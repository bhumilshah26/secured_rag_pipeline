"""CRUD for saved chat conversations. Every route is scoped to the authenticated user's
own threads within their tenant — enforced in app.chat_store."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import chat_store
from app.db import get_db
from app.schemas import ConversationDetail, ConversationOut, RenameConversationRequest
from app.security.auth import CurrentUser
from app.security.rbac import require_capability

router = APIRouter(prefix="/conversations", tags=["conversations"])


@router.get("", response_model=list[ConversationOut])
def list_conversations(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_capability("query")),
) -> list[ConversationOut]:
    return chat_store.list_conversations(db, user=user)


@router.get("/{conversation_id}", response_model=ConversationDetail)
def get_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_capability("query")),
) -> ConversationDetail:
    return chat_store.get_owned_conversation(db, user=user, conversation_id=conversation_id)


@router.patch("/{conversation_id}", response_model=ConversationOut)
def rename_conversation(
    conversation_id: str,
    req: RenameConversationRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_capability("query")),
) -> ConversationOut:
    convo = chat_store.get_owned_conversation(db, user=user, conversation_id=conversation_id)
    convo.title = req.title.strip()
    db.add(convo)
    db.commit()
    db.refresh(convo)
    return convo


@router.delete("/{conversation_id}")
def delete_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_capability("query")),
) -> dict:
    convo = chat_store.get_owned_conversation(db, user=user, conversation_id=conversation_id)
    db.delete(convo)
    db.commit()
    return {"deleted": True, "conversation_id": conversation_id}
