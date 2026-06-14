"""ORM models. Postgres is the system-of-record for identity, metadata, perms, audit.
No chunk text or raw document content is stored here."""
import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Role(str, enum.Enum):
    ADMIN = "ADMIN"
    HR = "HR"
    ANALYST = "ANALYST"
    MANAGER = "MANAGER"
    VIEWER = "VIEWER"


class SourceKind(str, enum.Enum):
    SHAREPOINT = "sharepoint"
    ONEDRIVE = "onedrive"
    GDRIVE = "gdrive"
    CONFLUENCE = "confluence"
    SLACK = "slack"
    UPLOAD = "upload"


class Tenant(Base): # organization
    __tablename__ = "tenants"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String, nullable=False)
    slug: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("tenant_id", "email", name="uq_user_email_tenant"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), nullable=False, index=True)
    email: Mapped[str] = mapped_column(String, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[Role] = mapped_column(Enum(Role), nullable=False, default=Role.VIEWER)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class DataSource(Base):
    __tablename__ = "data_sources"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), nullable=False, index=True)
    kind: Mapped[SourceKind] = mapped_column(Enum(SourceKind), nullable=False)
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    config: Mapped[dict] = mapped_column(JSON, default=dict)  # non-secret metadata only
    status: Mapped[str] = mapped_column(String, default="connected")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), nullable=False, index=True)
    source_id: Mapped[str | None] = mapped_column(ForeignKey("data_sources.id"), nullable=True)
    external_id: Mapped[str | None] = mapped_column(String, nullable=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    mime_type: Mapped[str] = mapped_column(String, default="text/plain")
    checksum: Mapped[str | None] = mapped_column(String, nullable=True)
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String, default="pending")  # pending|indexed|failed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    permissions: Mapped[list["DocumentPermission"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )


class DocumentPermission(Base):
    __tablename__ = "document_permissions"
    __table_args__ = (
        UniqueConstraint("document_id", "role", name="uq_docperm_doc_role"),
    )
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), nullable=False, index=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), nullable=False, index=True)
    role: Mapped[Role] = mapped_column(Enum(Role), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    document: Mapped[Document] = relationship(back_populates="permissions")


class Conversation(Base):
    """A saved chat thread. Scoped to a single user within a tenant — a user only ever
    sees their own conversations. Holds no document content, only the dialogue."""
    __tablename__ = "conversations"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String, nullable=False, default="New conversation")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now, index=True
    )

    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.created_at",
    )


class Message(Base):
    """One turn in a conversation. Citations are stored as IDs/metadata only (same shape the
    API returns), never raw chunk text beyond the short snippet already shown to the user."""
    __tablename__ = "messages"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("conversations.id"), nullable=False, index=True
    )
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String, nullable=False)  # "user" | "assistant"
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    citations: Mapped[list] = mapped_column(JSON, default=list)
    security_risk: Mapped[str | None] = mapped_column(String, nullable=True)
    model_used: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)

    conversation: Mapped[Conversation] = relationship(back_populates="messages")


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    tenant_id: Mapped[str | None] = mapped_column(String, index=True)
    user_id: Mapped[str | None] = mapped_column(String, index=True)
    event_type: Mapped[str] = mapped_column(String, nullable=False)
    query_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    document_ids: Mapped[list] = mapped_column(JSON, default=list)  # IDs only, never content
    authz_decision: Mapped[str | None] = mapped_column(String, nullable=True)
    security_risk: Mapped[str | None] = mapped_column(String, nullable=True)
    model_used: Mapped[str | None] = mapped_column(String, nullable=True)
    response_status: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
