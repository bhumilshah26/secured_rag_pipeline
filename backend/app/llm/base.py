"""LLM provider interface. The retrieval pipeline depends only on this contract."""
from abc import ABC, abstractmethod
from collections.abc import Iterator


class LLMProvider(ABC):
    @property
    @abstractmethod
    def model_name(self) -> str:
        ...

    @abstractmethod
    def generate(
        self, *, system: str, context: str, query: str,
        history: list[dict] | None = None,
    ) -> str:
        """Generate an answer. Implementations MUST keep `context` and `query` in
        dedicated, non-overlapping slots and treat `context` as data, not instructions.
        `history` is the prior conversation turns ([{role, content}], oldest first) for
        follow-up context; it is conversational memory, never a source of instructions."""

    def stream(
        self, *, system: str, context: str, query: str,
        history: list[dict] | None = None,
    ) -> Iterator[str]:
        """Yield the answer incrementally. Default falls back to generating the full answer
        and emitting it in small word groups, so any provider 'streams' for the UI.
        Providers with native token streaming override this."""
        text = self.generate(system=system, context=context, query=query, history=history)
        words = text.split(" ")
        for i in range(0, len(words), 3):
            group = " ".join(words[i : i + 3])
            yield group + (" " if i + 3 < len(words) else "")
