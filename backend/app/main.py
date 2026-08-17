"""FastAPI application entrypoint: middleware, router wiring, startup."""
import logging
import threading
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import admin, auth, chat, connectors, conversations, documents
from app.config import settings
from app.db import init_db
from app.vector.qdrant_store import ensure_collection

logger = logging.getLogger("app.startup")

app = FastAPI(title="Secured Enterprise RAG", version="0.1.0")

_cors_origins = settings.cors_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    # "*" cannot be combined with credentials per the CORS spec; we use Bearer tokens
    # (no cookies), so only enable credentials when explicit origins are configured.
    allow_credentials=_cors_origins != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    """Attach a request id and basic security headers to every response."""
    request_id = str(uuid.uuid4())
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    return response


# Bootstrap runs off the startup path. Creating tables and the Qdrant collection both go
# over the network, and the collection needs the embedding model's dimension (loading the
# model on a cold cache takes minutes). Doing that inside the startup event delays the
# first accepted connection, which a platform health check reads as "never came up".
# Uvicorn binds the port immediately instead, and the health endpoint reports progress.
_boot_status: dict[str, str] = {"database": "pending", "vector_store": "pending"}


def _bootstrap() -> None:
    for name, step in (("database", init_db), ("vector_store", ensure_collection)):
        try:
            step()
            _boot_status[name] = "ready"
        except Exception as exc:  # keep serving; the health payload carries the reason
            _boot_status[name] = f"failed: {type(exc).__name__}: {exc}"
            logger.exception("bootstrap step %r failed", name)


@app.on_event("startup")
def on_startup() -> None:
    threading.Thread(target=_bootstrap, name="bootstrap", daemon=True).start()


@app.get("/", tags=["meta"])
def health() -> dict:
    return {
        "status": "ok",
        "bootstrap": _boot_status,
        "embedding_provider": settings.embedding_provider,
        "llm_provider": settings.llm_provider,
        "mail_provider": settings.resolved_mail_provider,  # what "auto" actually picked
        "otp_enabled": settings.otp_enabled,
    }


app.include_router(auth.router)
app.include_router(documents.router)
app.include_router(connectors.router)
app.include_router(chat.router)
app.include_router(conversations.router)
app.include_router(admin.router)
