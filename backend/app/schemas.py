"""Pydantic request/response DTOs."""
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

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


class ChatRequest(BaseModel):
    query: str


class ChatResponse(BaseModel):
    answer: str
    citations: list[Citation]
    security_risk: str
    model_used: str
