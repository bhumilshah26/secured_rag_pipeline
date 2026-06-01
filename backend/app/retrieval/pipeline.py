"""Secure retrieval pipeline:

  1. Prompt guard scores the query; BLOCK -> refuse + audit.
  2. Embed query, search Qdrant with a MANDATORY tenant + role filter.
  3. Build an immutable prompt (context = untrusted data slot).
  4. Generate answer via the configured LLM.
  5. Audit (IDs + hashes only) and return answer + citations.
"""
import re
from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import logger as audit
from app.config import settings
from app.embeddings import get_embedding_provider
from app.llm import get_llm_provider
from app.models import Document
from app.prompts.templates import SYSTEM_INSTRUCTION, build_context_block
from app.security.auth import CurrentUser
from app.security.prompt_guard import scan_query
from app.security.rbac import readable_roles_for
from app.vector import qdrant_store


@dataclass
class RetrievalAnswer:
    answer: str
    citations: list[dict]
    security_risk: str
    model_used: str


def _resolve_named_documents(
    db: Session, *, tenant_id: str, query: str
) -> tuple[list[str], str]:
    """Keyword stage: if the query names a document (by title), return those document ids
    and the query with the title text removed (so the semantic stage focuses on the rest).
    Tenant-scoped, so only this tenant's titles are ever matched."""
    rows = db.execute(
        select(Document.id, Document.title).where(Document.tenant_id == tenant_id)
    ).all()
    q_lower = query.lower()
    matched: list[str] = []
    cleaned = query
    for doc_id, title in rows:
        base = re.sub(r"\.\w+$", "", (title or "")).strip().lower()  # drop extension
        if len(base) >= 3 and base in q_lower:
            matched.append(doc_id)
            cleaned = re.sub(re.escape(base), " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return matched, (cleaned or query)


def answer_query(
    db: Session, *, user: CurrentUser, query: str, top_k: int | None = None
) -> RetrievalAnswer:
    top_k = top_k or settings.retrieval_top_k
    guard = scan_query(query)

    if guard.blocked:
        audit.record_event(
            db,
            event_type="chat.blocked",
            tenant_id=user.tenant_id,
            user_id=user.id,
            query=query,
            authz_decision="ALLOWED",
            security_risk=f"BLOCK:{guard.score}:{','.join(guard.categories)}",
            response_status="403",
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Query blocked by security policy (possible prompt injection).",
        )

    # Hybrid retrieval: keyword-resolve any document named in the query, then run semantic
    # search (on the remaining query text) scoped to those documents when found.
    named_doc_ids, semantic_query = _resolve_named_documents(
        db, tenant_id=user.tenant_id, query=query
    )
    query_vector = get_embedding_provider().embed_one(semantic_query)
    # When a specific document is named, don't score-threshold it away — the user asked for it.
    threshold = None if named_doc_ids else settings.retrieval_score_threshold
    hits = qdrant_store.secure_search(
        tenant_id=user.tenant_id,
        allowed_roles=readable_roles_for(user),
        query_vector=query_vector,
        limit=top_k,
        score_threshold=threshold,
        document_ids=named_doc_ids or None,
    )

    # Context for the LLM uses the relevant chunks (already score-filtered).
    context = build_context_block([h["text"] for h in hits])
    llm = get_llm_provider()
    answer = llm.generate(system=SYSTEM_INSTRUCTION, context=context, query=query)

    # Citations list only DISTINCT relevant documents (best-scoring chunk per document),
    # capped at retrieval_max_documents — so users see relevant sources, not chunk noise.
    best_per_doc: dict[str, dict] = {}
    for h in hits:
        doc_id = h["document_id"]
        if doc_id not in best_per_doc or h["score"] > best_per_doc[doc_id]["score"]:
            best_per_doc[doc_id] = h
    ranked = sorted(best_per_doc.values(), key=lambda h: h["score"], reverse=True)
    ranked = ranked[: settings.retrieval_max_documents]

    citations = [
        {
            "document_id": h["document_id"],
            "title": h["title"],
            "section": h.get("section", ""),
            "score": round(float(h["score"]), 4),
            "snippet": h["text"][:240],
        }
        for h in ranked
    ]

    audit.record_event(
        db,
        event_type="chat.query",
        tenant_id=user.tenant_id,
        user_id=user.id,
        query=query,
        document_ids=[c["document_id"] for c in citations],
        authz_decision="ALLOWED",
        security_risk=f"{guard.decision}:{guard.score}",
        model_used=llm.model_name,
        response_status="200",
    )

    return RetrievalAnswer(
        answer=answer,
        citations=citations,
        security_risk=guard.decision,
        model_used=llm.model_name,
    )
