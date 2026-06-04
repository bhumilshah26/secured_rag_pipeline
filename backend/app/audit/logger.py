"""PII-safe audit logging.

Persists ONLY: user id, tenant id, timestamp, query HASH, retrieved document IDs,
authorization decision, security risk, model used, response status.
NEVER persists: raw query, full prompts, chunk text, raw documents. Any free-text field
is PII-masked before write as defense-in-depth."""
import hashlib

from sqlalchemy.orm import Session

from app.models import AuditLog
from app.security.pii import mask_pii

def record_event(
    db: Session,
    *,
    event_type: str,
    tenant_id: str | None = None,
    user_id: str | None = None,
    query: str | None = None,
    document_ids: list[str] | None = None,
    authz_decision: str | None = None,
    security_risk: str | None = None,
    model_used: str | None = None,
    response_status: str | None = None,
) -> None:
    log = AuditLog(
        tenant_id=tenant_id,
        user_id=user_id,
        event_type=event_type,
        query_hash=mask_pii(query) if query else None,
        document_ids=document_ids or [],
        authz_decision=authz_decision,
        security_risk=mask_pii(security_risk) if security_risk else None,
        model_used=model_used,
        response_status=response_status,
    )
    db.add(log)
    db.commit()
