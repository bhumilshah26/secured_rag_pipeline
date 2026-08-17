"""Auth + user management. /register bootstraps a tenant + its first ADMIN."""
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import logger as audit
from app.config import settings
from app.db import get_db
from app.models import Role, Tenant, User
from app.schemas import (
    AuthPendingResponse,
    CreateUserRequest,
    MeResponse,
    RegisterRequest,
    TokenResponse,
    UpdateProfileRequest,
    UserOut,
    VerifyOtpRequest,
)
from app.security.auth import (
    CurrentUser,
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from app.security.otp import (
    MailDeliveryError,
    create_or_replace_otp,
    create_or_replace_pending_registration,
    find_valid_pending_registration,
    send_otp_email,
    validate_otp,
)
from app.security.rbac import require_capability

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


def _issue_token(user: User) -> TokenResponse:
    token = create_access_token(user_id=user.id, tenant_id=user.tenant_id, role=user.role)
    return TokenResponse(access_token=token, role=user.role, tenant_id=user.tenant_id)


def _start_second_factor(
    db: Session, user: User, purpose: str
) -> AuthPendingResponse | TokenResponse:
    """Send the login OTP and ask the caller to come back with it. With OTP_ENABLED=false
    the second factor is skipped and the token is issued straight away."""
    if not settings.otp_enabled:
        audit.record_event(
            db, event_type=f"auth.{purpose}.otp.disabled", tenant_id=user.tenant_id,
            user_id=user.id, response_status="200",
        )
        return _issue_token(user)

    otp = create_or_replace_otp(db, user, purpose=purpose)
    try:
        send_otp_email(user.email, otp.code)
    except MailDeliveryError as exc:
        # The reason names configuration, so it is logged rather than returned to the caller.
        logger.error("OTP delivery failed for purpose=%s: %s", purpose, exc)
        audit.record_event(
            db, event_type=f"auth.{purpose}.otp.undeliverable", tenant_id=user.tenant_id,
            user_id=user.id, response_status="503",
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not send the verification code. Check the server mail configuration.",
        ) from exc

    audit.record_event(
        db, event_type=f"auth.{purpose}.otp.sent", tenant_id=user.tenant_id,
        user_id=user.id, response_status="200",
    )
    return AuthPendingResponse(user_id=user.id, email=user.email, pending=True)


def _create_tenant_with_admin(db: Session, *, name: str, slug: str, email: str, hashed: str) -> User:
    tenant = Tenant(name=name, slug=slug)
    db.add(tenant)
    db.flush()
    admin = User(tenant_id=tenant.id, email=email, hashed_password=hashed, role=Role.ADMIN)
    db.add(admin)
    return admin


@router.post("/register", response_model=None, status_code=201)
def register(
    req: RegisterRequest, db: Session = Depends(get_db)
) -> AuthPendingResponse | TokenResponse:
    """Hold the signup and email a code. Nothing is created until /verify-otp succeeds, so
    an unverified attempt cannot claim a slug or leave an orphaned tenant."""
    if db.scalar(select(Tenant).where(Tenant.slug == req.tenant_slug)):
        raise HTTPException(status_code=409, detail="Tenant slug already exists")

    hashed = hash_password(req.admin_password)

    # Nothing to verify against when the second factor is off, so create it outright.
    if not settings.otp_enabled:
        admin = _create_tenant_with_admin(
            db, name=req.tenant_name, slug=req.tenant_slug, email=req.admin_email, hashed=hashed
        )
        db.commit()
        audit.record_event(
            db, event_type="tenant.register.otp.disabled", tenant_id=admin.tenant_id,
            user_id=admin.id, response_status="201",
        )
        return _issue_token(admin)

    pending = create_or_replace_pending_registration(
        db,
        tenant_name=req.tenant_name,
        tenant_slug=req.tenant_slug,
        email=req.admin_email,
        hashed_password=hashed,
    )
    try:
        send_otp_email(pending.email, pending.code)
    except MailDeliveryError as exc:
        # Undeliverable code means the signup can never be completed; drop the held row
        # rather than leaving it to expire.
        logger.error("OTP delivery failed for purpose=register: %s", exc)
        db.delete(pending)
        db.commit()
        audit.record_event(
            db, event_type="tenant.register.otp.undeliverable", response_status="503",
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not send the verification code. Check the server mail configuration.",
        ) from exc

    audit.record_event(
        db, event_type="tenant.register.otp.sent", response_status="201",
    )
    return AuthPendingResponse(email=pending.email, pending=True)


@router.post("/login", response_model=None)
def login(
    form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)
) -> AuthPendingResponse | TokenResponse:
    # OAuth2 form uses `username`; we treat it as email.
    user = db.scalar(select(User).where(User.email == form.username))
    if not user or not verify_password(form.password, user.hashed_password) or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )
    return _start_second_factor(db, user, purpose="login")


def _complete_registration(db: Session, *, email: str, code: str) -> TokenResponse:
    """Create the tenant and its first ADMIN, now that the address is proven."""
    pending = find_valid_pending_registration(db, email=email, code=code)
    if pending is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired OTP"
        )
    # Checked again here: another signup may have taken the slug while this one waited.
    if db.scalar(select(Tenant).where(Tenant.slug == pending.tenant_slug)):
        db.delete(pending)
        db.commit()
        raise HTTPException(status_code=409, detail="Tenant slug already exists")

    admin = _create_tenant_with_admin(
        db,
        name=pending.tenant_name,
        slug=pending.tenant_slug,
        email=pending.email,
        hashed=pending.hashed_password,  # already hashed at /register
    )
    db.delete(pending)
    db.commit()

    audit.record_event(
        db, event_type="tenant.register.verified", tenant_id=admin.tenant_id,
        user_id=admin.id, response_status="200",
    )
    return _issue_token(admin)


@router.post("/verify-otp", response_model=TokenResponse)
def verify_otp(req: VerifyOtpRequest, db: Session = Depends(get_db)) -> TokenResponse:
    if req.purpose == "register":
        return _complete_registration(db, email=req.email, code=req.code)

    user = db.scalar(select(User).where(User.email == req.email))
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )
    if not validate_otp(db, user, req.code, purpose=req.purpose):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired OTP"
        )
    audit.record_event(
        db, event_type="auth.otp.verify", tenant_id=user.tenant_id, user_id=user.id,
        response_status="200",
    )
    token = create_access_token(user_id=user.id, tenant_id=user.tenant_id, role=user.role)
    return TokenResponse(access_token=token, role=user.role, tenant_id=user.tenant_id)


@router.get("/me", response_model=MeResponse)
def me(
    db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)
) -> MeResponse:
    u = db.get(User, user.id)
    return MeResponse(id=u.id, email=u.email, role=u.role, tenant_id=u.tenant_id)


@router.patch("/me", response_model=MeResponse)
def update_me(
    req: UpdateProfileRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> MeResponse:
    u = db.get(User, user.id)
    if req.email and req.email != u.email:
        clash = db.scalar(
            select(User).where(
                User.tenant_id == u.tenant_id, User.email == req.email, User.id != u.id
            )
        )
        if clash:
            raise HTTPException(status_code=409, detail="Email already in use in this tenant")
        u.email = req.email
    if req.password:
        u.hashed_password = hash_password(req.password)
    db.commit()
    audit.record_event(
        db, event_type="profile.update", tenant_id=u.tenant_id, user_id=u.id,
        response_status="200",
    )
    return MeResponse(id=u.id, email=u.email, role=u.role, tenant_id=u.tenant_id)


@router.get("/users", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    admin: CurrentUser = Depends(require_capability("manage_tenant")),
) -> list[User]:
    """List members of the admin's tenant (tenant-scoped, ADMIN only)."""
    return list(
        db.scalars(
            select(User).where(User.tenant_id == admin.tenant_id).order_by(User.created_at)
        ).all()
    )


@router.post("/users", status_code=201)
def create_user(
    req: CreateUserRequest,
    db: Session = Depends(get_db),
    admin: CurrentUser = Depends(require_capability("manage_tenant")),
) -> dict:
    exists = db.scalar(
        select(User).where(User.tenant_id == admin.tenant_id, User.email == req.email)
    )
    if exists:
        raise HTTPException(status_code=409, detail="User already exists in tenant")
    user = User(
        tenant_id=admin.tenant_id,
        email=req.email,
        hashed_password=hash_password(req.password),
        role=req.role,
    )
    db.add(user)
    db.commit()
    return {"id": user.id, "email": user.email, "role": user.role.value}


@router.delete("/users/{user_id}")
def delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    admin: CurrentUser = Depends(require_capability("manage_tenant")),
) -> dict:
    """Remove a member from the admin's tenant. Admins cannot delete themselves."""
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="You cannot remove your own account")
    user = db.get(User, user_id)
    if not user or user.tenant_id != admin.tenant_id:  # tenant isolation
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()
    audit.record_event(
        db, event_type="user.delete", tenant_id=admin.tenant_id, user_id=admin.id,
        response_status="200",
    )
    return {"deleted": True, "user_id": user_id}
