"""Document ingestion, listing, and document-level permission management.

All queries are tenant-scoped via the JWT-derived tenant_id. A user can never read or modify
another tenant's documents."""
from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import logger as audit
from app.db import get_db
from app.ingestion.pipeline import ingest_document
from app.models import Document, DocumentPermission, Role
from app.schemas import DocumentOut, IngestTextRequest, SetPermissionsRequest
from app.security.auth import CurrentUser, get_current_user
from app.security.rbac import require_capability
from app.vector import qdrant_store

router = APIRouter(prefix="/documents", tags=["documents"])


def _to_out(db: Session, doc: Document) -> DocumentOut:
    roles = db.scalars(
        select(DocumentPermission.role).where(DocumentPermission.document_id == doc.id)
    ).all()
    return DocumentOut(
        id=doc.id, title=doc.title, status=doc.status, chunk_count=doc.chunk_count,
        allowed_roles=list(roles), created_at=doc.created_at,
    )


@router.post("/text", response_model=DocumentOut, status_code=201)
def ingest_text(
    req: IngestTextRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_capability("ingest")),
) -> DocumentOut:
    doc = ingest_document(
        db, tenant_id=user.tenant_id, title=req.title, raw=req.content,
        allowed_roles=req.allowed_roles, source_id=None,
    )
    audit.record_event(
        db, event_type="document.ingest", tenant_id=user.tenant_id, user_id=user.id,
        document_ids=[doc.id], response_status="201",
    )
    return _to_out(db, doc)


def _parse_roles(raw: str | None) -> list[Role]:
    if not raw:
        return [Role.VIEWER]
    roles: list[Role] = []
    for part in raw.split(","):
        part = part.strip().upper()
        if part:
            try:
                roles.append(Role(part))
            except ValueError:
                raise HTTPException(status_code=422, detail=f"invalid role: {part}")
    return roles or [Role.VIEWER]


@router.post("/upload", response_model=DocumentOut, status_code=201)
async def upload(
    file: UploadFile,
    allowed_roles: str | None = Form(default=None),  # comma-separated, e.g. "VIEWER,MANAGER"
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_capability("ingest")),
) -> DocumentOut:
    raw = await file.read()
    doc = ingest_document(
        db, tenant_id=user.tenant_id, title=file.filename or "uploaded",
        raw=raw, allowed_roles=_parse_roles(allowed_roles),
        mime_type=file.content_type or "text/plain",
    )
    audit.record_event(
        db, event_type="document.upload", tenant_id=user.tenant_id, user_id=user.id,
        document_ids=[doc.id], response_status="201",
    )
    return _to_out(db, doc)


@router.get("", response_model=list[DocumentOut])
def list_documents(
    db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)
) -> list[DocumentOut]:
    # Role-scoped: ADMIN sees all tenant docs; others only docs their role may retrieve.
    stmt = select(Document).where(Document.tenant_id == user.tenant_id)
    if user.role is not Role.ADMIN:
        stmt = (
            stmt.join(DocumentPermission, DocumentPermission.document_id == Document.id)
            .where(DocumentPermission.role == user.role)
        )
    docs = db.scalars(stmt.order_by(Document.created_at.desc()).distinct()).all()
    return [_to_out(db, d) for d in docs]


def _get_owned_doc(db: Session, *, doc_id: str, tenant_id: str) -> Document:
    doc = db.get(Document, doc_id)
    if not doc or doc.tenant_id != tenant_id:  # tenant isolation
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.put("/{doc_id}/permissions", response_model=DocumentOut)
def set_permissions(
    doc_id: str,
    req: SetPermissionsRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_capability("set_permissions")),
) -> DocumentOut:
    doc = _get_owned_doc(db, doc_id=doc_id, tenant_id=user.tenant_id)
    db.query(DocumentPermission).filter(DocumentPermission.document_id == doc.id).delete()
    roles = set(req.allowed_roles) | {Role.ADMIN}  # ADMIN access is compulsory
    for role in roles:
        db.add(DocumentPermission(document_id=doc.id, tenant_id=user.tenant_id, role=role))
    db.commit()
    # keep vector payloads in sync so retrieval filters reflect new permissions (no re-embed)
    qdrant_store.set_document_roles(
        tenant_id=user.tenant_id,
        document_id=doc.id,
        allowed_roles=sorted(r.value for r in roles),
    )
    audit.record_event(
        db, event_type="document.set_permissions", tenant_id=user.tenant_id,
        user_id=user.id, document_ids=[doc.id], response_status="200",
    )
    return _to_out(db, doc)


@router.delete("/{doc_id}")
def delete_document(
    doc_id: str,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_capability("ingest")),
) -> dict:
    """Delete an indexed document: its DB row (+ permissions via cascade) and its vectors."""
    doc = _get_owned_doc(db, doc_id=doc_id, tenant_id=user.tenant_id)
    qdrant_store.delete_document(tenant_id=user.tenant_id, document_id=doc.id)
    db.delete(doc)  # cascades document_permissions
    db.commit()
    audit.record_event(
        db, event_type="document.delete", tenant_id=user.tenant_id,
        user_id=user.id, document_ids=[doc_id], response_status="200",
    )
    return {"deleted": True, "document_id": doc_id}
