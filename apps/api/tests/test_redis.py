import os
import uuid
import pytest
import redis.asyncio as aioredis

from app.core.redis import (
    check_redis_health,
    close_redis,
    get_redis,
    get_redis_url,
    init_redis,
)


@pytest.fixture(autouse=True)
async def cleanup_redis_fixture():
    yield
    await close_redis()


@pytest.mark.asyncio
async def test_redis_connection_and_ping():
    """Test connecting to Redis, pinging, and checking health."""
    client = await init_redis()
    assert client is not None
    assert await client.ping() is True
    assert await check_redis_health() is True


@pytest.mark.asyncio
async def test_redis_set_get_delete_namespaced():
    """Test SET, GET, and DELETE with namespaced test key without touching other keys."""
    client = await init_redis()
    test_id = uuid.uuid4().hex
    test_key = f"synapse:test:redis:{test_id}"
    test_val = "synapse_redis_foundation_verified"

    try:
        # SET
        set_res = await client.set(test_key, test_val, ex=60)
        assert set_res is True

        # GET
        retrieved = await client.get(test_key)
        assert retrieved == test_val
    finally:
        # Clean up specific test key (Never FLUSHALL/FLUSHDB)
        deleted = await client.delete(test_key)
        assert deleted == 1

    # Verify key is gone
    assert await client.get(test_key) is None


@pytest.mark.asyncio
async def test_shared_client_reuse():
    """Verify that get_redis returns the exact same shared client instance."""
    client1 = await init_redis()
    client2 = get_redis()
    assert client1 is client2


@pytest.mark.asyncio
async def test_redis_lifecycle_cleanup():
    """Verify close_redis cleans up the client cleanly and subsequent get_redis raises error."""
    await init_redis()
    assert await check_redis_health() is True

    await close_redis()
    assert await check_redis_health() is False

    with pytest.raises(RuntimeError, match="Redis client is not initialized"):
        get_redis()

    # Re-initialize for subsequent tests
    await init_redis()
    assert await check_redis_health() is True


@pytest.mark.asyncio
async def test_redis_unavailable_explicit_failure(monkeypatch):
    """Verify that trying to connect to an unreachable Redis host raises a clear ConnectionError without silent fallback."""
    await close_redis()
    # Point to an unreachable port/host
    monkeypatch.setenv("REDIS_URL", "redis://127.0.0.1:63799/0")

    with pytest.raises(ConnectionError, match="Could not connect to Redis"):
        await init_redis()

    # Ensure no fake fallback was created
    assert await check_redis_health() is False

    # Restore valid client
    monkeypatch.undo()
    await init_redis()
    assert await check_redis_health() is True
