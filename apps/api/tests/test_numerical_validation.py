import pytest
from app.curriculum.mcq_generation import (
    validate_numerical_problem,
    generate_mcq_batch_bounded,
    PlannedSlot,
    QuestionFormat,
    get_last_batch_telemetry,
)


def test_cidr_comparison_previously_failing_case():
    """
    Regression test for the previously failing CIDR comparative question:
    'Given CIDR blocks 10.0.0.0/22 and 10.0.4.0/24, what is the difference in usable host addresses?'
    Prefix /22 has 1022 usable hosts, /24 has 254 usable hosts. Difference is 768.
    The validator must NOT reject this as invalid!
    """
    stem = "Given CIDR blocks 10.0.0.0/22 and 10.0.4.0/24, what is the difference in usable host addresses between the larger subnet and the smaller subnet?"
    correct_ans = "768"
    options = ["768", "1022", "254", "512"]

    valid, meta = validate_numerical_problem(stem, correct_ans, options)
    assert valid is True
    assert meta is not None
    assert meta.get("calculation") == "cidr_host_comparison"
    assert meta.get("expected_difference") == 768


def test_cidr_single_subnet_calculation():
    """Verifies that single-subnet host calculation is deterministically verified."""
    stem = "A subnet configured for Subnetting utilizes a /25 CIDR network prefix. How many usable host IP addresses are available within this subnet?"
    correct_ans = "126"
    options = ["126", "128", "62", "254"]

    valid, meta = validate_numerical_problem(stem, correct_ans, options)
    assert valid is True
    assert meta is not None
    assert meta.get("calculation") == "cidr_usable_hosts"
    assert meta.get("expected_hosts") == 126

    # If mathematically wrong answer is supplied, it must be rejected
    wrong_valid, _ = validate_numerical_problem(stem, "200", ["200", "128", "62", "254"])
    assert wrong_valid is False


def test_cidr_comparison_more_fewer_hosts():
    """Tests comparison with 'more' / 'fewer' keywords between two prefixes."""
    stem = "An organization compares two subnets derived from a block: /26 and /27. How many more usable host addresses does the /26 subnet provide compared to the /27 subnet?"
    correct_ans = "32"
    options = ["32", "62", "30", "64"]

    valid, meta = validate_numerical_problem(stem, correct_ans, options)
    assert valid is True
    assert meta is not None
    assert meta.get("calculation") == "cidr_host_comparison"
    assert meta.get("expected_difference") == 32


def test_cidr_required_host_prefix_determination():
    """
    Tests question determining prefix for required host capacity.
    Does not match narrow single-formula regex, but is structurally sound.
    """
    stem = "An administrator must subnet the 10.0.0.0/16 network to create subnets that each support at least 1000 usable host addresses. Which prefix should be used?"
    correct_ans = "/22"
    options = ["/22", "/23", "/21", "/20"]

    valid, meta = validate_numerical_problem(stem, correct_ans, options)
    assert valid is True
    assert meta is not None
    assert meta.get("calculation") == "general_numeric"


def test_cidr_subnet_allocation_calculation():
    """Tests subnets created from a larger network block."""
    stem = "An organization has been allocated the IPv4 network 172.16.0.0/16. They need to create subnets for point-to-point links using /31 subnets. How many such subnets can be created?"
    correct_ans = "32768"
    options = ["32768", "16384", "65536", "8192"]

    valid, meta = validate_numerical_problem(stem, correct_ans, options)
    assert valid is True
    assert meta is not None
    assert meta.get("calculation") == "general_numeric"


def test_cidr_broadcast_address_calculation():
    """Tests broadcast address numerical reasoning question."""
    stem = "A router interface is configured with IP address 10.1.1.100/20. What is the broadcast address for this subnet?"
    correct_ans = "10.1.15.255"
    options = ["10.1.15.255", "10.1.31.255", "10.1.255.255", "10.1.0.255"]

    valid, meta = validate_numerical_problem(stem, correct_ans, options)
    assert valid is True
    assert meta is not None
    assert meta.get("calculation") == "general_numeric"


def test_ttl_calculation_valid_and_invalid():
    """Tests deterministic verification for TTL decrement pattern."""
    stem = "An IPv4 packet is initialized with a TTL value of 64. If the packet traverses 5 intermediate routers, what is the TTL upon arrival?"
    correct_ans = "59"
    options = ["59", "58", "60", "64"]

    valid, meta = validate_numerical_problem(stem, correct_ans, options)
    assert valid is True
    assert meta is not None
    assert meta.get("calculation") == "ttl_decrement"
    assert meta.get("expected") == 59

    # Rejects incorrect math
    invalid, _ = validate_numerical_problem(stem, "50", ["50", "58", "60", "64"])
    assert invalid is False


def test_buffer_capacity_calculation():
    """Tests bandwidth-delay or TCP buffer capacity calculation."""
    stem = "Under TCP, an endpoint advertises a receive window buffer of 32 KB. Assuming an MSS of 1460 bytes, how many full-sized segments can be sent?"
    correct_ans = "22"
    options = ["22", "21", "23", "32"]

    valid, meta = validate_numerical_problem(stem, correct_ans, options)
    assert valid is True
    assert meta is not None
    assert meta.get("calculation") == "general_numeric"


def test_rejects_missing_numeric_information():
    """Rejects questions that lack digits or numbers in options."""
    stem = "What is the numerical relationship between network prefixes and host capacity?"
    correct_ans = "Longer prefixes have fewer hosts"
    options = [
        "Longer prefixes have fewer hosts",
        "Shorter prefixes have fewer hosts",
        "Prefix length has no effect on host capacity",
        "All prefixes have identical host capacity",
    ]

    valid, _ = validate_numerical_problem(stem, correct_ans, options)
    assert valid is False


def test_rejects_duplicate_numeric_options():
    """Rejects questions with duplicate numerical options."""
    stem = "How many usable hosts exist in a /28 subnet?"
    correct_ans = "14"
    options = ["14", "14", "16", "30"]

    valid, _ = validate_numerical_problem(stem, correct_ans, options)
    assert valid is False


@pytest.mark.asyncio
async def test_batch_telemetry_recording(monkeypatch):
    """Verifies pipeline telemetry is recorded during bounded batch generation."""
    from app.curriculum import mcq_generation as mcq_mod

    # Mock generate_question to return valid mock questions immediately
    async def mock_generate_question(concept_id, concept_name, concept_summary, **kwargs):
        from app.curriculum.mcq_generation import GeneratedQuestion, QuestionOption
        q_idx = kwargs.get("question_index", 1)
        stems = [
            f"How does the handshake mechanism operate in {concept_name}?",
            f"What specific header field determines window scaling in {concept_name}?",
            f"In an enterprise deployment, how does {concept_name} prevent congestion collapse?",
        ]
        return GeneratedQuestion(
            questionId=f"{concept_id}-test-{q_idx}",
            stem=stems[(q_idx - 1) % len(stems)],
            options=[
                QuestionOption(id="a", text=f"Distinct Option A for question {q_idx}"),
                QuestionOption(id="b", text=f"Distinct Option B for question {q_idx}"),
                QuestionOption(id="c", text=f"Distinct Option C for question {q_idx}"),
                QuestionOption(id="d", text=f"Distinct Option D for question {q_idx}"),
            ],
            correctOptionId="a",
        )


    monkeypatch.setattr(mcq_mod, "generate_question", mock_generate_question)

    slots = [
        PlannedSlot(
            slot_id=i,
            concept_id="c-test",
            concept_name="TCP",
            concept_summary="TCP protocol",
            question_index=i + 1,
            total_count=3,
            angle="mechanism",
            question_format=QuestionFormat.STANDARD_MCQ,
        )
        for i in range(3)
    ]

    results = await generate_mcq_batch_bounded(slots)
    assert len(results) == 3

    telemetry = get_last_batch_telemetry()
    assert telemetry["requested_questions"] == 3
    assert telemetry["initial_llm_calls"] == 3
    assert telemetry["validation_failures"] == 0
    assert telemetry["targeted_regeneration_calls"] == 0
    assert telemetry["fallback_calls"] == 0
    assert telemetry["total_llm_calls"] == 3
    assert "duration_seconds" in telemetry
