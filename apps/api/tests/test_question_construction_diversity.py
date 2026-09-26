import pytest
from unittest.mock import AsyncMock

from app.curriculum.mcq_generation import (
    PlannedSlot,
    QuestionFormat,
    _prompt,
    dynamic_fallback_question,
    generate_mcq_batch_bounded,
    is_duplicate_stem,
)


def test_diversity_instruction_exists_in_system_prompt():
    """Verify that system prompt explicitly mandates question construction diversity and forbids formulaic openings."""
    messages = _prompt(
        concept_name="ARP",
        concept_summary="Address Resolution Protocol mapping IP to MAC",
        question_index=1,
        total_count=4,
        angle="mechanism",
        question_format=QuestionFormat.STANDARD_MCQ,
    )
    system_content = messages[0]["content"]

    # Must contain question construction and reasoning diversity rules
    assert "QUESTION CONSTRUCTION & REASONING DIVERSITY" in system_content
    # Must explicitly prohibit repetitive formulaic openings
    assert "Which of the following" in system_content
    assert "STRICTLY AVOID repetitive openings" in system_content
    assert "genuinely distinct" in system_content


def test_existing_question_context_is_supplied_and_instructs_non_repetition():
    """Verify that previous stems are formatted and accompanied by the construction diversity mandate."""
    previous = [
        "Which of the following statements about ARP is true?",
        "Which statement best characterizes the core objective of DNS?",
    ]
    messages = _prompt(
        concept_name="TCP",
        concept_summary="Transmission Control Protocol",
        question_index=3,
        total_count=4,
        angle="troubleshooting",
        question_format=QuestionFormat.STANDARD_MCQ,
        previous_stems=previous,
    )
    user_content = messages[1]["content"]

    # Previous questions must be enumerated
    assert "1. Which of the following statements about ARP is true?" in user_content
    assert "2. Which statement best characterizes the core objective of DNS?" in user_content
    # Diversity mandate must instruct against copying sentence openers or structure
    assert "AVOID DUPLICATING THEIR CONSTRUCTION" in user_content
    assert "Do NOT use the same sentence opener or questioning frame" in user_content


def test_same_format_receives_diverse_cognitive_cues():
    """Verify that multiple questions in the same format receive distinct batch diversity guidance."""
    cues = []
    for idx in range(1, 5):
        msgs = _prompt(
            concept_name="TCP",
            concept_summary="Transport protocol",
            question_index=idx,
            total_count=4,
            question_format=QuestionFormat.STANDARD_MCQ,
        )
        user_content = msgs[1]["content"]
        # Extract batch diversity guidance
        for line in user_content.splitlines():
            if "Batch Diversity Guidance:" in line:
                cues.append(line.split("Batch Diversity Guidance:")[1].strip())

    assert len(cues) == 4
    # All 4 cues must be distinct to promote different reasoning modes across parallel slots
    assert len(set(cues)) == 4


@pytest.mark.asyncio
async def test_regeneration_receives_diversity_context(monkeypatch):
    """Verify that a rejected slot receives accepted questions in its retry prompt."""
    accepted_q1 = {
        "questionId": "q1",
        "stem": "An engineer observes recurring SYN packet retransmissions. What causes this?",
        "options": [{"id": "a", "text": "Firewall drop"}, {"id": "b", "text": "MTU mismatch"}],
        "correctOptionId": "a",
    }
    # Initial slot 2 returns invalid (duplicate stem) then valid on retry
    regen_received_stems = []

    async def mock_generate_question(concept_id, concept_name, concept_summary, **kwargs):
        prev = kwargs.get("previous_stems")
        if concept_id == "c2" and prev:
            regen_received_stems.extend(prev)
            return type("Obj", (), {
                "stem": "How does selective acknowledgment (SACK) reduce retransmission overhead?",
                "options": [type("Opt", (), {"id": "a", "text": "By acknowledging out-of-order blocks"}), type("Opt", (), {"id": "b", "text": "By clearing socket buffers"})],
                "correctOptionId": "a",
                "model_copy": lambda self, update: self,
            })()
        elif concept_id == "c1":
            return type("Obj", (), {
                "stem": accepted_q1["stem"],
                "options": [type("Opt", (), {"id": "a", "text": "Firewall drop"}), type("Opt", (), {"id": "b", "text": "MTU mismatch"})],
                "correctOptionId": "a",
                "model_copy": lambda self, update: self,
            })()
        else:
            # First attempt for c2: duplicate of c1 to force rejection
            return type("Obj", (), {
                "stem": accepted_q1["stem"],
                "options": [type("Opt", (), {"id": "a", "text": "Firewall drop"}), type("Opt", (), {"id": "b", "text": "MTU mismatch"})],
                "correctOptionId": "a",
                "model_copy": lambda self, update: self,
            })()

    monkeypatch.setattr("app.curriculum.mcq_generation.generate_question", mock_generate_question)

    slots = [
        PlannedSlot(0, "c1", "TCP", "Transport", 1, 2, "mechanism", QuestionFormat.STANDARD_MCQ),
        PlannedSlot(1, "c2", "TCP SACK", "SACK extension", 2, 2, "application", QuestionFormat.STANDARD_MCQ),
    ]

    results = await generate_mcq_batch_bounded(slots, concurrency_limit=2)
    assert len(results) == 2
    # The regeneration call for c2 must have received accepted_q1's stem as context
    assert accepted_q1["stem"] in regen_received_stems


def test_fallback_templates_do_not_contain_formulaic_openings():
    """Verify that fallback questions across formats do not begin with formulaic openings."""
    formulaic_openings = [
        "which of the following",
        "which statement best",
        "which option is true",
    ]
    for fmt in [
        QuestionFormat.STANDARD_MCQ,
        QuestionFormat.ASSERTION_REASON,
        QuestionFormat.TRUE_FALSE,
        QuestionFormat.SCENARIO_BASED,
    ]:
        for idx in range(1, 5):
            fb = dynamic_fallback_question(
                concept_id="c-test",
                concept_name="DNS",
                concept_summary="Domain Name System",
                question_format=fmt,
                question_index=idx,
            )
            prompt_lower = fb["prompt"].lower()
            for formula in formulaic_openings:
                assert formula not in prompt_lower, f"Fallback for {fmt} (index {idx}) contained formulaic opening: {fb['prompt']}"
