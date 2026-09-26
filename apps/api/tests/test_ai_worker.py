import asyncio
import json
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.ai_jobs import AIJobManager
from app.core.db import (
    AIJobRow,
    ClassroomRow,
    ConceptRow,
    NoteRow,
    UserRow,
    engine,
    get_session_context,
)
from app.core.redis import close_redis, init_redis
from app.core.security import create_access_token
from app.curriculum.tagging import ProposedConcept
from app.main import app
from app.workers.ai_worker import AIWorker


@pytest.fixture(autouse=True)
async def worker_test_setup():
    """Initializes Redis and cleans up test-created keys and db pool."""
    client = await init_redis()
    yield client
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
async def test_env():
    """Sets up a real teacher, classroom, and note in the database."""
    uid = uuid.uuid4().hex[:8]
    user_id = f"teacher-{uid}"
    class_id = f"class-{uid}"
    note_id = f"note-{uid}"

    token = create_access_token(subject=user_id, role="teacher")
    auth_headers = {"Authorization": f"Bearer {token}"}

    async with get_session_context() as db:
        user = UserRow(
            id=user_id,
            name="Worker Teacher",
            email=f"wteacher_{uid}@synapse.internal",
            password_hash="testhash",
            role="teacher",
        )
        classroom = ClassroomRow(
            id=class_id,
            name="Worker Test Class",
            subject="Networks",
            join_code=f"WJ{uid[:4]}",
            teacher_id=user_id,
        )
        note = NoteRow(
            id=note_id,
            title="Transport Layer",
            classroom_id=class_id,
            published=True,
            status="PROCESSING",
            summary="Intro to transport protocols",
            content="## TCP\nTransmission Control Protocol.\n\n## UDP\nUser Datagram Protocol.",
            sections="[]",
            concept_ids="[]",
        )
        db.add(user)
        await db.flush()
        db.add(classroom)
        db.add(note)
        await db.commit()

    yield {
        "user_id": user_id,
        "classroom_id": class_id,
        "note_id": note_id,
        "token": token,
        "auth_headers": auth_headers,
    }

    # Cleanup
    async with get_session_context() as db:
        jobs = (await db.scalars(select(AIJobRow).where(AIJobRow.user_id == user_id))).all()
        for j in jobs:
            await db.delete(j)
        await db.flush()

        concepts = (await db.scalars(select(ConceptRow).where(ConceptRow.classroom_id == class_id))).all()
        for c in concepts:
            await db.delete(c)
        await db.flush()

        notes = (await db.scalars(select(NoteRow).where(NoteRow.classroom_id == class_id))).all()
        for n in notes:
            await db.delete(n)
        await db.flush()

        c = await db.scalar(select(ClassroomRow).where(ClassroomRow.id == class_id))
        if c:
            await db.delete(c)
        await db.flush()

        u = await db.scalar(select(UserRow).where(UserRow.id == user_id))
        if u:
            await db.delete(u)
        await db.commit()


@pytest.mark.asyncio
async def test_worker_dequeue_and_process_success(test_env, monkeypatch):
    """1. Worker dequeue & execution: Pulls job from Redis, runs extraction, marks job SUCCEEDED, note READY."""
    queue_name = f"synapse:test:queue:{uuid.uuid4().hex}"
    note_id = test_env["note_id"]
    user_id = test_env["user_id"]
    class_id = test_env["classroom_id"]

    # Mock extract_concepts to return deterministic test concepts
    async def mock_extract(source_text, title=""):
        return [
            ProposedConcept(name="TCP", summary="Transmission Control Protocol", relatedNames=["UDP"]),
            ProposedConcept(name="UDP", summary="User Datagram Protocol", relatedNames=["TCP"]),
        ]

    monkeypatch.setattr("app.workers.ai_worker.extract_concepts", mock_extract)

    manager = AIJobManager(queue_name=queue_name)
    worker = AIWorker(queue_name=queue_name, job_manager=manager)

    # Create and enqueue job
    async with get_session_context() as db:
        job, enqueued = await manager.create_and_enqueue_job(
            db=db,
            user_id=user_id,
            job_type="NOTE_CONCEPT_EXTRACTION",
            payload={"note_id": note_id, "classroom_id": class_id, "source_text": "Sample", "title": "Transport"},
            classroom_id=class_id,
            queue_name=queue_name,
        )
        assert enqueued is True

    # Process one job with worker
    success = await worker.process_one(timeout=2.0)
    assert success is True

    # Verify job status is SUCCEEDED in PostgreSQL
    async with get_session_context() as db:
        db_job = await db.scalar(select(AIJobRow).where(AIJobRow.id == job.id))
        assert db_job.status == "SUCCEEDED"
        assert db_job.completed_at is not None
        result = json.loads(db_job.result)
        assert result["concepts_extracted"] == 2

        # Verify note status transitioned from PROCESSING to READY
        db_note = await db.scalar(select(NoteRow).where(NoteRow.id == note_id))
        assert db_note.status == "READY"
        note_cids = json.loads(db_note.concept_ids)
        assert len(note_cids) == 2


@pytest.mark.asyncio
async def test_worker_failure_and_permanent_fail(test_env, monkeypatch):
    """2. Worker retry exhaustion: Job fails repeatedly until max_attempts, then marks note and job FAILED."""
    queue_name = f"synapse:test:queue:{uuid.uuid4().hex}"
    note_id = test_env["note_id"]
    user_id = test_env["user_id"]
    class_id = test_env["classroom_id"]

    # Mock extract_concepts to raise an unrecoverable error
    async def mock_fail(source_text, title=""):
        raise RuntimeError("NIM server overloaded 503")

    monkeypatch.setattr("app.workers.ai_worker.extract_concepts", mock_fail)

    manager = AIJobManager(queue_name=queue_name)
    worker = AIWorker(queue_name=queue_name, job_manager=manager)

    # Create job with max_attempts=2
    async with get_session_context() as db:
        job, _ = await manager.create_and_enqueue_job(
            db=db,
            user_id=user_id,
            job_type="NOTE_CONCEPT_EXTRACTION",
            payload={"note_id": note_id, "classroom_id": class_id},
            max_attempts=2,
            queue_name=queue_name,
        )

    # Attempt 1: fails and re-enqueues
    res1 = await worker.process_one(timeout=2.0)
    assert res1 is False
    async with get_session_context() as db:
        j1 = await db.scalar(select(AIJobRow).where(AIJobRow.id == job.id))
        assert j1.status == "QUEUED"
        assert j1.attempts == 1

    # Attempt 2: fails and exhausts max_attempts -> FAILED
    res2 = await worker.process_one(timeout=2.0)
    assert res2 is False
    async with get_session_context() as db:
        j2 = await db.scalar(select(AIJobRow).where(AIJobRow.id == job.id))
        assert j2.status == "FAILED"
        assert j2.attempts == 2

        # Note should now also be marked FAILED
        db_note = await db.scalar(select(NoteRow).where(NoteRow.id == note_id))
        assert db_note.status == "FAILED"


@pytest.mark.asyncio
async def test_worker_concurrency_limit(test_env, monkeypatch):
    """3. Worker concurrency: Multiple jobs execute concurrently bounded by AI_WORKER_CONCURRENCY."""
    queue_name = f"synapse:test:queue:{uuid.uuid4().hex}"
    user_id = test_env["user_id"]
    class_id = test_env["classroom_id"]
    concurrency_limit = 3

    active_executions = 0
    max_observed_concurrency = 0

    async def mock_slow_extract(source_text, title=""):
        nonlocal active_executions, max_observed_concurrency
        active_executions += 1
        max_observed_concurrency = max(max_observed_concurrency, active_executions)
        await asyncio.sleep(0.1)
        active_executions -= 1
        return [ProposedConcept(name=f"C-{uuid.uuid4().hex[:4]}", summary="Summary")]

    monkeypatch.setattr("app.workers.ai_worker.extract_concepts", mock_slow_extract)

    manager = AIJobManager(queue_name=queue_name)
    worker = AIWorker(queue_name=queue_name, concurrency=concurrency_limit, job_manager=manager)

    # Create 6 jobs and 6 notes
    job_ids = []
    async with get_session_context() as db:
        for i in range(6):
            nid = f"note-concurr-{i}-{uuid.uuid4().hex[:4]}"
            note = NoteRow(
                id=nid,
                title=f"Note {i}",
                classroom_id=class_id,
                published=True,
                status="PROCESSING",
                sections="[]",
                concept_ids="[]",
            )
            db.add(note)
            await db.commit()

            j, _ = await manager.create_and_enqueue_job(
                db=db,
                user_id=user_id,
                job_type="NOTE_CONCEPT_EXTRACTION",
                payload={"note_id": nid, "classroom_id": class_id},
                queue_name=queue_name,
            )
            job_ids.append(j.id)

    # Run worker processing tasks concurrently
    tasks = [asyncio.create_task(worker.process_one(timeout=2.0)) for _ in range(6)]
    results = await asyncio.gather(*tasks)
    assert all(results)
    assert max_observed_concurrency <= concurrency_limit


@pytest.mark.asyncio
async def test_note_creation_and_worker_end_to_end(test_env, monkeypatch):
    """4. End-to-end API integration: POST /notes creates durable AIJob in Redis, worker executes, note becomes READY."""
    user_id = test_env["user_id"]
    class_id = test_env["classroom_id"]
    auth_headers = test_env["auth_headers"]

    # Mock extract_concepts
    async def mock_extract(source_text, title=""):
        return [ProposedConcept(name="HTTP", summary="Hypertext Transfer Protocol")]

    monkeypatch.setattr("app.workers.ai_worker.extract_concepts", mock_extract)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        # Create note via API
        note_res = await c.post(
            "/notes",
            json={
                "title": "Application Protocols",
                "classroomId": class_id,
                "content": "## HTTP\nWeb protocol.",
                "published": True,
            },
            headers=auth_headers,
        )
        assert note_res.status_code == 201
        created_note = note_res.json()
        assert created_note["status"] == "PROCESSING"
        note_id = created_note["id"]

        # Verify an AIJob was created in PostgreSQL
        async with get_session_context() as db:
            job = await db.scalar(
                select(AIJobRow).where(
                    AIJobRow.user_id == user_id,
                    AIJobRow.job_type == "NOTE_CONCEPT_EXTRACTION",
                ).order_by(AIJobRow.created_at.desc())
            )
            assert job is not None
            assert job.status == "QUEUED"
            payload = json.loads(job.payload)
            assert payload["note_id"] == note_id

        # Worker processes the job
        worker = AIWorker()
        success = await worker.process_one(timeout=2.0)
        assert success is True

        # Verify note is now READY via GET /notes/{id}
        get_res = await c.get(f"/notes/{note_id}", headers=auth_headers)
        assert get_res.status_code == 200
        ready_note = get_res.json()
        assert ready_note["status"] == "READY"
        assert len(ready_note["conceptIds"]) == 1


@pytest.mark.asyncio
async def test_note_retry_and_worker_end_to_end(test_env, monkeypatch):
    """5. End-to-end API retry: POST /notes/{id}/retry creates durable retry job, worker executes, note becomes READY."""
    user_id = test_env["user_id"]
    note_id = test_env["note_id"]
    auth_headers = test_env["auth_headers"]

    # Mark note as FAILED initially
    async with get_session_context() as db:
        note = await db.scalar(select(NoteRow).where(NoteRow.id == note_id))
        note.status = "FAILED"
        await db.commit()

    async def mock_extract(source_text, title=""):
        return [ProposedConcept(name="Sockets", summary="Network socket communication")]

    monkeypatch.setattr("app.workers.ai_worker.extract_concepts", mock_extract)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        # Trigger retry endpoint
        retry_res = await c.post(f"/notes/{note_id}/retry", headers=auth_headers)
        assert retry_res.status_code == 200
        retrying_note = retry_res.json()
        assert retrying_note["status"] == "PROCESSING"

        # Verify retry job created
        async with get_session_context() as db:
            retry_job = await db.scalar(
                select(AIJobRow).where(
                    AIJobRow.user_id == user_id,
                    AIJobRow.job_type == "NOTE_CONCEPT_EXTRACTION_RETRY",
                ).order_by(AIJobRow.created_at.desc())
            )
            assert retry_job is not None
            assert retry_job.status == "QUEUED"

        # Worker processes retry job
        worker = AIWorker()
        success = await worker.process_one(timeout=2.0)
        assert success is True

        # Note is now READY
        final_res = await c.get(f"/notes/{note_id}", headers=auth_headers)
        assert final_res.status_code == 200
        assert final_res.json()["status"] == "READY"
