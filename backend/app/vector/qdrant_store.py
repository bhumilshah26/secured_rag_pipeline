"""Qdrant collection design + tenant/permission-filtered search.

Isolation invariant: EVERY search builds its filter server-side from the caller's JWT-derived
tenant_id and role. A client cannot widen the filter, so cross-tenant leakage is impossible
even if the embedding or query is adversarial."""
import uuid
from functools import lru_cache

from qdrant_client import QdrantClient
from qdrant_client.http import models as qm

from app.config import settings
from app.embeddings import get_embedding_provider

_PAYLOAD_INDEXES = {
    "tenant_id": qm.PayloadSchemaType.KEYWORD,
    "document_id": qm.PayloadSchemaType.KEYWORD,
    "allowed_roles": qm.PayloadSchemaType.KEYWORD,
}


@lru_cache
def get_client() -> QdrantClient:
    return QdrantClient(host=settings.qdrant_host, port=settings.qdrant_port)


def ensure_collection() -> None:
    client = get_client()
    dim = get_embedding_provider().dimension
    name = settings.qdrant_collection

    if client.collection_exists(name):
        # If the embedding dimension changed (e.g. switched models), the collection must be
        # recreated — vectors of a different size can't coexist. This drops existing vectors.
        existing = client.get_collection(name)
        current = existing.config.params.vectors.size
        if current != dim:
            client.delete_collection(name)

    if not client.collection_exists(name):
        client.create_collection(
            collection_name=name,
            vectors_config=qm.VectorParams(size=dim, distance=qm.Distance.COSINE),
        )
    for field, schema in _PAYLOAD_INDEXES.items():
        try:
            client.create_payload_index(name, field_name=field, field_schema=schema)
        except Exception:
            pass  # already exists


def upsert_chunks(
    *,
    tenant_id: str,
    document_id: str,
    source_id: str | None,
    title: str,
    allowed_roles: list[str],
    chunks: list[str],
    vectors: list[list[float]],
    sections: list[str] | None = None,
) -> None:
    sections = sections or [""] * len(chunks)
    points = [
        qm.PointStruct(
            id=str(uuid.uuid4()),
            vector=vec,
            payload={
                "tenant_id": tenant_id,
                "document_id": document_id,
                "source_id": source_id,
                "title": title,
                "section": sections[i],
                "allowed_roles": allowed_roles,
                "chunk_index": i,
                "text": chunk,  # for citation snippets only; never logged
            },
        )
        for i, (chunk, vec) in enumerate(zip(chunks, vectors))
    ]
    get_client().upsert(collection_name=settings.qdrant_collection, points=points)


def set_document_roles(*, tenant_id: str, document_id: str, allowed_roles: list[str]) -> None:
    """Update allowed_roles on all of a document's vectors in place — keeps retrieval
    filters in sync with permission changes without re-embedding."""
    flt = qm.Filter(
        must=[
            qm.FieldCondition(key="tenant_id", match=qm.MatchValue(value=tenant_id)),
            qm.FieldCondition(key="document_id", match=qm.MatchValue(value=document_id)),
        ]
    )
    get_client().set_payload(
        collection_name=settings.qdrant_collection,
        payload={"allowed_roles": allowed_roles},
        points=qm.FilterSelector(filter=flt),
    )


def delete_source(*, tenant_id: str, source_id: str) -> None:
    """Delete all vectors belonging to a data source (tenant-scoped)."""
    flt = qm.Filter(
        must=[
            qm.FieldCondition(key="tenant_id", match=qm.MatchValue(value=tenant_id)),
            qm.FieldCondition(key="source_id", match=qm.MatchValue(value=source_id)),
        ]
    )
    get_client().delete(
        collection_name=settings.qdrant_collection,
        points_selector=qm.FilterSelector(filter=flt),
    )


def delete_document(*, tenant_id: str, document_id: str) -> None:
    flt = qm.Filter(
        must=[
            qm.FieldCondition(key="tenant_id", match=qm.MatchValue(value=tenant_id)),
            qm.FieldCondition(key="document_id", match=qm.MatchValue(value=document_id)),
        ]
    )
    get_client().delete(
        collection_name=settings.qdrant_collection,
        points_selector=qm.FilterSelector(filter=flt),
    )


def secure_search(
    *,
    tenant_id: str,
    allowed_roles: list[str] | None,
    query_vector: list[float],
    limit: int = 5,
    score_threshold: float | None = None,
    document_ids: list[str] | None = None,
) -> list[dict]:
    """Search with a MANDATORY tenant filter and (unless ADMIN) a role filter.

    allowed_roles=None means ADMIN: tenant filter only (all docs in tenant).
    score_threshold drops weakly-matching (irrelevant) chunks server-side.
    document_ids (if given) restricts the search to specific documents — used by hybrid
    retrieval when the user names a document in their query.
    """
    must = [qm.FieldCondition(key="tenant_id", match=qm.MatchValue(value=tenant_id))]
    if allowed_roles is not None:
        must.append(
            qm.FieldCondition(key="allowed_roles", match=qm.MatchAny(any=allowed_roles))
        )
    if document_ids:
        must.append(
            qm.FieldCondition(key="document_id", match=qm.MatchAny(any=document_ids))
        )
    flt = qm.Filter(must=must)

    hits = get_client().search(
        collection_name=settings.qdrant_collection,
        query_vector=query_vector,
        query_filter=flt,
        limit=limit,
        score_threshold=score_threshold,
        with_payload=True,
    )
    return [
        {
            "document_id": h.payload.get("document_id"),
            "title": h.payload.get("title", ""),
            "section": h.payload.get("section", ""),
            "text": h.payload.get("text", ""),
            "score": h.score,
        }
        for h in hits
    ]
