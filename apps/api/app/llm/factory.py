from __future__ import annotations

import os

from app.llm.errors import ConfigurationError
from app.llm.providers.base import LLMProvider
from app.llm.providers.gemini import GeminiProvider
from app.llm.providers.groq import GroqProvider
from app.llm.providers.nim import NIMProvider


def create_llm_provider(provider_name: str | None = None) -> LLMProvider:
    """
    Centralized factory for creating LLM provider instances.
    Selects provider based on provider_name or the LLM_PROVIDER environment variable.
    Defaults to 'nim' if unconfigured.
    """
    raw = provider_name or os.environ.get("LLM_PROVIDER", "nim")
    provider = raw.strip().lower()

    if provider == "nim":
        return NIMProvider()
    elif provider == "groq":
        return GroqProvider()
    elif provider == "gemini":
        return GeminiProvider()
    else:
        raise ConfigurationError(
            f"Unsupported LLM provider '{provider}'. Supported providers: 'nim', 'groq', 'gemini'."
        )
