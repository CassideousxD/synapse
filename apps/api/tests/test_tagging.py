import pytest

from app.curriculum.tagging import ProposedConcept, generate_concepts, resolve_concept_ids

VALID_JSON = (
    '{"concepts":['
    '{"name":"Photosynthesis","summary":"Plants convert light to chemical energy.","relatedNames":["Cellular Respiration"]},'
    '{"name":"Cellular Respiration","summary":"Cells convert glucose to ATP.","relatedNames":["Photosynthesis"]}'
    "]}"
)


def _fake_call_nim(*responses):
    calls = []

    async def call_nim(tier, messages, temperature, max_tokens):
        calls.append({"tier": tier, "messages": messages})
        return {"content": responses[len(calls) - 1], "model": "fake-model", "usage": None}

    return call_nim, calls


async def test_generates_concepts_with_valid_cross_references(monkeypatch):
    fake, calls = _fake_call_nim(VALID_JSON)
    monkeypatch.setattr("app.curriculum.tagging.call_nim", fake)

    concepts = await generate_concepts("Photosynthesis and cellular respiration in plant biology")
    assert len(concepts) == 2
    assert concepts[0].name == "Photosynthesis"
    assert concepts[0].relatedNames == ["Cellular Respiration"]
    assert len(calls) == 1


async def test_repairs_when_concept_references_itself(monkeypatch):
    bad = '{"concepts":[{"name":"A","summary":"s","relatedNames":["A"]}]}'
    fake, calls = _fake_call_nim(bad, VALID_JSON)
    monkeypatch.setattr("app.curriculum.tagging.call_nim", fake)

    concepts = await generate_concepts("some text")
    assert len(concepts) == 2
    assert "lists itself" in calls[1]["messages"][-1]["content"]


async def test_repairs_when_related_name_is_unknown(monkeypatch):
    bad = '{"concepts":[{"name":"A","summary":"s","relatedNames":["Nonexistent Concept"]}]}'
    fake, calls = _fake_call_nim(bad, VALID_JSON)
    monkeypatch.setattr("app.curriculum.tagging.call_nim", fake)

    await generate_concepts("some text")
    assert "not one of the proposed concept names" in calls[1]["messages"][-1]["content"]


async def test_rejects_empty_concept_list(monkeypatch):
    empty = '{"concepts":[]}'
    fake, calls = _fake_call_nim(empty, VALID_JSON)
    monkeypatch.setattr("app.curriculum.tagging.call_nim", fake)

    concepts = await generate_concepts("some text")
    assert len(concepts) == 2


def test_resolve_concept_ids_assigns_real_ids_and_resolves_names():
    proposals = [
        ProposedConcept(name="Photosynthesis", summary="s1", relatedNames=["Cellular Respiration"]),
        ProposedConcept(name="Cellular Respiration", summary="s2", relatedNames=["Photosynthesis"]),
    ]
    nodes = resolve_concept_ids(proposals)

    assert len(nodes) == 2
    by_name = {n["name"]: n for n in nodes}
    assert by_name["Photosynthesis"]["id"] != by_name["Cellular Respiration"]["id"]
    assert by_name["Photosynthesis"]["relatedConceptIds"] == [by_name["Cellular Respiration"]["id"]]
    assert set(nodes[0].keys()) == {"id", "name", "summary", "relatedConceptIds"}


def test_resolve_concept_ids_drops_links_to_concepts_teacher_removed():
    proposals = [ProposedConcept(name="Photosynthesis", summary="s1", relatedNames=["Cellular Respiration"])]
    nodes = resolve_concept_ids(proposals)
    assert nodes[0]["relatedConceptIds"] == []


async def test_rejects_extra_field_from_model():
    from app.curriculum.tagging import ConceptTaggingResult
    with pytest.raises(Exception):
        ConceptTaggingResult.model_validate({"concepts": [], "extra": "nope"})