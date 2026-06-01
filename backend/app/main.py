"""FastAPI application entrypoint: middleware, router wiring, startup."""
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import admin, auth, chat, connectors, documents
from app.config import settings
from app.db import init_db
from app.vector.qdrant_store import ensure_collection

app = FastAPI(title="Secured Enterprise RAG", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.app_env == "development" else [],
    allow_credentials=True,
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


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    ensure_collection()


@app.get("/health", tags=["meta"])
def health() -> dict:
    return {
        "status": "ok",
        "embedding_provider": settings.embedding_provider,
        "llm_provider": settings.llm_provider,
    }


app.include_router(auth.router)
app.include_router(documents.router)
app.include_router(connectors.router)
app.include_router(chat.router)
app.include_router(admin.router)
