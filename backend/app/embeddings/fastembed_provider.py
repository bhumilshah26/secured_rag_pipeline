"""Default embedding provider: FastEmbed (local, no API key required)."""
from app.config import settings
from app.embeddings.base import EmbeddingProvider

# Known output dims for common FastEmbed models; falls back to a probe otherwise.
_KNOWN_DIMS = {
    "BAAI/bge-small-en-v1.5": 384,
    "BAAI/bge-base-en-v1.5": 768,
    "BAAI/bge-large-en-v1.5": 1024,
    "mixedbread-ai/mxbai-embed-large-v1": 1024,
    "intfloat/multilingual-e5-large": 1024,
    "sentence-transformers/all-MiniLM-L6-v2": 384,
}


class FastEmbedProvider(EmbeddingProvider):
    def __init__(self) -> None:
        from fastembed import TextEmbedding

        self._model_name = settings.fastembed_model
        self._model = TextEmbedding(model_name=self._model_name)
        self._dim = _KNOWN_DIMS.get(self._model_name) or len(
            next(iter(self._model.embed(["_probe_"])))
        )

    @property
    def dimension(self) -> int:
        return self._dim

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [vec.tolist() for vec in self._model.embed(texts)]
