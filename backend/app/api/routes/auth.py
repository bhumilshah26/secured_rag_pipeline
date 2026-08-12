"""Auth + user management. /register bootstraps a tenant + its first ADMIN."""
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import logger as audit
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
    create_or_replace_otp,
    create_or_replace_pending_registration,
    find_valid_pending_registration,
    send_otp_email,
    validate_otp,
)
from app.security.rbac import require_capability

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=AuthPendingResponse, status_code=201)
def register(req: RegisterRequest, db: Session = Depends(get_db)) -> AuthPendingResponse:
    """Hold the signup and email a code. Nothing is created until /verify-otp succeeds, so
    an unverified attempt cannot claim a slug or leave an orphaned tenant."""
    if db.scalar(select(Tenant).where(Tenant.slug == req.tenant_slug)):
        raise HTTPException(status_code=409, detail="Tenant slug already exists")

    pending = create_or_replace_pending_registration(
        db,
        tenant_name=req.tenant_name,
        tenant_slug=req.tenant_slug,
        email=req.admin_email,
        hashed_password=hash_password(req.admin_password),
    )
    try:
        send_otp_email(pending.email, pending.code)
    except Exception as exc:
        # Undeliverable code means the signup can never be completed; drop the held row
        # rather than leaving it to expire.
        db.delete(pending)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not send the verification code. Check the server mail configuration.",
        ) from exc

    audit.record_event(
        db, event_type="tenant.register.otp.sent", response_status="201",
    )
    return AuthPendingResponse(email=pending.email, pending=True)


@router.post("/login", response_model=AuthPendingResponse)
def login(
    form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)
) -> TokenResponse:
    # OAuth2 form uses `username`; we treat it as email.
    user = db.scalar(select(User).where(User.email == form.username))
    if not user or not verify_password(form.password, user.hashed_password) or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )
    otp = create_or_replace_otp(db, user, purpose="login")
    send_otp_email(user.email, otp.code)
    audit.record_event(
        db, event_type="auth.login.otp.sent", tenant_id=user.tenant_id, user_id=user.id,
        response_status="200",
    )
    return AuthPendingResponse(user_id=user.id, email=user.email, pending=True)


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

    tenant = Tenant(name=pending.tenant_name, slug=pending.tenant_slug)
    db.add(tenant)
    db.flush()
    admin = User(
        tenant_id=tenant.id,
        email=pending.email,
        hashed_password=pending.hashed_password,  # already hashed at /register
        role=Role.ADMIN,
    )
    db.add(admin)
    db.delete(pending)
    db.commit()

    audit.record_event(
        db, event_type="tenant.register.verified", tenant_id=tenant.id, user_id=admin.id,
        response_status="200",
    )
    token = create_access_token(user_id=admin.id, tenant_id=tenant.id, role=admin.role)
    return TokenResponse(access_token=token, role=admin.role, tenant_id=tenant.id)


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
