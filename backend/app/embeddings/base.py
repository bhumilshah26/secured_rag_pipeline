"""Embedding provider interface. All providers expose the same contract so the rest of
the system is agnostic to the backend (FastEmbed, OpenAI, ...)."""
from abc import ABC, abstractmethod


class EmbeddingProvider(ABC):
    @property
    @abstractmethod
    def dimension(self) -> int:
        """Vector size produced by this provider/model."""

    @abstractmethod
    def embed(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch of texts into vectors."""

    def embed_one(self, text: str) -> list[float]:
        return self.embed([text])[0]
