"""LLM provider interface. The retrieval pipeline depends only on this contract."""
from abc import ABC, abstractmethod


class LLMProvider(ABC):
    @property
    @abstractmethod
    def model_name(self) -> str:
        ...

    @abstractmethod
    def generate(self, *, system: str, context: str, query: str) -> str:
        """Generate an answer. Implementations MUST keep `context` and `query` in
        dedicated, non-overlapping slots and treat `context` as data, not instructions."""
