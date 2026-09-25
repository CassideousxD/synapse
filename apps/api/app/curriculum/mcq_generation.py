from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.llm.client import call_nim
from app.llm.json_utils import call_json


class QuestionOption(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    text: str


class GeneratedQuestion(BaseModel):
    """
    Superset of the QuestionContext contract (questionId, stem, options) plus
    correctOptionId, which QuestionContext deliberately omits since that type
    is what the STUDENT sees. This type never crosses to the student directly.
    """

    model_config = ConfigDict(extra="forbid")
    questionId: str
    stem: str
    options: list[QuestionOption] = Field(min_length=2, max_length=5)
    correctOptionId: str


def _correct_option_must_exist(q: GeneratedQuestion) -> list[str]:
    ids = {o.id for o in q.options}
    if q.correctOptionId not in ids:
        return [f"correctOptionId '{q.correctOptionId}' does not match any option id in {sorted(ids)}"]
    return []


def _prompt(concept_name: str, concept_summary: str) -> list[dict]:
    system = (
        "You write a single multiple-choice question testing understanding of ONE concept. "
        "Reply with ONLY a JSON object: "
        '{"questionId": string, "stem": string, "options": [{"id": string, "text": string}, ...] (2-5 options), '
        '"correctOptionId": string (must equal one option\'s id)}. '
        "No prose, no code fences. Distractors should be plausible, not silly."
    )
    user = f"Concept: {concept_name}\nSummary: {concept_summary}"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


async def generate_question(
    concept_id: str,
    concept_name: str,
    concept_summary: str,
    *,
    tier: str = "main",
    max_repairs: int = 1,
) -> GeneratedQuestion:
    async def call_llm(tier: str, messages: list[dict], temperature: float | None, max_tokens: int | None) -> dict:
        return await call_nim(tier, messages, temperature, max_tokens)

    question = await call_json(
        call_llm,
        tier,
        _prompt(concept_name, concept_summary),
        GeneratedQuestion,
        max_repairs=max_repairs,
        extra_check=_correct_option_must_exist,
    )
    # "Never trust model-generated IDs" — re-stamp deterministically, namespaced to the concept.
    return question.model_copy(update={"questionId": f"{concept_id}-{uuid.uuid4().hex[:8]}"})


def fallback_question(concept_id: str, concept_name: str, concept_summary: str) -> dict:
    correct_text = (
        f"It establishes {concept_summary.rstrip('.')}."
        if concept_summary
        else f"Core definitions and mechanisms of {concept_name}."
    )
    distractor_1 = f"A legacy protocol that has been replaced entirely in modern computing."
    distractor_2 = f"An operation that runs in exponential O(2^n) time without any practical utility."
    distractor_3 = f"A technique used strictly for unrelated data manipulation, separate from {concept_name}."
    options = [correct_text, distractor_1, distractor_2, distractor_3]
    return {
        "id": f"q-{uuid.uuid4().hex[:8]}",
        "type": "mcq",
        "prompt": f"Which of the following statements most accurately describes {concept_name}?",
        "options": options,
        "answer": correct_text,
        "conceptId": concept_id,
    }


async def generate_mcq_for_concept(concept_id: str, concept_name: str, concept_summary: str) -> dict:
    try:
        gq = await generate_question(concept_id, concept_name, concept_summary)
        correct_opt = next((o.text for o in gq.options if o.id == gq.correctOptionId), "")
        opts = [o.text for o in gq.options]
        while len(opts) < 4:
            opts.append(f"Alternative option {len(opts) + 1}")
        return {
            "id": f"q-{uuid.uuid4().hex[:8]}",
            "type": "mcq",
            "prompt": gq.stem,
            "options": opts,
            "answer": correct_opt or opts[0],
            "conceptId": concept_id,
        }
    except Exception:
        return fallback_question(concept_id, concept_name, concept_summary)