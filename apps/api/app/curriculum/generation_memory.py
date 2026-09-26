from __future__ import annotations

import logging
import os
import time
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from redis.asyncio import Redis

from app.core.redis import get_redis

logger = logging.getLogger("synapse.generation_memory")

# Configurable TTL for draft test generation memory (default: 24 hours)
TEST_GENERATION_MEMORY_TTL_SECONDS = int(
    os.environ.get("TEST_GENERATION_MEMORY_TTL_SECONDS", "86400")
)


def get_test_generation_key(test_id: str) -> str:
    """Returns canonical namespaced Redis key for a test/draft generation context."""
    return f"synapse:test:{test_id}:generation"


class StoredQuestion(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    prompt: str
    concept_id: str | None = None
    format: str | None = None
    type: str = "mcq"
    options: list[str] = Field(default_factory=list)
    answer: str | None = None
    created_at: float = Field(default_factory=time.time)


class TestGenerationMemory(BaseModel):
    __test__ = False
    model_config = ConfigDict(extra="ignore")
    test_id: str
    teacher_id: str
    classroom_id: str | None = None
    questions: list[StoredQuestion] = Field(default_factory=list)
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)


def _parse_question_dict(q: dict[str, Any]) -> StoredQuestion:
    """Converts a raw question dictionary into a validated StoredQuestion."""
    return StoredQuestion(
        id=str(q.get("id", "")),
        prompt=str(q.get("prompt", q.get("stem", ""))),
        concept_id=q.get("conceptId") or q.get("concept_id"),
        format=q.get("format"),
        type=q.get("type", "mcq"),
        options=[str(o) for o in q.get("options", [])],
        answer=str(q.get("answer", "")) if q.get("answer") is not None else None,
        created_at=time.time(),
    )


async def get_test_generation_memory(
    test_id: str,
    redis_client: Redis | None = None,
) -> TestGenerationMemory | None:
    """
    Retrieves the active generation memory for a test/draft ID.
    Returns None if no memory exists or if Redis is unavailable.
    """
    if not test_id:
        return None

    try:
        r = redis_client if redis_client is not None else get_redis()
        key = get_test_generation_key(test_id)
        raw = await r.get(key)
        if not raw:
            return None
        return TestGenerationMemory.model_validate_json(raw)
    except Exception as e:
        logger.warning(f"Failed to read test generation memory for '{test_id}': {e}")
        return None


async def add_test_generation_questions(
    test_id: str,
    teacher_id: str,
    questions: list[dict[str, Any]],
    classroom_id: str | None = None,
    redis_client: Redis | None = None,
    ttl_seconds: int | None = None,
) -> TestGenerationMemory:
    """
    Appends generated questions to the test's generation memory in Redis and refreshes TTL.
    Preserves question ordering and isolates memory by teacher_id.
    """
    ttl = ttl_seconds if ttl_seconds is not None else TEST_GENERATION_MEMORY_TTL_SECONDS
    now = time.time()
    new_stored = [_parse_question_dict(q) for q in questions]

    existing = await get_test_generation_memory(test_id, redis_client=redis_client)

    if existing is not None:
        # Append only new question IDs to avoid duplicates if re-added
        existing_ids = {q.id for q in existing.questions}
        for q in new_stored:
            if q.id not in existing_ids:
                existing.questions.append(q)
                existing_ids.add(q.id)
        existing.updated_at = now
        memory = existing
    else:
        memory = TestGenerationMemory(
            test_id=test_id,
            teacher_id=teacher_id,
            classroom_id=classroom_id,
            questions=new_stored,
            created_at=now,
            updated_at=now,
        )

    try:
        r = redis_client if redis_client is not None else get_redis()
        key = get_test_generation_key(test_id)
        await r.set(key, memory.model_dump_json(), ex=ttl)
    except Exception as e:
        logger.warning(f"Failed to write test generation memory for '{test_id}': {e}")

    return memory


async def clear_test_generation_memory(
    test_id: str,
    redis_client: Redis | None = None,
) -> bool:
    """Clears the generation memory for a given test/draft ID."""
    if not test_id:
        return False
    try:
        r = redis_client if redis_client is not None else get_redis()
        key = get_test_generation_key(test_id)
        deleted = await r.delete(key)
        return bool(deleted)
    except Exception as e:
        logger.warning(f"Failed to clear test generation memory for '{test_id}': {e}")
        return False
