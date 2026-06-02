"""Data-source connectors: register a source, connect it via Composio OAuth, and sync.

Connector secrets/tokens are NOT stored here — only non-secret metadata. OAuth is brokered
by Composio, scoped to the tenant (Composio user_id == tenant_id)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import logger as audit
from app.config import settings
from app.connectors import get_connector
from app.db import get_db
from app.ingestion.pipeline import ingest_document
from app.models import DataSource, Document, Role
from app.vector import qdrant_store
from app.schemas import (
    ConnectorFile,
    IngestSelectedRequest,
    RegisterConnectorRequest,
    UpdateConnectorRequest,
)
from app.security.auth import CurrentUser
from app.security.rbac import require_capability

router = APIRouter(prefix="/connectors", tags=["connectors"])


def _owned_source(db: Session, *, source_id: str, tenant_id: str) -> DataSource:
    src = db.get(DataSource, source_id)
    if not src or src.tenant_id != tenant_id:  # tenant isolation
        raise HTTPException(status_code=404, detail="data source not found")
    return src


@router.post("", status_code=201)
def register_connector(
    req: RegisterConnectorRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_capability("connect_source")),
) -> dict:
    src = DataSource(
        tenant_id=user.tenant_id, kind=req.kind, display_name=req.display_name,
        config=req.config, status="registered",
    )
    db.add(src)
    db.commit()
    audit.record_event(
        db, event_type="connector.register", tenant_id=user.tenant_id, user_id=user.id,
        response_status="201",
    )
    return {"id": src.id, "kind": src.kind.value, "status": src.status}


@router.get("")
def list_connectors(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_capability("connect_source")),
) -> list[dict]:
    sources = db.scalars(
        select(DataSource).where(DataSource.tenant_id == user.tenant_id)
    ).all()
    return [
        {"id": s.id, "kind": s.kind.value, "display_name": s.display_name, "status": s.status}
        for s in sources
    ]


@router.patch("/{source_id}")
def update_connector(
    source_id: str,
    req: UpdateConnectorRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_capability("connect_source")),
) -> dict:
    """Update a source's config (e.g. set the Composio action slugs) or display name."""
    src = _owned_source(db, source_id=source_id, tenant_id=user.tenant_id)
    if req.display_name is not None:
        src.display_name = req.display_name
    if req.config is not None:
        src.config = req.config
    db.commit()
    return {"id": src.id, "kind": src.kind.value, "display_name": src.display_name,
            "config": src.config, "status": src.status}


@router.delete("/{source_id}")
def delete_connector(
    source_id: str,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_capability("connect_source")),
) -> dict:
    """Remove a data source and everything ingested from it: documents, their permissions
    (ORM cascade), and their vectors in Qdrant. Tenant-scoped."""
    src = _owned_source(db, source_id=source_id, tenant_id=user.tenant_id)
    docs = db.scalars(
        select(Document).where(
            Document.tenant_id == user.tenant_id, Document.source_id == src.id
        )
    ).all()
    removed = len(docs)
    for doc in docs:
        db.delete(doc)  # cascades document_permissions
    qdrant_store.delete_source(tenant_id=user.tenant_id, source_id=src.id)
    db.delete(src)
    db.commit()
    audit.record_event(
        db, event_type="connector.delete", tenant_id=user.tenant_id, user_id=user.id,
        response_status="200",
    )
    return {"deleted": True, "documents_removed": removed}


@router.post("/{source_id}/connect")
def connect_connector(
    source_id: str,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_capability("connect_source")),
) -> dict:
    """Begin Composio OAuth for this source; returns a redirect_url for the user to authorize.

    The auth-config id is resolved server-side from settings by toolkit kind, so end users
    never deal with developer-side Composio credentials."""
    src = _owned_source(db, source_id=source_id, tenant_id=user.tenant_id)
    auth_config_id = settings.composio_auth_config_for(src.kind.value)
    if not auth_config_id:
        raise HTTPException(
            status_code=400,
            detail=(
                f"No Composio auth config set for '{src.kind.value}'. "
                f"Set COMPOSIO_AUTHCONFIG_{src.kind.value.upper()} in the backend .env."
            ),
        )
    connector = get_connector(src.kind.value, user.tenant_id)
    result = connector.initiate_connection(auth_config_id)
    src.status = "connecting"
    db.commit()
    audit.record_event(
        db, event_type="connector.connect", tenant_id=user.tenant_id, user_id=user.id,
        response_status="200",
    )
    return result


@router.get("/{source_id}/status")
def connector_status(
    source_id: str,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_capability("connect_source")),
) -> dict:
    src = _owned_source(db, source_id=source_id, tenant_id=user.tenant_id)
    connector = get_connector(src.kind.value, user.tenant_id)
    status = connector.connection_status()
    if status.get("connected") and src.status != "connected":
        src.status = "connected"
        db.commit()
    return status


@router.get("/{source_id}/files", response_model=list[ConnectorFile])
def list_files(
    source_id: str,
    q: str | None = None,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_capability("connect_source")),
) -> list[ConnectorFile]:
    """List/search items available from the source WITHOUT ingesting, so the user can choose.
    `q` searches by name/title (server-side where the toolkit supports it)."""
    src = _owned_source(db, source_id=source_id, tenant_id=user.tenant_id)
    connector = get_connector(src.kind.value, user.tenant_id)
    return [ConnectorFile(**f) for f in connector.list_items(src.config, query=q)]


def _ingest_fetched(db, *, user, src, external_ids, allowed_roles) -> dict:
    connector = get_connector(src.kind.value, user.tenant_id)
    fetched = connector.fetch_documents(src.config, external_ids=external_ids)
    doc_ids: list[str] = []
    for fd in fetched:
        doc = ingest_document(
            db, tenant_id=user.tenant_id, title=fd.title, raw=fd.content,
            allowed_roles=allowed_roles, mime_type=fd.mime_type,
            source_id=src.id, external_id=fd.external_id,
        )
        doc_ids.append(doc.id)
    audit.record_event(
        db, event_type="connector.ingest", tenant_id=user.tenant_id, user_id=user.id,
        document_ids=doc_ids, response_status="200",
    )
    return {"ingested": len(doc_ids), "document_ids": doc_ids}


@router.post("/{source_id}/ingest")
def ingest_selected(
    source_id: str,
    req: IngestSelectedRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_capability("ingest")),
) -> dict:
    """Index only the files the user selected, with chosen role permissions."""
    src = _owned_source(db, source_id=source_id, tenant_id=user.tenant_id)
    return _ingest_fetched(
        db, user=user, src=src, external_ids=req.external_ids, allowed_roles=req.allowed_roles
    )


@router.post("/{source_id}/sync")
def sync_connector(
    source_id: str,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_capability("ingest")),
) -> dict:
    """Ingest ALL files from the source (bulk). Prefer /files + /ingest for selection."""
    src = _owned_source(db, source_id=source_id, tenant_id=user.tenant_id)
    return _ingest_fetched(
        db, user=user, src=src, external_ids=None, allowed_roles=[Role.VIEWER]
    )
