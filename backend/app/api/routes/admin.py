"""Admin-only endpoints: audit log access. Tenant-scoped; ADMIN capability required."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import AuditLog
from app.security.auth import CurrentUser
from app.security.rbac import require_capability

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/audit")
def list_audit(
    limit: int = 100,
    db: Session = Depends(get_db),
    admin: CurrentUser = Depends(require_capability("read_audit")),
) -> list[dict]:
    rows = db.scalars(
        select(AuditLog)
        .where(AuditLog.tenant_id == admin.tenant_id)  # tenant isolation
        .order_by(AuditLog.created_at.desc())
        .limit(min(limit, 500))
    ).all()
    return [
        {
            "id": r.id,
            "event_type": r.event_type,
            "user_id": r.user_id,
            "query_hash": r.query_hash,
            "document_ids": r.document_ids,
            "authz_decision": r.authz_decision,
            "security_risk": r.security_risk,
            "model_used": r.model_used,
            "response_status": r.response_status,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]
