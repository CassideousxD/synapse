import time
from unittest.mock import AsyncMock
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.curriculum.generation_memory import (
    StoredQuestion,
    TestGenerationMemory,
    add_test_generation_questions,
    clear_test_generation_memory,
    get_test_generation_key,
    get_test_generation_memory,
)
from app.routers.tests import GenerateQuestionsRequest, generate_questions_for_test


class FakeAsyncRedis:
    """In-memory async Redis simulation with TTL support for unit testing."""

    def __init__(self):
        self.store: dict[str, str] = {}
        self.expirations: dict[str, float] = {}

    async def get(self, key: str) -> str | None:
        if key in self.expirations:
            if time.time() > self.expirations[key]:
                self.store.pop(key, None)
                self.expirations.pop(key, None)
                return None
        return self.store.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> bool:
        self.store[key] = value
        if ex is not None:
            self.expirations[key] = time.time() + ex
        else:
            self.expirations.pop(key, None)
        return True

    async def delete(self, key: str) -> int:
        existed = key in self.store
        self.store.pop(key, None)
        self.expirations.pop(key, None)
        return 1 if existed else 0


@pytest.fixture
def fake_redis():
    return FakeAsyncRedis()


# 1 & 2. Create generation memory for Test A & Retrieve Test A memory
@pytest.mark.asyncio
async def test_create_and_retrieve_memory(fake_redis):
    questions = [
        {"id": "q-1", "prompt": "What is virtual memory?", "conceptId": "c-vm", "format": "STANDARD_MCQ", "options": ["A", "B"], "answer": "A"},
        {"id": "q-2", "prompt": "What causes a page fault?", "conceptId": "c-vm", "format": "STANDARD_MCQ", "options": ["C", "D"], "answer": "C"},
    ]
    created = await add_test_generation_questions(
        test_id="test-A",
        teacher_id="teacher-1",
        classroom_id="room-1",
        questions=questions,
        redis_client=fake_redis,
    )
    assert created.test_id == "test-A"
    assert created.teacher_id == "teacher-1"
    assert len(created.questions) == 2

    retrieved = await get_test_generation_memory("test-A", redis_client=fake_redis)
    assert retrieved is not None
    assert retrieved.test_id == "test-A"
    assert retrieved.teacher_id == "teacher-1"
    assert len(retrieved.questions) == 2
    assert retrieved.questions[0].id == "q-1"
    assert retrieved.questions[0].prompt == "What is virtual memory?"
    assert retrieved.questions[1].id == "q-2"


# 3. Create Test B memory -> Test B cannot see Test A questions
@pytest.mark.asyncio
async def test_test_isolation(fake_redis):
    q_a = [{"id": "qa-1", "prompt": "Question for Test A", "conceptId": "c-1"}]
    q_b = [{"id": "qb-1", "prompt": "Question for Test B", "conceptId": "c-2"}]

    await add_test_generation_questions("test-A", "teacher-1", q_a, redis_client=fake_redis)
    await add_test_generation_questions("test-B", "teacher-1", q_b, redis_client=fake_redis)

    mem_a = await get_test_generation_memory("test-A", redis_client=fake_redis)
    mem_b = await get_test_generation_memory("test-B", redis_client=fake_redis)

    assert mem_a is not None and mem_b is not None
    assert [q.id for q in mem_a.questions] == ["qa-1"]
    assert [q.id for q in mem_b.questions] == ["qb-1"]
    assert "qa-1" not in [q.id for q in mem_b.questions]


# 4. Missing Redis key -> Returns None / empty, not an exception
@pytest.mark.asyncio
async def test_missing_redis_key(fake_redis):
    result = await get_test_generation_memory("non-existent-test", redis_client=fake_redis)
    assert result is None


# 5. TTL -> Memory expires after configured TTL
@pytest.mark.asyncio
async def test_ttl_expiration(fake_redis):
    q = [{"id": "q-ttl", "prompt": "Will expire soon", "conceptId": "c-1"}]
    # Set with 1-second TTL
    await add_test_generation_questions(
        "draft-expiring", "teacher-1", q, redis_client=fake_redis, ttl_seconds=1
    )

    # Immediately available
    mem = await get_test_generation_memory("draft-expiring", redis_client=fake_redis)
    assert mem is not None

    # Fast forward expiration
    fake_redis.expirations[get_test_generation_key("draft-expiring")] = time.time() - 1

    # Should now be expired and return None
    expired_mem = await get_test_generation_memory("draft-expiring", redis_client=fake_redis)
    assert expired_mem is None


# 6. Repeated generation context -> Appends questions across multiple clicks for same draft
@pytest.mark.asyncio
async def test_repeated_generation_context(fake_redis):
    draft_id = "draft-12345"
    wave_1 = [
        {"id": "q-1", "prompt": "First question", "conceptId": "c-vm"},
        {"id": "q-2", "prompt": "Second question", "conceptId": "c-vm"},
    ]
    await add_test_generation_questions(draft_id, "teacher-1", wave_1, redis_client=fake_redis)

    wave_2 = [
        {"id": "q-3", "prompt": "Third question", "conceptId": "c-vm"},
        {"id": "q-4", "prompt": "Fourth question", "conceptId": "c-vm"},
    ]
    mem_after_wave_2 = await add_test_generation_questions(draft_id, "teacher-1", wave_2, redis_client=fake_redis)

    assert len(mem_after_wave_2.questions) == 4
    all_prompts = [q.prompt for q in mem_after_wave_2.questions]
    assert all_prompts == ["First question", "Second question", "Third question", "Fourth question"]


# 7. Teacher isolation -> teacher-A + draft-A vs teacher-B + draft-B
@pytest.mark.asyncio
async def test_teacher_draft_isolation(fake_redis):
    q_a = [{"id": "qa-1", "prompt": "Teacher A question", "conceptId": "c-1"}]
    q_b = [{"id": "qb-1", "prompt": "Teacher B question", "conceptId": "c-2"}]

    await add_test_generation_questions("draft-A", "teacher-A", q_a, redis_client=fake_redis)
    await add_test_generation_questions("draft-B", "teacher-B", q_b, redis_client=fake_redis)

    mem_a = await get_test_generation_memory("draft-A", redis_client=fake_redis)
    mem_b = await get_test_generation_memory("draft-B", redis_client=fake_redis)

    assert mem_a.teacher_id == "teacher-A"
    assert mem_b.teacher_id == "teacher-B"
    assert mem_a.questions[0].prompt == "Teacher A question"
    assert mem_b.questions[0].prompt == "Teacher B question"


# 8. Persisted test ownership check in endpoint
@pytest.mark.asyncio
async def test_persisted_test_ownership_validation():
    # Mock database session
    mock_db = AsyncMock()

    # Case A: Classroom owned by teacher-1
    mock_classroom = AsyncMock()
    mock_classroom.id = "room-1"
    mock_classroom.teacher_id = "teacher-1"

    # Case B: Test owned by teacher-2 in room-2
    mock_test = AsyncMock()
    mock_test.id = "t-foreign"
    mock_test.classroom_id = "room-2"

    async def mock_scalar(query):
        # Inspect query target
        q_str = str(query)
        if "classrooms" in q_str:
            return mock_classroom
        if "tests" in q_str:
            return mock_test
        return None

    mock_db.scalar = mock_scalar

    req = GenerateQuestionsRequest(
        testId="t-foreign",
        classroomId="room-1",
        count=5,
    )

    # Attempting to generate for a test that does not belong to room-1
    with pytest.raises(HTTPException) as exc_info:
        await generate_questions_for_test(req, teacher_id="teacher-1", db=mock_db)

    assert exc_info.value.status_code == 400
    assert "does not belong" in exc_info.value.detail


# 9. New draft does not inherit old draft memory
@pytest.mark.asyncio
async def test_new_draft_starts_empty(fake_redis):
    old_draft = "draft-session-1"
    new_draft = "draft-session-2"

    await add_test_generation_questions(
        old_draft,
        "teacher-1",
        [{"id": "q-old", "prompt": "Old question"}],
        redis_client=fake_redis,
    )

    new_mem = await get_test_generation_memory(new_draft, redis_client=fake_redis)
    assert new_mem is None


# 10. Account / session switch -> Teacher B cannot hijack Teacher A's draft session
@pytest.mark.asyncio
async def test_account_switch_draft_hijack_prevention(monkeypatch, fake_redis):
    # Teacher A creates a draft session
    draft_id = "draft-shared-123"
    await add_test_generation_questions(
        draft_id,
        "teacher-A",
        [{"id": "q-1", "prompt": "Teacher A question"}],
        redis_client=fake_redis,
    )

    # Patch get_test_generation_memory to use fake_redis
    monkeypatch.setattr(
        "app.routers.tests.get_test_generation_memory",
        lambda tid: get_test_generation_memory(tid, redis_client=fake_redis),
    )

    mock_db = AsyncMock()
    mock_classroom = AsyncMock()
    mock_classroom.id = "room-1"
    mock_classroom.teacher_id = "teacher-B"  # Teacher B owns this classroom

    async def mock_scalar(query):
        q_str = str(query)
        if "classrooms" in q_str:
            return mock_classroom
        if "tests" in q_str:
            return None  # Not a persisted test, it's a draft
        return None

    mock_db.scalar = mock_scalar

    req = GenerateQuestionsRequest(
        testId=draft_id,
        classroomId="room-1",
        count=5,
    )

    # Teacher B tries to pass Teacher A's draftId
    with pytest.raises(HTTPException) as exc_info:
        await generate_questions_for_test(req, teacher_id="teacher-B", db=mock_db)

    assert exc_info.value.status_code == 403
    assert "Forbidden" in exc_info.value.detail


# =========================================================================
# INCREMENT 2 TESTS: Previous-Question Awareness & Deduplication
# =========================================================================

from app.curriculum.mcq_generation import (
    GeneratedQuestion,
    PlannedSlot,
    QuestionFormat,
    QuestionOption,
    _validate_slot_candidate,
    generate_mcq_batch_bounded,
    is_duplicate_stem,
)


# TEST 1 & TEST 12: New test with no memory -> generation succeeds normally without extra overhead
@pytest.mark.asyncio
async def test_test_1_and_12_new_test_no_memory_succeeds_unchanged(monkeypatch):
    slots = [
        PlannedSlot(
            slot_id=0,
            concept_id="c-vm",
            concept_name="Virtual Memory",
            concept_summary="Abstraction of memory",
            question_index=1,
            total_count=1,
            angle="definition",
            question_format=QuestionFormat.STANDARD_MCQ,
        )
    ]

    async def fake_generate_question(*args, **kwargs):
        # kwargs["previous_stems"] should be None when there is no memory
        assert kwargs.get("previous_stems") is None
        return GeneratedQuestion(
            questionId="q-1",
            stem="What is virtual memory?",
            options=[
                QuestionOption(id="a", text="An abstraction of physical memory"),
                QuestionOption(id="b", text="A hardware cable"),
            ],
            correctOptionId="a",
        )

    monkeypatch.setattr("app.curriculum.mcq_generation.generate_question", fake_generate_question)

    results = await generate_mcq_batch_bounded(slots, initial_previous_stems=None)
    assert len(results) == 1
    assert results[0]["prompt"] == "What is virtual memory?"


# TEST 2: Existing memory contains 3 previous questions -> previous stems passed into context
@pytest.mark.asyncio
async def test_test_2_existing_memory_passed_to_generation_context(monkeypatch):
    previous = [
        "What is dynamic routing?",
        "Which routing protocol uses link-state information?",
        "A router receives an incoming frame with an unknown destination.",
    ]
    slots = [
        PlannedSlot(
            slot_id=0,
            concept_id="c-routing",
            concept_name="Routing",
            concept_summary="Network packet forwarding",
            question_index=1,
            total_count=1,
            angle="mechanism",
            question_format=QuestionFormat.STANDARD_MCQ,
        )
    ]

    captured_stems = None

    async def fake_generate_question(*args, **kwargs):
        nonlocal captured_stems
        captured_stems = kwargs.get("previous_stems")
        return GeneratedQuestion(
            questionId="q-new",
            stem="How does distance-vector routing prevent routing loops?",
            options=[
                QuestionOption(id="a", text="Using split horizon and poison reverse"),
                QuestionOption(id="b", text="By disabling all interfaces"),
            ],
            correctOptionId="a",
        )

    monkeypatch.setattr("app.curriculum.mcq_generation.generate_question", fake_generate_question)

    results = await generate_mcq_batch_bounded(slots, initial_previous_stems=previous)
    assert len(results) == 1
    assert captured_stems == previous


# TEST 3: Generated candidate exactly matches previous question -> candidate rejected
def test_test_3_exact_match_candidate_rejected():
    previous = ["What is dynamic routing?", "How does BGP exchange prefixes?"]
    exact_candidate = "What is dynamic routing?"
    assert is_duplicate_stem(exact_candidate, previous) is True

    # Validate slot candidate rejection
    slot = PlannedSlot(0, "c-1", "Routing", "", 1, 1, "def", QuestionFormat.STANDARD_MCQ)
    gq = GeneratedQuestion(
        questionId="q-dup",
        stem=exact_candidate,
        options=[QuestionOption(id="a", text="A"), QuestionOption(id="b", text="B")],
        correctOptionId="a",
    )
    is_valid, _ = _validate_slot_candidate(slot, gq, accepted_stems=previous, accepted_questions=[])
    assert is_valid is False


# TEST 4: Generated candidate is a trivial paraphrase of previous question -> candidate rejected
def test_test_4_trivial_paraphrase_candidate_rejected():
    previous = ["What is dynamic routing?"]
    # Trivial paraphrase using stopwords and rephrasing
    paraphrase = "Which statement best describes dynamic routing?"
    assert is_duplicate_stem(paraphrase, previous) is True

    slot = PlannedSlot(0, "c-1", "Routing", "", 1, 1, "def", QuestionFormat.STANDARD_MCQ)
    gq = GeneratedQuestion(
        questionId="q-dup",
        stem=paraphrase,
        options=[QuestionOption(id="a", text="A"), QuestionOption(id="b", text="B")],
        correctOptionId="a",
    )
    is_valid, _ = _validate_slot_candidate(slot, gq, accepted_stems=previous, accepted_questions=[])
    assert is_valid is False


# TEST 5: Generated candidate is genuinely different -> candidate accepted
def test_test_5_genuinely_different_candidate_accepted():
    previous = ["What is dynamic routing?"]
    different = "A router learns a previously unknown network path. Which mechanism allows it to dynamically update its routing table?"
    assert is_duplicate_stem(different, previous) is False

    slot = PlannedSlot(0, "c-1", "Routing", "", 1, 1, "scenario", QuestionFormat.STANDARD_MCQ)
    gq = GeneratedQuestion(
        questionId="q-diff",
        stem=different,
        options=[
            QuestionOption(id="a", text="Routing protocol advertisement updates"),
            QuestionOption(id="b", text="Static address resolution table"),
            QuestionOption(id="c", text="Manual console route override"),
            QuestionOption(id="d", text="Default gateway loopback ping"),
        ],
        correctOptionId="a",
    )
    is_valid, parsed = _validate_slot_candidate(slot, gq, accepted_stems=previous, accepted_questions=[])
    assert is_valid is True
    assert parsed["prompt"] == different


# TEST 6: Two candidates in the SAME generation batch are duplicates -> one accepted, duplicate rejected
@pytest.mark.asyncio
async def test_test_6_same_batch_duplicate_rejected():
    slots = [
        PlannedSlot(0, "c-1", "Routing", "", 1, 2, "def", QuestionFormat.STANDARD_MCQ),
        PlannedSlot(1, "c-1", "Routing", "", 2, 2, "mech", QuestionFormat.STANDARD_MCQ),
    ]

    accepted_stems = []
    accepted_questions = []

    # Both slots produce the same stem
    gq0 = GeneratedQuestion(
        questionId="q-0",
        stem="What is dynamic routing?",
        options=[QuestionOption(id="a", text="A"), QuestionOption(id="b", text="B"), QuestionOption(id="c", text="C"), QuestionOption(id="d", text="D")],
        correctOptionId="a",
    )
    gq1 = GeneratedQuestion(
        questionId="q-1",
        stem="What is dynamic routing?",
        options=[QuestionOption(id="a", text="A"), QuestionOption(id="b", text="B"), QuestionOption(id="c", text="C"), QuestionOption(id="d", text="D")],
        correctOptionId="a",
    )

    # Slot 0 validation
    v0, p0 = _validate_slot_candidate(slots[0], gq0, accepted_stems, accepted_questions)
    assert v0 is True
    accepted_stems.append(p0["prompt"])
    accepted_questions.append(p0)

    # Slot 1 validation: should see Slot 0 in accepted_stems and be rejected!
    v1, p1 = _validate_slot_candidate(slots[1], gq1, accepted_stems, accepted_questions)
    assert v1 is False
    assert p1 is None


# TEST 7: Rejected duplicate is regenerated successfully -> only rejected slot retried
@pytest.mark.asyncio
async def test_test_7_rejected_duplicate_regenerated(monkeypatch):
    slots = [
        PlannedSlot(0, "c-1", "Routing", "", 1, 2, "def", QuestionFormat.STANDARD_MCQ),
        PlannedSlot(1, "c-1", "Routing", "", 2, 2, "mech", QuestionFormat.STANDARD_MCQ),
    ]

    call_counts = {0: 0, 1: 0}

    async def fake_generate(concept_id, concept_name, concept_summary, question_index, *args, **kwargs):
        slot_idx = question_index - 1
        call_counts[slot_idx] += 1
        # Slot 0 generates Q-A
        if slot_idx == 0:
            return GeneratedQuestion(
                questionId="q-0",
                stem="What is dynamic routing?",
                options=[QuestionOption(id="a", text="A"), QuestionOption(id="b", text="B"), QuestionOption(id="c", text="C"), QuestionOption(id="d", text="D")],
                correctOptionId="a",
            )
        # Slot 1 on first try duplicates Slot 0; on retry produces a different question
        if call_counts[1] == 1:
            return GeneratedQuestion(
                questionId="q-1-dup",
                stem="What is dynamic routing?",
                options=[QuestionOption(id="a", text="A"), QuestionOption(id="b", text="B"), QuestionOption(id="c", text="C"), QuestionOption(id="d", text="D")],
                correctOptionId="a",
            )
        else:
            return GeneratedQuestion(
                questionId="q-1-ok",
                stem="How does link-state routing determine the shortest path?",
                options=[QuestionOption(id="a", text="Dijkstra algorithm"), QuestionOption(id="b", text="Bellman-Ford"), QuestionOption(id="c", text="Flooding"), QuestionOption(id="d", text="Spanning tree")],
                correctOptionId="a",
            )

    monkeypatch.setattr("app.curriculum.mcq_generation.generate_question", fake_generate)

    results = await generate_mcq_batch_bounded(slots)
    assert len(results) == 2
    # Slot 0 generated once; Slot 1 generated twice (1 initial + 1 targeted retry)
    assert call_counts[0] == 1
    assert call_counts[1] == 2
    assert results[0]["prompt"] == "What is dynamic routing?"
    assert results[1]["prompt"] == "How does link-state routing determine the shortest path?"


# TEST 8: Fallback candidate would duplicate an existing question -> not inserted into memory
@pytest.mark.asyncio
async def test_test_8_duplicate_fallback_not_inserted(monkeypatch):
    duplicate_stem = "Which statement best characterizes the core objective of Routing?"
    accepted_stems = [duplicate_stem]

    # Verify is_duplicate_stem detects it
    assert is_duplicate_stem(duplicate_stem, accepted_stems) is True

    # In generate_mcq_batch_bounded, if generation fails and fallback produces a duplicate stem:
    slots = [
        PlannedSlot(0, "c-1", "Routing", "", 1, 1, "def", QuestionFormat.STANDARD_MCQ),
    ]

    async def fake_fail_generate(*args, **kwargs):
        raise RuntimeError("LLM failure")

    def fake_duplicate_fallback(*args, **kwargs):
        return {
            "id": "fb-dup",
            "type": "mcq",
            "format": "STANDARD_MCQ",
            "prompt": duplicate_stem,
            "options": ["A", "B", "C", "D"],
            "answer": "A",
            "conceptId": "c-1",
        }

    monkeypatch.setattr("app.curriculum.mcq_generation.generate_question", fake_fail_generate)
    monkeypatch.setattr("app.curriculum.mcq_generation.dynamic_fallback_question", fake_duplicate_fallback)

    # With initial_previous_stems containing the duplicate stem:
    results = await generate_mcq_batch_bounded(slots, initial_previous_stems=accepted_stems)
    # The duplicate fallback should NOT be inserted!
    assert len(results) == 0


# TEST 9: Accepted questions are appended to generation memory
@pytest.mark.asyncio
async def test_test_9_accepted_questions_appended_to_memory(fake_redis):
    draft_id = "draft-multi-wave"
    wave_1 = [{"id": "q-1", "prompt": "Question 1"}, {"id": "q-2", "prompt": "Question 2"}]
    await add_test_generation_questions(draft_id, "teacher-1", wave_1, redis_client=fake_redis)

    wave_2 = [{"id": "q-3", "prompt": "Question 3"}, {"id": "q-4", "prompt": "Question 4"}]
    mem = await add_test_generation_questions(draft_id, "teacher-1", wave_2, redis_client=fake_redis)

    assert len(mem.questions) == 4
    assert [q.id for q in mem.questions] == ["q-1", "q-2", "q-3", "q-4"]
    assert [q.prompt for q in mem.questions] == ["Question 1", "Question 2", "Question 3", "Question 4"]


# TEST 10: Teacher A's memory cannot affect Teacher B's generation -> strict isolation
@pytest.mark.asyncio
async def test_test_10_teacher_isolation_strict(fake_redis):
    await add_test_generation_questions("draft-A", "teacher-A", [{"id": "qa-1", "prompt": "Prompt A"}], redis_client=fake_redis)
    await add_test_generation_questions("draft-B", "teacher-B", [{"id": "qb-1", "prompt": "Prompt B"}], redis_client=fake_redis)

    mem_a = await get_test_generation_memory("draft-A", redis_client=fake_redis)
    mem_b = await get_test_generation_memory("draft-B", redis_client=fake_redis)

    assert mem_a.teacher_id == "teacher-A"
    assert mem_b.teacher_id == "teacher-B"
    assert "Prompt A" not in [q.prompt for q in mem_b.questions]
    assert "Prompt B" not in [q.prompt for q in mem_a.questions]


# TEST 11: Different testIds cannot see each other's generation memory -> strict isolation
@pytest.mark.asyncio
async def test_test_11_different_test_ids_isolation(fake_redis):
    await add_test_generation_questions("t-1", "teacher-1", [{"id": "q-t1", "prompt": "Test 1 prompt"}], redis_client=fake_redis)
    await add_test_generation_questions("t-2", "teacher-1", [{"id": "q-t2", "prompt": "Test 2 prompt"}], redis_client=fake_redis)

    mem_1 = await get_test_generation_memory("t-1", redis_client=fake_redis)
    mem_2 = await get_test_generation_memory("t-2", redis_client=fake_redis)

    assert [q.id for q in mem_1.questions] == ["q-t1"]
    assert [q.id for q in mem_2.questions] == ["q-t2"]
    assert "q-t1" not in [q.id for q in mem_2.questions]


