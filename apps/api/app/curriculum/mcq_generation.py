from __future__ import annotations

import asyncio
from dataclasses import dataclass
import difflib
import logging
import os
import random
import re
import time
import uuid
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.llm.client import (
    call_llm,
    call_nim,
    get_current_provider_model,
    get_current_provider_name,
)
from app.llm.json_utils import call_json

logger = logging.getLogger("synapse.mcq")

LLM_GENERATION_CONCURRENCY = int(
    os.environ.get("LLM_GENERATION_CONCURRENCY", os.environ.get("NIM_GENERATION_CONCURRENCY", "3"))
)
NIM_GENERATION_CONCURRENCY = LLM_GENERATION_CONCURRENCY



@dataclass
class PlannedSlot:
    slot_id: int
    concept_id: str
    concept_name: str
    concept_summary: str
    question_index: int
    total_count: int
    angle: str
    question_format: str


class QuestionFormat:
    STANDARD_MCQ = "STANDARD_MCQ"
    ASSERTION_REASON = "ASSERTION_REASON"
    TRUE_FALSE = "TRUE_FALSE"
    SCENARIO_BASED = "SCENARIO_BASED"
    NUMERICAL = "NUMERICAL"


# Conceptual angles to provide diverse pedagogical perspectives
CONCEPTUAL_ANGLES: list[str] = [
    "definition",
    "mechanism",
    "application",
    "scenario",
    "comparison",
    "troubleshooting",
    "edge_case",
    "interpretation",
    "configuration",
    "practical_consequence",
]

# Concepts in these domains legitimately support quantitative calculations
NUMERICAL_CONCEPT_KEYWORDS = {
    "routing", "cidr", "subnet", "subnetting", "ttl", "throughput", "bandwidth",
    "delay", "latency", "packet", "mtu", "window", "checksum", "crc", "congestion",
    "cache", "paging", "memory", "scheduling", "cpu", "registers",
    "complexity", "big-o", "binary", "tree", "heap", "graph", "hash", "hashing",
    "rsa", "aes", "encryption", "entropy", "probability", "statistics",
    "normalization", "b-tree", "transaction", "acid", "concurrency",
}

# Generic filler distractors that must never be accepted
GENERIC_DISTRACTOR_PATTERNS: list[str] = [
    "legacy protocol that has been replaced",
    "exponential o(2^n)",
    "unrelated data manipulation",
    "alternative option",
    "none of the above",
    "all of the above",
]


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

    @model_validator(mode="before")
    @classmethod
    def _normalize_fields(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        d = dict(data)
        # Normalize questionId aliases
        if "questionId" not in d:
            for k in ("id", "question_id", "questionID"):
                if k in d:
                    d["questionId"] = d.pop(k)
                    break
        # Normalize stem aliases
        if "stem" not in d:
            for k in ("prompt", "question", "text", "question_text"):
                if k in d:
                    d["stem"] = d.pop(k)
                    break
        # Normalize options aliases
        if "options" not in d:
            for k in ("choices", "alternatives"):
                if k in d:
                    d["options"] = d.pop(k)
                    break
        # Normalize correctOptionId aliases
        if "correctOptionId" not in d:
            for k in ("correct_option_id", "answer", "correctAnswer", "correct_answer", "correctOption"):
                if k in d:
                    d["correctOptionId"] = d.pop(k)
                    break

        # If options are list of strings or dicts with option/label aliases
        if "options" in d and isinstance(d["options"], list):
            new_opts = []
            for idx, opt in enumerate(d["options"]):
                if isinstance(opt, str):
                    new_opts.append({"id": chr(ord("a") + idx), "text": opt})
                elif isinstance(opt, dict):
                    opt_copy = dict(opt)
                    if "id" not in opt_copy:
                        for ok in ("option", "label", "key"):
                            if ok in opt_copy:
                                opt_copy["id"] = opt_copy.pop(ok)
                                break
                    if "text" not in opt_copy:
                        for tk in ("value", "content", "choice", "description"):
                            if tk in opt_copy:
                                opt_copy["text"] = opt_copy.pop(tk)
                                break
                    new_opts.append(opt_copy)
                else:
                    new_opts.append(opt)
            d["options"] = new_opts

            # If correctOptionId was given as the text of the option rather than the ID:
            if "correctOptionId" in d and isinstance(d["correctOptionId"], str):
                for opt in d["options"]:
                    if isinstance(opt, dict) and opt.get("text") == d["correctOptionId"]:
                        d["correctOptionId"] = opt.get("id")
                        break
        return d


def _correct_option_must_exist(q: GeneratedQuestion) -> list[str]:
    ids = {o.id for o in q.options}
    if q.correctOptionId not in ids:
        return [f"correctOptionId '{q.correctOptionId}' does not match any option id in {sorted(ids)}"]
    return []


def normalize_text(text: str) -> str:
    """Normalize text by lowercasing and stripping all non-alphanumeric characters."""
    return re.sub(r"[^a-z0-9]", "", text.strip().lower())


def _tokenize(text: str) -> set[str]:
    """Extract informative lowercase word tokens, omitting conversational question stop words."""
    words = re.findall(r"\b[a-z0-9]{2,}\b", text.lower())
    stop_words = {
        "which", "what", "how", "when", "where", "why", "who", "the", "this", "that",
        "these", "those", "is", "are", "was", "were", "be", "been", "being", "have",
        "has", "had", "do", "does", "did", "can", "could", "will", "would", "should",
        "of", "in", "to", "for", "with", "on", "at", "from", "by", "about", "into",
        "through", "during", "before", "after", "above", "below", "following", "statements",
        "accurately", "describes", "best", "most", "statement", "correctly", "characterizes",
    }
    return {w for w in words if w not in stop_words}


def is_duplicate_stem(candidate_stem: str, existing_stems: list[str], threshold: float = 0.75) -> bool:
    """Check if candidate stem is an exact duplicate, normalized duplicate, or too similar."""
    norm_cand = normalize_text(candidate_stem)
    if not norm_cand:
        return True

    cand_tokens = _tokenize(candidate_stem)

    for prev in existing_stems:
        norm_prev = normalize_text(prev)
        if norm_cand == norm_prev:
            return True

        # Fuzzy sequence similarity ratio
        seq_ratio = difflib.SequenceMatcher(None, norm_cand, norm_prev).ratio()
        if seq_ratio >= threshold:
            return True

        # Word token overlap (Jaccard similarity)
        prev_tokens = _tokenize(prev)
        if cand_tokens and prev_tokens:
            intersection = cand_tokens & prev_tokens
            union = cand_tokens | prev_tokens
            if union and (len(intersection) / len(union)) >= 0.70:
                return True

    return False


def check_option_quality(
    options: list[str],
    existing_questions: list[dict] | None = None,
) -> tuple[bool, str]:
    """Validate option quality, non-emptiness, uniqueness, absence of filler, and diversity across questions."""
    if len(options) < 2:
        return False, "Too few options"

    norm_opts = [normalize_text(o) for o in options]
    if len(set(norm_opts)) < len(norm_opts):
        return False, "Duplicate option within the same question"

    for opt in options:
        opt_lower = opt.lower()
        for pattern in GENERIC_DISTRACTOR_PATTERNS:
            if pattern in opt_lower:
                return False, f"Generic distractor pattern detected: '{pattern}'"
        if len(opt.strip()) < 1:
            return False, "Option is empty"

    cand_set = frozenset(norm_opts)
    # Standardized format option sets (e.g. True/False and Assertion-Reason) have fixed canonical wording by definition
    is_standardized_format = (
        cand_set == frozenset(["true", "false"])
        or any("assertion" in o and "reason" in o for o in norm_opts)
    )

    if existing_questions and not is_standardized_format:
        for eq in existing_questions:
            eq_options = eq.get("options") or []
            if frozenset(normalize_text(o) for o in eq_options) == cand_set:
                return False, "Option set matches a previously generated question"

            # Check if non-generic distractors repeat across questions
            for opt_text in options:
                norm_o = normalize_text(opt_text)
                times_seen = sum(
                    1 for q in existing_questions
                    if any(normalize_text(prev_opt) == norm_o for prev_opt in q.get("options", []))
                )
                if times_seen >= 2:
                    return False, f"Distractor '{opt_text[:30]}' repeated across multiple questions"

    return True, "OK"


def is_numerical_supported_for_concept(concept_name: str, concept_summary: str = "") -> bool:
    """Determine whether a concept legitimately supports numerical/calculation problems."""
    combined = f"{concept_name} {concept_summary}".lower()
    tokens = set(re.findall(r"\b[a-z0-9_-]+\b", combined))
    return bool(tokens & NUMERICAL_CONCEPT_KEYWORDS)


def select_question_format(
    concept_name: str,
    concept_summary: str,
    question_index: int,
    total_count: int,
    recent_formats: list[str] | None = None,
) -> str:
    """
    Select an appropriate, diverse question format without deterministic lockstep repetition.
    Adapts based on concept capability and past selections.
    """
    has_numerical = is_numerical_supported_for_concept(concept_name, concept_summary)
    eligible_formats = [
        QuestionFormat.STANDARD_MCQ,
        QuestionFormat.SCENARIO_BASED,
        QuestionFormat.ASSERTION_REASON,
        QuestionFormat.TRUE_FALSE,
    ]
    if has_numerical:
        eligible_formats.append(QuestionFormat.NUMERICAL)

    recent = list(recent_formats or [])

    # Prevent 2 identical formats in a row
    if recent and recent[-1] in eligible_formats and len(eligible_formats) > 1:
        candidates = [f for f in eligible_formats if f != recent[-1]]
    else:
        candidates = list(eligible_formats)

    # Use a varied pseudo-random selection to avoid A B C D cycles
    seed_val = (hash(concept_name) + question_index * 7919) % len(candidates)
    selected = candidates[seed_val]

    # Encourage format diversity if standard MCQ is over-represented
    if selected == QuestionFormat.STANDARD_MCQ and len(recent) >= 2:
        non_mcq = [f for f in candidates if f != QuestionFormat.STANDARD_MCQ]
        if non_mcq and (recent.count(QuestionFormat.STANDARD_MCQ) / len(recent)) >= 0.4:
            selected = non_mcq[(question_index + 1) % len(non_mcq)]

    return selected


def randomize_option_order(
    options: list[str],
    correct_answer: str,
    recent_indices: list[int] | None = None,
) -> tuple[list[str], int]:
    """
    Randomize option order while preventing answer-position bias and deterministic sequences.
    Returns (shuffled_options, new_correct_index).
    Authoritative correct answer string is untouched.
    """
    if len(options) < 2:
        return list(options), 0

    recent = list(recent_indices or [])

    # Disallow picking the exact same position 3 times in a row
    forbidden_idx = None
    if len(recent) >= 2 and recent[-1] == recent[-2]:
        forbidden_idx = recent[-1]

    distractors = [o for o in options if o != correct_answer]
    if len(distractors) == len(options):
        # Fallback if correct_answer not matched exactly
        correct_answer = options[0]
        distractors = options[1:]

    random.shuffle(distractors)

    num_options = len(options)
    eligible_target_indices = [i for i in range(num_options) if i != forbidden_idx]
    if not eligible_target_indices:
        eligible_target_indices = list(range(num_options))

    # Balance distribution naturally against recent history
    if len(recent) >= 4:
        counts = {i: recent[-8:].count(i) for i in eligible_target_indices}
        min_count = min(counts.values())
        least_frequent = [i for i, c in counts.items() if c == min_count]
        target_idx = random.choice(least_frequent)
    else:
        target_idx = random.choice(eligible_target_indices)

    shuffled = list(distractors)
    shuffled.insert(target_idx, correct_answer)

    return shuffled, target_idx


def validate_numerical_problem(
    stem: str,
    correct_answer: str,
    options: list[str],
) -> tuple[bool, dict[str, Any] | None]:
    """
    Validate that numerical questions have clear quantitative values, distinct numeric options,
    and mathematical consistency where deterministic patterns (e.g. TTL, CIDR/hosts) appear.
    Does NOT reject mathematically plausible questions merely because they don't match a single regex.
    """
    # 1. Structural check: Options must contain digits or numeric/prefix identifiers
    has_digits = any(re.search(r"\d+", o) for o in options)
    if not has_digits:
        return False, None

    # Structural check: Numeric values in options must be mutually distinct
    numeric_opts = [re.sub(r"[^\d.]", "", o) for o in options if re.search(r"\d", o)]
    if len(set(numeric_opts)) < len(numeric_opts):
        return False, None

    stem_lower = stem.lower()
    ans_num_match = re.search(r"\b(\d+)\b", correct_answer)
    ans_num = int(ans_num_match.group(1)) if ans_num_match else None

    # 2. TTL pattern: initial TTL X, traversed Y routers -> X - Y
    ttl_match = re.search(r"(?:initial\s+ttl|ttl\s+(?:value\s+)?(?:of\s+)?|initialized\s+with\s+(?:a\s+)?ttl\s+(?:value\s+)?(?:of\s+)?)(\d+).*?(\d+)\s+(?:intermediate\s+)?routers", stem, re.IGNORECASE)
    if ttl_match:
        initial = int(ttl_match.group(1))
        hops = int(ttl_match.group(2))
        expected_ttl = initial - hops
        if ans_num is not None and ans_num != expected_ttl:
            return False, None
        return True, {"calculation": "ttl_decrement", "initial": initial, "hops": hops, "expected": expected_ttl}

    # 3. CIDR patterns
    raw_prefixes = [int(p) for p in re.findall(r"/(\d{1,2})", stem) if 1 <= int(p) <= 30]
    unique_prefixes = sorted(list(set(raw_prefixes)))

    # 3a. Comparative CIDR difference: 2 distinct prefixes with comparison/difference query
    comparison_keywords = {"difference", "more", "fewer", "compare", "comparison", "larger", "smaller", "greater"}
    has_comparison = bool(set(re.findall(r"\b[a-z]+\b", stem_lower)) & comparison_keywords)

    if len(unique_prefixes) == 2 and has_comparison and ("usable" in stem_lower or "host" in stem_lower or "address" in stem_lower or "ip" in stem_lower):
        cap_a = (2 ** (32 - unique_prefixes[0])) - 2
        cap_b = (2 ** (32 - unique_prefixes[1])) - 2
        expected_diff = abs(cap_a - cap_b)
        if ans_num is not None:
            if ans_num == expected_diff:
                return True, {
                    "calculation": "cidr_host_comparison",
                    "prefixes": unique_prefixes,
                    "expected_difference": expected_diff,
                }
            # Only reject if it explicitly asks for the difference in usable host addresses
            if "difference" in stem_lower and ("usable host" in stem_lower or "usable ip" in stem_lower):
                return False, None

    # 3b. Single CIDR host capacity: exactly 1 distinct prefix, asks for usable hosts in THAT single subnet, NO comparison
    if len(unique_prefixes) == 1 and not has_comparison:
        prefix = unique_prefixes[0]
        expected_hosts = (2 ** (32 - prefix)) - 2
        if re.search(r"how\s+many\s+usable\s+(?:host|ip)", stem_lower):
            if ans_num is not None and ans_num != expected_hosts:
                return False, None
            return True, {"calculation": "cidr_usable_hosts", "prefix": prefix, "expected_hosts": expected_hosts}


    # 4. General numerical reasoning: structurally valid, distinct numeric options
    return True, {"calculation": "general_numeric"}



def _prompt(
    concept_name: str,
    concept_summary: str,
    *,
    question_index: int = 1,
    total_count: int = 1,
    angle: str | None = None,
    question_format: str = QuestionFormat.STANDARD_MCQ,
    previous_stems: list[str] | None = None,
) -> list[dict]:
    assigned_angle = angle or CONCEPTUAL_ANGLES[(question_index - 1) % len(CONCEPTUAL_ANGLES)]

    format_instruction = ""
    if question_format == QuestionFormat.ASSERTION_REASON:
        format_instruction = (
            "FORMAT: ASSERTION-REASON\n"
            "Stem format:\n"
            f"Assertion (A): <Specific technical assertion about {concept_name}>\n"
            f"Reason (R): <Specific technical reason or justification regarding the assertion>\n\n"
            "Options MUST be:\n"
            "- Both Assertion and Reason are true, and Reason is the correct explanation of Assertion.\n"
            "- Both Assertion and Reason are true, but Reason is NOT the correct explanation of Assertion.\n"
            "- Assertion is true, but Reason is false.\n"
            "- Assertion is false, but Reason is true.\n"
            "Set correctOptionId to whichever option represents the true relationship."
        )
    elif question_format == QuestionFormat.TRUE_FALSE:
        format_instruction = (
            "FORMAT: TRUE/FALSE\n"
            f"Stem must be a single, non-trivial technical statement evaluating a core property or edge behavior of {concept_name}.\n"
            "Options MUST be exactly two options:\n"
            "- True\n"
            "- False\n"
            "Set correctOptionId to the factually accurate option."
        )
    elif question_format == QuestionFormat.SCENARIO_BASED:
        format_instruction = (
            "FORMAT: SCENARIO-BASED\n"
            f"Stem must establish a practical operational scenario or problem-solving situation involving {concept_name} "
            "(e.g., 'An engineer observes...', 'In a system deployment with...').\n"
            "Options must evaluate alternative diagnosis, actions, or outcomes."
        )
    elif question_format == QuestionFormat.NUMERICAL:
        format_instruction = (
            "FORMAT: NUMERICAL / CALCULATION\n"
            f"Stem must state a concrete numerical problem based on {concept_name} with explicit parameter values "
            "(e.g., CIDR host counts, TTL hops, transmission delay, tree depth, cache lines).\n"
            "Provide exactly 4 distinct numerical options with units where appropriate. Ensure the correct answer is mathematically exact."
        )
    else:
        format_instruction = (
            "FORMAT: STANDARD MCQ\n"
            f"Craft a question testing {concept_name} from the assigned angle ('{assigned_angle}').\n"
            "MANDATORY: Do NOT default to formulaic openings like 'Which of the following statements about X is true?'. "
            "Frame the question around a concrete technical mechanism, a cause-and-effect relationship, "
            "a design trade-off, a comparative distinction, or an operational outcome."
        )

    system = (
        "You are an expert curriculum author writing high-quality questions for an adaptive learning assessment. "
        "Reply with ONLY a valid JSON object matching this schema:\n"
        '{"questionId": string, "stem": string, "options": [{"id": string, "text": string}, ...] (2-5 options), '
        '"correctOptionId": string (must match one option\'s id)}.\n'
        "No prose, no markdown fences, no extra commentary.\n\n"
        f"{format_instruction}\n\n"
        "STRICT DIVERSITY & QUALITY RULES:\n"
        f"1. CONCEPTUAL ANGLE: Focus specifically on the '{assigned_angle}' perspective.\n"
        "2. QUESTION CONSTRUCTION & REASONING DIVERSITY:\n"
        "   - Construct the question with a distinct cognitive reasoning approach. Do NOT use formulaic question stems.\n"
        "   - STRICTLY AVOID repetitive openings such as 'Which of the following...', 'Which statement is correct...', 'Which of these statements...', 'Which option best describes...'.\n"
        "   - Vary the presentation: diagnose an observed failure or symptom, predict a state transition or system outcome, evaluate a design trade-off, contrast two operational behaviors, trace a message exchange, or ask directly about a specific mechanism.\n"
        "   - Trivial wording changes (e.g. changing 'Which of the following' to 'Which statement') do NOT satisfy this requirement — the underlying reasoning structure must be genuinely distinct.\n"
        "3. NOVELTY & INDEPENDENCE: Never repeat, rephrase, or mimic previous questions.\n"
        "4. HIGH-QUALITY DISTRACTORS: Distractors must be plausible, technically grounded misconceptions specific to this concept. "
        "NEVER use generic filler phrases like 'A legacy protocol...', 'An operation that runs in exponential time...', 'A technique for unrelated data...', or 'None of the above'.\n"
        "5. All options must be mutually distinct and plausible."
    )

    user_parts = [
        f"Concept: {concept_name}",
        f"Summary: {concept_summary.strip() if concept_summary else 'Core mechanisms and principles.'}",
        f"Question Index: {question_index} of {total_count}",
        f"Assigned Conceptual Angle: {assigned_angle}",
        f"Question Format: {question_format}",
    ]
    if total_count > 1:
        variety_cues = [
            "Reasoning focus: Direct operational mechanism or internal protocol behavior.",
            "Reasoning focus: Problem diagnosis, practical symptom analysis, or unexpected behavior.",
            "Reasoning focus: Comparative distinction, trade-off evaluation, or architectural consequence.",
            "Reasoning focus: Outcome prediction when parameters, conditions, or topology change.",
        ]
        cue = variety_cues[(question_index - 1) % len(variety_cues)]
        user_parts.append(f"Batch Diversity Guidance: {cue}")

    if previous_stems:
        user_parts.append(
            "\nPREVIOUS QUESTIONS IN THIS TEST SESSION (AVOID DUPLICATING THEIR CONSTRUCTION):\n"
            "The following questions already exist in this test session. Inspect their structural patterns and "
            "ensure this new question uses a DIFFERENT construction and reasoning approach:\n"
        )
        for idx, stem in enumerate(previous_stems[-8:], 1):
            user_parts.append(f"  {idx}. {stem}")
        user_parts.append(
            f"\nGenerate a completely NEW question for '{concept_name}' with a distinct construction pattern. "
            "Do NOT use the same sentence opener or questioning frame as the questions above."
        )
    else:
        user_parts.append(
            "\nConstruction requirement: Ensure this question has an engaging, distinct reasoning structure "
            "(avoid generic formulaic stems like 'Which of the following is true...')."
        )

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": "\n".join(user_parts)},
    ]


async def generate_question(
    concept_id: str,
    concept_name: str,
    concept_summary: str,
    *,
    tier: str = "main",
    max_repairs: int = 1,
    question_index: int = 1,
    total_count: int = 1,
    angle: str | None = None,
    question_format: str = QuestionFormat.STANDARD_MCQ,
    previous_stems: list[str] | None = None,
    temperature: float = 0.4,
) -> GeneratedQuestion:
    async def call_llm_worker(tier: str, messages: list[dict], temperature: float | None, max_tokens: int | None) -> dict:
        return await call_nim(tier, messages, temperature, max_tokens)

    question = await call_json(
        call_llm_worker,


        tier,
        _prompt(
            concept_name,
            concept_summary,
            question_index=question_index,
            total_count=total_count,
            angle=angle,
            question_format=question_format,
            previous_stems=previous_stems,
        ),
        GeneratedQuestion,
        max_repairs=max_repairs,
        temperature=temperature,
        extra_check=_correct_option_must_exist,
    )
    # "Never trust model-generated IDs" — re-stamp deterministically, namespaced to the concept.
    return question.model_copy(update={"questionId": f"{concept_id}-{uuid.uuid4().hex[:8]}"})


def dynamic_fallback_question(
    concept_id: str,
    concept_name: str,
    concept_summary: str,
    *,
    angle: str | None = None,
    question_format: str = QuestionFormat.STANDARD_MCQ,
    question_index: int = 1,
    previous_stems: list[str] | None = None,
    existing_questions: list[dict] | None = None,
    recent_indices: list[int] | None = None,
) -> dict:
    """Generate dynamic, concept-grounded fallback question with varied formats and realistic distractors."""
    clean_summary = concept_summary.strip().rstrip(".") if concept_summary else ""
    summary_point = clean_summary if clean_summary else f"core operations and mechanisms of {concept_name}"

    stem: str
    correct_text: str
    distractors: list[str]
    metadata: dict[str, Any] | None = None

    # Handle specialized formats in fallback
    if question_format == QuestionFormat.ASSERTION_REASON:
        ar_templates = [
            {
                "stem": (
                    f"Assertion (A): {concept_name} dynamically determines forwarding or processing paths based on active system state.\n"
                    f"Reason (R): Adaptive state evaluation prevents persistent loops and failure propagation across interconnected nodes."
                ),
                "correct": "Both Assertion and Reason are true, and Reason is the correct explanation of Assertion.",
                "distractors": [
                    "Both Assertion and Reason are true, but Reason is NOT the correct explanation of Assertion.",
                    "Assertion is true, but Reason is false.",
                    "Assertion is false, but Reason is true.",
                ],
            },
            {
                "stem": (
                    f"Assertion (A): Disabling {concept_name} immediately halts all packet loss across interconnected systems.\n"
                    f"Reason (R): {concept_name} introduces mandatory packet inspection overhead that increases transport latency."
                ),
                "correct": "Assertion is false, but Reason is true.",
                "distractors": [
                    "Both Assertion and Reason are true, and Reason is the correct explanation of Assertion.",
                    "Both Assertion and Reason are true, but Reason is NOT the correct explanation of Assertion.",
                    "Assertion is true, but Reason is false.",
                ],
            },
            {
                "stem": (
                    f"Assertion (A): Configuration parameters for {concept_name} must align with neighboring autonomous systems.\n"
                    f"Reason (R): Incompatible state synchronization protocols lead to persistent unreachable endpoints or route flapping."
                ),
                "correct": "Both Assertion and Reason are true, and Reason is the correct explanation of Assertion.",
                "distractors": [
                    "Both Assertion and Reason are true, but Reason is NOT the correct explanation of Assertion.",
                    "Assertion is true, but Reason is false.",
                    "Assertion is false, but Reason is true.",
                ],
            },
            {
                "stem": (
                    f"Assertion (A): In {concept_name}, all routing decisions are calculated exclusively on destination host hardware.\n"
                    f"Reason (R): Intermediate nodes only amplify physical signals without evaluating protocol headers."
                ),
                "correct": "Both Assertion and Reason are false.",
                "distractors": [
                    "Both Assertion and Reason are true, and Reason is the correct explanation of Assertion.",
                    "Assertion is true, but Reason is false.",
                    "Assertion is false, but Reason is true.",
                ],
            },
        ]
        used_stems = list(previous_stems or [])
        start_idx = (question_index - 1) % len(ar_templates)
        chosen = None
        for offset in range(len(ar_templates)):
            cand = ar_templates[(start_idx + offset) % len(ar_templates)]
            if not is_duplicate_stem(cand["stem"], used_stems, threshold=0.70):
                chosen = cand
                break
        if chosen is None:
            chosen = ar_templates[start_idx]
        stem = chosen["stem"]
        correct_text = chosen["correct"]
        distractors = chosen["distractors"]
    elif question_format == QuestionFormat.TRUE_FALSE:
        tf_templates = [
            {
                "stem": f"In modern network architectures, {concept_name} operates autonomously without requiring manual per-packet route configuration.",
                "correct": "True",
                "distractors": ["False"],
            },
            {
                "stem": f"When {concept_name} is active, all packets are unconditionally broadcasted to every connected physical port.",
                "correct": "False",
                "distractors": ["True"],
            },
            {
                "stem": f"Protocol convergence in {concept_name} guarantees instantaneous state propagation across wide-area links without measurable delay.",
                "correct": "False",
                "distractors": ["True"],
            },
            {
                "stem": f"Correct operational deployment of {concept_name} requires verifying that interface MTU and subnet masks match across adjacent peers.",
                "correct": "True",
                "distractors": ["False"],
            },
        ]
        used_stems = list(previous_stems or [])
        start_idx = (question_index - 1) % len(tf_templates)
        chosen = None
        for offset in range(len(tf_templates)):
            cand = tf_templates[(start_idx + offset) % len(tf_templates)]
            if not is_duplicate_stem(cand["stem"], used_stems, threshold=0.70):
                chosen = cand
                break
        if chosen is None:
            chosen = tf_templates[start_idx]
        stem = chosen["stem"]
        correct_text = chosen["correct"]
        distractors = chosen["distractors"]
    elif question_format == QuestionFormat.SCENARIO_BASED:
        scenario_templates = [
            {
                "stem": (
                    f"Scenario: A network engineer deploys {concept_name} in an enterprise environment spanning multiple autonomous regions. "
                    f"During an unexpected upstream link degradation, which operational behavior will {concept_name} demonstrate?"
                ),
                "correct": f"It automatically recalculates alternative paths and synchronizes state with neighboring nodes.",
                "distractors": [
                    f"It terminates all existing client connections and halts interface hardware permanently.",
                    f"It continues forwarding packets into the degraded link until physical power is manually cycled.",
                    f"It broadcasts raw payload data across unencrypted channels to discover alternative neighbors.",
                ],
            },
            {
                "stem": (
                    f"Scenario: During a routine migration involving {concept_name}, an engineer notices high convergence times after a link failure. "
                    f"Which diagnostic step should be prioritized to isolate the bottleneck?"
                ),
                "correct": f"Inspect keepalive timers and peer adjacency state across intermediate interfaces.",
                "distractors": [
                    f"Replace physical fiber cables immediately without checking routing table metrics.",
                    f"Disable error logging globally to eliminate disk write overhead.",
                    f"Hardcode all destination IP addresses directly into client ARP caches.",
                ],
            },
            {
                "stem": (
                    f"Scenario: An administrator notices intermittent packet drops occurring exclusively when {concept_name} experiences peak traffic. "
                    f"What is the most probable underlying condition?"
                ),
                "correct": f"Receive buffer saturation or queue exhaustion under bursty load.",
                "distractors": [
                    f"The physical chassis power cord has inverted polarity.",
                    f"Unrelated background operating system clock ticks are colliding with packet preambles.",
                    f"The CPU has permanently switched from binary to decimal instruction decoding.",
                ],
            },
            {
                "stem": (
                    f"Scenario: Two branch offices are interconnected via {concept_name}, but hosts in Office A cannot reach hosts in Office B. "
                    f"ICMP requests time out at the first hop. What configuration mismatch is most likely responsible?"
                ),
                "correct": f"Default gateway or prefix length misconfiguration on the local subnet.",
                "distractors": [
                    f"The ambient room temperature in Office B is slightly lower than in Office A.",
                    f"DNS hostnames exceed 8 alphabetical characters in length.",
                    f"The operating system desktop wallpaper resolution does not match the server monitor.",
                ],
            },
        ]
        used_stems = list(previous_stems or [])
        start_idx = (question_index - 1) % len(scenario_templates)
        chosen = None
        for offset in range(len(scenario_templates)):
            cand = scenario_templates[(start_idx + offset) % len(scenario_templates)]
            if not is_duplicate_stem(cand["stem"], used_stems, threshold=0.70):
                chosen = cand
                break
        if chosen is None:
            chosen = scenario_templates[start_idx]
        stem = chosen["stem"]
        correct_text = chosen["correct"]
        distractors = chosen["distractors"]
    elif question_format == QuestionFormat.NUMERICAL and is_numerical_supported_for_concept(concept_name, concept_summary):
        num_variant = question_index % 6
        if num_variant == 0:
            initial_ttl = 64 if (question_index // 3) % 2 == 0 else 128
            routers = 3 + (question_index % 4)
            expected_ttl = initial_ttl - routers
            stem = (
                f"An IPv4 packet is initialized with a TTL value of {initial_ttl}. "
                f"If the packet traverses {routers} intermediate routers before reaching the destination, "
                f"what is the TTL value upon arrival at the destination host?"
            )
            correct_text = str(expected_ttl)
            distractors = [
                str(expected_ttl - 1),
                str(expected_ttl + 1),
                str(initial_ttl),
            ]
            metadata = {"calculation": "ttl_decrement", "initial": initial_ttl, "hops": routers, "expected": expected_ttl}
        elif num_variant == 1:
            prefix = 24 + (question_index % 5)  # e.g., /24, /25, /26, /27, /28
            host_bits = 32 - prefix
            usable_hosts = (2 ** host_bits) - 2
            stem = (
                f"A subnet configured for {concept_name} utilizes a /{prefix} CIDR network prefix. "
                f"How many usable host IP addresses are available within this subnet?"
            )
            correct_text = str(usable_hosts)
            distractors = [
                str(usable_hosts + 2),  # total addresses without subtracting 2
                str(usable_hosts - 2),  # sub-range mistake
                str(2 ** (host_bits - 1)),  # wrong power of 2
            ]
            metadata = {"calculation": "cidr_hosts", "prefix": prefix, "usable_hosts": usable_hosts}
        elif num_variant == 2:
            win_kb = 16 * ((question_index % 4) + 1)
            full_segs = (win_kb * 1024) // 1460
            stem = (
                f"Under {concept_name}, an endpoint advertises a receive window buffer of {win_kb} KB. "
                f"Assuming a Maximum Segment Size (MSS) of 1460 bytes, how many full-sized segments can be sent before buffer exhaustion?"
            )
            correct_text = str(full_segs)
            distractors = [
                str(full_segs - 1),
                str(full_segs + 1),
                str(win_kb),
            ]
            metadata = {"calculation": "window_segments", "win_kb": win_kb, "expected": full_segs}
        elif num_variant == 3:
            p1, p2 = 26, 28
            diff = ((2 ** (32 - p1)) - 2) - ((2 ** (32 - p2)) - 2)
            stem = (
                f"In network capacity planning for {concept_name}, how many more usable host IP addresses "
                f"does a /{p1} subnet provide compared to a /{p2} subnet?"
            )
            correct_text = str(diff)
            distractors = [
                str(diff + 16),
                str(diff - 16),
                str(diff // 2),
            ]
            metadata = {"calculation": "cidr_host_comparison", "prefixes": [p1, p2], "expected_difference": diff}
        elif num_variant == 4:
            delay_ms = 4 * ((question_index % 3) + 1)
            stem = (
                f"A storage system transferring blocks under {concept_name} takes {delay_ms} ms to serialize each block. "
                f"How many complete data blocks can be placed onto the transmission channel in 1 second (1000 ms)?"
            )
            expected_blocks = 1000 // delay_ms
            correct_text = str(expected_blocks)
            distractors = [
                str(expected_blocks - 5),
                str(expected_blocks + 5),
                str(expected_blocks * 2),
            ]
            metadata = {"calculation": "block_throughput", "delay_ms": delay_ms, "expected": expected_blocks}
        else:
            rtt_ms = 50 * ((question_index % 3) + 1)
            mbps = 20
            bdp_mb = max(1, (rtt_ms * mbps) // 1000)
            stem = (
                f"A transport connection utilizing {concept_name} operates across a {rtt_ms} ms round-trip time (RTT) path "
                f"with a bottleneck bandwidth of {mbps} Mbps. What is the minimum Bandwidth-Delay Product (BDP) in megabits?"
            )
            correct_text = str(bdp_mb)
            distractors = [
                str(bdp_mb + 2),
                str(bdp_mb * 4),
                str(max(1, bdp_mb - 1)),
            ]
            metadata = {"calculation": "bdp", "rtt_ms": rtt_ms, "mbps": mbps, "expected": bdp_mb}
    else:
        # Standard MCQ fallback templates
        templates = [
            {
                "angle": "definition",
                "stem": f"What foundational problem does {concept_name} address within system architectures?",
                "correct": f"It serves to manage {summary_point}." if clean_summary else f"It provides the foundational mechanism for coordinating and resolving state in {concept_name}.",
                "distractors": [
                    f"It restricts system execution strictly to offline single-node processing without runtime updates.",
                    f"It executes unconditional hardware broadcasts across all connected interfaces without logical filtering.",
                    f"It serializes static memory buffers directly to disk without participating in active coordination.",
                ],
            },
            {
                "angle": "mechanism",
                "stem": f"How does {concept_name} execute its primary operation during runtime?",
                "correct": f"By dynamically evaluating state to establish {summary_point}." if clean_summary else f"By inspecting incoming requests and applying designated rules or state transitions for {concept_name}.",
                "distractors": [
                    f"By broadcasting requests indiscriminately to every node without consulting any lookup table or state.",
                    f"By retaining only the initial observed configuration permanently and ignoring subsequent topology updates.",
                    f"By halting all system traffic until manual administrative intervention resolves every single event.",
                ],
            },
            {
                "angle": "application",
                "stem": f"In which environment or scenario is {concept_name} most effectively utilized?",
                "correct": f"In scalable architectures that require dynamic adaptation for {concept_name}.",
                "distractors": [
                    f"In isolated single-device architectures with strictly zero network interfaces or peer dependencies.",
                    f"Exclusively in static read-only firmware environments where runtime state modification is prohibited.",
                    f"Only when physical transport links are intentionally severed to suppress automated recovery.",
                ],
            },
            {
                "angle": "comparison",
                "stem": f"How does {concept_name} primarily contrast with static or unmanaged configurations?",
                "correct": f"It adapts dynamically to changing conditions and failure states rather than enforcing static hardcoded paths.",
                "distractors": [
                    f"It eliminates the necessity for any underlying transport protocols or physical infrastructure.",
                    f"It guarantees instantaneous zero-latency delivery regardless of distance or network congestion.",
                    f"It shifts all processing overhead exclusively to client terminals without maintaining server or peer state.",
                ],
            },
            {
                "angle": "troubleshooting",
                "stem": f"What is the most likely operational failure if {concept_name} is misconfigured or disabled?",
                "correct": f"System degradation, unreachable targets, or persistent loop conditions affecting {concept_name}.",
                "distractors": [
                    f"Immediate hardware clock synchronization desynchronization causing physical circuit shutdown.",
                    f"Permanent corruption of read-only cold backup tapes located in remote offline vaults.",
                    f"Automatic unrecoverable de-allocation of motherboard BIOS memory.",
                ],
            },
            {
                "angle": "edge_case",
                "stem": f"What critical constraint or boundary condition must be managed when implementing {concept_name}?",
                "correct": f"Convergence latency, synchronization consistency, and resource overhead under heavy load.",
                "distractors": [
                    f"Ensuring packet payloads never exceed 1 bit of total transmission length.",
                    f"Restricting total lifetime transactions across the infrastructure to a single invocation.",
                    f"Prohibiting any binary data representations from containing adjacent zero bits.",
                ],
            },
            {
                "angle": "configuration",
                "stem": f"What is the primary factor that dictates the configuration and tuning of {concept_name}?",
                "correct": f"Matching policy constraints, topology scale, and performance requirements for {concept_name}.",
                "distractors": [
                    f"Matching the physical color of the network patch cables connected to the chassis.",
                    f"Limiting operating system file paths to fewer than four alphabetical characters.",
                    f"Configuring the processor power supply to fluctuate randomly at 100 Hz intervals.",
                ],
            },
            {
                "angle": "practical_consequence",
                "stem": f"What is the primary operational consequence of successfully deploying {concept_name}?",
                "correct": f"Increased resilience, automated coordination, and optimized path selection.",
                "distractors": [
                    f"Complete elimination of all electrical power consumption by switching hardware.",
                    f"Total abandonment of cryptographic security standards across the entire enterprise.",
                    f"Forcing all communication endpoints to transmit data strictly in reverse byte order.",
                ],
            },
        ]

        used_stems = list(previous_stems or [])
        start_idx = (question_index - 1) % len(templates)
        chosen = None
        for offset in range(len(templates)):
            candidate_tmpl = templates[(start_idx + offset) % len(templates)]
            if not is_duplicate_stem(candidate_tmpl["stem"], used_stems, threshold=0.70):
                chosen = candidate_tmpl
                break

        if chosen is None:
            chosen = templates[start_idx]

        stem = chosen["stem"]
        correct_text = chosen["correct"]
        distractors = chosen["distractors"]

    # Randomize answer position naturally
    all_options = [correct_text] + distractors
    shuffled_options, _ = randomize_option_order(
        options=all_options,
        correct_answer=correct_text,
        recent_indices=recent_indices,
    )

    result = {
        "id": f"q-{uuid.uuid4().hex[:8]}",
        "type": "mcq",
        "format": question_format,
        "prompt": stem,
        "options": shuffled_options,
        "answer": correct_text,
        "conceptId": concept_id,
    }
    if metadata:
        result["metadata"] = metadata
    return result


def fallback_question(concept_id: str, concept_name: str, concept_summary: str) -> dict:
    """Backward-compatible wrapper routing to dynamic_fallback_question."""
    return dynamic_fallback_question(concept_id, concept_name, concept_summary)


async def generate_mcq_for_concept(
    concept_id: str,
    concept_name: str,
    concept_summary: str,
    *,
    question_index: int = 1,
    total_count: int = 1,
    previous_stems: list[str] | None = None,
    existing_questions: list[dict] | None = None,
    angle: str | None = None,
    question_format: str | None = None,
    recent_answer_indices: list[int] | None = None,
    max_attempts: int = 3,
) -> dict:
    """
    Generate a high-quality question for a concept with bounded retries, diversity checks,
    answer position randomization, format intelligence, and concept-grounded dynamic fallback.
    """
    known_stems = list(previous_stems or [])
    known_questions = list(existing_questions or [])
    recent_indices = list(recent_answer_indices or [])

    if question_format:
        chosen_format = question_format
    elif total_count > 1:
        chosen_format = select_question_format(
            concept_name=concept_name,
            concept_summary=concept_summary,
            question_index=question_index,
            total_count=total_count,
            recent_formats=[q.get("format", "") for q in known_questions],
        )
    else:
        chosen_format = QuestionFormat.STANDARD_MCQ

    for attempt in range(max_attempts):
        chosen_angle = angle or CONCEPTUAL_ANGLES[(question_index - 1 + attempt) % len(CONCEPTUAL_ANGLES)]
        try:
            gq = await generate_question(
                concept_id,
                concept_name,
                concept_summary,
                question_index=question_index,
                total_count=total_count,
                angle=chosen_angle,
                question_format=chosen_format,
                previous_stems=known_stems,
                temperature=0.4,
            )

            # Check duplicate stem against known stems
            if is_duplicate_stem(gq.stem, known_stems):
                logger.warning(
                    f"Generated question stem is duplicate/too similar on attempt {attempt + 1}: '{gq.stem}'. Retrying..."
                )
                continue

            correct_opt = next((o.text for o in gq.options if o.id == gq.correctOptionId), "")
            opts = [o.text for o in gq.options]

            # In True/False format, ensure exactly 2 options ("True", "False")
            if chosen_format == QuestionFormat.TRUE_FALSE:
                if len(opts) != 2 or not all(normalize_text(o) in ("true", "false") for o in opts):
                    logger.warning("True/False question did not return exactly True and False. Retrying...")
                    continue
            elif chosen_format == QuestionFormat.NUMERICAL:
                valid_num, num_meta = validate_numerical_problem(gq.stem, correct_opt, opts)
                if not valid_num:
                    logger.warning(f"Numerical question failed validation on attempt {attempt + 1}. Retrying...")
                    continue

            # Standard check for distractors
            if chosen_format != QuestionFormat.TRUE_FALSE:
                while len(opts) < 4:
                    opts.append(f"Additional distinct operational factor {len(opts) + 1} for {concept_name}")

            ok, reason = check_option_quality(opts, known_questions)
            if not ok:
                logger.warning(
                    f"Generated question options failed quality check on attempt {attempt + 1}: {reason}. Retrying..."
                )
                continue

            # Randomize answer position naturally
            shuffled_options, _ = randomize_option_order(
                options=opts,
                correct_answer=correct_opt,
                recent_indices=recent_indices,
            )

            result = {
                "id": f"q-{uuid.uuid4().hex[:8]}",
                "type": "mcq",
                "format": chosen_format,
                "prompt": gq.stem,
                "options": shuffled_options,
                "answer": correct_opt or opts[0],
                "conceptId": concept_id,
            }
            if chosen_format == QuestionFormat.NUMERICAL:
                _, num_meta = validate_numerical_problem(gq.stem, correct_opt, opts)
                if num_meta:
                    result["metadata"] = num_meta

            return result
        except Exception as e:
            logger.warning(
                f"generate_question attempt {attempt + 1} failed for concept '{concept_name}': {e}. Retrying with next angle..."
            )

    # All attempts exhausted or NIM failure -> dynamic concept-grounded fallback
    return dynamic_fallback_question(
        concept_id,
        concept_name,
        concept_summary,
        angle=angle or CONCEPTUAL_ANGLES[(question_index - 1) % len(CONCEPTUAL_ANGLES)],
        question_format=chosen_format,
        question_index=question_index,
        previous_stems=known_stems,
        existing_questions=known_questions,
        recent_indices=recent_indices,
    )


def _validate_slot_candidate(
    slot: PlannedSlot,
    gq: GeneratedQuestion | None,
    accepted_stems: list[str],
    accepted_questions: list[dict],
) -> tuple[bool, dict | None]:
    """Validates candidate question against duplicate stems, distractor rules, and format constraints."""
    if gq is None:
        return False, None

    if is_duplicate_stem(gq.stem, accepted_stems):
        logger.warning(f"Slot {slot.slot_id} duplicate stem rejected: '{gq.stem}'")
        return False, None

    correct_opt = next((o.text for o in gq.options if o.id == gq.correctOptionId), "")
    opts = [o.text for o in gq.options]

    if slot.question_format == QuestionFormat.TRUE_FALSE:
        if len(opts) != 2 or not all(normalize_text(o) in ("true", "false") for o in opts):
            logger.warning(f"Slot {slot.slot_id} True/False format invalid options: {opts}")
            return False, None
    elif slot.question_format == QuestionFormat.NUMERICAL:
        valid_num, _ = validate_numerical_problem(gq.stem, correct_opt, opts)
        if not valid_num:
            logger.warning(f"Slot {slot.slot_id} numerical validation failed for: '{gq.stem}'")
            return False, None

    if slot.question_format != QuestionFormat.TRUE_FALSE:
        while len(opts) < 4:
            opts.append(f"Additional distinct operational factor {len(opts) + 1} for {slot.concept_name}")

    ok, reason = check_option_quality(opts, accepted_questions)
    if not ok:
        logger.warning(f"Slot {slot.slot_id} option check failed: {reason}")
        return False, None

    q_meta = None
    if slot.question_format == QuestionFormat.NUMERICAL:
        _, q_meta = validate_numerical_problem(gq.stem, correct_opt, opts)

    cand_dict = {
        "slot_id": slot.slot_id,
        "id": f"q-{uuid.uuid4().hex[:8]}",
        "type": "mcq",
        "format": slot.question_format,
        "prompt": gq.stem,
        "options": opts,
        "answer": correct_opt or opts[0],
        "conceptId": slot.concept_id,
    }
    if q_meta:
        cand_dict["metadata"] = q_meta
    return True, cand_dict


async def generate_mcq_batch_bounded(
    planned_slots: list[PlannedSlot],
    concurrency_limit: int | None = None,
    initial_previous_stems: list[str] | None = None,
    existing_questions: list[dict] | None = None,
) -> list[dict]:
    """
    Executes bounded concurrent question generation across planned slots, followed by
    batch validation, targeted regeneration for rejected slots, dynamic fallback for
    exhausted retries, and deterministic answer-position randomization in original slot order.
    """
    if not planned_slots:
        return []

    concurrency = concurrency_limit or LLM_GENERATION_CONCURRENCY
    sem = asyncio.Semaphore(concurrency)
    start_time = time.perf_counter()


    logger.info(
        f"Starting batch generation: requested={len(planned_slots)}, "
        f"concurrency_limit={concurrency}, initial_previous_stems={len(initial_previous_stems or [])}"
    )

    async def _generate_slot(slot: PlannedSlot, previous_stems: list[str] | None = None) -> GeneratedQuestion | None:
        async with sem:
            try:
                return await generate_question(
                    slot.concept_id,
                    slot.concept_name,
                    slot.concept_summary,
                    question_index=slot.question_index,
                    total_count=slot.total_count,
                    angle=slot.angle,
                    question_format=slot.question_format,
                    previous_stems=previous_stems,
                    temperature=0.4,
                )
            except Exception as e:
                logger.warning(f"Slot {slot.slot_id} generation error: {e}")
                return None

    # Stage 2: Initial concurrent generation wave
    # Pass initial_previous_stems to all slots so they have awareness of prior questions on this test
    candidates = await asyncio.gather(
        *[_generate_slot(slot, previous_stems=initial_previous_stems) for slot in planned_slots]
    )

    # Stage 3-5: Collect in deterministic order & batch validation pass
    accepted: dict[int, dict] = {}
    accepted_stems: list[str] = list(initial_previous_stems or [])
    accepted_questions: list[dict] = list(existing_questions or [])
    rejected_slots: list[PlannedSlot] = []

    for slot, gq in zip(planned_slots, candidates):
        is_valid, parsed_q = _validate_slot_candidate(slot, gq, accepted_stems, accepted_questions)
        if is_valid and parsed_q:
            accepted[slot.slot_id] = parsed_q
            accepted_stems.append(parsed_q["prompt"])
            accepted_questions.append(parsed_q)
        else:
            rejected_slots.append(slot)

    initial_rejected_count = len(rejected_slots)
    logger.info(
        f"Initial wave complete: accepted={len(accepted)}, rejected={initial_rejected_count}"
    )

    # Stage 6: Targeted regeneration ONLY for rejected slots
    total_regenerated = 0
    max_retry_rounds = 2
    for r_round in range(max_retry_rounds):
        if not rejected_slots:
            break
        still_rejected: list[PlannedSlot] = []
        retry_tasks = []
        for slot in rejected_slots:
            retry_angle = CONCEPTUAL_ANGLES[(slot.question_index - 1 + r_round + 1) % len(CONCEPTUAL_ANGLES)]
            r_slot = PlannedSlot(
                slot_id=slot.slot_id,
                concept_id=slot.concept_id,
                concept_name=slot.concept_name,
                concept_summary=slot.concept_summary,
                question_index=slot.question_index,
                total_count=slot.total_count,
                angle=retry_angle,
                question_format=slot.question_format,
            )
            retry_tasks.append((r_slot, _generate_slot(r_slot, previous_stems=accepted_stems)))

        regen_results = await asyncio.gather(*[t[1] for t in retry_tasks])
        for (r_slot, _), gq in zip(retry_tasks, regen_results):
            total_regenerated += 1
            is_valid, parsed_q = _validate_slot_candidate(r_slot, gq, accepted_stems, accepted_questions)
            if is_valid and parsed_q:
                accepted[r_slot.slot_id] = parsed_q
                accepted_stems.append(parsed_q["prompt"])
                accepted_questions.append(parsed_q)
            else:
                still_rejected.append(r_slot)
        rejected_slots = still_rejected

    # Dynamic fallback for any slots still unresolved after retry budget
    fallback_count = len(rejected_slots)
    for slot in rejected_slots:
        fb_q = None
        for offset_try in range(6):
            candidate_fb = dynamic_fallback_question(
                concept_id=slot.concept_id,
                concept_name=slot.concept_name,
                concept_summary=slot.concept_summary,
                angle=slot.angle,
                question_format=slot.question_format,
                question_index=slot.question_index + offset_try,
                previous_stems=accepted_stems,
                existing_questions=accepted_questions,
            )
            if not is_duplicate_stem(candidate_fb["prompt"], accepted_stems):
                fb_q = candidate_fb
                break

        if fb_q is None:
            logger.warning(
                f"Fallback for slot {slot.slot_id} duplicated an existing question; skipping insertion."
            )
            continue

        fb_dict = {
            "slot_id": slot.slot_id,
            "id": fb_q["id"],
            "type": fb_q.get("type", "mcq"),
            "format": fb_q.get("format", slot.question_format),
            "prompt": fb_q["prompt"],
            "options": fb_q["options"],
            "answer": fb_q["answer"],
            "conceptId": fb_q["conceptId"],
        }
        if "metadata" in fb_q:
            fb_dict["metadata"] = fb_q["metadata"]
        accepted[slot.slot_id] = fb_dict
        accepted_stems.append(fb_q["prompt"])
        accepted_questions.append(fb_dict)

    # Stage 8: Apply answer-position randomization in deterministic slot order
    final_questions: list[dict] = []
    recent_indices: list[int] = []

    for slot in planned_slots:
        if slot.slot_id not in accepted:
            continue
        q = accepted[slot.slot_id]
        shuffled_options, new_idx = randomize_option_order(
            options=q["options"],
            correct_answer=q["answer"],
            recent_indices=recent_indices,
        )
        recent_indices.append(new_idx)
        final_q = {
            "id": q["id"],
            "type": q.get("type", "mcq"),
            "format": q.get("format", slot.question_format),
            "prompt": q["prompt"],
            "options": shuffled_options,
            "answer": q["answer"],
            "conceptId": q["conceptId"],
        }
        if "metadata" in q:
            final_q["metadata"] = q["metadata"]
        final_questions.append(final_q)

    duration = time.perf_counter() - start_time
    provider_name = get_current_provider_name()
    provider_model = get_current_provider_model("main")

    global _last_batch_telemetry
    _last_batch_telemetry = {
        "provider": provider_name,
        "model": provider_model,
        "requested_questions": len(planned_slots),
        "initial_llm_calls": len(planned_slots),
        "validation_failures": initial_rejected_count,
        "targeted_regeneration_calls": total_regenerated,
        "fallback_calls": fallback_count,
        "total_llm_calls": len(planned_slots) + total_regenerated,
        "duration_seconds": round(duration, 2),
    }

    logger.info(
        f"Generation Pipeline Telemetry: provider={provider_name}, model={provider_model}, "
        f"requested={len(planned_slots)}, initial_llm_calls={len(planned_slots)}, "
        f"validation_failures={initial_rejected_count}, targeted_regeneration_calls={total_regenerated}, "
        f"fallback_calls={fallback_count}, total_llm_calls={len(planned_slots) + total_regenerated}, "
        f"duration={duration:.2f}s"
    )
    return final_questions



_last_batch_telemetry: dict[str, Any] = {}


def get_last_batch_telemetry() -> dict[str, Any]:
    """Returns telemetry from the most recent batch generation pass."""
    return dict(_last_batch_telemetry)