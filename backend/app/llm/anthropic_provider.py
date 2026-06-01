"""Anthropic Claude provider — produces Claude-quality, grounded answers.

Uses the Messages API directly via httpx (no SDK dependency). The fixed system instruction
is sent as a cached system block (prompt caching) since it never changes; the retrieved
context and user question go in a single user turn, with the context clearly delimited as
untrusted data by the prompt template."""
import httpx

from app.config import settings
from app.llm.base import LLMProvider

_API_URL = "https://api.anthropic.com/v1/messages"


class AnthropicLLMProvider(LLMProvider):
    def __init__(self) -> None:
        if not settings.anthropic_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY required for anthropic LLM provider")
        self._model = settings.anthropic_model

    @property
    def model_name(self) -> str:
        return self._model

    def generate(self, *, system: str, context: str, query: str) -> str:
        payload = {
            "model": self._model,
            "max_tokens": settings.llm_max_tokens,
            "temperature": 0.2,
            # Fixed instruction -> cacheable system block.
            "system": [
                {"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}
            ],
            "messages": [
                {
                    "role": "user",
                    "content": f"{context}\n\nQuestion: {query}",
                }
            ],
        }
        resp = httpx.post(
            _API_URL,
            headers={
                "x-api-key": settings.anthropic_api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json=payload,
            timeout=120,
        )
        resp.raise_for_status()
        blocks = resp.json().get("content", [])
        return "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()
