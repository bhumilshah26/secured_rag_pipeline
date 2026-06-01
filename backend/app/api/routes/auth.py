"""Auth + user management. /register bootstraps a tenant + its first ADMIN."""
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import logger as audit
from app.db import get_db
from app.models import Role, Tenant, User
from app.schemas import (
    CreateUserRequest,
    MeResponse,
    RegisterRequest,
    TokenResponse,
    UpdateProfileRequest,
)
from app.security.auth import (
    CurrentUser,
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from app.security.rbac import require_capability

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=201)
def register(req: RegisterRequest, db: Session = Depends(get_db)) -> TokenResponse:
    if db.scalar(select(Tenant).where(Tenant.slug == req.tenant_slug)):
        raise HTTPException(status_code=409, detail="Tenant slug already exists")
    tenant = Tenant(name=req.tenant_name, slug=req.tenant_slug)
    db.add(tenant)
    db.flush()
    admin = User(
        tenant_id=tenant.id,
        email=req.admin_email,
        hashed_password=hash_password(req.admin_password),
        role=Role.ADMIN,
    )
    db.add(admin)
    db.commit()
    audit.record_event(
        db, event_type="tenant.register", tenant_id=tenant.id, user_id=admin.id,
        response_status="201",
    )
    token = create_access_token(user_id=admin.id, tenant_id=tenant.id, role=Role.ADMIN)
    return TokenResponse(access_token=token, role=Role.ADMIN, tenant_id=tenant.id)


@router.post("/login", response_model=TokenResponse)
def login(
    form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)
) -> TokenResponse:
    # OAuth2 form uses `username`; we treat it as email.
    user = db.scalar(select(User).where(User.email == form.username))
    if not user or not verify_password(form.password, user.hashed_password) or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )
    audit.record_event(
        db, event_type="auth.login", tenant_id=user.tenant_id, user_id=user.id,
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
