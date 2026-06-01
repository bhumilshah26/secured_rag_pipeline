"""OpenAI embedding provider (e.g. text-embedding-3-small). Selected via config only."""
import httpx

from app.config import settings
from app.embeddings.base import EmbeddingProvider

_MODEL_DIMS = {
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "text-embedding-ada-002": 1536,
}


class OpenAIEmbeddingProvider(EmbeddingProvider):
    def __init__(self) -> None:
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY required for openai embedding provider")
        self._model = settings.openai_embedding_model
        self._dim = _MODEL_DIMS.get(self._model, 1536)

    @property
    def dimension(self) -> int:
        return self._dim

    def embed(self, texts: list[str]) -> list[list[float]]:
        resp = httpx.post(
            "https://api.openai.com/v1/embeddings",
            headers={"Authorization": f"Bearer {settings.openai_api_key}"},
            json={"model": self._model, "input": texts},
            timeout=60,
        )
        resp.raise_for_status()
        data = sorted(resp.json()["data"], key=lambda d: d["index"])
        return [d["embedding"] for d in data]
