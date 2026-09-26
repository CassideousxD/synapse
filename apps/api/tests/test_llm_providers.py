import pytest
import httpx
from unittest.mock import AsyncMock, patch

from app.llm.client import (
    call_llm,
    call_nim,
    get_current_provider_model,
    get_current_provider_name,
    get_llm_provider,
    set_llm_provider,
)
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
from app.llm.providers.gemini import GeminiProvider
from app.llm.providers.groq import GroqProvider
from app.llm.providers.nim import NIMProvider


def test_factory_creates_nim_by_default(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    provider = create_llm_provider()
    assert isinstance(provider, NIMProvider)
    assert provider.provider_name == "nim"


def test_factory_creates_groq(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "groq")
    provider = create_llm_provider()
    assert isinstance(provider, GroqProvider)
    assert provider.provider_name == "groq"


def test_factory_creates_gemini(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    provider = create_llm_provider()
    assert isinstance(provider, GeminiProvider)
    assert provider.provider_name == "gemini"


def test_factory_rejects_unknown_provider():
    with pytest.raises(ConfigurationError) as exc_info:
        create_llm_provider("unsupported_ai")
    assert "Unsupported LLM provider" in str(exc_info.value)


@pytest.mark.asyncio
async def test_nim_provider_normalization(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "test-key")
    provider = NIMProvider(api_key="test-key")

    mock_resp = {
        "id": "chatcmpl-123",
        "choices": [{"message": {"role": "assistant", "content": '{"result": "ok"}'}}],
        "usage": {"prompt_tokens": 15, "completion_tokens": 25},
    }

    mock_post = AsyncMock(return_value=httpx.Response(200, json=mock_resp))
    monkeypatch.setattr(provider._get_client(), "post", mock_post)

    res = await provider.call("main", [{"role": "user", "content": "hi"}])
    assert res["content"] == '{"result": "ok"}'
    assert res["model"] == "nvidia/nemotron-3-super-120b-a12b"
    assert res["usage"] == {"promptTokens": 15, "completionTokens": 25}
    await provider.close()


@pytest.mark.asyncio
async def test_groq_provider_normalization(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-groq-key")
    provider = GroqProvider(api_key="test-groq-key")

    mock_resp = {
        "id": "chatcmpl-groq-123",
        "choices": [{"message": {"role": "assistant", "content": '{"provider": "groq"}'}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 20},
    }

    mock_post = AsyncMock(return_value=httpx.Response(200, json=mock_resp))
    monkeypatch.setattr(provider._get_client(), "post", mock_post)

    res = await provider.call("fast", [{"role": "user", "content": "hi"}])
    assert res["content"] == '{"provider": "groq"}'
    assert res["model"] == "openai/gpt-oss-20b"
    assert res["usage"] == {"promptTokens": 10, "completionTokens": 20}

    await provider.close()


@pytest.mark.asyncio
async def test_gemini_provider_normalization(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    provider = GeminiProvider(api_key="test-gemini-key")

    mock_resp = {
        "id": "chatcmpl-gemini-123",
        "choices": [{"message": {"role": "assistant", "content": '{"provider": "gemini"}'}}],
        "usage": {"prompt_tokens": 12, "completion_tokens": 18},
    }

    mock_post = AsyncMock(return_value=httpx.Response(200, json=mock_resp))
    monkeypatch.setattr(provider._get_client(), "post", mock_post)

    res = await provider.call("heavy", [{"role": "user", "content": "hi"}])
    assert res["content"] == '{"provider": "gemini"}'
    assert res["model"] == "gemini-flash-latest"
    assert res["usage"] == {"promptTokens": 12, "completionTokens": 18}
    await provider.close()


@pytest.mark.asyncio
async def test_groq_provider_error_mapping(monkeypatch):
    provider = GroqProvider(api_key="test-key")

    # 401 AuthenticationError
    mock_post_401 = AsyncMock(return_value=httpx.Response(401, text="Unauthorized"))
    monkeypatch.setattr(provider._get_client(), "post", mock_post_401)
    with pytest.raises(AuthenticationError):
        await provider.call("main", [{"role": "user", "content": "hi"}], max_retries=0)

    # 429 RateLimitError
    mock_post_429 = AsyncMock(return_value=httpx.Response(429, text="Rate limit exceeded"))
    monkeypatch.setattr(provider._get_client(), "post", mock_post_429)
    with pytest.raises(RateLimitError):
        await provider.call("main", [{"role": "user", "content": "hi"}], max_retries=0)

    # 503 TemporaryProviderError
    mock_post_503 = AsyncMock(return_value=httpx.Response(503, text="Service Unavailable"))
    monkeypatch.setattr(provider._get_client(), "post", mock_post_503)
    with pytest.raises(TemporaryProviderError):
        await provider.call("main", [{"role": "user", "content": "hi"}], max_retries=0)

    # Missing API key
    no_key_provider = GroqProvider(api_key="")
    with pytest.raises(AuthenticationError):
        await no_key_provider.call("main", [{"role": "user", "content": "hi"}])

    await provider.close()


@pytest.mark.asyncio
async def test_unified_call_llm_and_backward_compatibility(monkeypatch):
    mock_provider = GroqProvider(api_key="test-key")
    mock_post = AsyncMock(return_value=httpx.Response(200, json={
        "choices": [{"message": {"role": "assistant", "content": "test reply"}}],
        "usage": {"prompt_tokens": 5, "completion_tokens": 5},
    }))
    monkeypatch.setattr(mock_provider._get_client(), "post", mock_post)

    set_llm_provider(mock_provider)
    try:
        assert get_current_provider_name() == "groq"
        assert get_current_provider_model("fast") == "openai/gpt-oss-20b"


        # call_llm
        r1 = await call_llm("fast", [{"role": "user", "content": "ping"}])
        assert r1["content"] == "test reply"

        # call_nim backward compatibility alias
        r2 = await call_nim("fast", [{"role": "user", "content": "ping"}])
        assert r2["content"] == "test reply"

        # NimError alias
        assert issubclass(AuthenticationError, NimError)
        assert issubclass(NimError, LLMProviderError)
    finally:
        set_llm_provider(None)
