"""Probe Composio for a tenant so you can nail the connector config.

Run from the PROJECT ROOT:

  # 1) Is the tenant's Google account connected yet?
  uv run --project backend python backend/scripts/composio_probe.py status <TENANT_ID>

  # 1b) Discover the available action slugs for a toolkit (e.g. googledrive)
  uv run --project backend python backend/scripts/composio_probe.py tools googledrive

  # 2) See the raw response of a list action (to map items_path / id_field / title_field)
  uv run --project backend python backend/scripts/composio_probe.py exec <TENANT_ID> GOOGLEDRIVE_LIST_FILES "{}"

  # 3) Inspect a download/parse action for one file (to map fetch_content_path)
  uv run --project backend python backend/scripts/composio_probe.py exec <TENANT_ID> GOOGLEDRIVE_DOWNLOAD_FILE "{\"file_id\":\"<id-from-step-2>\"}"

TENANT_ID is the `tenant_id` returned by /auth/login (it is the Composio user_id).
"""
import json
import sys
from pathlib import Path

# allow `import app` when run from the project root
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402


def _jsonable(obj):
    for attr in ("model_dump", "dict"):
        fn = getattr(obj, attr, None)
        if callable(fn):
            try:
                return fn()
            except Exception:
                pass
    return obj


def main() -> None:
    if not settings.composio_api_key:
        sys.exit("COMPOSIO_API_KEY is not set in .env")
    from composio import Composio

    client = Composio(api_key=settings.composio_api_key)
    cmd = sys.argv[1]

    if cmd == "tools":
        # Discover action slugs for a toolkit via REST: GET /api/v3/tools?toolkit_slugs=...
        import httpx

        toolkit = sys.argv[2]
        resp = httpx.get(
            f"{settings.composio_base_url.rstrip('/')}/api/v3/tools",
            headers={"x-api-key": settings.composio_api_key},
            params={"toolkit_slugs": toolkit, "limit": 100},
            timeout=30,
        )
        resp.raise_for_status()
        items = resp.json().get("items", [])
        for it in items:
            print(f"{it.get('slug')}\t- {it.get('name')}")
        print(f"\n({len(items)} actions for '{toolkit}')")
        return

    tenant = sys.argv[2]

    if cmd == "status":
        accounts = client.connected_accounts.list(user_ids=[tenant])
        print(json.dumps(_jsonable(accounts), indent=2, default=str))
    elif cmd == "exec":
        slug = sys.argv[3]
        args = json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}
        result = client.tools.execute(slug, user_id=tenant, arguments=args)
        print(json.dumps(_jsonable(result), indent=2, default=str))
    else:
        sys.exit("usage: composio_probe.py [status|exec] <TENANT_ID> [SLUG] [JSON_ARGS]")


if __name__ == "__main__":
    main()
