"""Pluggable embedding provider factory."""
from functools import lru_cache

from app.config import settings
from app.embeddings.base import EmbeddingProvider


@lru_cache
def get_embedding_provider() -> EmbeddingProvider:
    provider = settings.embedding_provider.lower()
    if provider == "openai":
        from app.embeddings.openai_provider import OpenAIEmbeddingProvider

        return OpenAIEmbeddingProvider()
    if provider == "fastembed":
        from app.embeddings.fastembed_provider import FastEmbedProvider

        return FastEmbedProvider()
    raise ValueError(f"Unknown EMBEDDING_PROVIDER: {settings.embedding_provider}")
