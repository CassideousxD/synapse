import logging
import os
from typing import Optional

import redis.asyncio as aioredis
from redis.asyncio import Redis

logger = logging.getLogger("synapse.redis")

# Global shared Redis client instance
_redis_client: Optional[Redis] = None


def get_redis_url() -> str:
    """Returns canonical REDIS_URL from environment or default local endpoint."""
    return os.environ.get("REDIS_URL", "redis://localhost:6379/0")


async def init_redis() -> Redis:
    """
    Initializes the shared async Redis client and verifies connection with PING.
    Raises ConnectionError if Redis is unavailable.
    """
    global _redis_client
    if _redis_client is not None:
        return _redis_client

    url = get_redis_url()
    max_connections = int(os.environ.get("REDIS_MAX_CONNECTIONS", "10"))

    client = aioredis.from_url(
        url,
        max_connections=max_connections,
        decode_responses=True,
    )

    try:
        # Verify connection
        await client.ping()
        logger.info(f"Connected to Redis at {url} (pool_max={max_connections})")
    except Exception as e:
        await client.aclose()
        logger.error(f"Failed to connect to Redis at {url}: {e}")
        raise ConnectionError(f"Could not connect to Redis at {url}: {e}") from e

    _redis_client = client
    return _redis_client


async def close_redis() -> None:
    """Gracefully closes the shared Redis connection pool during application shutdown."""
    global _redis_client
    if _redis_client is not None:
        try:
            await _redis_client.aclose()
            logger.info("Closed Redis connection pool.")
        finally:
            _redis_client = None


def get_redis() -> Redis:
    """
    Dependency / access pattern for retrieving the shared Redis client.
    Raises RuntimeError if Redis client has not been initialized.
    """
    if _redis_client is None:
        raise RuntimeError("Redis client is not initialized. Ensure init_redis() ran in application lifespan.")
    return _redis_client


async def check_redis_health() -> bool:
    """
    Internal health check helper that performs a Redis PING.
    Returns True if healthy, False otherwise.
    """
    if _redis_client is None:
        return False
    try:
        return await _redis_client.ping() is True
    except Exception:
        return False
