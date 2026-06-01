"""Shared FastAPI dependencies, re-exported for convenience."""
from app.db import get_db
from app.security.auth import get_current_user
from app.security.rbac import require_capability

__all__ = ["get_db", "get_current_user", "require_capability"]
