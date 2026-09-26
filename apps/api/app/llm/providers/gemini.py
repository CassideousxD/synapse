from __future__ import annotations

import asyncio
import logging
import os
import random
from typing import Any

import httpx

from app.llm.errors import (
    AuthenticationError,
    InvalidResponseError,
    RateLimitError,
    TemporaryProviderError,
    TimeoutError,
    LLMProviderError,
)
from app.llm.router import ModelTier

logger = logging.getLogger("synapse.llm.gemini")

GEMINI_DEFAULT_MODELS: dict[ModelTier, str] = {
    "fast": "gemini-flash-latest",
    "main": "gemini-flash-latest",
    "heavy": "gemini-flash-latest",
}


class GeminiProvider:
    provider_name: str = "gemini"

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout_seconds: float | None = None,
        model_override: str | None = None,
    ):
        self._api_key = api_key or os.environ.get("GEMINI_API_KEY")
        self._base_url = (base_url or os.environ.get("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai")).rstrip("/")
        self._timeout_seconds = float(
            timeout_seconds
            or os.environ.get("LLM_TIMEOUT_SECONDS")
            or 30.0
        )
        self._model_override = model_override or os.environ.get("GEMINI_MODEL")
        self._client: httpx.AsyncClient | None = None

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            limits = httpx.Limits(max_connections=10, max_keepalive_connections=5, keepalive_expiry=30.0)
            timeout = httpx.Timeout(timeout=self._timeout_seconds, connect=10.0)
            self._client = httpx.AsyncClient(limits=limits, timeout=timeout)
        return self._client

    def resolve_model_name(self, tier: ModelTier) -> str:
        if self._model_override:
            return self._model_override
        return GEMINI_DEFAULT_MODELS.get(tier, "gemini-flash-latest")

    async def call(
        self,
        tier: ModelTier,
        messages: list[dict[str, Any]],
        temperature: float | None = None,
        max_tokens: int | None = None,
        max_retries: int = 2,
    ) -> dict[str, Any]:
        if not self._api_key:
            raise AuthenticationError("Server misconfigured: GEMINI_API_KEY not set", provider=self.provider_name)

        model = self.resolve_model_name(tier)
        body = {
            "model": model,
            "messages": messages,
            "temperature": temperature if temperature is not None else 0.2,
            "max_tokens": max_tokens if max_tokens is not None else 1024,
        }

        client = self._get_client()

        for attempt in range(max_retries + 1):
            try:
                res = await client.post(
                    f"{self._base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "Content-Type": "application/json",
                    },
                    json=body,
                )
            except httpx.TimeoutException:
                if attempt < max_retries:
                    delay = 0.5 * (2 ** attempt) + random.uniform(0.05, 0.25)
                    logger.warning(
                        f"Gemini request timed out after {self._timeout_seconds}s (attempt {attempt + 1}/{max_retries + 1}), "
                        f"retrying in {delay:.2f}s..."
                    )
                    await asyncio.sleep(delay)
                    continue
                raise TimeoutError(
                    f"Gemini request timed out after {self._timeout_seconds}s",
                    provider=self.provider_name,
                )
            except httpx.HTTPError as e:
                if attempt < max_retries and isinstance(e, (httpx.ConnectError, httpx.ReadError)):
                    delay = 0.5 * (2 ** attempt) + random.uniform(0.05, 0.25)
                    logger.warning(
                        f"Gemini network error: {e} (attempt {attempt + 1}/{max_retries + 1}), "
                        f"retrying in {delay:.2f}s..."
                    )
                    await asyncio.sleep(delay)
                    continue
                raise TemporaryProviderError(
                    f"Gemini request failed: {e}",
                    provider=self.provider_name,
                )

            if res.status_code in (401, 403):
                raise AuthenticationError(f"Gemini authentication failed ({res.status_code}): {res.text[:200]}", status=res.status_code, provider=self.provider_name)
            elif res.status_code == 429:
                if attempt < max_retries:
                    delay = 0.5 * (2 ** attempt) + random.uniform(0.05, 0.25)
                    logger.warning(
                        f"Gemini rate limited (attempt {attempt + 1}/{max_retries + 1}), retrying in {delay:.2f}s..."
                    )
                    await asyncio.sleep(delay)
                    continue
                raise RateLimitError(f"Gemini rate limit exceeded: {res.text[:200]}", status=429, provider=self.provider_name)
            elif res.status_code in (500, 502, 503, 504):
                if attempt < max_retries:
                    delay = 0.5 * (2 ** attempt) + random.uniform(0.05, 0.25)
                    logger.warning(
                        f"Gemini returned transient {res.status_code} (attempt {attempt + 1}/{max_retries + 1}), "
                        f"retrying in {delay:.2f}s..."
                    )
                    await asyncio.sleep(delay)
                    continue
                raise TemporaryProviderError(f"Gemini {res.status_code}: {res.text[:200]}", status=res.status_code, provider=self.provider_name)
            elif res.status_code >= 400:
                raise LLMProviderError(f"Gemini {res.status_code}: {res.text[:200]}", status=res.status_code, provider=self.provider_name)

            data = res.json()
            choices = data.get("choices", [])
            content = choices[0].get("message", {}).get("content") if choices else None
            if not isinstance(content, str):
                raise InvalidResponseError("Gemini response had no message content", provider=self.provider_name)

            usage = data.get("usage")
            return {
                "content": content,
                "model": model,
                "usage": (
                    {"promptTokens": usage["prompt_tokens"], "completionTokens": usage["completion_tokens"]}
                    if usage and "prompt_tokens" in usage and "completion_tokens" in usage
                    else None
                ),
            }

        raise TemporaryProviderError("Gemini retries exhausted without response", provider=self.provider_name)

    async def close(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
            logger.info("Closed Gemini HTTP client connection pool")
        self._client = None
