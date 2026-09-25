import os

import httpx

from app.llm.router import ModelTier, resolve_model

NIM_BASE_URL = os.environ.get("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1")
NIM_TIMEOUT_S = float(os.environ.get("NVIDIA_TIMEOUT_S", "60"))


class NimError(Exception):
    """status=None means we never got a response from NIM at all (network/timeout)."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


async def call_nim(
    tier: ModelTier,
    messages: list[dict],
    temperature: float | None,
    max_tokens: int | None,
) -> dict:
    api_key = os.environ.get("NVIDIA_API_KEY")
    if not api_key:
        raise NimError("Server misconfigured: NVIDIA_API_KEY not set", status=None)

    model = resolve_model(tier)
    body = {
        "model": model,
        "messages": messages,
        "temperature": temperature if temperature is not None else 0.2,
        "max_tokens": max_tokens if max_tokens is not None else 1024,
    }

    try:
        async with httpx.AsyncClient(timeout=NIM_TIMEOUT_S) as client:
            res = await client.post(
                f"{NIM_BASE_URL}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=body,
            )
    except httpx.TimeoutException:
        raise NimError(f"NIM request timed out after {NIM_TIMEOUT_S}s", status=None)
    except httpx.HTTPError as e:
        raise NimError(f"NIM request failed: {e}", status=None)

    if res.status_code >= 400:
        raise NimError(f"NIM {res.status_code}: {res.text[:200]}", status=res.status_code)

    data = res.json()
    content = data.get("choices", [{}])[0].get("message", {}).get("content")
    if not isinstance(content, str):
        raise NimError("NIM response had no message content", status=None)

    usage = data.get("usage")
    return {
        "content": content,
        "model": model,
        "usage": (
            {"promptTokens": usage["prompt_tokens"], "completionTokens": usage["completion_tokens"]}
            if usage
            else None
        ),
    }
