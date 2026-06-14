"""Pydantic request/response DTOs."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models import Role, SourceKind


# ---- Auth ----
class RegisterRequest(BaseModel):
    tenant_name: str
    tenant_slug: str
    admin_email: EmailStr
    admin_password: str = Field(min_length=8)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: Role
    tenant_id: str


class CreateUserRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    role: Role = Role.VIEWER


class MeResponse(BaseModel):
    id: str
    email: EmailStr
    role: Role
    tenant_id: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: EmailStr
    role: Role
    is_active: bool
    created_at: datetime


class UpdateProfileRequest(BaseModel):
    email: EmailStr | None = None
    password: str | None = Field(default=None, min_length=8)


# ---- Documents ----
class IngestTextRequest(BaseModel):
    title: str
    content: str
    allowed_roles: list[Role] = Field(default_factory=lambda: [Role.VIEWER])


class DocumentOut(BaseModel):
    id: str
    title: str
    status: str
    chunk_count: int
    allowed_roles: list[Role] = []
    created_at: datetime


class SetPermissionsRequest(BaseModel):
    allowed_roles: list[Role]


# ---- Connectors ----
class RegisterConnectorRequest(BaseModel):
    kind: SourceKind
    display_name: str
    config: dict = Field(default_factory=dict)


class InitiateConnectionRequest(BaseModel):
    # Composio auth-config id for the toolkit (from your Composio dashboard).
    auth_config_id: str


class UpdateConnectorRequest(BaseModel):
    display_name: str | None = None
    config: dict | None = None


class ConnectorFile(BaseModel):
    external_id: str
    title: str
    mime_type: str


class IngestSelectedRequest(BaseModel):
    external_ids: list[str]
    allowed_roles: list[Role] = Field(default_factory=lambda: [Role.VIEWER])


# ---- Chat ----
class Citation(BaseModel):
    document_id: str
    title: str
    section: str = ""
    score: float
    snippet: str


class ChatTurn(BaseModel):
    """One prior message in the conversation, sent by the client for context memory."""
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    query: str
    # Conversation to append to. When omitted, the server starts a new conversation and
    # returns its id. When given, the server loads prior turns from the DB (source of truth).
    conversation_id: str | None = None
    # Legacy/fallback: prior turns supplied by the client. Ignored when conversation_id is set.
    history: list[ChatTurn] = Field(default_factory=list)


class ChatResponse(BaseModel):
    answer: str
    citations: list[Citation]
    security_risk: str
    model_used: str
    conversation_id: str


# ---- Conversations (saved chat history) ----
class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    title: str
    created_at: datetime
    updated_at: datetime


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    role: Literal["user", "assistant"]
    content: str
    citations: list[Citation] = []
    security_risk: str | None = None
    model_used: str | None = None
    created_at: datetime


class ConversationDetail(ConversationOut):
    messages: list[MessageOut] = []


class RenameConversationRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
