"""Secure retrieval pipeline:

  1. Prompt guard scores the query; BLOCK -> refuse + audit.
  2. Embed query, search Qdrant with a MANDATORY tenant + role filter.
  3. Build an immutable prompt (context = untrusted data slot).
  4. Generate answer via the configured LLM.
  5. Audit (IDs + hashes only) and return answer + citations.
"""
import re
from collections.abc import Iterator
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
from app.security.pii import mask_for_role
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


def _retrieve(db: Session, *, user: CurrentUser, query: str, top_k: int | None) -> tuple[str, list[dict]]:
    """Hybrid retrieval (keyword-resolve named docs, then semantic search) -> (context, citations).
    No LLM, no audit; shared by the blocking and streaming paths."""
    top_k = top_k or settings.retrieval_top_k
    named_doc_ids, semantic_query = _resolve_named_documents(
        db, tenant_id=user.tenant_id, query=query
    )
    query_vector = get_embedding_provider().embed_one(semantic_query)
    threshold = None if named_doc_ids else settings.retrieval_score_threshold
    hits = qdrant_store.secure_search(
        tenant_id=user.tenant_id,
        allowed_roles=readable_roles_for(user),
        query_vector=query_vector,
        limit=top_k,
        score_threshold=threshold,
        document_ids=named_doc_ids or None,
    )
    context = build_context_block([h["text"] for h in hits])

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
    return context, citations


def _audit_blocked(db, *, user, query, guard) -> None:
    audit.record_event(
        db, event_type="chat.blocked", tenant_id=user.tenant_id, user_id=user.id, query=query,
        authz_decision="ALLOWED",
        security_risk=f"BLOCK:{guard.score}:{','.join(guard.categories)}",
        response_status="403",
    )


def _audit_query(db, *, user, query, citations, guard, model) -> None:
    audit.record_event(
        db, event_type="chat.query", tenant_id=user.tenant_id, user_id=user.id, query=query,
        document_ids=[c["document_id"] for c in citations], authz_decision="ALLOWED",
        security_risk=f"{guard.decision}:{guard.score}", model_used=model, response_status="200",
    )


def answer_query(
    db: Session, *, user: CurrentUser, query: str, top_k: int | None = None
) -> RetrievalAnswer:
    guard = scan_query(query)
    if guard.blocked:
        _audit_blocked(db, user=user, query=query, guard=guard)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Query blocked by security policy (possible prompt injection).",
        )

    context, citations = _retrieve(db, user=user, query=query, top_k=top_k)
    llm = get_llm_provider()
    answer = llm.generate(system=SYSTEM_INSTRUCTION, context=context, query=query)
    if settings.pii_mask_in_response:
        answer = mask_for_role(answer, user.role.value)
    print(f"[LLM] response generated by model: {llm.model_name} (provider={settings.llm_provider})")
    _audit_query(db, user=user, query=query, citations=citations, guard=guard, model=llm.model_name)

    return RetrievalAnswer(
        answer=answer, citations=citations,
        security_risk=guard.decision, model_used=llm.model_name,
    )


def stream_answer(
    db: Session, *, user: CurrentUser, query: str, top_k: int | None = None
) -> Iterator[dict]:
    """Streaming variant: yields SSE-friendly event dicts.
    blocked -> {type: blocked}; meta -> {type: meta}; token -> {type: token, text}; done -> {...}."""
    guard = scan_query(query)
    if guard.blocked:
        _audit_blocked(db, user=user, query=query, guard=guard)
        yield {"type": "blocked", "detail": "Query blocked by security policy (possible prompt injection)."}
        return

    context, citations = _retrieve(db, user=user, query=query, top_k=top_k)
    llm = get_llm_provider()
    yield {"type": "meta", "model_used": llm.model_name, "security_risk": guard.decision}
    parts: list[str] = []
    try:
        for piece in llm.stream(system=SYSTEM_INSTRUCTION, context=context, query=query):
            parts.append(piece)
            yield {"type": "token", "text": piece}
    except Exception as exc:  # surface provider errors without 500-ing the stream
        yield {"type": "error", "detail": str(exc)}
        return
    answer = "".join(parts)
    if settings.pii_mask_in_response:
        answer = mask_for_role(answer, user.role.value)
    print(f"[LLM] response streamed by model: {llm.model_name} (provider={settings.llm_provider})")
    _audit_query(db, user=user, query=query, citations=citations, guard=guard, model=llm.model_name)
    # `answer` is the authoritative, PII-masked text; the client replaces the streamed text with it.
    yield {"type": "done", "answer": answer, "citations": citations,
           "security_risk": guard.decision, "model_used": llm.model_name}
