import pytest

from app.curriculum.mcq_generation import GeneratedQuestion, generate_question
from app.llm.json_utils import LlmOutputError, extract_json_object, JsonExtractError

VALID_JSON = '{"questionId":"tmp","stem":"What is 2+2?","options":[{"id":"a","text":"3"},{"id":"b","text":"4"}],"correctOptionId":"b"}'


def _fake_call_nim(*responses):
    calls = []

    async def call_nim(tier, messages, temperature, max_tokens):
        calls.append({"tier": tier, "messages": messages})
        content = responses[len(calls) - 1]
        return {"content": content, "model": "fake-model", "usage": None}

    return call_nim, calls


async def test_generates_valid_question_first_try(monkeypatch):
    fake, calls = _fake_call_nim(VALID_JSON)
    monkeypatch.setattr("app.curriculum.mcq_generation.call_nim", fake)

    q = await generate_question("c1", "Addition", "Basic arithmetic")
    assert isinstance(q, GeneratedQuestion)
    assert q.stem == "What is 2+2?"
    assert q.correctOptionId == "b"
    assert len(calls) == 1


async def test_questionId_is_restamped_not_trusted_from_model(monkeypatch):
    fake, _ = _fake_call_nim(VALID_JSON)
    monkeypatch.setattr("app.curriculum.mcq_generation.call_nim", fake)

    q = await generate_question("concept-42", "Addition", "Basic arithmetic")
    assert q.questionId != "tmp"
    assert q.questionId.startswith("concept-42-")


async def test_repairs_after_malformed_json_then_succeeds(monkeypatch):
    fake, calls = _fake_call_nim("not json at all, sorry", VALID_JSON)
    monkeypatch.setattr("app.curriculum.mcq_generation.call_nim", fake)

    q = await generate_question("c1", "Addition", "Basic arithmetic")
    assert q.correctOptionId == "b"
    assert len(calls) == 2
    assert calls[1]["messages"][-2]["content"] == "not json at all, sorry"
    assert "No JSON object found" in calls[1]["messages"][-1]["content"]


async def test_repairs_when_correctOptionId_does_not_match_any_option(monkeypatch):
    bad = '{"questionId":"x","stem":"S","options":[{"id":"a","text":"A"},{"id":"b","text":"B"}],"correctOptionId":"z"}'
    fake, calls = _fake_call_nim(bad, VALID_JSON)
    monkeypatch.setattr("app.curriculum.mcq_generation.call_nim", fake)

    q = await generate_question("c1", "Addition", "Basic arithmetic")
    assert q.correctOptionId == "b"
    assert "does not match any option id" in calls[1]["messages"][-1]["content"]


async def test_gives_up_after_max_repairs(monkeypatch):
    fake, calls = _fake_call_nim("garbage", "still garbage")
    monkeypatch.setattr("app.curriculum.mcq_generation.call_nim", fake)

    with pytest.raises(LlmOutputError):
        await generate_question("c1", "Addition", "Basic arithmetic", max_repairs=1)
    assert len(calls) == 2


async def test_rejects_extra_field_from_model():
    with pytest.raises(Exception):
        GeneratedQuestion.model_validate(
            {"questionId": "x", "stem": "S", "options": [{"id": "a", "text": "A"}, {"id": "b", "text": "B"}], "correctOptionId": "a", "hint": "sneaky"}
        )


def test_extract_json_handles_think_tags_and_fences():
    raw = "<think>let me plan</think>```json\n" + VALID_JSON + "\n```"
    assert extract_json_object(raw)["correctOptionId"] == "b"


def test_extract_json_handles_prose_wrapped_object():
    raw = f"Sure, here you go: {VALID_JSON} Hope that helps!"
    assert extract_json_object(raw)["correctOptionId"] == "b"


def test_extract_json_raises_when_nothing_found():
    with pytest.raises(JsonExtractError):
        extract_json_object("no json here at all")