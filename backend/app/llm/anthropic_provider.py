"""Anthropic Claude provider — produces Claude-quality, grounded answers.

Uses the Messages API directly via httpx (no SDK dependency). The fixed system instruction
is sent as a cached system block (prompt caching) since it never changes; the retrieved
context and user question go in a single user turn, with the context clearly delimited as
untrusted data by the prompt template."""
import json
from collections.abc import Iterator

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

    def _payload(
        self, system: str, context: str, query: str, stream: bool = False,
        history: list[dict] | None = None,
    ) -> dict:
        # Prior turns precede the final user turn (which carries the fresh context + question),
        # giving the model conversational memory. History is pre-normalized to strict
        # user/assistant alternation by the pipeline, as the Messages API requires.
        messages: list[dict] = []
        for turn in history or []:
            role = "assistant" if turn.get("role") == "assistant" else "user"
            messages.append({"role": role, "content": turn.get("content", "")})
        messages.append({"role": "user", "content": f"{context}\n\nQuestion: {query}"})
        return {
            "model": self._model,
            "max_tokens": settings.llm_max_tokens,
            "temperature": 0.2,
            "stream": stream,
            # Fixed instruction -> cacheable system block.
            "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            "messages": messages,
        }

    @property
    def _headers(self) -> dict:
        return {
            "x-api-key": settings.anthropic_api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

    def generate(
        self, *, system: str, context: str, query: str,
        history: list[dict] | None = None,
    ) -> str:
        resp = httpx.post(_API_URL, headers=self._headers,
                          json=self._payload(system, context, query, history=history), timeout=120)
        resp.raise_for_status()
        blocks = resp.json().get("content", [])
        return "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()

    def stream(
        self, *, system: str, context: str, query: str,
        history: list[dict] | None = None,
    ) -> Iterator[str]:
        with httpx.stream("POST", _API_URL, headers=self._headers,
                          json=self._payload(system, context, query, stream=True, history=history),
                          timeout=120) as resp:
            resp.raise_for_status()
            for line in resp.iter_lines():
                if not line.startswith("data: "):
                    continue
                try:
                    obj = json.loads(line[6:])
                except json.JSONDecodeError:
                    continue
                if obj.get("type") == "content_block_delta":
                    text = (obj.get("delta") or {}).get("text")
                    if text:
                        yield text
