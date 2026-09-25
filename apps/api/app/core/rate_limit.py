import hashlib
import logging
import os
from typing import Callable, Optional

from fastapi import HTTPException, Request, Response, status
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import TimeoutError as RedisTimeoutError

from app.core.redis import get_redis

logger = logging.getLogger("synapse.rate_limit")

# Atomic fixed-window rate limiter Lua script
# KEYS[1]: rate limit key
# ARGV[1]: window in seconds
# ARGV[2]: max allowed requests
LUA_RATE_LIMIT = """
local current = redis.call('INCR', KEYS[1])
if current == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end

local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
    ttl = tonumber(ARGV[1])
end

local allowed = 0
if current <= tonumber(ARGV[2]) then
    allowed = 1
end

return { allowed, current, ttl }
"""

# Lua script to check without incrementing
LUA_CHECK_RATE_LIMIT = """
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
    ttl = 0
end

local allowed = 0
if current < tonumber(ARGV[1]) then
    allowed = 1
end

return { allowed, current, ttl }
"""


def is_rate_limit_enabled() -> bool:
    return os.environ.get("RATE_LIMIT_ENABLED", "true").lower() in ("true", "1", "yes")


def get_limit_config(env_var: str, default: int) -> int:
    try:
        return int(os.environ.get(env_var, str(default)))
    except ValueError:
        return default


def hash_identifier(val: str) -> str:
    """SHA-256 hash for privacy-preserving Redis keys (no raw emails/IPs)."""
    return hashlib.sha256(val.strip().lower().encode("utf-8")).hexdigest()[:32]


def extract_client_ip(request: Request) -> str:
    """
    Extracts client IP.
    By default, uses request.client.host to prevent untrusted header spoofing.
    If TRUST_PROXY_HEADERS=true, inspects X-Forwarded-For (leftmost IP).
    """
    trust_proxy = os.environ.get("TRUST_PROXY_HEADERS", "false").lower() in ("true", "1", "yes")
    if trust_proxy:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            client_ip = forwarded.split(",")[0].strip()
            if client_ip:
                return client_ip
    if request.client and request.client.host:
        return request.client.host
    return "127.0.0.1"


def extract_user_id(request: Request) -> str:
    """Extracts user ID from request state or auth token without re-decoding."""
    # Check if user payload was already unpacked onto request.state
    if hasattr(request, "state") and hasattr(request.state, "user_id"):
        return request.state.user_id

    # Fallback to authorization header decode if available
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        token = auth_header[7:]
        try:
            import jwt
            secret = os.environ.get("JWT_SECRET", "")
            if secret:
                payload = jwt.decode(token, secret, algorithms=["HS256"], options={"verify_signature": False})
                return payload.get("sub", "anon")
        except Exception:
            pass
    return "anon"


class RateLimitResult:
    def __init__(self, allowed: bool, limit: int, remaining: int, reset: int, retry_after: int):
        self.allowed = allowed
        self.limit = limit
        self.remaining = remaining
        self.reset = reset
        self.retry_after = retry_after

    def set_headers(self, response: Response) -> None:
        response.headers["X-RateLimit-Limit"] = str(self.limit)
        response.headers["X-RateLimit-Remaining"] = str(max(0, self.remaining))
        response.headers["X-RateLimit-Reset"] = str(self.reset)
        if not self.allowed:
            response.headers["Retry-After"] = str(self.retry_after)


async def check_rate_limit(key: str, limit: int, window: int) -> RateLimitResult:
    """
    Executes the atomic rate limit check against Redis using EVAL.
    Fails open ONLY on Redis connectivity/timeout errors.
    """
    if not is_rate_limit_enabled():
        return RateLimitResult(allowed=True, limit=limit, remaining=limit, reset=0, retry_after=0)

    try:
        redis = get_redis()
        res = await redis.eval(LUA_RATE_LIMIT, 1, key, window, limit)
        allowed_int, current, ttl = res[0], res[1], res[2]
        allowed = bool(allowed_int == 1)
        remaining = max(0, limit - current)
        reset = max(0, ttl)
        retry_after = reset if not allowed else 0
        return RateLimitResult(allowed=allowed, limit=limit, remaining=remaining, reset=reset, retry_after=retry_after)
    except (RedisConnectionError, RedisTimeoutError, RuntimeError) as e:
        logger.error("Rate limiter: Redis unreachable (%s). Failing open.", e)
        return RateLimitResult(allowed=True, limit=limit, remaining=limit, reset=0, retry_after=0)


async def check_rate_limit_without_increment(key: str, limit: int) -> RateLimitResult:
    """
    Inspects if key is already blocked without incrementing counter.
    Fails open on Redis errors.
    """
    if not is_rate_limit_enabled():
        return RateLimitResult(allowed=True, limit=limit, remaining=limit, reset=0, retry_after=0)

    try:
        redis = get_redis()
        res = await redis.eval(LUA_CHECK_RATE_LIMIT, 1, key, limit)
        allowed_int, current, ttl = res[0], res[1], res[2]
        allowed = bool(allowed_int == 1)
        remaining = max(0, limit - current)
        reset = max(0, ttl)
        retry_after = reset if not allowed else 0
        return RateLimitResult(allowed=allowed, limit=limit, remaining=remaining, reset=reset, retry_after=retry_after)
    except (RedisConnectionError, RedisTimeoutError, RuntimeError) as e:
        logger.error("Rate limiter: Redis unreachable (%s). Failing open.", e)
        return RateLimitResult(allowed=True, limit=limit, remaining=limit, reset=0, retry_after=0)


async def record_failed_login(identifier: str, client_ip: str, window: int = 60) -> RateLimitResult:
    """
    Increments failed login counter for <sha256(identifier + ip)>.
    Limit is configured by RATE_LIMIT_AUTH_PER_MINUTE (default 5).
    """
    limit = get_limit_config("RATE_LIMIT_AUTH_PER_MINUTE", 5)
    hashed_key = hash_identifier(f"{identifier}:{client_ip}")
    key = f"synapse:rl:auth:login:{hashed_key}"
    return await check_rate_limit(key, limit=limit, window=window)


def rate_limit(
    key_prefix: str,
    limit: int,
    window: int = 60,
    key_extractor: Optional[Callable[[Request], str]] = None,
):
    """
    FastAPI dependency factory for rate limiting.
    Injects standard rate limit headers and raises 429 when limit is exceeded.
    """
    async def dependency(request: Request, response: Response):
        if not is_rate_limit_enabled():
            return

        if key_extractor:
            key_suffix = key_extractor(request)
        else:
            key_suffix = hash_identifier(extract_client_ip(request))

        key = f"{key_prefix}:{key_suffix}"
        result = await check_rate_limit(key, limit=limit, window=window)
        result.set_headers(response)

        if not result.allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded",
                headers={
                    "Retry-After": str(result.retry_after),
                    "X-RateLimit-Limit": str(result.limit),
                    "X-RateLimit-Remaining": str(result.remaining),
                    "X-RateLimit-Reset": str(result.reset),
                },
            )

    return dependency
