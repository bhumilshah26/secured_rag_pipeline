"""Secure chat endpoint. Guard + tenant/permission-filtered retrieval + secure prompt."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.retrieval.pipeline import answer_query
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
