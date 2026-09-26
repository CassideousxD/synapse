import asyncio
import json
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import select

from app.core.ai_jobs import AIJobManager
from app.core.db import (
    AIJobRow,
    ClassroomRow,
    UserRow,
    engine,
    get_session_context,
)
from app.core.redis import close_redis, get_redis, init_redis


@pytest.fixture(autouse=True)
async def ai_jobs_test_setup():
    """Initializes Redis and cleans up test-created keys and db pool."""
    client = await init_redis()
    yield client
    # Clean up test keys created in this test run
    cursor = 0
    test_keys = []
    while True:
        cursor, keys = await client.scan(cursor=cursor, match="synapse:test:queue:*", count=100)
        test_keys.extend(keys)
        if cursor == 0:
            break
    if test_keys:
        await client.delete(*test_keys)
    await close_redis()
    await engine.dispose()


@pytest.fixture
async def test_user_and_classroom():
    """Creates a real test teacher and classroom in the DB for foreign key relations."""
    uid = uuid.uuid4().hex[:8]
    user_id = f"test-teacher-{uid}"
    class_id = f"test-class-{uid}"

    async with get_session_context() as db:
        user = UserRow(
            id=user_id,
            name="Test Teacher",
            email=f"teacher_{uid}@synapse.internal",
            password_hash="testhash",
            role="teacher",
        )
        classroom = ClassroomRow(
            id=class_id,
            name="AI Job Test Classroom",
            subject="Computer Science",
            join_code=f"JOIN{uid[:4]}",
            teacher_id=user_id,
        )
        db.add(user)
        await db.flush()
        db.add(classroom)
        await db.commit()

    yield {"user_id": user_id, "classroom_id": class_id}

    # Cleanup
    async with get_session_context() as db:
        jobs = (await db.scalars(select(AIJobRow).where(AIJobRow.user_id == user_id))).all()
        for j in jobs:
            await db.delete(j)
        c = await db.scalar(select(ClassroomRow).where(ClassroomRow.id == class_id))
        if c:
            await db.delete(c)
        u = await db.scalar(select(UserRow).where(UserRow.id == user_id))
        if u:
            await db.delete(u)
        await db.commit()


@pytest.mark.asyncio
async def test_ai_job_creation_and_persistence(test_user_and_classroom):
    """1. Job creation: Job is durably committed in PostgreSQL with status QUEUED."""
    user_id = test_user_and_classroom["user_id"]
    class_id = test_user_and_classroom["classroom_id"]
    queue_name = f"synapse:test:queue:{uuid.uuid4().hex}"

    manager = AIJobManager(queue_name=queue_name)
    payload = {"source_text": "Sample text", "title": "Test Title"}

    async with get_session_context() as db:
        job = await manager.create_job(
            db=db,
            user_id=user_id,
            job_type="NOTE_CONCEPT_EXTRACTION",
            payload=payload,
            classroom_id=class_id,
        )

        assert job.id.startswith("job-")
        assert job.status == "QUEUED"
        assert job.attempts == 0
        assert job.max_attempts == 3
        assert json.loads(job.payload) == payload
        assert job.result is None
        assert job.error is None

        # Verify directly from database
        db_job = await db.scalar(select(AIJobRow).where(AIJobRow.id == job.id))
        assert db_job is not None
        assert db_job.status == "QUEUED"


@pytest.mark.asyncio
async def test_ai_job_enqueue(test_user_and_classroom):
    """2. Redis enqueue: Job is committed to PostgreSQL then enqueued to Redis."""
    user_id = test_user_and_classroom["user_id"]
    class_id = test_user_and_classroom["classroom_id"]
    queue_name = f"synapse:test:queue:{uuid.uuid4().hex}"

    manager = AIJobManager(queue_name=queue_name)
    payload = {"source_text": "Networks", "title": "Networks Note"}

    async with get_session_context() as db:
        job, enqueued = await manager.create_and_enqueue_job(
            db=db,
            user_id=user_id,
            job_type="NOTE_CONCEPT_EXTRACTION",
            payload=payload,
            classroom_id=class_id,
            queue_name=queue_name,
        )
        assert enqueued is True

        # Verify job is present in Redis queue
        redis = get_redis()
        items = await redis.lrange(queue_name, 0, -1)
        assert job.id in items


@pytest.mark.asyncio
async def test_redis_unavailable_during_enqueue_fails_safely(test_user_and_classroom, monkeypatch):
    """3. Redis failure resilience: If Redis is unavailable, job remains safe in PostgreSQL."""
    from unittest.mock import AsyncMock
    import app.core.ai_jobs as ai_jobs_module

    user_id = test_user_and_classroom["user_id"]
    queue_name = f"synapse:test:queue:{uuid.uuid4().hex}"

    # Mock get_redis in ai_jobs module to simulate a Redis outage
    mock_redis = AsyncMock()
    mock_redis.rpush.side_effect = RedisConnectionError("Redis connection dropped")
    monkeypatch.setattr(ai_jobs_module, "get_redis", lambda: mock_redis)

    manager = AIJobManager(queue_name=queue_name)

    async with get_session_context() as db:
        job, enqueued = await manager.create_and_enqueue_job(
            db=db,
            user_id=user_id,
            job_type="NOTE_CONCEPT_EXTRACTION",
            payload={"test": "data"},
            queue_name=queue_name,
        )

        # Enqueue returned False without raising 500
        assert enqueued is False
        # But job is durably saved in PostgreSQL!
        db_job = await db.scalar(select(AIJobRow).where(AIJobRow.id == job.id))
        assert db_job is not None
        assert db_job.status == "QUEUED"


@pytest.mark.asyncio
async def test_reconciliation_enqueues_missing_jobs(test_user_and_classroom):
    """4. Reconciliation: Discovers QUEUED jobs missing from Redis and enqueues them."""
    user_id = test_user_and_classroom["user_id"]
    queue_name = f"synapse:test:queue:{uuid.uuid4().hex}"

    manager = AIJobManager(queue_name=queue_name)

    # Create job in PostgreSQL directly (simulating Redis was down)
    async with get_session_context() as db:
        job = await manager.create_job(
            db=db,
            user_id=user_id,
            job_type="NOTE_CONCEPT_EXTRACTION",
            payload={"note_id": "test-note-1"},
        )

    # Verify not yet in Redis queue
    redis = get_redis()
    items_before = await redis.lrange(queue_name, 0, -1)
    assert job.id not in items_before

    # Run reconciliation
    async with get_session_context() as db:
        stats = await manager.reconcile_and_recover(db=db, queue_name=queue_name)
        assert stats["missing_enqueued"] >= 1

    # Verify job is now safely in Redis queue
    items_after = await redis.lrange(queue_name, 0, -1)
    assert job.id in items_after


@pytest.mark.asyncio
async def test_job_claim_and_duplicate_protection(test_user_and_classroom):
    """5. Atomic claim and duplicate protection: Completed or running jobs cannot be re-claimed."""
    user_id = test_user_and_classroom["user_id"]
    queue_name = f"synapse:test:queue:{uuid.uuid4().hex}"

    manager = AIJobManager(queue_name=queue_name)

    async with get_session_context() as db:
        job = await manager.create_job(
            db=db,
            user_id=user_id,
            job_type="NOTE_CONCEPT_EXTRACTION",
            payload={},
        )

        # 1. First claim transitions QUEUED -> RUNNING
        claimed = await manager.claim_job(job.id, db)
        assert claimed is not None
        assert claimed.status == "RUNNING"
        assert claimed.attempts == 1
        assert claimed.started_at is not None

        # 2. Second immediate claim returns None (cannot claim while actively running)
        second_claim = await manager.claim_job(job.id, db)
        assert second_claim is None

        # 3. Complete job -> SUCCEEDED
        completed = await manager.complete_job(job.id, {"status": "ok"}, db)
        assert completed.status == "SUCCEEDED"

        # 4. Third claim on SUCCEEDED returns None (never re-execute succeeded job)
        third_claim = await manager.claim_job(job.id, db)
        assert third_claim is None


@pytest.mark.asyncio
async def test_job_retry_and_max_attempts(test_user_and_classroom):
    """6. Bounded retries: Job retries until max_attempts, then permanently marks FAILED."""
    user_id = test_user_and_classroom["user_id"]
    queue_name = f"synapse:test:queue:{uuid.uuid4().hex}"

    manager = AIJobManager(queue_name=queue_name)

    async with get_session_context() as db:
        job = await manager.create_job(
            db=db,
            user_id=user_id,
            job_type="NOTE_CONCEPT_EXTRACTION",
            payload={},
            max_attempts=2,
        )

        # Attempt 1: claim and fail
        claimed1 = await manager.claim_job(job.id, db)
        assert claimed1.attempts == 1
        j1, requeued1 = await manager.fail_job(job.id, "Attempt 1 error", db, queue_name=queue_name)
        assert j1.status == "QUEUED"
        assert requeued1 is True

        # Attempt 2: claim and fail
        claimed2 = await manager.claim_job(job.id, db)
        assert claimed2.attempts == 2
        j2, requeued2 = await manager.fail_job(job.id, "Attempt 2 error", db, queue_name=queue_name)
        assert j2.status == "FAILED"
        assert requeued2 is False
        assert j2.error == "Attempt 2 error"
        assert j2.completed_at is not None


@pytest.mark.asyncio
async def test_stale_job_crash_recovery(test_user_and_classroom, monkeypatch):
    """7. Worker crash recovery: Stale RUNNING jobs are recovered back to QUEUED."""
    user_id = test_user_and_classroom["user_id"]
    queue_name = f"synapse:test:queue:{uuid.uuid4().hex}"

    manager = AIJobManager(queue_name=queue_name)

    async with get_session_context() as db:
        job = await manager.create_job(
            db=db,
            user_id=user_id,
            job_type="NOTE_CONCEPT_EXTRACTION",
            payload={},
        )
        claimed = await manager.claim_job(job.id, db)
        # Simulate worker crash 10 minutes ago
        claimed.started_at = datetime.now(timezone.utc) - timedelta(seconds=600)
        await db.commit()

        # Run recovery
        stats = await manager.reconcile_and_recover(db=db, queue_name=queue_name)
        assert stats["stale_requeued"] >= 1

        # Check job status is restored to QUEUED
        recovered = await db.scalar(select(AIJobRow).where(AIJobRow.id == job.id))
        assert recovered.status == "QUEUED"
        assert "Recovered from stale RUNNING state" in (recovered.error or "")
