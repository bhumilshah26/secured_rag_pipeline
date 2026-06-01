"""Connector factory. Composio fronts SharePoint, OneDrive, Google Drive, Confluence, Slack."""
from app.connectors.base import Connector, FetchedDoc
from app.connectors.composio_connector import ComposioConnector

__all__ = ["Connector", "FetchedDoc", "ComposioConnector", "get_connector"]


def get_connector(kind: str, tenant_id: str) -> ComposioConnector:
    # All supported kinds are fronted by Composio; tenant_id scopes the Composio user.
    return ComposioConnector(kind=kind, tenant_id=tenant_id)
