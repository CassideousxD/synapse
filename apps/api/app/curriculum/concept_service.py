import json
import re
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import ConceptRow
from app.curriculum.tagging import ProposedConcept


def normalize_concept_name(name: str) -> str:
    """Canonical representation of a concept name for deduplication."""
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9\s]", "", name.strip().lower())).strip()


async def sync_classroom_concepts(
    classroom_id: str,
    proposals: list[ProposedConcept],
    db: AsyncSession,
) -> list[str]:
    """
    Deduplicates proposed concepts against existing concepts in the classroom,
    persists new concepts into the database, updates relationships, and returns
    the list of concept IDs corresponding to the proposals.
    """
    if not proposals:
        return []

    # 1. Fetch existing concepts for this classroom
    existing_rows = (
        await db.scalars(
            select(ConceptRow).where(ConceptRow.classroom_id == classroom_id)
        )
    ).all()
    concept_by_norm: dict[str, ConceptRow] = {
        row.normalized_name: row for row in existing_rows
    }

    # 2. Map proposals to concept IDs
    id_by_name: dict[str, str] = {}
    resolved_ids: list[str] = []

    for p in proposals:
        name_clean = p.name.strip()
        if not name_clean:
            continue
        norm = normalize_concept_name(name_clean)
        if not norm:
            continue

        if norm in concept_by_norm:
            # Deduplicated: concept already exists in this classroom!
            existing_row = concept_by_norm[norm]
            concept_id = existing_row.id
            if p.summary and len(p.summary) > len(existing_row.description or ""):
                existing_row.description = p.summary
        else:
            slug = re.sub(r"[^a-z0-9]+", "-", norm).strip("-")[:20]
            concept_id = f"c-{slug}-{uuid.uuid4().hex[:6]}"
            new_row = ConceptRow(
                id=concept_id,
                classroom_id=classroom_id,
                name=name_clean,
                normalized_name=norm,
                description=p.summary or "",
                related_concept_ids="[]",
            )
            db.add(new_row)
            concept_by_norm[norm] = new_row

        id_by_name[p.name] = concept_id
        if concept_id not in resolved_ids:
            resolved_ids.append(concept_id)

    # 3. Update relationships across proposals
    for p in proposals:
        norm = normalize_concept_name(p.name)
        row = concept_by_norm.get(norm)
        if not row:
            continue

        try:
            curr_rels = set(json.loads(row.related_concept_ids or "[]"))
        except Exception:
            curr_rels = set()

        for rel_name in p.relatedNames:
            rel_norm = normalize_concept_name(rel_name)
            if rel_norm in concept_by_norm and rel_norm != norm:
                curr_rels.add(concept_by_norm[rel_norm].id)

        row.related_concept_ids = json.dumps(sorted(list(curr_rels)))

    await db.flush()
    return resolved_ids


def format_concept_row(row: ConceptRow) -> dict[str, Any]:
    try:
        related = json.loads(row.related_concept_ids) if row.related_concept_ids else []
    except Exception:
        related = []

    return {
        "id": row.id,
        "classroomId": row.classroom_id,
        "name": row.name,
        "summary": row.description or "",
        "description": row.description or "",
        "relatedConceptIds": related,
    }
