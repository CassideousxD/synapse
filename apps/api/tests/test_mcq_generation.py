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


def test_extract_json_handles_trailing_commas():
    raw_with_trailing = """
    {
        "questionId": "q1",
        "stem": "What is dynamic routing?",
        "options": [
            {"id": "a", "text": "Path selection based on topology changes"},
            {"id": "b", "text": "Fixed manual route entry"},
        ],
        "correctOptionId": "a",
    }
    """
    extracted = extract_json_object(raw_with_trailing, target_keys={"questionId", "stem", "options", "correctOptionId"})
    assert extracted["questionId"] == "q1"
    assert extracted["stem"] == "What is dynamic routing?"
    assert len(extracted["options"]) == 2
    assert extracted["correctOptionId"] == "a"


def test_extract_json_prioritizes_full_question_over_preamble_option():
    raw = """
    Here is an example option: {"id": "example", "text": "sample text"}
    
    And here is the actual complete question:
    ```json
    {
        "questionId": "q-real",
        "stem": "Which layer does IP operate at?",
        "options": [
            {"id": "a", "text": "Network layer"},
            {"id": "b", "text": "Transport layer"}
        ],
        "correctOptionId": "a"
    }
    ```
    """
    extracted = extract_json_object(raw, target_keys={"questionId", "stem", "options", "correctOptionId"})
    assert extracted["questionId"] == "q-real"
    assert extracted["stem"] == "Which layer does IP operate at?"


def test_generated_question_normalizes_aliases():
    data = {
        "id": "q-aliased",
        "prompt": "What is an autonomous system?",
        "choices": [
            {"label": "opt1", "value": "A collection of connected routing prefixes under common control"},
            {"label": "opt2", "value": "A single physical router with redundant power supplies"}
        ],
        "answer": "opt1",
    }
    q = GeneratedQuestion.model_validate(data)
    assert q.questionId == "q-aliased"
    assert q.stem == "What is an autonomous system?"
    assert len(q.options) == 2
    assert q.options[0].id == "opt1"
    assert q.options[0].text == "A collection of connected routing prefixes under common control"
    assert q.correctOptionId == "opt1"


def test_generated_question_normalizes_string_options():
    data = {
        "questionId": "q-str",
        "stem": "Is BGP an exterior gateway protocol?",
        "options": ["True", "False"],
        "correctOptionId": "True",
    }
    q = GeneratedQuestion.model_validate(data)
    assert q.stem == "Is BGP an exterior gateway protocol?"
    assert len(q.options) == 2
    assert q.options[0].id == "a"
    assert q.options[0].text == "True"
    assert q.options[1].id == "b"
    assert q.options[1].text == "False"
    assert q.correctOptionId == "a"