import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from app.llm.client import NimError, call_nim
from app.main import app
from tests.conftest import CLIENT_HEADERS

REQ = {"tier": "main", "messages": [{"role": "user", "content": "hi"}]}




async def test_chat_success(client, monkeypatch):
    async def fake_call_nim(tier, messages, temperature, max_tokens):
        return {"content": "hello", "model": "nvidia/nemotron-3-super-120b-a12b", "usage": None}

    monkeypatch.setattr("app.routers.llm_proxy.call_nim", fake_call_nim)
    r = await client.post("/llm/chat", json=REQ, headers=CLIENT_HEADERS)
    assert r.status_code == 200
    assert r.json() == {"content": "hello", "model": "nvidia/nemotron-3-super-120b-a12b", "usage": None}


async def test_chat_passes_through_upstream_429(client, monkeypatch):
    async def fake_call_nim(*a, **kw):
        raise NimError("NIM 429: slow down", status=429)

    monkeypatch.setattr("app.routers.llm_proxy.call_nim", fake_call_nim)
    r = await client.post("/llm/chat", json=REQ, headers=CLIENT_HEADERS)
    assert r.status_code == 429


async def test_chat_passes_through_upstream_401(client, monkeypatch):
    async def fake_call_nim(*a, **kw):
        raise NimError("NIM 401: bad key", status=401)

    monkeypatch.setattr("app.routers.llm_proxy.call_nim", fake_call_nim)
    r = await client.post("/llm/chat", json=REQ, headers=CLIENT_HEADERS)
    assert r.status_code == 401


async def test_chat_timeout_maps_to_504(client, monkeypatch):
    async def fake_call_nim(*a, **kw):
        raise NimError("NIM request timed out after 60.0s", status=None)

    monkeypatch.setattr("app.routers.llm_proxy.call_nim", fake_call_nim)
    r = await client.post("/llm/chat", json=REQ, headers=CLIENT_HEADERS)
    assert r.status_code == 504


async def test_chat_missing_content_maps_to_502(client, monkeypatch):
    async def fake_call_nim(*a, **kw):
        raise NimError("NIM response had no message content", status=None)

    monkeypatch.setattr("app.routers.llm_proxy.call_nim", fake_call_nim)
    r = await client.post("/llm/chat", json=REQ, headers=CLIENT_HEADERS)
    assert r.status_code == 502


async def test_chat_missing_api_key_maps_to_500(client, monkeypatch):
    async def fake_call_nim(*a, **kw):
        raise NimError("Server misconfigured: NVIDIA_API_KEY not set", status=None)

    monkeypatch.setattr("app.routers.llm_proxy.call_nim", fake_call_nim)
    r = await client.post("/llm/chat", json=REQ, headers=CLIENT_HEADERS)
    assert r.status_code == 500


async def test_chat_rejects_malformed_request(client):
    r = await client.post("/llm/chat", json={"tier": "main", "messages": []}, headers=CLIENT_HEADERS)
    assert r.status_code == 422  # empty messages violates min_length=1

    r = await client.post("/llm/chat", json={"tier": "nano", "messages": [{"role": "user", "content": "hi"}]}, headers=CLIENT_HEADERS)
    assert r.status_code == 422  # tier not in fast|main|heavy

    r = await client.post("/llm/chat", json={**REQ, "apiKey": "sneaky"}, headers=CLIENT_HEADERS)
    assert r.status_code == 422  # extra="forbid"


async def test_call_nim_builds_correct_request_and_parses_response(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "test-key")
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("authorization")
        captured["body"] = request.read()
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "pong"}}],
                "usage": {"prompt_tokens": 3, "completion_tokens": 1},
            },
        )

    import app.llm.client as client_mod

    real_async_client = httpx.AsyncClient

    def patched_async_client(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr(client_mod.httpx, "AsyncClient", patched_async_client)

    result = await call_nim("main", [{"role": "user", "content": "hi"}], None, None)

    assert result["content"] == "pong"
    assert result["model"] == "nvidia/nemotron-3-super-120b-a12b"
    assert result["usage"] == {"promptTokens": 3, "completionTokens": 1}
    assert captured["auth"] == "Bearer test-key"
    assert captured["url"] == "https://integrate.api.nvidia.com/v1/chat/completions"


async def test_call_nim_raises_without_api_key(monkeypatch):
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    with pytest.raises(NimError, match="NVIDIA_API_KEY"):
        await call_nim("main", [{"role": "user", "content": "hi"}], None, None)
