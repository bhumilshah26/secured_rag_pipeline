"""Persistence helpers for saved conversations.

Every lookup is scoped to (tenant_id, user_id) so a user can only ever touch their own
threads — the same isolation guarantee the retrieval layer enforces for documents.
Shared by the chat endpoints (which append turns) and the conversations router (CRUD)."""
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Conversation, Message
from app.security.auth import CurrentUser

# Cap how many prior turns we replay to the LLM (bounds prompt size and cost).
MAX_HISTORY_TURNS = 8


def title_from_query(query: str) -> str:
    """Derive a short, human-readable thread title from the opening question."""
    text = " ".join((query or "").split())
    if len(text) > 60:
        text = text[:57].rstrip() + "…"
    return text or "New conversation"


def get_owned_conversation(
    db: Session, *, user: CurrentUser, conversation_id: str
) -> Conversation:
    """Fetch a conversation, 404-ing if it is missing or not owned by this user/tenant."""
    convo = db.get(Conversation, conversation_id)
    if convo is None or convo.tenant_id != user.tenant_id or convo.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    return convo


def list_conversations(db: Session, *, user: CurrentUser) -> list[Conversation]:
    """All of the user's conversations, most recently updated first."""
    stmt = (
        select(Conversation)
        .where(Conversation.tenant_id == user.tenant_id, Conversation.user_id == user.id)
        .order_by(Conversation.updated_at.desc())
    )
    return list(db.execute(stmt).scalars().all())


def ensure_conversation(
    db: Session, *, user: CurrentUser, conversation_id: str | None, first_query: str
) -> Conversation:
    """Return the owned conversation for `conversation_id`, or create a new one (titled from
    `first_query`) when no id is supplied."""
    if conversation_id:
        return get_owned_conversation(db, user=user, conversation_id=conversation_id)
    convo = Conversation(
        tenant_id=user.tenant_id, user_id=user.id, title=title_from_query(first_query)
    )
    db.add(convo)
    db.commit()
    db.refresh(convo)
    return convo


def load_history(db: Session, *, conversation: Conversation) -> list[dict]:
    """Prior turns as [{role, content}], oldest first, capped to the last MAX_HISTORY_TURNS."""
    stmt = (
        select(Message.role, Message.content)
        .where(Message.conversation_id == conversation.id)
        .order_by(Message.created_at.desc())
        .limit(MAX_HISTORY_TURNS)
    )
    rows = list(db.execute(stmt).all())
    rows.reverse()  # back to chronological order
    return [{"role": r.role, "content": r.content} for r in rows]


def add_message(
    db: Session,
    *,
    conversation: Conversation,
    role: str,
    content: str,
    citations: list | None = None,
    security_risk: str | None = None,
    model_used: str | None = None,
) -> Message:
    """Append a turn and bump the conversation's updated_at (so it floats to the top of the list)."""
    msg = Message(
        conversation_id=conversation.id,
        tenant_id=conversation.tenant_id,
        role=role,
        content=content,
        citations=citations or [],
        security_risk=security_risk,
        model_used=model_used,
    )
    db.add(msg)
    # Touch the parent so list ordering reflects the latest activity.
    conversation.updated_at = datetime.now(timezone.utc)
    db.add(conversation)
    db.commit()
    db.refresh(msg)
    return msg
