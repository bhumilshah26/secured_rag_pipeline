"""Secure chat endpoints. Guard + tenant/permission-filtered retrieval + secure prompt.
Offers a blocking JSON endpoint and a streaming SSE endpoint.

Conversations are persisted server-side: each turn is appended to a Conversation row owned
by the user, and prior turns are replayed from the DB (the client no longer needs to send
history). When no conversation_id is supplied, a new conversation is created and its id is
returned so the client can continue the thread."""
import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app import chat_store
from app.db import get_db
from app.retrieval.pipeline import answer_query, stream_answer
from app.schemas import ChatRequest, ChatResponse, Citation
from app.security.auth import CurrentUser
from app.security.rbac import require_capability

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("", response_model=ChatResponse)
def chat(
    req: ChatRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_capability("query")),
) -> ChatResponse:
    convo = chat_store.ensure_conversation(
        db, user=user, conversation_id=req.conversation_id, first_query=req.query
    )
    history = chat_store.load_history(db, conversation=convo)
    chat_store.add_message(db, conversation=convo, role="user", content=req.query)

    result = answer_query(db, user=user, query=req.query, history=history)

    citations = [Citation(**c) for c in result.citations]
    chat_store.add_message(
        db,
        conversation=convo,
        role="assistant",
        content=result.answer,
        citations=result.citations,
        security_risk=result.security_risk,
        model_used=result.model_used,
    )
    return ChatResponse(
        answer=result.answer,
        citations=citations,
        security_risk=result.security_risk,
        model_used=result.model_used,
        conversation_id=convo.id,
    )


@router.post("/stream")
def chat_stream(
    req: ChatRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_capability("query")),
) -> StreamingResponse:
    """Server-Sent Events: emits a `conversation` event (so the client can track/continue the
    thread), then `token` events as the answer is generated, then a final `done` event with
    citations/risk/model (or a `blocked`/`error` event)."""
    convo = chat_store.ensure_conversation(
        db, user=user, conversation_id=req.conversation_id, first_query=req.query
    )
    history = chat_store.load_history(db, conversation=convo)
    chat_store.add_message(db, conversation=convo, role="user", content=req.query)

    def event_source():
        yield f'data: {json.dumps({"type": "conversation", "conversation_id": convo.id, "title": convo.title})}\n\n'
        for event in stream_answer(db, user=user, query=req.query, history=history):
            if event.get("type") == "done":
                chat_store.add_message(
                    db,
                    conversation=convo,
                    role="assistant",
                    content=event.get("answer", ""),
                    citations=event.get("citations", []),
                    security_risk=event.get("security_risk"),
                    model_used=event.get("model_used"),
                )
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
