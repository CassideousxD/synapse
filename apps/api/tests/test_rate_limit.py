import asyncio
import os
import uuid
import pytest
from httpx import ASGITransport, AsyncClient
from redis.exceptions import ConnectionError as RedisConnectionError

from app.core.db import engine
from app.core.redis import close_redis, get_redis, init_redis
from app.core.rate_limit import check_rate_limit, hash_identifier
from app.main import app


@pytest.fixture(autouse=True)
async def redis_setup(monkeypatch):
    """Ensure Redis is initialized before tests and clean up test keys afterwards."""
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "true")
    client = await init_redis()
    yield client
    # Clean up test keys created in this test run
    test_keys = []
    for match_pat in ("synapse:test:rl:*", "synapse:rl:auth:*"):
        cursor = 0
        while True:
            cursor, keys = await client.scan(cursor=cursor, match=match_pat, count=100)
            test_keys.extend(keys)
            if cursor == 0:
                break
    if test_keys:
        await client.delete(*test_keys)
    await close_redis()
    await engine.dispose()


@pytest.mark.asyncio
async def test_allowed_requests_under_limit(redis_setup):
    """1. Allowed requests under limit succeed with valid decrementing headers."""
    test_id = uuid.uuid4().hex
    key = f"synapse:test:rl:{test_id}"
    limit = 5

    for i in range(1, limit + 1):
        res = await check_rate_limit(key, limit=limit, window=60)
        assert res.allowed is True
        assert res.limit == limit
        assert res.remaining == limit - i
        assert res.reset > 0


@pytest.mark.asyncio
async def test_exact_limit_boundary(redis_setup):
    """2. Exact boundary: N requests succeed, N+1 returns allowed=False."""
    test_id = uuid.uuid4().hex
    key = f"synapse:test:rl:{test_id}"
    limit = 3

    # N requests succeed
    for _ in range(limit):
        res = await check_rate_limit(key, limit=limit, window=60)
        assert res.allowed is True

    # N+1 rejected
    overflow = await check_rate_limit(key, limit=limit, window=60)
    assert overflow.allowed is False
    assert overflow.remaining == 0
    assert overflow.retry_after > 0


@pytest.mark.asyncio
async def test_rate_limit_headers_and_status(redis_setup):
    """3. Verify 429 response and standard RFC 6585 headers via FastAPI route."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        # Use register route with small limit (5 / min)
        ip = "192.168.1.100"
        headers = {"X-Forwarded-For": ip}
        
        # Fire 5 requests to hit limit
        for i in range(5):
            r = await c.post(
                "/auth/register/student",
                json={"name": f"Test {i}", "email": f"test_{uuid.uuid4().hex[:6]}@synapse.edu", "password": "password123"},
                headers=headers,
            )
            assert r.status_code == 201
            assert "X-RateLimit-Limit" in r.headers
            assert "X-RateLimit-Remaining" in r.headers
            assert "X-RateLimit-Reset" in r.headers

        # 6th request must trigger 429
        blocked = await c.post(
            "/auth/register/student",
            json={"name": "Blocked", "email": f"blocked_{uuid.uuid4().hex[:6]}@synapse.edu", "password": "password123"},
            headers=headers,
        )
        assert blocked.status_code == 429
        assert blocked.json()["detail"] == "Rate limit exceeded"
        assert "Retry-After" in blocked.headers
        assert int(blocked.headers["Retry-After"]) > 0
        assert blocked.headers["X-RateLimit-Remaining"] == "0"


@pytest.mark.asyncio
async def test_window_expiry(redis_setup):
    """4. Window expiry: After TTL passes, counter resets and requests succeed."""
    test_id = uuid.uuid4().hex
    key = f"synapse:test:rl:{test_id}"
    limit = 2
    window = 1  # 1 second window for test

    # Hit limit
    for _ in range(limit):
        r = await check_rate_limit(key, limit=limit, window=window)
        assert r.allowed is True

    # Blocked
    r_blocked = await check_rate_limit(key, limit=limit, window=window)
    assert r_blocked.allowed is False

    # Wait for window expiry
    await asyncio.sleep(1.1)

    # Allowed again
    r_reset = await check_rate_limit(key, limit=limit, window=window)
    assert r_reset.allowed is True
    assert r_reset.remaining == limit - 1


@pytest.mark.asyncio
async def test_concurrent_requests_atomicity(redis_setup):
    """5. Concurrent requests: Fire 20 concurrent requests against a limit of 10. Exactly 10 allowed, 10 rejected."""
    test_id = uuid.uuid4().hex
    key = f"synapse:test:rl:concurrent:{test_id}"
    limit = 10

    async def hit():
        return await check_rate_limit(key, limit=limit, window=60)

    results = await asyncio.gather(*(hit() for _ in range(20)))
    allowed_count = sum(1 for r in results if r.allowed)
    blocked_count = sum(1 for r in results if not r.allowed)

    assert allowed_count == 10
    assert blocked_count == 10


@pytest.mark.asyncio
async def test_user_isolation(redis_setup):
    """6. User isolation: User A exhausting quota must NOT affect User B."""
    user_a_key = f"synapse:test:rl:user:{uuid.uuid4().hex}"
    user_b_key = f"synapse:test:rl:user:{uuid.uuid4().hex}"
    limit = 3

    # Exhaust user A
    for _ in range(limit):
        await check_rate_limit(user_a_key, limit=limit, window=60)
    assert (await check_rate_limit(user_a_key, limit=limit, window=60)).allowed is False

    # User B is completely unaffected
    user_b_res = await check_rate_limit(user_b_key, limit=limit, window=60)
    assert user_b_res.allowed is True
    assert user_b_res.remaining == limit - 1


@pytest.mark.asyncio
async def test_tier_isolation(redis_setup):
    """7. Tier isolation: Exhausting AI quota must not prevent normal general API operations."""
    user_id = uuid.uuid4().hex
    ai_key = f"synapse:test:rl:ai:user:{user_id}"
    general_key = f"synapse:test:rl:user:{user_id}:general"

    # Exhaust AI quota (limit 2)
    for _ in range(2):
        await check_rate_limit(ai_key, limit=2, window=60)
    assert (await check_rate_limit(ai_key, limit=2, window=60)).allowed is False

    # General tier still completely allowed
    gen_res = await check_rate_limit(general_key, limit=120, window=60)
    assert gen_res.allowed is True
    assert gen_res.remaining == 119


@pytest.mark.asyncio
async def test_failed_login_protection(redis_setup):
    """8. Failed login protection: Repeated invalid credentials return 429; successful logins do not consume quota."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        # Create a real teacher first with dedicated client IP
        client_ip = f"10.99.{uuid.uuid4().int % 200 + 1}.1"
        headers = {"X-Forwarded-For": client_ip}
        email = f"teacher_lockout_{uuid.uuid4().hex[:6]}@synapse.edu"
        pw = "CorrectPassword123!"
        reg = await c.post("/auth/register/teacher", json={"name": "Teacher Lockout", "email": email, "password": pw}, headers=headers)
        assert reg.status_code == 201

        # 1. Successful login does NOT count towards failed login lockout
        login_good = await c.post("/auth/login", json={"email": email, "password": pw}, headers=headers)
        assert login_good.status_code == 200

        # 2. 5 bad password attempts trigger 401s
        for _ in range(5):
            bad_res = await c.post("/auth/login", json={"email": email, "password": "WrongPassword"}, headers=headers)
            assert bad_res.status_code in (401, 429)

        # 3. 6th attempt is blocked with 429 Too Many Requests
        lockout_res = await c.post("/auth/login", json={"email": email, "password": "WrongPassword"}, headers=headers)
        assert lockout_res.status_code == 429
        assert lockout_res.json()["detail"] == "Rate limit exceeded"
        assert "Retry-After" in lockout_res.headers


@pytest.mark.asyncio
async def test_redis_outage_fail_open(redis_setup, monkeypatch, caplog):
    """9. Redis outage: When Redis throws ConnectionError, rate limiter fails open (allowed=True) and logs high-visibility error."""
    import logging
    from unittest.mock import AsyncMock

    caplog.set_level(logging.ERROR)

    # Mock get_redis() in rate_limit module to simulate a connection failure
    mock_client = AsyncMock()
    mock_client.eval.side_effect = RedisConnectionError("Simulated Redis network drop")
    monkeypatch.setattr("app.core.rate_limit.get_redis", lambda: mock_client)

    test_key = f"synapse:test:rl:outage:{uuid.uuid4().hex}"
    res = await check_rate_limit(test_key, limit=5, window=60)

    # Must fail open (allow request)
    assert res.allowed is True
    # Must log high-visibility error
    assert any("Rate limiter: Redis unreachable" in record.message for record in caplog.records)


@pytest.mark.asyncio
async def test_health_check_immunity(redis_setup):
    """10. Health immunity: GET /health is never rate-limited even when quotas are exhausted."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        for _ in range(20):
            r = await c.get("/health")
            assert r.status_code == 200
            assert r.json() == {"ok": True}
