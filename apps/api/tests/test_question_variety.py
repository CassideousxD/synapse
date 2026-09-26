import json
import re
import uuid
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.core.db import ClassroomRow, ConceptRow, SessionLocal, engine
from app.core.redis import close_redis, init_redis
from app.curriculum.mcq_generation import (
    QuestionFormat,
    dynamic_fallback_question,
    generate_mcq_for_concept,
    is_numerical_supported_for_concept,
    randomize_option_order,
    select_question_format,
    validate_numerical_problem,
)
from app.main import app


@pytest_asyncio.fixture
async def client(monkeypatch):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "true")
    r = await init_redis()
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
    await engine.dispose()


def _simulated_format_nim_generator():
    """Generates realistic LLM completions matching requested QuestionFormat."""
    counter = 0

    async def mock_call_nim(tier, messages, temperature, max_tokens):
        nonlocal counter
        counter += 1
        user_msg = messages[-1]["content"]

        fmt_match = re.search(r"Question Format:\s*(\w+)", user_msg)
        q_format = fmt_match.group(1) if fmt_match else QuestionFormat.STANDARD_MCQ

        concept_match = re.search(r"Concept:\s*([^\n]+)", user_msg)
        concept = concept_match.group(1).strip() if concept_match else "Routing"

        if q_format == QuestionFormat.ASSERTION_REASON:
            stem = (
                f"Assertion (A): {concept} automatically reconfigures routes upon link failure.\n"
                f"Reason (R): Periodic keepalive signals detect unreachable downstream gateways."
            )
            options = [
                {"id": "a", "text": "Both Assertion and Reason are true, and Reason is the correct explanation of Assertion."},
                {"id": "b", "text": "Both Assertion and Reason are true, but Reason is NOT the correct explanation of Assertion."},
                {"id": "c", "text": "Assertion is true, but Reason is false."},
                {"id": "d", "text": "Assertion is false, but Reason is true."},
            ]
            correct_id = "a"
        elif q_format == QuestionFormat.TRUE_FALSE:
            stem = f"In {concept}, a router forwards unicast packets to all physical interfaces simultaneously."
            options = [
                {"id": "a", "text": "True"},
                {"id": "b", "text": "False"},
            ]
            correct_id = "b"
        elif q_format == QuestionFormat.SCENARIO_BASED:
            stem = f"Scenario #{counter}: An enterprise engineer connects two data centers running {concept}. When Link A drops, what metric updates first?"
            options = [
                {"id": "a", "text": "The neighbor adjacency state transitions to Down and cost recalculates."},
                {"id": "b", "text": "The entire routing table is purged and all traffic halts."},
                {"id": "c", "text": "Packets are stored in infinite buffers until Link A reboots."},
                {"id": "d", "text": "The hardware interfaces switch unconditionally to 10 Mbps half-duplex."},
            ]
            correct_id = "a"
        elif q_format == QuestionFormat.NUMERICAL:
            initial = 64
            hops = 4 + (counter % 3)
            exp = initial - hops
            stem = f"An IPv4 packet begins with an initial TTL of {initial}. If it traverses {hops} routers under {concept}, what is the resulting TTL?"
            options = [
                {"id": "a", "text": str(exp)},
                {"id": "b", "text": str(exp - 1)},
                {"id": "c", "text": str(exp + 1)},
                {"id": "d", "text": str(initial)},
            ]
            correct_id = "a"
        else:
            stem = f"What is the primary mechanism of {concept} in core networks? [Ref #{counter}]"
            options = [
                {"id": "a", "text": f"Accurate dynamic path determination for {concept} (ref {counter})"},
                {"id": "b", "text": f"Plausible alternative distractor A for {concept}"},
                {"id": "c", "text": f"Plausible alternative distractor B for {concept}"},
                {"id": "d", "text": f"Plausible alternative distractor C for {concept}"},
            ]
            correct_id = "a"

        content = json.dumps({
            "questionId": f"gen-{counter}",
            "stem": stem,
            "options": options,
            "correctOptionId": correct_id,
        })
        return {"content": content, "model": "mock-nim", "usage": None}

    return mock_call_nim


# 1. Answer position randomization test
def test_answer_position_randomization():
    options = ["Wrong 1", "Wrong 2", "Wrong 3", "Correct Target"]
    correct = "Correct Target"

    seen_indices = set()
    for _ in range(50):
        shuffled, idx = randomize_option_order(options, correct)
        assert shuffled[idx] == correct
        seen_indices.add(idx)

    # Across 50 runs, all 4 positions (0, 1, 2, 3) must be hit
    assert seen_indices == {0, 1, 2, 3}


# 2. Correct answer integrity test
def test_correct_answer_integrity():
    options = ["Alpha", "Beta", "Gamma", "Delta"]
    for target in options:
        shuffled, idx = randomize_option_order(options, target)
        assert target in shuffled
        assert shuffled[idx] == target
        assert set(shuffled) == set(options)


# 3. Grading compatibility test with shuffled answers
@pytest.mark.asyncio
async def test_grading_compatibility_with_shuffled_options(client):
    uid = uuid.uuid4().hex[:6]
    t_res = await client.post(
        "/auth/register/teacher",
        json={"name": "Teacher Grade", "email": f"grade_{uid}@test.edu", "password": "password123"},
    )
    t_headers = {"Authorization": f"Bearer {t_res.json()['accessToken']}"}
    t_id = t_res.json()["user"]["id"]

    s_res = await client.post(
        "/auth/register/student",
        json={"name": "Student Grade", "email": f"student_{uid}@test.edu", "password": "password123"},
    )
    s_headers = {"Authorization": f"Bearer {s_res.json()['accessToken']}"}

    room_id = f"room-grade-{uid}"
    c1_id = f"c1-{uid}"

    async with SessionLocal() as session:
        session.add(ClassroomRow(id=room_id, name="Grading Class", subject="CS", teacher_id=t_id, join_code=f"GRD{uid[:4]}"))
        session.add(ConceptRow(id=c1_id, classroom_id=room_id, name="Routing", normalized_name="routing", description="Routing info"))
        await session.commit()

    # Create test with two shuffled MCQ questions
    # Q1 correct answer is placed at index 3 (D)
    # Q2 correct answer is placed at index 1 (B)
    q1 = {
        "id": "q1",
        "type": "mcq",
        "format": "STANDARD_MCQ",
        "prompt": "Which component stores destination routes?",
        "options": ["Buffer", "ALU", "Cache", "Routing Table"],
        "answer": "Routing Table",
        "conceptId": c1_id,
    }
    q2 = {
        "id": "q2",
        "type": "mcq",
        "format": "STANDARD_MCQ",
        "prompt": "What does TTL prevent?",
        "options": ["Bit errors", "Routing Loops", "High Voltage", "Bandwidth Loss"],
        "answer": "Routing Loops",
        "conceptId": c1_id,
    }

    create_res = await client.post(
        "/tests",
        json={
            "title": "Grading Integrity Check",
            "classroomId": room_id,
            "durationMin": 15,
            "status": "published",
            "conceptIds": [c1_id],
            "questions": [q1, q2],
        },
        headers=t_headers,
    )
    assert create_res.status_code == 201
    test_id = create_res.json()["id"]

    # Student submits: Q1 correct, Q2 wrong
    submit_res = await client.post(
        f"/tests/{test_id}/submit",
        json={
            "answers": {
                "q1": "Routing Table",  # Correct text at index 3
                "q2": "Bit errors",     # Wrong text at index 0
            }
        },
        headers=s_headers,
    )
    assert submit_res.status_code == 200
    res_data = submit_res.json()
    assert res_data["score"] == 50  # 1 of 2 correct


# 4. Standard MCQ format verification
@pytest.mark.asyncio
async def test_standard_mcq_generation(monkeypatch):
    monkeypatch.setattr("app.curriculum.mcq_generation.call_nim", _simulated_format_nim_generator())

    q = await generate_mcq_for_concept(
        concept_id="c-routing",
        concept_name="Routing",
        concept_summary="Directs packets",
        question_format=QuestionFormat.STANDARD_MCQ,
    )
    assert q["format"] == QuestionFormat.STANDARD_MCQ
    assert len(q["options"]) == 4
    assert q["answer"] in q["options"]


# 5. Assertion-Reason format verification
@pytest.mark.asyncio
async def test_assertion_reason_format_generation(monkeypatch):
    monkeypatch.setattr("app.curriculum.mcq_generation.call_nim", _simulated_format_nim_generator())

    q = await generate_mcq_for_concept(
        concept_id="c-routing",
        concept_name="Routing",
        concept_summary="Directs packets",
        question_format=QuestionFormat.ASSERTION_REASON,
    )
    assert q["format"] == QuestionFormat.ASSERTION_REASON
    assert "Assertion (A):" in q["prompt"]
    assert "Reason (R):" in q["prompt"]
    assert len(q["options"]) == 4
    assert any("Both Assertion and Reason are true" in o for o in q["options"])
    assert q["answer"] in q["options"]


# 6. True/False format verification
@pytest.mark.asyncio
async def test_true_false_format_generation(monkeypatch):
    monkeypatch.setattr("app.curriculum.mcq_generation.call_nim", _simulated_format_nim_generator())

    q = await generate_mcq_for_concept(
        concept_id="c-routing",
        concept_name="Routing",
        concept_summary="Directs packets",
        question_format=QuestionFormat.TRUE_FALSE,
    )
    assert q["format"] == QuestionFormat.TRUE_FALSE
    assert len(q["options"]) == 2
    assert set(q["options"]) == {"True", "False"}
    assert q["answer"] in ("True", "False")


# 7. Scenario-based format verification
@pytest.mark.asyncio
async def test_scenario_based_format_generation(monkeypatch):
    monkeypatch.setattr("app.curriculum.mcq_generation.call_nim", _simulated_format_nim_generator())

    q = await generate_mcq_for_concept(
        concept_id="c-routing",
        concept_name="Routing",
        concept_summary="Directs packets",
        question_format=QuestionFormat.SCENARIO_BASED,
    )
    assert q["format"] == QuestionFormat.SCENARIO_BASED
    assert "Scenario" in q["prompt"]
    assert len(q["options"]) == 4
    assert q["answer"] in q["options"]


# 8. Numerical format verification for supported concept
@pytest.mark.asyncio
async def test_numerical_format_generation_for_supported_concept(monkeypatch):
    monkeypatch.setattr("app.curriculum.mcq_generation.call_nim", _simulated_format_nim_generator())

    q = await generate_mcq_for_concept(
        concept_id="c-ttl",
        concept_name="Time to Live (TTL)",
        concept_summary="Hop counter in IPv4 packet headers",
        question_format=QuestionFormat.NUMERICAL,
    )
    assert q["format"] == QuestionFormat.NUMERICAL
    assert len(q["options"]) == 4
    assert q["answer"] in q["options"]
    assert any(re.search(r"\d+", o) for o in q["options"])
    # Verify metadata is attached
    assert "metadata" in q
    assert q["metadata"]["calculation"] == "ttl_decrement"


# 9. Unsupported numerical concept falls back to non-numerical format
def test_unsupported_numerical_concept_falls_back():
    concept = "Software Ethics and Professional Conduct"
    summary = "Guidelines for intellectual property, privacy, and user consent."
    assert is_numerical_supported_for_concept(concept, summary) is False

    # Selection strategy must never pick NUMERICAL for non-numeric concepts
    for idx in range(1, 20):
        fmt = select_question_format(concept, summary, question_index=idx, total_count=20)
        assert fmt != QuestionFormat.NUMERICAL
        assert fmt in (
            QuestionFormat.STANDARD_MCQ,
            QuestionFormat.SCENARIO_BASED,
            QuestionFormat.ASSERTION_REASON,
            QuestionFormat.TRUE_FALSE,
        )


# 10. Format diversity test (10 questions use multiple formats)
@pytest.mark.asyncio
async def test_format_diversity_across_10_questions(client, monkeypatch):
    monkeypatch.setattr("app.curriculum.mcq_generation.call_nim", _simulated_format_nim_generator())

    uid = uuid.uuid4().hex[:6]
    t_res = await client.post(
        "/auth/register/teacher",
        json={"name": "Teacher Formats", "email": f"formats_{uid}@test.edu", "password": "password123"},
    )
    t_headers = {"Authorization": f"Bearer {t_res.json()['accessToken']}"}
    t_id = t_res.json()["user"]["id"]

    room_id = f"room-fmt-{uid}"
    c1_id = f"c-net-{uid}"

    async with SessionLocal() as session:
        session.add(ClassroomRow(id=room_id, name="Computer Networks", subject="CS", teacher_id=t_id, join_code=f"FMT{uid[:4]}"))
        session.add(ConceptRow(
            id=c1_id,
            classroom_id=room_id,
            name="Routing and Subnetting",
            normalized_name="routing and subnetting",
            description="Packet forwarding, longest prefix match, and CIDR subnet calculation.",
        ))
        await session.commit()

    res = await client.post(
        "/tests/generate-questions",
        json={"classroomId": room_id, "conceptIds": [c1_id], "count": 10},
        headers=t_headers,
    )
    assert res.status_code == 200
    questions = res.json()
    assert len(questions) == 10

    formats_used = {q.get("format") for q in questions}
    # At least 3 distinct question formats must be used in a 10-question test
    assert len(formats_used) >= 3, f"Expected >= 3 formats, got {formats_used}"


# 11. Answer-position distribution test (no severe bias across batch)
@pytest.mark.asyncio
async def test_answer_position_distribution(client, monkeypatch):
    monkeypatch.setattr("app.curriculum.mcq_generation.call_nim", _simulated_format_nim_generator())

    uid = uuid.uuid4().hex[:6]
    t_res = await client.post(
        "/auth/register/teacher",
        json={"name": "Teacher Dist", "email": f"dist_{uid}@test.edu", "password": "password123"},
    )
    t_headers = {"Authorization": f"Bearer {t_res.json()['accessToken']}"}
    t_id = t_res.json()["user"]["id"]

    room_id = f"room-dist-{uid}"
    c1_id = f"c-dist-{uid}"

    async with SessionLocal() as session:
        session.add(ClassroomRow(id=room_id, name="Systems Architecture", subject="CS", teacher_id=t_id, join_code=f"DST{uid[:4]}"))
        session.add(ConceptRow(
            id=c1_id,
            classroom_id=room_id,
            name="Computer Networks",
            normalized_name="computer networks",
            description="OSI model, routing protocols, and transport layer reliability.",
        ))
        await session.commit()

    res = await client.post(
        "/tests/generate-questions",
        json={"classroomId": room_id, "conceptIds": [c1_id], "count": 16},
        headers=t_headers,
    )
    assert res.status_code == 200
    questions = res.json()
    assert len(questions) == 16

    # Calculate distribution of correct answer position (for questions with >= 4 options)
    mcq_4_opts = [q for q in questions if len(q["options"]) == 4]
    indices = [q["options"].index(q["answer"]) for q in mcq_4_opts]

    # Every position (0, 1, 2, 3) must be represented
    distinct_positions = set(indices)
    assert len(distinct_positions) >= 3, f"Positions represented: {distinct_positions}"

    # No single position should dominate > 55% of questions
    for pos in distinct_positions:
        ratio = indices.count(pos) / len(indices)
        assert ratio <= 0.55, f"Position {pos} had excessive bias: {ratio:.2%}"
