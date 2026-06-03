"""Ingestion pipeline: extract -> chunk -> embed -> upsert to Qdrant + record metadata.

Tenant_id and allowed_roles are stamped onto every vector payload so retrieval-time
filtering can enforce isolation and document-level permissions."""
import hashlib

from sqlalchemy.orm import Session

from app.config import settings
from app.embeddings import get_embedding_provider
from app.ingestion.chunker import chunk_sections
from app.ingestion.extractor import extract_sections
from app.models import Document, DocumentPermission, Role
from app.vector import qdrant_store


def ingest_document(
    db: Session,
    *,
    tenant_id: str,
    title: str,
    raw: bytes | str,
    allowed_roles: list[Role],
    mime_type: str = "text/plain",
    source_id: str | None = None,
    external_id: str | None = None,
) -> Document:
    sections = extract_sections(raw=raw, mime_type=mime_type, filename=title)
    checksum = hashlib.sha256(
        "".join(s.text for s in sections).encode("utf-8")
    ).hexdigest()
    # ADMIN always has access — included on every document by default.
    role_set = set(allowed_roles) | {Role.ADMIN}
    role_values = sorted(r.value for r in role_set)

    doc = Document(
        tenant_id=tenant_id,
        source_id=source_id,
        external_id=external_id,
        title=title,
        mime_type=mime_type,
        checksum=checksum,
        status="pending",
    )
    db.add(doc)
    db.flush()  # assign doc.id

    for role in role_set:
        db.add(DocumentPermission(document_id=doc.id, tenant_id=tenant_id, role=role))

    chunks = chunk_sections(
        sections, chunk_words=settings.chunk_words, overlap=settings.chunk_overlap
    )
    if chunks:
        texts = [c.text for c in chunks]
        vectors = get_embedding_provider().embed(texts)
        qdrant_store.upsert_chunks(
            tenant_id=tenant_id,
            document_id=doc.id,
            source_id=source_id,
            title=title,
            allowed_roles=role_values,
            chunks=texts,
            vectors=vectors,
            sections=[c.section for c in chunks],
        )
    doc.chunk_count = len(chunks)
    doc.status = "indexed" if chunks else "failed"
    db.commit()
    db.refresh(doc)
    return doc
