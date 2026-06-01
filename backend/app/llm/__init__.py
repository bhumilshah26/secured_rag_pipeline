"""Pluggable LLM provider factory."""
from functools import lru_cache

from app.config import settings
from app.llm.base import LLMProvider


@lru_cache
def get_llm_provider() -> LLMProvider:
    provider = settings.llm_provider.lower()
    if provider == "anthropic":
        from app.llm.anthropic_provider import AnthropicLLMProvider

        return AnthropicLLMProvider()
    if provider == "openai":
        from app.llm.openai_provider import OpenAILLMProvider

        return OpenAILLMProvider()
    if provider == "echo":
        from app.llm.echo_provider import EchoLLMProvider

        return EchoLLMProvider()
    raise ValueError(f"Unknown LLM_PROVIDER: {settings.llm_provider}")
