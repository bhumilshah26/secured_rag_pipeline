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

from fastembed import SparseTextEmbedding

_PAYLOAD_INDEXES = {
    "tenant_id": qm.PayloadSchemaType.KEYWORD,
    "document_id": qm.PayloadSchemaType.KEYWORD,
    "allowed_roles": qm.PayloadSchemaType.KEYWORD,
}

_DENSE = "dense"   # named dense vector (semantic embeddings)
_SPARSE = "bm25"   # named sparse vector (BM25 lexical)


@lru_cache
def get_client() -> QdrantClient:
    return QdrantClient(host=settings.qdrant_host, port=settings.qdrant_port)

@lru_cache
def _bm25():
    """FastEmbed BM25 sparse encoder. Produces term-frequency sparse vectors; Qdrant applies
    the IDF component (via the collection's IDF modifier) for full BM25 scoring."""

    return SparseTextEmbedding(model_name="Qdrant/bm25")

def _sparse_docs(texts: list[str]) -> list[qm.SparseVector]:
    return [
        qm.SparseVector(indices=s.indices.tolist(), values=s.values.tolist())
        for s in _bm25().embed(texts)
    ]

def _sparse_query(text: str) -> qm.SparseVector:
    s = next(_bm25().query_embed(text))
    return qm.SparseVector(indices=s.indices.tolist(), values=s.values.tolist())

def ensure_collection() -> None:
    """Collection holds BOTH a named dense vector (semantic) and a named BM25 sparse vector
    (lexical), enabling hybrid retrieval. Recreated if the schema/dimension differs (drops
    existing vectors -> re-index)."""
    client = get_client()
    dim = get_embedding_provider().dimension
    name = settings.qdrant_collection

    if client.collection_exists(name):
        params = client.get_collection(name).config.params
        vectors = params.vectors
        sparse = params.sparse_vectors or {}
        compatible = (
            isinstance(vectors, dict)
            and _DENSE in vectors
            and vectors[_DENSE].size == dim
            and _SPARSE in sparse
        )
        if not compatible:
            client.delete_collection(name)

    if not client.collection_exists(name):
        client.create_collection(
            collection_name=name,
            vectors_config={_DENSE: qm.VectorParams(size=dim, distance=qm.Distance.COSINE)},
            sparse_vectors_config={_SPARSE: qm.SparseVectorParams(modifier=qm.Modifier.IDF)},
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
    sparse = _sparse_docs(chunks)  # BM25 lexical vectors computed from the same chunk text
    points = [
        qm.PointStruct(
            id=str(uuid.uuid4()),
            vector={_DENSE: vec, _SPARSE: sparse[i]},
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
    query_text: str,
    limit: int = 5,
) -> list[dict]:
    """Hybrid retrieval: dense (semantic) + BM25 (lexical) candidates fused with Reciprocal
    Rank Fusion. A MANDATORY tenant filter (and, unless ADMIN, a role filter) is applied to
    BOTH branches, so isolation holds for the lexical path too.

    allowed_roles=None means ADMIN: tenant filter only (all docs in tenant).
    """
    must = [qm.FieldCondition(key="tenant_id", match=qm.MatchValue(value=tenant_id))]
    if allowed_roles is not None:
        must.append(
            qm.FieldCondition(key="allowed_roles", match=qm.MatchAny(any=allowed_roles))
        )
    flt = qm.Filter(must=must)
    prefetch_limit = max(limit * 4, 20)

    result = get_client().query_points(
        collection_name=settings.qdrant_collection,
        prefetch=[
            qm.Prefetch(query=query_vector, using=_DENSE, filter=flt, limit=prefetch_limit),
            qm.Prefetch(query=_sparse_query(query_text), using=_SPARSE, filter=flt, limit=prefetch_limit),
        ],
        query=qm.FusionQuery(fusion=qm.Fusion.RRF),
        limit=limit,
        with_payload=True,
    )
    return [
        {
            "document_id": h.payload.get("document_id"),
            "title": h.payload.get("title", ""),
            "section": h.payload.get("section", ""),
            "text": h.payload.get("text", ""),
            "score": h.score,  # RRF fused score
        }
        for h in result.points
    ]
