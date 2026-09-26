import json
import re
import uuid
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.core.db import ClassroomRow, ConceptRow, SessionLocal, engine
from app.core.redis import close_redis, init_redis
from app.curriculum.mcq_generation import (
    GENERIC_DISTRACTOR_PATTERNS,
    check_option_quality,
    dynamic_fallback_question,
    generate_mcq_for_concept,
    is_duplicate_stem,
    normalize_text,
)
from app.llm.client import NimError
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
    await engine.dispose()


def _simulated_nim_generator():
    """Generates realistic, distinct LLM completions honoring concept and assigned angle."""
    counter = 0

    angle_templates = {
        "definition": "What constitutes the fundamental architecture of {concept} in distributed systems?",
        "mechanism": "How does {concept} coordinate state changes across interconnected interfaces?",
        "application": "In what operational workload is deploying {concept} most effective?",
        "scenario": "During an unexpected peak in network traffic, how does {concept} regulate resource consumption?",
        "comparison": "What distinguishes the behavioral profile of {concept} from stateless communication?",
        "troubleshooting": "What error condition typically emerges when {concept} suffers from misconfigured parameters?",
        "edge_case": "Under which edge boundary does {concept} experience maximum queue latency?",
        "interpretation": "When inspecting diagnostic packet captures, what metric confirms that {concept} is healthy?",
        "configuration": "Which policy parameter dictates the retry interval and convergence rate for {concept}?",
        "practical_consequence": "What concrete operational advantage is attained by migrating to {concept}?",
    }

    async def mock_call_nim(tier, messages, temperature, max_tokens):
        nonlocal counter
        counter += 1
        user_msg = messages[-1]["content"]
        angle_match = re.search(r"Assigned Conceptual Angle:\s*(\w+)", user_msg)
        angle = angle_match.group(1) if angle_match else "definition"
        concept_match = re.search(r"Concept:\s*([^\n]+)", user_msg)
        concept = concept_match.group(1).strip() if concept_match else "Concept"
        fmt_match = re.search(r"Question Format:\s*(\w+)", user_msg)
        q_format = fmt_match.group(1) if fmt_match else "STANDARD_MCQ"

        base_template = angle_templates.get(angle, "What critical factor governs the implementation of {concept}?")
        stem = f"{base_template.format(concept=concept)} [Ref #{counter}]"

        if q_format == "TRUE_FALSE":
            tf_topics = [
                f"In distributed architectures, {concept} regulates transmission states dynamically under workload condition #{counter}.",
                f"Operating system kernels allocate fixed-size receive buffers when initializing sockets for {concept} #{counter}.",
                f"Hardware network interface cards offload packet segmentation when executing {concept} #{counter}.",
            ]
            stem = tf_topics[counter % len(tf_topics)]
            options = [
                {"id": "a", "text": "True"},
                {"id": "b", "text": "False"},
            ]
            correct_id = "a"
        elif q_format == "ASSERTION_REASON":
            ar_templates = [
                (
                    f"Assertion (A): {concept} enforces end-to-end flow control using dynamic window advertisements #{counter}.\n"
                    f"Reason (R): Receiving socket buffers can be overwhelmed if transmitting hosts send data at unconstrained rates."
                ),
                (
                    f"Assertion (A): {concept} establishes connection state via a three-way handshake before transmitting payload bytes #{counter}.\n"
                    f"Reason (R): Synchronizing sequence numbers prevents packets from obsolete duplicate connections from corrupting sessions."
                ),
                (
                    f"Assertion (A): Selective Acknowledgments (SACK) improve throughput over lossy links when utilizing {concept} #{counter}.\n"
                    f"Reason (R): Receivers inform senders of non-contiguous segments to prevent retransmitting already received data."
                ),
                (
                    f"Assertion (A): Congestion avoidance algorithms halve the congestion window upon detecting packet drop under {concept} #{counter}.\n"
                    f"Reason (R): Multiplicative decrease relieves intermediate router buffer saturation near path capacity."
                ),
            ]
            chosen_ar = ar_templates[counter % len(ar_templates)]
            stem = chosen_ar
            options = [
                {"id": "a", "text": "Both Assertion and Reason are true, and Reason is the correct explanation of Assertion."},
                {"id": "b", "text": "Both Assertion and Reason are true, but Reason is NOT the correct explanation of Assertion."},
                {"id": "c", "text": "Assertion is true, but Reason is false."},
                {"id": "d", "text": "Assertion is false, but Reason is true."},
            ]
            correct_id = "a"
        elif q_format == "NUMERICAL":
            variant = counter % 3
            if variant == 0:
                initial = 64 + (counter % 2) * 64
                hops = 3 + (counter % 4)
                exp = initial - hops
                stem = f"An IPv4 datagram is transmitted with initial TTL {initial} and traverses {hops} intermediate gateway hops under {concept}. What is the resulting TTL? [Ref #{counter}]"
                options = [
                    {"id": "a", "text": str(exp)},
                    {"id": "b", "text": str(exp - 1)},
                    {"id": "c", "text": str(exp + 1)},
                    {"id": "d", "text": str(initial)},
                ]
            elif variant == 1:
                prefix = 24 + (counter % 5)
                usable = (2 ** (32 - prefix)) - 2
                stem = f"A subnet configured for {concept} is allocated using network prefix /{prefix}. How many usable host IP addresses are supported? [Ref #{counter}]"
                options = [
                    {"id": "a", "text": str(usable)},
                    {"id": "b", "text": str(usable + 4)},
                    {"id": "c", "text": str(usable - 1)},
                    {"id": "d", "text": str(2 ** (32 - prefix))},
                ]
            else:
                window_kb = 16 * ((counter % 4) + 1)
                full_segs = (window_kb * 1024) // 1460
                stem = f"Under {concept}, a sender receives an advertised receive window of {window_kb} KB. Given an MSS of 1460 bytes, calculate the maximum full segments in flight. [Ref #{counter}]"
                options = [
                    {"id": "a", "text": str(full_segs)},
                    {"id": "b", "text": str(full_segs - 1)},
                    {"id": "c", "text": str(full_segs + 1)},
                    {"id": "d", "text": str(window_kb)},
                ]
            correct_id = "a"
        else:
            options = [
                {"id": "a", "text": f"Correct operational mechanism for {concept} under {angle} (ref {counter})"},
                {"id": "b", "text": f"Plausible misconception regarding {concept} {angle} alternative #{counter}A"},
                {"id": "c", "text": f"Plausible misconception regarding {concept} {angle} alternative #{counter}B"},
                {"id": "d", "text": f"Plausible misconception regarding {concept} {angle} alternative #{counter}C"},
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


def test_stem_duplicate_detection():
    # Exact match
    assert is_duplicate_stem("What is Routing?", ["What is Routing?"]) is True

    # Case & whitespace normalization
    assert is_duplicate_stem("  what is routing?  ", ["What is Routing?"]) is True

    # High similarity / rephrasing
    assert is_duplicate_stem(
        "Which statement most accurately describes the mechanism of routing?",
        ["Which statement accurately describes the mechanism of routing?"],
    ) is True

    # Distinct stems
    assert is_duplicate_stem(
        "How does a router utilize longest prefix matching to forward packets?",
        ["What is the fundamental difference between dynamic routing and switching?"],
    ) is False


def test_option_quality_and_repetition_check():
    # 1. Generic distractors rejected
    for pattern in GENERIC_DISTRACTOR_PATTERNS:
        ok, reason = check_option_quality(["Valid option", f"Some {pattern} option", "Opt C", "Opt D"])
        assert ok is False
        assert "Generic distractor pattern detected" in reason

    # 2. Duplicate options in same question rejected
    ok, reason = check_option_quality(["Option A", "Option A", "Option B", "Option C"])
    assert ok is False
    assert "Duplicate option" in reason

    # 3. Repeated option sets across questions rejected
    existing = [
        {"options": ["Alpha", "Beta", "Gamma", "Delta"]}
    ]
    ok, reason = check_option_quality(["beta", "gamma", "delta", "alpha"], existing_questions=existing)
    assert ok is False
    assert "Option set matches" in reason

    # 4. Valid diverse options accepted
    ok, _ = check_option_quality(["Option One", "Option Two", "Option Three", "Option Four"])
    assert ok is True


# Test A: Same concept, multiple questions (Routing + 8 questions)
@pytest.mark.asyncio
async def test_same_concept_8_questions_end_to_end(client, monkeypatch):
    monkeypatch.setattr("app.curriculum.mcq_generation.call_nim", _simulated_nim_generator())

    uid = uuid.uuid4().hex[:6]
    t_res = await client.post(
        "/auth/register/teacher",
        json={"name": "Teacher 8Q", "email": f"teacher8_{uid}@test.edu", "password": "password123"},
    )
    t_headers = {"Authorization": f"Bearer {t_res.json()['accessToken']}"}
    t_id = t_res.json()["user"]["id"]

    room_id = f"room-8q-{uid}"
    c1_id = f"c-routing-{uid}"

    async with SessionLocal() as session:
        session.add(ClassroomRow(id=room_id, name="Computer Networks", subject="CS", teacher_id=t_id, join_code=f"NET{uid[:4]}"))
        session.add(ConceptRow(
            id=c1_id,
            classroom_id=room_id,
            name="Routing",
            normalized_name="routing",
            description="Directs network packets between networks using destination IP addresses and forwarding tables.",
        ))
        await session.commit()

    res = await client.post(
        "/tests/generate-questions",
        json={"classroomId": room_id, "conceptIds": [c1_id], "count": 8},
        headers=t_headers,
    )
    assert res.status_code == 200
    questions = res.json()
    assert len(questions) == 8

    # Stems must be distinct and non-empty
    stems = [q["prompt"] for q in questions]
    assert len(set(stems)) == 8

    # No generic filler distractors in any question
    for q in questions:
        for opt in q["options"]:
            for pattern in GENERIC_DISTRACTOR_PATTERNS:
                assert pattern not in opt.lower(), f"Found generic distractor pattern '{pattern}' in {opt}"

    assert all(q["conceptId"] == c1_id for q in questions)


# Test B: Same concept, 15 questions
@pytest.mark.asyncio
async def test_same_concept_15_questions_bounded(client, monkeypatch):
    monkeypatch.setattr("app.curriculum.mcq_generation.call_nim", _simulated_nim_generator())

    uid = uuid.uuid4().hex[:6]
    t_res = await client.post(
        "/auth/register/teacher",
        json={"name": "Teacher 15Q", "email": f"teacher15_{uid}@test.edu", "password": "password123"},
    )
    t_headers = {"Authorization": f"Bearer {t_res.json()['accessToken']}"}
    t_id = t_res.json()["user"]["id"]

    room_id = f"room-15q-{uid}"
    c1_id = f"c-tcp-{uid}"

    async with SessionLocal() as session:
        session.add(ClassroomRow(id=room_id, name="Transport Protocols", subject="CS", teacher_id=t_id, join_code=f"TCP{uid[:4]}"))
        session.add(ConceptRow(
            id=c1_id,
            classroom_id=room_id,
            name="Transmission Control Protocol",
            normalized_name="transmission control protocol",
            description="Connection-oriented, reliable byte-stream protocol providing flow and congestion control.",
        ))
        await session.commit()

    res = await client.post(
        "/tests/generate-questions",
        json={"classroomId": room_id, "conceptIds": [c1_id], "count": 15},
        headers=t_headers,
    )
    assert res.status_code == 200
    questions = res.json()
    assert len(questions) == 15

    stems = [q["prompt"] for q in questions]
    assert len(set(stems)) == 15


# Test C: Distractor quality (no generic distractors injected)
def test_distractor_quality_in_fallback_and_validation():
    questions = []
    stems = []
    for i in range(1, 9):
        q = dynamic_fallback_question(
            concept_id="c-routing",
            concept_name="Routing",
            concept_summary="Directs network packets between nodes based on destination IP and routing tables.",
            question_index=i,
            previous_stems=stems,
            existing_questions=questions,
        )
        questions.append(q)
        stems.append(q["prompt"])

    assert len(questions) == 8
    assert len(set(stems)) == 8

    # Ensure none of the old generic distractors appear
    for q in questions:
        for opt in q["options"]:
            for pattern in GENERIC_DISTRACTOR_PATTERNS:
                assert pattern not in opt.lower(), f"Generic pattern '{pattern}' found in {opt}"

    # Verify each question has 4 distinct options
    for q in questions:
        assert len(q["options"]) == 4
        assert len(set(q["options"])) == 4


# Test D: Duplicate LLM output triggers retry
@pytest.mark.asyncio
async def test_duplicate_llm_output_triggers_retry(monkeypatch):
    call_count = 0

    async def mock_call_nim(tier, messages, temperature, max_tokens):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            # Duplicate of existing question
            content = '{"questionId":"tmp","stem":"What is Routing?","options":[{"id":"a","text":"Option 1"},{"id":"b","text":"Option 2"},{"id":"c","text":"Option 3"},{"id":"d","text":"Option 4"}],"correctOptionId":"a"}'
        else:
            # Fresh question on attempt 2
            content = '{"questionId":"tmp","stem":"How does dynamic routing handle topology link failures?","options":[{"id":"a","text":"Reroutes traffic"},{"id":"b","text":"Halts packets"},{"id":"c","text":"Deletes interface"},{"id":"d","text":"Broadcasts all"}],"correctOptionId":"a"}'
        return {"content": content, "model": "fake-model", "usage": None}

    monkeypatch.setattr("app.curriculum.mcq_generation.call_nim", mock_call_nim)

    q = await generate_mcq_for_concept(
        concept_id="c-routing",
        concept_name="Routing",
        concept_summary="Routing principles",
        previous_stems=["What is Routing?"],
        max_attempts=3,
    )

    assert call_count == 2
    assert q["prompt"] == "How does dynamic routing handle topology link failures?"


# Test E: Duplicate options trigger retry
@pytest.mark.asyncio
async def test_duplicate_option_set_triggers_retry(monkeypatch):
    call_count = 0

    async def mock_call_nim(tier, messages, temperature, max_tokens):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            # Options match existing question
            content = '{"questionId":"tmp","stem":"Stem One?","options":[{"id":"a","text":"Shared A"},{"id":"b","text":"Shared B"},{"id":"c","text":"Shared C"},{"id":"d","text":"Shared D"}],"correctOptionId":"a"}'
        else:
            # Fresh option set
            content = '{"questionId":"tmp","stem":"Stem Two?","options":[{"id":"a","text":"Unique A"},{"id":"b","text":"Unique B"},{"id":"c","text":"Unique C"},{"id":"d","text":"Unique D"}],"correctOptionId":"a"}'
        return {"content": content, "model": "fake-model", "usage": None}

    monkeypatch.setattr("app.curriculum.mcq_generation.call_nim", mock_call_nim)

    existing = [{
        "prompt": "Prior question",
        "options": ["Shared A", "Shared B", "Shared C", "Shared D"],
    }]

    q = await generate_mcq_for_concept(
        concept_id="c-routing",
        concept_name="Routing",
        concept_summary="Routing principles",
        existing_questions=existing,
        max_attempts=3,
    )

    assert call_count == 2
    assert q["prompt"] == "Stem Two?"
    assert "Unique A" in q["options"]


# Test F: LLM failure falls back cleanly to dynamic concept-grounded questions
@pytest.mark.asyncio
async def test_llm_failure_falls_back_cleanly(monkeypatch):
    async def mock_failed_nim(*args, **kwargs):
        raise NimError("NVIDIA API timeout or service unavailable", status=503)

    monkeypatch.setattr("app.curriculum.mcq_generation.call_nim", mock_failed_nim)

    q = await generate_mcq_for_concept(
        concept_id="c-bgp",
        concept_name="Border Gateway Protocol",
        concept_summary="An exterior gateway protocol designed to exchange routing and reachability information among autonomous systems.",
        question_index=1,
    )

    assert q["conceptId"] == "c-bgp"
    assert "Border Gateway Protocol" in q["prompt"]
    assert len(q["options"]) == 4
    for opt in q["options"]:
        for pattern in GENERIC_DISTRACTOR_PATTERNS:
            assert pattern not in opt.lower()


# Test G: Multiple concepts generate concept-specific questions
@pytest.mark.asyncio
async def test_multiple_concepts_remain_concept_specific(client, monkeypatch):
    monkeypatch.setattr("app.curriculum.mcq_generation.call_nim", _simulated_nim_generator())

    uid = uuid.uuid4().hex[:6]
    t_res = await client.post(
        "/auth/register/teacher",
        json={"name": "Teacher Multi", "email": f"multi_{uid}@test.edu", "password": "password123"},
    )
    t_headers = {"Authorization": f"Bearer {t_res.json()['accessToken']}"}
    t_id = t_res.json()["user"]["id"]

    room_id = f"room-multi-{uid}"
    c_routing = f"c-routing-{uid}"
    c_tcp = f"c-tcp-{uid}"
    c_udp = f"c-udp-{uid}"

    async with SessionLocal() as session:
        session.add(ClassroomRow(id=room_id, name="Internet Architecture", subject="CS", teacher_id=t_id, join_code=f"INT{uid[:4]}"))
        session.add(ConceptRow(id=c_routing, classroom_id=room_id, name="Routing", normalized_name="routing", description="Path determination across network topologies."))
        session.add(ConceptRow(id=c_tcp, classroom_id=room_id, name="TCP", normalized_name="tcp", description="Reliable stream transport with acknowledgments."))
        session.add(ConceptRow(id=c_udp, classroom_id=room_id, name="UDP", normalized_name="udp", description="Connectionless datagram service with minimal overhead."))
        await session.commit()

    res = await client.post(
        "/tests/generate-questions",
        json={"classroomId": room_id, "conceptIds": [c_routing, c_tcp, c_udp], "count": 6},
        headers=t_headers,
    )
    assert res.status_code == 200
    questions = res.json()
    assert len(questions) == 6

    # Verify questions reference their respective concepts and are concept-specific
    for q in questions:
        cid = q["conceptId"]
        assert cid in (c_routing, c_tcp, c_udp)
        for opt in q["options"]:
            for pattern in GENERIC_DISTRACTOR_PATTERNS:
                assert pattern not in opt.lower()
