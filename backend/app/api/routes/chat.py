"""Secure chat endpoints. Guard + tenant/permission-filtered retrieval + secure prompt.
Offers a blocking JSON endpoint and a streaming SSE endpoint."""
import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

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
    result = answer_query(db, user=user, query=req.query)
    return ChatResponse(
        answer=result.answer,
        citations=[Citation(**c) for c in result.citations],
        security_risk=result.security_risk,
        model_used=result.model_used,
    )


@router.post("/stream")
def chat_stream(
    req: ChatRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_capability("query")),
) -> StreamingResponse:
    """Server-Sent Events: streams `token` events as the answer is generated, then a final
    `done` event with citations/risk/model (or a `blocked`/`error` event)."""
    def event_source():
        for event in stream_answer(db, user=user, query=req.query):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
