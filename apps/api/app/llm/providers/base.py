from __future__ import annotations

from typing import Any, Protocol, runtime_checkable
from app.llm.router import ModelTier


@runtime_checkable
class LLMProvider(Protocol):
    """Protocol that all LLM provider adapters must implement."""

    provider_name: str

    def resolve_model_name(self, tier: ModelTier) -> str:
        """Resolves the concrete provider model string for a given logical tier."""
        ...

    async def call(
        self,
        tier: ModelTier,
        messages: list[dict[str, Any]],
        temperature: float | None = None,
        max_tokens: int | None = None,
        max_retries: int = 2,
    ) -> dict[str, Any]:
        """
        Executes an inference call and returns a normalized response dict:
        {
            "content": str,
            "model": str,
            "usage": {"promptTokens": int, "completionTokens": int} | None,
        }
        """
        ...

    async def close(self) -> None:
        """Cleanly releases any persistent client connections or resources."""
        ...
