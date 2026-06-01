"""Role-based access control: capability gates and document-level read checks."""
from fastapi import Depends, HTTPException, status

from app.models import Role
from app.security.auth import CurrentUser, get_current_user

# Capability -> roles allowed. ADMIN is implicitly allowed everywhere via require_role.
CAPABILITIES: dict[str, set[Role]] = {
    "manage_tenant": {Role.ADMIN},
    "connect_source": {Role.ADMIN, Role.HR, Role.MANAGER},
    "ingest": {Role.ADMIN, Role.HR, Role.MANAGER},
    "set_permissions": {Role.ADMIN, Role.HR, Role.MANAGER},
    "query": {Role.ADMIN, Role.HR, Role.ANALYST, Role.MANAGER, Role.VIEWER},
    "read_audit": {Role.ADMIN},
}


def require_capability(capability: str):
    allowed = CAPABILITIES.get(capability, set())

    def _dep(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role is Role.ADMIN or user.role in allowed:
            return user
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Role {user.role.value} lacks capability '{capability}'",
        )

    return _dep


def readable_roles_for(user: CurrentUser) -> list[str] | None:
    """Roles whose documents this user may read. None == ADMIN (all tenant docs)."""
    if user.role is Role.ADMIN:
        return None
    return [user.role.value]
