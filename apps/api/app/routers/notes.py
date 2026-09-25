import asyncio
from datetime import datetime, timezone
import json
import logging
import re
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import (
    ClassroomRow,
    ConceptRow,
    EnrollmentRow,
    NoteRow,
    SessionLocal,
    TestRow,
    get_db,
    get_session_context,
)
from app.core.security import require_teacher, require_user
from app.curriculum.concept_service import sync_classroom_concepts
from app.curriculum.tagging import extract_concepts

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notes", tags=["notes"])

_background_tasks: set[asyncio.Task] = set()


def _safe_create_task(coro):
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


class CreateNoteRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str
    classroomId: str
    content: str | None = None
    summary: str | None = None
    sections: list[dict[str, Any]] | None = None
    conceptIds: list[str] | None = None
    published: bool = True


class UpdateNoteRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    published: bool | None = None
    title: str | None = None
    summary: str | None = None
    content: str | None = None


def parse_markdown_into_sections(
    text: str, default_title: str = ""
) -> tuple[str, str, list[dict[str, Any]]]:
    """
    Parses Markdown content into (title, summary, sections).
    Extracts top-level # title if present.
    Splits content by ## or ### headings into structured sections.
    Preserves all text, headings, lists, and code blocks.
    """
    clean_text = text.strip()
    if not clean_text:
        return default_title, "", []

    lines = clean_text.splitlines()
    first_line_idx = 0
    while first_line_idx < len(lines) and not lines[first_line_idx].strip():
        first_line_idx += 1

    extracted_title = default_title
    if first_line_idx < len(lines) and lines[first_line_idx].startswith("# "):
        title_candidate = lines[first_line_idx][2:].strip()
        if title_candidate:
            extracted_title = title_candidate
        body_lines = lines[first_line_idx + 1 :]
    else:
        body_lines = lines[first_line_idx:]

    remaining_text = "\n".join(body_lines).strip()
    if not remaining_text:
        return extracted_title, "", [{"id": "overview", "heading": "Overview", "body": ""}]

    heading_pattern = re.compile(r"(?:^|\n)(#{1,6})\s+(.+?)(?=\n|$)")
    matches = list(heading_pattern.finditer(remaining_text))

    sections: list[dict[str, Any]] = []

    if not matches:
        summary = remaining_text[:160].strip()
        if len(remaining_text) > 160:
            summary = summary.rsplit(" ", 1)[0] + "…"
        sections.append({
            "id": "overview",
            "heading": "Overview",
            "body": remaining_text,
        })
        return extracted_title, summary, sections

    first_match_start = matches[0].start()
    intro = remaining_text[:first_match_start].strip()
    if intro:
        summary = intro[:160].strip()
        if len(intro) > 160:
            summary = summary.rsplit(" ", 1)[0] + "…"
        sections.append({
            "id": "overview",
            "heading": "Overview",
            "body": intro,
        })
    else:
        summary = ""

    for i, m in enumerate(matches):
        h_text = m.group(2).strip()
        start_idx = m.end()
        end_idx = matches[i + 1].start() if i + 1 < len(matches) else len(remaining_text)
        sec_body = remaining_text[start_idx:end_idx].strip()

        slug = re.sub(r"[^a-z0-9]+", "-", h_text.lower()).strip("-")
        sec_id = f"s-{slug}" if slug else f"s-{i+1}"

        if not summary and sec_body:
            summary = sec_body[:160].strip()
            if len(sec_body) > 160:
                summary = summary.rsplit(" ", 1)[0] + "…"

        sections.append({
            "id": sec_id,
            "heading": h_text,
            "body": sec_body,
        })

    return extracted_title, summary, sections


def _format_note(n: NoteRow) -> dict[str, Any]:
    try:
        sections = json.loads(n.sections) if n.sections else []
        if not isinstance(sections, list):
            sections = []
    except Exception:
        sections = []
    try:
        concept_ids = json.loads(n.concept_ids) if n.concept_ids else []
        if not isinstance(concept_ids, list):
            concept_ids = []
    except Exception:
        concept_ids = []

    content = getattr(n, "content", None)
    if not content and sections:
        content_parts = []
        for s in sections:
            h = s.get("heading")
            b = s.get("body", "")
            if h and h.lower() != "overview":
                content_parts.append(f"## {h}\n\n{b}")
            else:
                content_parts.append(b)
        content = "\n\n".join(content_parts)

    return {
        "id": n.id,
        "title": n.title,
        "classroomId": n.classroom_id,
        "published": bool(n.published),
        "status": getattr(n, "status", None) or "READY",
        "summary": n.summary or "",
        "content": content or "",
        "updated": n.updated_at.strftime("%b %d") if n.updated_at else "Recently",
        "sections": sections,
        "conceptIds": concept_ids,
    }


async def _run_concept_extraction(
    note_id: str,
    classroom_id: str,
    source_text: str,
    title: str,
) -> None:
    try:
        proposals = await extract_concepts(source_text, title=title)
        async with get_session_context() as bg_db:
            note = await bg_db.scalar(select(NoteRow).where(NoteRow.id == note_id))
            if not note:
                return

            concept_ids = []
            if proposals:
                concept_ids = await sync_classroom_concepts(classroom_id, proposals, bg_db)

            # Re-link sections if needed
            sections = []
            try:
                sections = json.loads(note.sections) if note.sections else []
            except Exception:
                sections = []

            if concept_ids and sections:
                for s in sections:
                    if not s.get("conceptId"):
                        s["conceptId"] = concept_ids[0]
                note.sections = json.dumps(sections)

            note.concept_ids = json.dumps(concept_ids)
            note.status = "READY"
            note.updated_at = datetime.now(timezone.utc)
            await bg_db.commit()
    except Exception as exc:
        logger.exception("Concept extraction failed for note %s: %s", note_id, exc)
        try:
            async with get_session_context() as bg_db:
                note = await bg_db.scalar(select(NoteRow).where(NoteRow.id == note_id))
                if note:
                    note.status = "FAILED"
                    note.updated_at = datetime.now(timezone.utc)
                    await bg_db.commit()
        except Exception:
            pass


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_note(
    req: CreateNoteRequest,
    teacher_id: str = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    classroom = await db.scalar(
        select(ClassroomRow).where(ClassroomRow.id == req.classroomId)
    )
    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")
    if classroom.teacher_id != teacher_id:
        raise HTTPException(status_code=403, detail="Forbidden: You do not own this classroom")

    raw_text = (req.content or "").strip()
    sections = req.sections or []
    summary = req.summary or ""
    title = req.title.strip()

    # If raw content is provided and either sections are empty or single overview, parse markdown!
    if raw_text and (not sections or len(sections) <= 1):
        parsed_title, parsed_summary, parsed_sections = parse_markdown_into_sections(
            raw_text, default_title=title
        )
        if not title:
            title = parsed_title
        if not summary:
            summary = parsed_summary
        if parsed_sections:
            sections = parsed_sections
    elif sections and not raw_text:
        # Reconstruct content from sections
        content_parts = []
        for s in sections:
            h = s.get("heading", "").strip()
            b = s.get("body", "").strip()
            if h and h.lower() != "overview":
                content_parts.append(f"## {h}\n\n{b}")
            elif b:
                content_parts.append(b)
        raw_text = "\n\n".join(content_parts)

    concept_ids = list(req.conceptIds or [])
    needs_extraction = not concept_ids

    # If sections exist and conceptIds was supplied, link them
    if concept_ids and sections:
        for s in sections:
            if not s.get("conceptId"):
                s["conceptId"] = concept_ids[0]

    note_status = "PROCESSING" if needs_extraction else "READY"
    note_id = f"n-{uuid.uuid4().hex[:8]}"
    note = NoteRow(
        id=note_id,
        title=title,
        classroom_id=req.classroomId,
        published=req.published,
        status=note_status,
        summary=summary,
        content=raw_text,
        sections=json.dumps(sections),
        concept_ids=json.dumps(concept_ids),
    )
    db.add(note)
    await db.commit()
    await db.refresh(note)

    if req.published:
        from app.routers.notifications import create_classroom_notifications
        await create_classroom_notifications(
            db=db,
            classroom_id=req.classroomId,
            notif_type="new_note",
            title="New note added",
            message=f"“{note.title}” was added to {classroom.name}.",
            related_entity_type="note",
            related_entity_id=note.id,
        )

    if needs_extraction:
        source_text = raw_text
        if not source_text:
            body_parts = []
            if summary:
                body_parts.append(summary)
            for s in sections:
                heading = s.get("heading", "").strip()
                body = s.get("body", "").strip()
                if heading and body:
                    body_parts.append(f"## {heading}\n{body}")
                elif heading or body:
                    body_parts.append(heading or body)
            source_text = "\n\n".join(body_parts)

        _safe_create_task(
            _run_concept_extraction(note.id, req.classroomId, source_text, title)
        )

    return _format_note(note)


@router.post("/{note_id}/retry")
async def retry_note_extraction(
    note_id: str,
    teacher_id: str = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    note = await db.scalar(select(NoteRow).where(NoteRow.id == note_id))
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    classroom = await db.scalar(select(ClassroomRow).where(ClassroomRow.id == note.classroom_id))
    if not classroom or classroom.teacher_id != teacher_id:
        raise HTTPException(status_code=403, detail="Forbidden: You do not own this note")

    note.status = "PROCESSING"
    note.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(note)

    source_text = note.content or note.summary or note.title
    _safe_create_task(
        _run_concept_extraction(note.id, note.classroom_id, source_text, note.title)
    )
    return _format_note(note)


@router.get("")
async def list_notes(
    classroomId: str | None = Query(default=None),
    token_payload: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    role = token_payload.get("role", "teacher")
    user_id = token_payload.get("sub", "")

    if role == "teacher":
        allowed_classes = (
            await db.scalars(
                select(ClassroomRow.id).where(ClassroomRow.teacher_id == user_id)
            )
        ).all()
        if not allowed_classes:
            return []
        query = select(NoteRow).where(NoteRow.classroom_id.in_(allowed_classes))
    else:
        enrolled_classes = (
            await db.scalars(
                select(EnrollmentRow.classroom_id).where(EnrollmentRow.student_id == user_id)
            )
        ).all()
        if not enrolled_classes:
            return []
        query = select(NoteRow).where(
            NoteRow.classroom_id.in_(enrolled_classes),
            NoteRow.published == True,  # noqa: E712
        )

    if classroomId:
        query = query.where(NoteRow.classroom_id == classroomId)

    rows = (await db.scalars(query)).all()
    return [_format_note(r) for r in rows]


@router.get("/{note_id}")
async def get_note(
    note_id: str,
    token_payload: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    note = await db.scalar(select(NoteRow).where(NoteRow.id == note_id))
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    user_id = token_payload.get("sub", "")
    role = token_payload.get("role", "teacher")

    if role == "teacher":
        classroom = await db.scalar(
            select(ClassroomRow).where(ClassroomRow.id == note.classroom_id)
        )
        if not classroom or classroom.teacher_id != user_id:
            raise HTTPException(status_code=403, detail="Forbidden: You do not own this note")
    else:
        if not note.published:
            raise HTTPException(status_code=404, detail="Note not found")
        enrolled = await db.scalar(
            select(EnrollmentRow).where(
                EnrollmentRow.classroom_id == note.classroom_id,
                EnrollmentRow.student_id == user_id,
            )
        )
        if not enrolled:
            raise HTTPException(status_code=403, detail="Forbidden: You are not enrolled in this classroom")

    return _format_note(note)


@router.patch("/{note_id}")
async def update_note(
    note_id: str,
    req: UpdateNoteRequest,
    teacher_id: str = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    note = await db.scalar(select(NoteRow).where(NoteRow.id == note_id))
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    classroom = await db.scalar(
        select(ClassroomRow).where(ClassroomRow.id == note.classroom_id)
    )
    if not classroom or classroom.teacher_id != teacher_id:
        raise HTTPException(status_code=403, detail="Forbidden: You do not own this note")

    was_published = bool(note.published)
    if req.published is not None:
        note.published = req.published
    if req.title is not None:
        note.title = req.title.strip()
    if req.summary is not None:
        note.summary = req.summary
    if req.content is not None:
        note.content = req.content

    await db.commit()
    await db.refresh(note)

    if req.published is True and not was_published:
        from app.routers.notifications import create_classroom_notifications
        await create_classroom_notifications(
            db=db,
            classroom_id=note.classroom_id,
            notif_type="new_note",
            title="New note added",
            message=f"“{note.title}” was added to {classroom.name}.",
            related_entity_type="note",
            related_entity_id=note.id,
        )

    return _format_note(note)


async def delete_note_internal(
    note_id: str,
    teacher_id: str,
    db: AsyncSession,
    expected_classroom_id: str | None = None,
) -> dict[str, Any]:
    note = await db.scalar(select(NoteRow).where(NoteRow.id == note_id))
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    if expected_classroom_id and note.classroom_id != expected_classroom_id:
        raise HTTPException(
            status_code=404, detail="Note does not belong to specified classroom"
        )

    classroom = await db.scalar(
        select(ClassroomRow).where(ClassroomRow.id == note.classroom_id)
    )
    if not classroom or classroom.teacher_id != teacher_id:
        raise HTTPException(status_code=403, detail="Forbidden: You do not own this note")

    # 1. Parse concept IDs in this note
    try:
        note_concept_ids = set(json.loads(note.concept_ids or "[]"))
    except Exception:
        note_concept_ids = set()

    # 2. Check all remaining notes in the classroom
    other_notes = (
        await db.scalars(
            select(NoteRow).where(
                NoteRow.classroom_id == note.classroom_id,
                NoteRow.id != note_id,
            )
        )
    ).all()
    other_note_cids: set[str] = set()
    for on in other_notes:
        try:
            for cid in json.loads(on.concept_ids or "[]"):
                if cid:
                    other_note_cids.add(str(cid))
        except Exception:
            pass

    # 3. Check all tests in the classroom
    tests = (
        await db.scalars(
            select(TestRow).where(TestRow.classroom_id == note.classroom_id)
        )
    ).all()
    test_cids: set[str] = set()
    for t in tests:
        if t.concept_ids:
            try:
                for cid in json.loads(t.concept_ids):
                    if cid:
                        test_cids.add(str(cid))
            except Exception:
                pass
        if t.questions:
            try:
                for q in json.loads(t.questions):
                    if isinstance(q, dict) and q.get("conceptId"):
                        test_cids.add(str(q["conceptId"]))
            except Exception:
                pass

    active_cids = other_note_cids | test_cids
    orphaned_cids = note_concept_ids - active_cids

    # 4. Remove orphaned ConceptRows from the classroom curriculum
    # Note: Historical assessment records (AnalysisPayloadRow, SubmissionRow) are preserved.
    if orphaned_cids:
        orphaned_rows = (
            await db.scalars(
                select(ConceptRow).where(
                    ConceptRow.classroom_id == note.classroom_id,
                    ConceptRow.id.in_(orphaned_cids),
                )
            )
        ).all()
        for orow in orphaned_rows:
            await db.delete(orow)

        # In remaining ConceptRows, remove orphaned_cids from related_concept_ids
        remaining_concepts = (
            await db.scalars(
                select(ConceptRow).where(
                    ConceptRow.classroom_id == note.classroom_id,
                    ~ConceptRow.id.in_(orphaned_cids),
                )
            )
        ).all()
        for rc in remaining_concepts:
            try:
                rels = json.loads(rc.related_concept_ids or "[]")
                new_rels = [r for r in rels if r not in orphaned_cids]
                if len(new_rels) != len(rels):
                    rc.related_concept_ids = json.dumps(new_rels)
            except Exception:
                pass

    # 5. Delete the note
    await db.delete(note)
    await db.commit()

    return {
        "status": "deleted",
        "id": note_id,
        "classroomId": note.classroom_id,
        "reconciledConcepts": sorted(list(orphaned_cids)),
    }


@router.delete("/{note_id}")
async def delete_note(
    note_id: str,
    teacher_id: str = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    return await delete_note_internal(note_id, teacher_id, db)
