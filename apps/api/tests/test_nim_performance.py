import asyncio
import json
import time
import uuid
import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.core.db import ClassroomRow, ConceptRow, SessionLocal, engine
from app.core.redis import close_redis, init_redis
from app.curriculum.mcq_generation import (
    PlannedSlot,
    QuestionFormat,
    generate_mcq_batch_bounded,
)
from app.llm.client import (
    NimError,
    call_nim,
    close_nim_client,
    get_nim_client,
    init_nim_client,
)
from app.main import app


@pytest_asyncio.fixture
async def client(monkeypatch):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "true")
    r = await init_redis()
    # Clean rate limit keys
    cursor = 0
    while True:
        cursor, keys = await r.scan(cursor=cursor, match="synapse:rl:*", count=100)
        if keys:
            await r.delete(*keys)
        if cursor == 0:
            break
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    await close_redis()
    await close_nim_client()
    await engine.dispose()


# 1. Shared Client Reuse
@pytest.mark.asyncio
async def test_shared_client_reuse():
    await close_nim_client()
    c1 = get_nim_client()
    c2 = get_nim_client()
    assert c1 is c2
    assert not c1.is_closed
    await close_nim_client()


# 2. Client Shutdown
@pytest.mark.asyncio
async def test_client_shutdown():
    await close_nim_client()
    c = await init_nim_client()
    assert not c.is_closed
    await close_nim_client()
    assert c.is_closed
    assert get_nim_client() is not c


# 3. Concurrency Limit (max simultaneous <= 3)
@pytest.mark.asyncio
async def test_concurrency_limit_bounded_to_3(monkeypatch):
    current_concurrency = 0
    max_concurrency_observed = 0

    async def mock_call_nim(tier, messages, temperature, max_tokens):
        nonlocal current_concurrency, max_concurrency_observed
        current_concurrency += 1
        if current_concurrency > max_concurrency_observed:
            max_concurrency_observed = current_concurrency
        await asyncio.sleep(0.05)
        current_concurrency -= 1
        return {
            "content": json.dumps({
                "questionId": f"gen-{uuid.uuid4().hex[:6]}",
                "stem": f"Stem {uuid.uuid4().hex[:8]} testing concurrency",
                "options": [
                    {"id": "a", "text": "Correct Option"},
                    {"id": "b", "text": "Misconception 1"},
                    {"id": "c", "text": "Misconception 2"},
                    {"id": "d", "text": "Misconception 3"},
                ],
                "correctOptionId": "a",
            }),
            "model": "mock-nim",
            "usage": None,
        }

    monkeypatch.setattr("app.curriculum.mcq_generation.call_nim", mock_call_nim)

    slots = [
        PlannedSlot(
            slot_id=i,
            concept_id=f"c-{i}",
            concept_name=f"Concept {i}",
            concept_summary="Test summary",
            question_index=i + 1,
            total_count=10,
            angle="definition",
            question_format=QuestionFormat.STANDARD_MCQ,
        )
        for i in range(10)
    ]

    results = await generate_mcq_batch_bounded(slots, concurrency_limit=3)
    assert len(results) == 10
    assert max_concurrency_observed <= 3
    assert max_concurrency_observed >= 2


# 4. Deterministic Ordering (Slow Q1, Fast Q2 -> returns Q1, Q2)
@pytest.mark.asyncio
async def test_deterministic_ordering_preserved(monkeypatch):
    async def mock_call_nim(tier, messages, temperature, max_tokens):
        msg = messages[-1]["content"]
        if "SlotZero" in msg:
            await asyncio.sleep(0.1)  # slow
            stem_text = "SlotZero Stem"
        else:
            await asyncio.sleep(0.01)  # fast
            stem_text = "SlotOne Stem"

        return {
            "content": json.dumps({
                "questionId": f"gen-{uuid.uuid4().hex[:6]}",
                "stem": stem_text,
                "options": [
                    {"id": "a", "text": "Option 1"},
                    {"id": "b", "text": "Option 2"},
                    {"id": "c", "text": "Option 3"},
                    {"id": "d", "text": "Option 4"},
                ],
                "correctOptionId": "a",
            }),
            "model": "mock-nim",
            "usage": None,
        }

    monkeypatch.setattr("app.curriculum.mcq_generation.call_nim", mock_call_nim)

    slots = [
        PlannedSlot(
            slot_id=0,
            concept_id="c-0",
            concept_name="SlotZero",
            concept_summary="Summary 0",
            question_index=1,
            total_count=2,
            angle="definition",
            question_format=QuestionFormat.STANDARD_MCQ,
        ),
        PlannedSlot(
            slot_id=1,
            concept_id="c-1",
            concept_name="SlotOne",
            concept_summary="Summary 1",
            question_index=2,
            total_count=2,
            angle="mechanism",
            question_format=QuestionFormat.STANDARD_MCQ,
        ),
    ]

    results = await generate_mcq_batch_bounded(slots, concurrency_limit=3)
    assert len(results) == 2
    assert "SlotZero" in results[0]["prompt"]
    assert "SlotOne" in results[1]["prompt"]


# 5 & 6. Partial Rejection & Targeted Regeneration
@pytest.mark.asyncio
async def test_partial_rejection_only_regenerates_rejected(monkeypatch):
    call_counts = {}

    async def mock_call_nim(tier, messages, temperature, max_tokens):
        msg = messages[-1]["content"]
        import re
        concept_match = re.search(r"Concept:\s*([^\n]+)", msg)
        c_name = concept_match.group(1).strip() if concept_match else "Concept"
        call_counts[c_name] = call_counts.get(c_name, 0) + 1

        # For Concept 1, return a duplicate stem on attempt 1, valid on attempt 2
        if c_name == "Concept 1" and call_counts[c_name] == 1:
            stem = "Fundamental architecture and definitions of Concept 0"
        elif c_name == "Concept 0":
            stem = "Fundamental architecture and definitions of Concept 0"
        elif c_name == "Concept 1":
            stem = f"Internal runtime coordination and state dynamics of Concept 1 (attempt {call_counts[c_name]})"
        elif c_name == "Concept 2":
            stem = "Operational performance advantages when migrating to Concept 2"
        else:
            stem = "Edge boundary troubleshooting patterns for diagnostic inspection of Concept 3"

        return {
            "content": json.dumps({
                "questionId": f"gen-{uuid.uuid4().hex[:6]}",
                "stem": stem,
                "options": [
                    {"id": "a", "text": f"Correct for {c_name}"},
                    {"id": "b", "text": f"Distractor 1 for {c_name}"},
                    {"id": "c", "text": f"Distractor 2 for {c_name}"},
                    {"id": "d", "text": f"Distractor 3 for {c_name}"},
                ],
                "correctOptionId": "a",
            }),
            "model": "mock-nim",
            "usage": None,
        }

    monkeypatch.setattr("app.curriculum.mcq_generation.call_nim", mock_call_nim)

    slots = [
        PlannedSlot(
            slot_id=i,
            concept_id=f"c-{i}",
            concept_name=f"Concept {i}",
            concept_summary=f"Summary {i}",
            question_index=i + 1,
            total_count=4,
            angle="definition",
            question_format=QuestionFormat.STANDARD_MCQ,
        )
        for i in range(4)
    ]

    results = await generate_mcq_batch_bounded(slots, concurrency_limit=3)
    assert len(results) == 4
    # Concept 0, 2, 3 should have called NIM only once
    assert call_counts["Concept 0"] == 1
    assert call_counts["Concept 2"] == 1
    assert call_counts["Concept 3"] == 1
    # Concept 1 had a duplicate collision on attempt 1, so it was regenerated (called twice)
    assert call_counts["Concept 1"] == 2


# 7. Regeneration Context Received in Prompt
@pytest.mark.asyncio
async def test_regeneration_receives_accepted_context(monkeypatch):
    received_previous_stems = []

    async def mock_call_nim(tier, messages, temperature, max_tokens):
        msg = messages[-1]["content"]
        if "PREVIOUSLY ACCEPTED QUESTION STEMS" in msg:
            received_previous_stems.append(msg)

        if "FlakyConcept" in msg and len(received_previous_stems) == 0:
            # First attempt returns duplicate of Concept 0
            stem = "Identical stem for testing context propagation"
        elif "Concept 0" in msg:
            stem = "Identical stem for testing context propagation"
        else:
            stem = f"Accepted stem for {msg[:30]} {uuid.uuid4().hex[:6]}"

        return {
            "content": json.dumps({
                "questionId": f"gen-{uuid.uuid4().hex[:6]}",
                "stem": stem,
                "options": [
                    {"id": "a", "text": "Correct Ans"},
                    {"id": "b", "text": "Distractor A"},
                    {"id": "c", "text": "Distractor B"},
                    {"id": "d", "text": "Distractor C"},
                ],
                "correctOptionId": "a",
            }),
            "model": "mock-nim",
            "usage": None,
        }

    monkeypatch.setattr("app.curriculum.mcq_generation.call_nim", mock_call_nim)

    slots = [
        PlannedSlot(
            slot_id=0,
            concept_id="c-0",
            concept_name="Concept 0",
            concept_summary="Summary",
            question_index=1,
            total_count=2,
            angle="definition",
            question_format=QuestionFormat.STANDARD_MCQ,
        ),
        PlannedSlot(
            slot_id=1,
            concept_id="c-1",
            concept_name="FlakyConcept",
            concept_summary="Summary",
            question_index=2,
            total_count=2,
            angle="mechanism",
            question_format=QuestionFormat.STANDARD_MCQ,
        ),
    ]

    results = await generate_mcq_batch_bounded(slots, concurrency_limit=3)
    assert len(results) == 2
    assert len(received_previous_stems) >= 1
    assert "Identical stem for testing context propagation" in received_previous_stems[0]


# 8. NIM 503 Retry with Backoff
@pytest.mark.asyncio
async def test_nim_503_retry_with_backoff(monkeypatch):
    await close_nim_client()
    monkeypatch.setenv("NVIDIA_API_KEY", "test-key")
    call_count = 0

    def mock_handler(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        if call_count < 2:
            return httpx.Response(503, json={"error": {"message": "Service overloaded"}})
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "ok"}}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 2},
            },
        )

    transport = httpx.MockTransport(mock_handler)
    client_mod_c = httpx.AsyncClient(transport=transport)
    import app.llm.client as client_mod
    monkeypatch.setattr(client_mod, "_nim_client", client_mod_c)

    res = await call_nim("main", [{"role": "user", "content": "hi"}], None, None, max_retries=2)
    assert res["content"] == "ok"
    assert call_count == 2
    await close_nim_client()


# 9. NIM 429 Retry with Backoff
@pytest.mark.asyncio
async def test_nim_429_retry_with_backoff(monkeypatch):
    await close_nim_client()
    monkeypatch.setenv("NVIDIA_API_KEY", "test-key")
    call_count = 0

    def mock_handler(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        if call_count < 2:
            return httpx.Response(429, json={"error": {"message": "Rate limit exceeded"}})
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "ok 429 resolved"}}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 2},
            },
        )

    transport = httpx.MockTransport(mock_handler)
    client_mod_c = httpx.AsyncClient(transport=transport)
    import app.llm.client as client_mod
    monkeypatch.setattr(client_mod, "_nim_client", client_mod_c)

    res = await call_nim("main", [{"role": "user", "content": "hi"}], None, None, max_retries=2)
    assert res["content"] == "ok 429 resolved"
    assert call_count == 2
    await close_nim_client()


# 10. Permanent 400 Error Does Not Retry Indefinitely
@pytest.mark.asyncio
async def test_permanent_error_fails_immediately_without_retry(monkeypatch):
    await close_nim_client()
    monkeypatch.setenv("NVIDIA_API_KEY", "test-key")
    call_count = 0

    def mock_handler(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        return httpx.Response(400, json={"error": {"message": "Bad Request"}})

    transport = httpx.MockTransport(mock_handler)
    client_mod_c = httpx.AsyncClient(transport=transport)
    import app.llm.client as client_mod
    monkeypatch.setattr(client_mod, "_nim_client", client_mod_c)

    with pytest.raises(NimError) as exc_info:
        await call_nim("main", [{"role": "user", "content": "hi"}], None, None, max_retries=2)

    assert exc_info.value.status == 400
    assert call_count == 1  # Exactly 1 call, no retries on permanent 400
    await close_nim_client()


# 11. Fallback After Retry Exhaustion
@pytest.mark.asyncio
async def test_batch_fallback_after_retry_exhaustion(monkeypatch):
    async def mock_failing_nim(tier, messages, temperature, max_tokens):
        raise NimError("Simulated persistent NIM error", status=503)

    monkeypatch.setattr("app.curriculum.mcq_generation.call_nim", mock_failing_nim)

    slots = [
        PlannedSlot(
            slot_id=0,
            concept_id="c-fb",
            concept_name="Fallback Concept",
            concept_summary="Summary of fallback concept",
            question_index=1,
            total_count=1,
            angle="definition",
            question_format=QuestionFormat.STANDARD_MCQ,
        )
    ]

    results = await generate_mcq_batch_bounded(slots, concurrency_limit=3)
    assert len(results) == 1
    assert "Fallback Concept" in results[0]["prompt"] or "fallback" in results[0]["prompt"].lower()
    assert len(results[0]["options"]) == 4


# 12 & 13. End-to-end endpoint verification with question counts
@pytest.mark.asyncio
@pytest.mark.parametrize("req_count", [1, 3, 8])
async def test_end_to_end_question_count_control(client, req_count, monkeypatch):
    from tests.test_question_diversity import _simulated_nim_generator
    monkeypatch.setattr("app.curriculum.mcq_generation.call_nim", _simulated_nim_generator())

    uid = uuid.uuid4().hex[:6]
    t_res = await client.post(
        "/auth/register/teacher",
        json={"name": "Teacher Perf", "email": f"tperf_{uid}@test.edu", "password": "password123"},
    )
    t_headers = {"Authorization": f"Bearer {t_res.json()['accessToken']}"}
    t_id = t_res.json()["user"]["id"]

    room_id = f"room-perf-{uid}"
    c1_id = f"c-perf-{uid}"

    async with SessionLocal() as session:
        session.add(ClassroomRow(id=room_id, name="Performance Class", subject="CS", teacher_id=t_id, join_code=f"PF{uid[:4]}"))
        session.add(ConceptRow(
            id=c1_id,
            classroom_id=room_id,
            name="Throughput",
            normalized_name="throughput",
            description="Measure of how many units of information a system can process in a given amount of time.",
        ))
        await session.commit()

    res = await client.post(
        "/tests/generate-questions",
        json={"classroomId": room_id, "conceptIds": [c1_id], "count": req_count},
        headers=t_headers,
    )
    assert res.status_code == 200
    questions = res.json()
    assert len(questions) == req_count
    # All stems must be distinct
    stems = [q["prompt"] for q in questions]
    assert len(set(stems)) == req_count
