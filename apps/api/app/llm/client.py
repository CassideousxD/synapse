from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from app.llm.errors import (
    AuthenticationError,
    ConfigurationError,
    InvalidResponseError,
    LLMProviderError,
    NimError,
    RateLimitError,
    TemporaryProviderError,
    TimeoutError,
)
from app.llm.factory import create_llm_provider
from app.llm.providers.base import LLMProvider
from app.llm.router import ModelTier

logger = logging.getLogger("synapse.llm")

_active_provider: LLMProvider | None = None


def get_llm_provider() -> LLMProvider:
    """Returns the singleton LLM provider instance, instantiating it if necessary."""
    global _active_provider
    if _active_provider is None:
        _active_provider = create_llm_provider()
    return _active_provider


def set_llm_provider(provider: LLMProvider | None) -> None:
    """Explicitly sets or resets the active LLM provider (useful for testing)."""
    global _active_provider
    _active_provider = provider


async def init_llm_client() -> LLMProvider:
    """Eagerly initializes the active LLM provider."""
    provider = get_llm_provider()
    logger.info(f"Initialized LLM provider '{provider.provider_name}'")
    return provider


async def close_llm_client() -> None:
    """Cleanly closes active provider connections."""
    global _active_provider
    if _active_provider is not None:
        await _active_provider.close()
        logger.info(f"Closed LLM provider '{_active_provider.provider_name}'")
    _active_provider = None


def get_current_provider_name() -> str:
    """Returns the name of the currently active LLM provider (e.g. 'nim', 'groq', 'gemini')."""
    return get_llm_provider().provider_name


def get_current_provider_model(tier: ModelTier = "main") -> str:
    """Returns the resolved model string for the active provider."""
    return get_llm_provider().resolve_model_name(tier)


async def call_llm(
    tier: ModelTier,
    messages: list[dict[str, Any]],
    temperature: float | None = None,
    max_tokens: int | None = None,
    max_retries: int = 2,
) -> dict[str, Any]:
    """
    Unified entry point for LLM inference across all supported providers.
    Returns normalized dict:
    {
        "content": str,
        "model": str,
        "usage": {"promptTokens": int, "completionTokens": int} | None,
    }
    """
    provider = get_llm_provider()
    return await provider.call(
        tier=tier,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        max_retries=max_retries,
    )


# =========================================================================
# Backward-compatibility aliases for legacy code
# =========================================================================
call_nim = call_llm
init_nim_client = init_llm_client
close_nim_client = close_llm_client


def get_nim_client() -> httpx.AsyncClient:
    """Backward-compatible helper for legacy test suites expecting httpx.AsyncClient."""
    provider = get_llm_provider()
    if hasattr(provider, "_get_client"):
        return provider._get_client()  # type: ignore[attr-defined]
    return httpx.AsyncClient()
