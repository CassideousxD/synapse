from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.llm.client import call_nim
from app.llm.json_utils import call_json


class ProposedConcept(BaseModel):
    """
    Not yet a real ConceptNode — no id, because nothing exists to assign one
    to until a teacher confirms it. relatedNames references other concepts
    BY NAME within the same batch (there are no ids yet to reference).
    """

    model_config = ConfigDict(extra="forbid")
    name: str
    summary: str
    relatedNames: list[str] = Field(default_factory=list)


class ConceptTaggingResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    concepts: list[ProposedConcept] = Field(min_length=1)


def _relations_are_internally_consistent(result: ConceptTaggingResult) -> list[str]:
    names = {c.name for c in result.concepts}
    errors: list[str] = []
    for c in result.concepts:
        for rel in c.relatedNames:
            if rel == c.name:
                errors.append(f"concept '{c.name}' lists itself in relatedNames")
            elif rel not in names:
                errors.append(f"concept '{c.name}' has relatedNames entry '{rel}' which is not one of the proposed concept names {sorted(names)}")
    return errors


def _prompt(source_text: str, max_concepts: int) -> list[dict]:
    system = (
        f"You break down teaching material into up to {max_concepts} distinct, testable concepts. "
        "Reply with ONLY a JSON object: "
        '{"concepts": [{"name": string, "summary": string, "relatedNames": [string, ...]}, ...]}. '
        "relatedNames lists OTHER concept names from this SAME list that are prerequisites or closely "
        "related — never a concept's own name, never a name not in this list. summary should be 1-2 "
        "sentences a student's note could open with. No prose outside the JSON, no code fences."
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": source_text}]


async def generate_concepts(
    source_text: str,
    *,
    max_concepts: int = 8,
    tier: str = "main",
    max_repairs: int = 1,
) -> list[ProposedConcept]:
    async def call_llm(tier: str, messages: list[dict], temperature: float | None, max_tokens: int | None) -> dict:
        return await call_nim(tier, messages, temperature, max_tokens)

    result = await call_json(
        call_llm,
        tier,
        _prompt(source_text, max_concepts),
        ConceptTaggingResult,
        max_repairs=max_repairs,
        extra_check=_relations_are_internally_consistent,
    )
    return result.concepts


def resolve_concept_ids(proposals: list[ProposedConcept]) -> list[dict]:
    """
    Pure, no LLM: the "teacher confirmation" step calls this with whatever
    subset/edits of the proposals the teacher approved. Assigns real ids and
    resolves relatedNames -> relatedConceptIds, producing real ConceptNode-
    shaped dicts (matching contracts/schemas/concept-node.schema.json).
    A relatedNames entry pointing at a concept the teacher DIDN'T keep is
    silently dropped, not an error — the teacher trimming the list is expected.
    """
    id_by_name = {p.name: f"concept-{uuid.uuid4().hex[:8]}" for p in proposals}
    nodes = []
    for p in proposals:
        nodes.append(
            {
                "id": id_by_name[p.name],
                "name": p.name,
                "summary": p.summary,
                "relatedConceptIds": [id_by_name[n] for n in p.relatedNames if n in id_by_name],
            }
        )
    return nodes


def extract_fallback_concepts(source_text: str, title: str = "", max_concepts: int = 6) -> list[ProposedConcept]:
    """
    Deterministic rule-based extractor when LLM is unavailable or fails.
    Extracts distinct concept topics from title, markdown headings, bold terms,
    and bullet points.
    """
    import re

    candidates: list[tuple[str, str]] = []
    seen_names = set()

    def add_candidate(raw_name: str, raw_summary: str):
        cleaned_name = re.sub(r"^[#*\-\d.\s]+", "", raw_name).strip()
        cleaned_name = re.sub(r"[:_]+$", "", cleaned_name).strip()
        if not cleaned_name or len(cleaned_name) < 3 or len(cleaned_name) > 60:
            return
        if cleaned_name.lower() in {
            "overview",
            "introduction",
            "summary",
            "conclusion",
            "notes",
            "lecture notes",
            "table of contents",
            "references",
        }:
            return
        norm = cleaned_name.lower()
        if norm in seen_names:
            return
        seen_names.add(norm)
        cleaned_summary = raw_summary.strip()
        if not cleaned_summary:
            cleaned_summary = f"Core concept covering {cleaned_name}."
        elif len(cleaned_summary) > 200:
            cleaned_summary = cleaned_summary[:197] + "..."
        candidates.append((cleaned_name, cleaned_summary))

    # 1. Heading patterns in source_text (e.g. ## Binary Trees)
    heading_pattern = re.compile(r"^(?:#{1,4})\s+(.+)$", re.MULTILINE)
    for m in heading_pattern.findall(source_text):
        add_candidate(m, f"Key topic on {m.strip()}.")

    # 2. Bullet / colon definitions
    bullet_pattern = re.compile(
        r"^[*\-]\s*(?:\*\*)?([A-Za-z0-9\s\-]{3,40}?)(?:\*\*)?\s*:\s*(.+)$",
        re.MULTILINE,
    )
    for m in bullet_pattern.finditer(source_text):
        c_name = m.group(1).strip()
        c_summary = m.group(2).strip()
        add_candidate(c_name, c_summary)

    # 3. Explicit definitions: "A Binary Search Tree is..."
    if len(candidates) < max_concepts and source_text:
        def_pattern = re.compile(
            r"\b([A-Z][A-Za-z0-9\s\-]{2,35})\s+(?:is an?|refers to|represents)\s+([^.\n]+)",
            re.MULTILINE,
        )
        for m in def_pattern.finditer(source_text):
            c_name = m.group(1).strip()
            c_summary = f"{c_name} is {m.group(2).strip()}."
            add_candidate(c_name, c_summary)

    # 4. If still few candidates, inspect title
    if len(candidates) < 2 and title:
        subtitles = re.split(r"[:\-|&]|\band\b", title)
        for sub in subtitles:
            sub = sub.strip()
            if sub:
                add_candidate(sub, f"Fundamental principles of {sub}.")

    if not candidates:
        fallback_name = title.strip() or "General Concepts"
        candidates.append((fallback_name, f"Foundational concepts in {fallback_name}."))

    limited = candidates[:max_concepts]
    names = [c[0] for c in limited]

    proposals = []
    for name, summary in limited:
        related = [n for n in names if n != name]
        proposals.append(ProposedConcept(name=name, summary=summary, relatedNames=related))

    return proposals


async def extract_concepts(
    source_text: str,
    *,
    title: str = "",
    max_concepts: int = 8,
    tier: str = "main",
) -> list[ProposedConcept]:
    """
    Extracts concepts using NIM LLM when configured, falling back smoothly
    to deterministic rule-based extraction if LLM is unavailable or fails.
    """
    combined = f"{title}\n\n{source_text}".strip()
    try:
        concepts = await generate_concepts(combined, max_concepts=max_concepts, tier=tier)
        if concepts:
            return concepts
    except Exception:
        pass
    return extract_fallback_concepts(source_text, title=title, max_concepts=max_concepts)