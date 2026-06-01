"""Connector interface: list and fetch documents from an external source."""
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class FetchedDoc:
    external_id: str
    title: str
    content: str | bytes  # text, or raw file bytes (e.g. a downloaded PDF)
    mime_type: str = "text/plain"


class Connector(ABC):
    @abstractmethod
    def fetch_documents(self, config: dict) -> list[FetchedDoc]:
        """Return documents to ingest. `config` holds non-secret source metadata; secrets
        and OAuth tokens are resolved via the connector backend (Composio), never stored
        in plaintext in our DB."""
