"""Password hashing, JWT issuance/verification, and the current-user dependency.

The JWT is the single source of truth for tenant_id and role. The server NEVER trusts a
client-supplied tenant_id — it is always read from the verified token."""
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import Role, User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")


def hash_password(password: str) -> str:
    # bcrypt operates on the first 72 bytes; truncate explicitly to avoid errors.
    return bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8")[:72], hashed.encode("utf-8"))


def create_access_token(*, user_id: str, tenant_id: str, role: Role) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": user_id, "tenant_id": tenant_id, "role": role.value, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


class CurrentUser:
    def __init__(self, user: User):
        self.id = user.id
        self.tenant_id = user.tenant_id
        self.role = user.role
        self.email = user.email


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> CurrentUser:
    cred_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
        user_id = payload.get("sub")
        tenant_id = payload.get("tenant_id")
        if not user_id or not tenant_id:
            raise cred_exc
    except JWTError:
        raise cred_exc

    user = db.get(User, user_id)
    if user is None or not user.is_active or user.tenant_id != tenant_id:
        raise cred_exc
    return CurrentUser(user)
