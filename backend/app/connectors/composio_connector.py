"""Composio-backed connector (SharePoint / OneDrive / Google Drive / Confluence / Slack).

Uses the Composio v3 SDK (`from composio import Composio`). Multi-tenant isolation is
achieved by scoping every Composio call to `user_id = tenant_id`, so one tenant can never
act through another tenant's connected account.

Each toolkit ships with a built-in default config (action slugs + response paths) in
`_DEFAULT_CONFIGS`, so connectors work out of the box; anything in `DataSource.config`
overrides the defaults per source.

For file-based sources (e.g. Google Drive) the download action returns a temporary URL to
the file's bytes, not text — the connector fetches those bytes and hands them to the
extractor (PDF/DOCX/XLSX/OCR), so binary documents index correctly.

If `COMPOSIO_API_KEY` is unset the connector returns a single stub document so the rest of
the ingestion pipeline stays testable offline.
"""
import re
from html import unescape
from typing import Any

import httpx

from app.config import settings
from app.connectors.base import Connector, FetchedDoc


def _strip_html(text: str) -> str:
    """Reduce HTML / Confluence storage XHTML to readable plain text."""
    text = re.sub(r"<\s*(br|/p|/div|/h[1-6]|/li)\s*>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n\s*\n+", "\n\n", text).strip()

# Built-in per-toolkit configuration. Override any key via DataSource.config.
_DEFAULT_CONFIGS: dict[str, dict] = {
    "gdrive": {
        "list_action": "GOOGLEDRIVE_FIND_FILE",
        "list_arguments": {"q": "trashed = false"},
        "items_path": "data.files",
        "id_field": "id",
        "title_field": "name",
        "mime_field": "mimeType",
        # Search: Google Drive query syntax injected into the `q` argument.
        "search_arg": "q",
        "search_template": "name contains '{q}' and trashed = false",
        "fetch_action": "GOOGLEDRIVE_DOWNLOAD_FILE",
        "fetch_id_arg": "fileId",
        "fetch_url_path": "data.downloaded_file_content.s3url",
        "fetch_mime_path": "data.downloaded_file_content.mimetype",
        "fetch_title_path": "data.name",
        "export_arg": "mime_type",  # for native Google Workspace docs
    },
    "confluence": {
        "list_action": "CONFLUENCE_GET_PAGES",
        "list_arguments": {"limit": 100, "status": "current"},
        "items_path": "data.results",
        "id_field": "id",
        "title_field": "title",
        "search_arg": "title",  # GET_PAGES title filter
        "search_template": "{q}",
        # Page body comes from a per-page fetch as storage-format XHTML -> stripped to text.
        "fetch_action": "CONFLUENCE_GET_PAGE_BY_ID",
        "fetch_id_arg": "id",
        "fetch_content_path": "data.body.storage.value",
        "fetch_title_path": "data.title",
        "strip_html": True,
    },
    "slack": {
        # "Documents" are channels; content is the channel's message history joined to text.
        "list_action": "SLACK_LIST_ALL_CHANNELS",
        "list_arguments": {"exclude_archived": True, "limit": 200, "types": "public_channel"},
        "items_path": "data.channels",
        "id_field": "id",
        "title_field": "name",
        # Slack list has no name filter -> client-side filter on channel name (no search_arg).
        "fetch_action": "SLACK_FETCH_CONVERSATION_HISTORY",
        "fetch_id_arg": "channel",
        "fetch_arguments": {"limit": 200},
        "fetch_items_path": "data.messages",
        "fetch_item_text_field": "text",
    },
}

# Native Google Workspace types must be exported to a downloadable format.
_GOOGLE_EXPORT = {
    "application/vnd.google-apps.document":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.google-apps.spreadsheet":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.google-apps.presentation": "application/pdf",
}


def _base() -> str:
    return settings.composio_base_url.rstrip("/")


def _headers() -> dict:
    return {"x-api-key": settings.composio_api_key, "Content-Type": "application/json"}


def _execute_tool(slug: str, *, user_id: str, arguments: dict) -> Any:
    """Run a Composio tool via REST: POST /api/v3/tools/execute/{slug}."""
    resp = httpx.post(
        f"{_base()}/api/v3/tools/execute/{slug}",
        headers=_headers(),
        json={"user_id": user_id, "arguments": arguments},
        timeout=120,
    )
    resp.raise_for_status()
    body = resp.json()
    if body.get("successful") is False:
        raise RuntimeError(f"Composio tool {slug} failed: {body.get('error')}")
    return body


def _dig(obj: Any, path: str | None) -> Any:
    """Navigate a dotted path across dicts and objects (e.g. 'data.files')."""
    if not path:
        return obj
    cur = obj
    for part in path.split("."):
        if cur is None:
            return None
        cur = cur.get(part) if isinstance(cur, dict) else getattr(cur, part, None)
    return cur


class ComposioConnector(Connector):
    def __init__(self, kind: str, tenant_id: str) -> None:
        self.kind = kind
        self.tenant_id = tenant_id  # used as Composio user_id => tenant isolation

    # ---- OAuth connection lifecycle ----
    def initiate_connection(self, auth_config_id: str) -> dict:
        """Create a hosted-auth link via the Composio REST API
        (POST /api/v3/connected_accounts/link) rather than the SDK helper."""
        url = f"{settings.composio_base_url.rstrip('/')}/api/v3/connected_accounts/link"
        resp = httpx.post(
            url,
            headers={
                "x-api-key": settings.composio_api_key,
                "Content-Type": "application/json",
            },
            json={"auth_config_id": auth_config_id, "user_id": self.tenant_id},
            timeout=30,
        )
        resp.raise_for_status()
        body = resp.json()
        return {
            "connection_id": (
                _dig(body, "id")
                or _dig(body, "connected_account_id")
                or _dig(body, "connectedAccountId")
            ),
            "redirect_url": (
                _dig(body, "redirect_url")
                or _dig(body, "redirectUrl")
                or _dig(body, "redirect_uri")
            ),
            "status": _dig(body, "status") or "INITIATED",
        }

    def connection_status(self) -> dict:
        """List connected accounts via REST: GET /api/v3/connected_accounts?user_ids=..."""
        resp = httpx.get(
            f"{_base()}/api/v3/connected_accounts",
            headers=_headers(),
            params={"user_ids": [self.tenant_id]},
            timeout=30,
        )
        resp.raise_for_status()
        items = _dig(resp.json(), "items") or []
        return {
            "connected": len(items) > 0,
            "accounts": [
                {
                    "id": _dig(a, "id"),
                    "toolkit": _dig(a, "toolkit.slug") or _dig(a, "toolkit_slug"),
                    "status": _dig(a, "status"),
                }
                for a in items
            ],
        }

    # ---- Ingestion source ----
    def _cfg(self, config: dict | None) -> dict:
        """Merge built-in defaults for this toolkit with per-source overrides."""
        merged = dict(_DEFAULT_CONFIGS.get(self.kind, {}))
        merged.update(config or {})
        return merged

    def _raw_items(self, config: dict, arguments: dict | None = None) -> list[dict]:
        list_action = config.get("list_action")
        if not list_action:
            raise ValueError(
                f"No 'list_action' configured for '{self.kind}'. Add one in the source's "
                "ingestion config, or add a default in _DEFAULT_CONFIGS."
            )
        listed = _execute_tool(
            list_action,
            user_id=self.tenant_id,
            arguments=arguments if arguments is not None else config.get("list_arguments", {}),
        )
        items = _dig(listed, config.get("items_path", "data")) or []
        return [items] if isinstance(items, dict) else items

    def list_items(self, config: dict, query: str | None = None) -> list[dict]:
        """List available items as metadata only (no content download). If `query` is given,
        searches server-side via the toolkit's native search arg, else filters by title."""
        if not settings.composio_api_key:
            return [
                {"external_id": f"{self.kind}-sample-1",
                 "title": f"[{self.kind}] Sample Document", "mime_type": "text/plain"}
            ]
        cfg = self._cfg(config)
        id_field = cfg.get("id_field", "id")
        title_field = cfg.get("title_field", "name")
        mime_field = cfg.get("mime_field", "mimeType")

        args = dict(cfg.get("list_arguments", {}))
        client_filter = None
        if query:
            search_arg = cfg.get("search_arg")
            if search_arg:  # server-side search
                args[search_arg] = cfg.get("search_template", "{q}").format(q=query)
            else:  # client-side title filter
                client_filter = query.lower()

        out: list[dict] = []
        for item in self._raw_items(cfg, args):
            ext_id = str(_dig(item, id_field) or "")
            if not ext_id:
                continue
            title = str(_dig(item, title_field) or ext_id)
            if client_filter and client_filter not in title.lower():
                continue
            out.append({
                "external_id": ext_id,
                "title": title,
                "mime_type": str(_dig(item, mime_field) or "text/plain"),
            })
        return out

    def _fetch_one(self, cfg: dict, item: dict, ext_id: str) -> tuple[str | bytes, str, str]:
        """Return (content, mime_type, title). Content is raw bytes when the download action
        yields a file URL, else text. Title falls back to the fetch response, then ext_id."""
        item_mime = str(_dig(item, cfg.get("mime_field", "mimeType")) or "")
        title = str(_dig(item, cfg.get("title_field", "name")) or "")

        def done(content: str | bytes, mime: str) -> tuple[str | bytes, str, str]:
            return content, mime, (title or ext_id)

        def _as_text(value: Any) -> str:
            s = value if isinstance(value, str) else str(value)
            return _strip_html(s) if cfg.get("strip_html") else s

        fetch_action = cfg.get("fetch_action")
        if not fetch_action:  # content inline in the listed item
            return done(_as_text(_dig(item, cfg.get("content_field", "content")) or ""), "text/plain")

        args = {cfg.get("fetch_id_arg", "file_id"): ext_id, **cfg.get("fetch_arguments", {})}
        export = _GOOGLE_EXPORT.get(item_mime)
        if export and cfg.get("export_arg"):
            args[cfg["export_arg"]] = export  # native Google doc -> exportable format
        resp = _execute_tool(fetch_action, user_id=self.tenant_id, arguments=args)

        if not title and cfg.get("fetch_title_path"):
            title = str(_dig(resp, cfg["fetch_title_path"]) or "")

        url_path = cfg.get("fetch_url_path")
        if url_path:  # download the file's bytes from the returned URL
            file_url = _dig(resp, url_path)
            if not file_url:
                return done(b"", item_mime)
            mime = _dig(resp, cfg.get("fetch_mime_path", "")) or export or item_mime or "application/octet-stream"
            r = httpx.get(file_url, timeout=180)
            r.raise_for_status()
            return done(r.content, mime)

        items_path = cfg.get("fetch_items_path")
        if items_path:  # response is a list of records (e.g. Slack messages) -> join to text
            records = _dig(resp, items_path) or []
            text_field = cfg.get("fetch_item_text_field", "text")
            parts = [
                str(r.get(text_field)) for r in records
                if isinstance(r, dict) and r.get(text_field)
            ]
            return done(_as_text("\n".join(parts)), "text/plain")

        return done(_as_text(_dig(resp, cfg.get("fetch_content_path", "data")) or ""), "text/plain")

    def fetch_documents(
        self, config: dict, external_ids: list[str] | None = None
    ) -> list[FetchedDoc]:
        """Fetch content for the selected items (or all). Selected items are fetched by id
        directly, so files surfaced via search always index. File-based sources return raw
        bytes so the extractor (PDF/DOCX/XLSX/OCR) handles them."""
        if not settings.composio_api_key:
            return [
                FetchedDoc(
                    external_id=f"{self.kind}-sample-1",
                    title=f"[{self.kind}] Sample Document",
                    content=(
                        f"Sample document from the {self.kind} connector stub. Set "
                        "COMPOSIO_API_KEY and a connected account to ingest real data."
                    ),
                )
            ]

        cfg = self._cfg(config)
        id_field = cfg.get("id_field", "id")

        # Best-effort metadata map (title/mime) from a single listing call.
        meta: dict[str, dict] = {}
        try:
            for item in self._raw_items(cfg):
                eid = str(_dig(item, id_field) or "")
                if eid:
                    meta[eid] = item
        except Exception:
            pass

        target_ids = external_ids if external_ids else list(meta.keys())

        docs: list[FetchedDoc] = []
        for ext_id in target_ids:
            item = meta.get(ext_id, {id_field: ext_id})
            content, mime, title = self._fetch_one(cfg, item, ext_id)
            has_content = len(content) > 0 if isinstance(content, bytes) else bool(content.strip())
            if has_content:
                docs.append(
                    FetchedDoc(external_id=ext_id, title=title, content=content, mime_type=mime)
                )
        return docs
