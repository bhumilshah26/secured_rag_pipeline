"""Secure retrieval pipeline:

  1. Prompt guard scores the query; BLOCK -> refuse + audit.
  2. Embed query, search Qdrant with a MANDATORY tenant + role filter.
  3. Build an immutable prompt (context = untrusted data slot).
  4. Generate answer via the configured LLM.
  5. Audit (IDs + hashes only) and return answer + citations.
"""
from collections.abc import Iterator
from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.audit import logger as audit
from app.config import settings
from app.embeddings import get_embedding_provider
from app.llm import get_llm_provider
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


def _normalize_history(history: list[dict] | None) -> list[dict]:
    """Sanitize client-supplied turns into the shape the LLM APIs expect: drop empty turns,
    merge consecutive same-role turns, and drop any leading assistant turn so the sequence
    starts with a user turn (Anthropic requires strict alternation starting from user)."""
    norm: list[dict] = []
    for turn in history or []:
        role = "assistant" if turn.get("role") == "assistant" else "user"
        content = (turn.get("content") or "").strip()
        if not content:
            continue
        if norm and norm[-1]["role"] == role:
            norm[-1]["content"] += "\n\n" + content
        else:
            norm.append({"role": role, "content": content})
    while norm and norm[0]["role"] == "assistant":
        norm.pop(0)
    return norm


def _retrieve(
    *, user: CurrentUser, query: str, top_k: int | None, history: list[dict] | None = None,
) -> tuple[str, list[dict]]:
    """Hybrid retrieval: dense (semantic) + BM25 (lexical) fused by Qdrant (RRF), tenant/role
    filtered -> (context, citations). No LLM, no audit; shared by blocking & streaming paths.

    For follow-ups, the previous user question is prepended to the retrieval text so anaphoric
    queries ("what about managers?") still pull the right chunks. This only widens retrieval;
    the tenant/role filter is unchanged, so isolation is unaffected."""
    top_k = top_k or settings.retrieval_top_k
    retrieval_text = query
    if history:
        prev_user = next((t["content"] for t in reversed(history) if t["role"] == "user"), "")
        if prev_user:
            retrieval_text = f"{prev_user}\n{query}"
    query_vector = get_embedding_provider().embed_one(retrieval_text)
    hits = qdrant_store.secure_search(
        tenant_id=user.tenant_id,
        allowed_roles=readable_roles_for(user),
        query_vector=query_vector,
        query_text=retrieval_text,
        limit=top_k,
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
    db: Session, *, user: CurrentUser, query: str,
    history: list[dict] | None = None, top_k: int | None = None,
) -> RetrievalAnswer:
    guard = scan_query(query)
    if guard.blocked:
        _audit_blocked(db, user=user, query=query, guard=guard)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Query blocked by security policy (possible prompt injection).",
        )

    history = _normalize_history(history)
    context, citations = _retrieve(user=user, query=query, top_k=top_k, history=history)
    llm = get_llm_provider()
    answer = llm.generate(system=SYSTEM_INSTRUCTION, context=context, query=query, history=history)
    if settings.pii_mask_in_response:
        answer = mask_for_role(answer, user.role.value)
    _audit_query(db, user=user, query=query, citations=citations, guard=guard, model=llm.model_name)

    return RetrievalAnswer(
        answer=answer, citations=citations,
        security_risk=guard.decision, model_used=llm.model_name,
    )


def stream_answer(
    db: Session, *, user: CurrentUser, query: str,
    history: list[dict] | None = None, top_k: int | None = None,
) -> Iterator[dict]:
    """Streaming variant: yields SSE-friendly event dicts.
    blocked -> {type: blocked}; meta -> {type: meta}; token -> {type: token, text}; done -> {...}."""
    guard = scan_query(query)
    if guard.blocked:
        _audit_blocked(db, user=user, query=query, guard=guard)
        yield {"type": "blocked", "detail": "Query blocked by security policy (possible prompt injection)."}
        return

    history = _normalize_history(history)
    context, citations = _retrieve(user=user, query=query, top_k=top_k, history=history)
    llm = get_llm_provider()
    yield {"type": "meta", "model_used": llm.model_name, "security_risk": guard.decision}
    parts: list[str] = []
    try:
        for piece in llm.stream(system=SYSTEM_INSTRUCTION, context=context, query=query, history=history):
            parts.append(piece)
            yield {"type": "token", "text": piece}
    except Exception as exc:  # surface provider errors without 500-ing the stream
        yield {"type": "error", "detail": str(exc)}
        return
    answer = "".join(parts)
    if settings.pii_mask_in_response:
        answer = mask_for_role(answer, user.role.value)
    _audit_query(db, user=user, query=query, citations=citations, guard=guard, model=llm.model_name)
    # `answer` is the authoritative, PII-masked text; the client replaces the streamed text with it.
    yield {"type": "done", "answer": answer, "citations": citations,
           "security_risk": guard.decision, "model_used": llm.model_name}
