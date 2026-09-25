from datetime import datetime, timezone
import json
import secrets
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import (
    AnalysisPayloadRow,
    ClassroomRow,
    ConceptRow,
    EnrollmentRow,
    NoteRow,
    NotificationRow,
    SubmissionRow,
    TestRow,
    UserRow,
    get_db,
)
from app.core.security import require_teacher, require_user
from app.curriculum.concept_service import format_concept_row

router = APIRouter(prefix="/classrooms", tags=["classrooms"])


class CreateClassroomRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    subject: str = "Computer Science"
    description: str | None = None


class JoinClassroomRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    joinCode: str


def _gen_join_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(6))


async def _get_classroom_concept_ids(classroom_id: str, db: AsyncSession) -> set[str]:
    concept_rows = (
        await db.scalars(select(ConceptRow.id).where(ConceptRow.classroom_id == classroom_id))
    ).all()
    note_concept_rows = (
        await db.scalars(select(NoteRow.concept_ids).where(NoteRow.classroom_id == classroom_id))
    ).all()
    test_rows = (
        await db.scalars(select(TestRow).where(TestRow.classroom_id == classroom_id))
    ).all()

    cids: set[str] = set()
    for cid in concept_rows:
        if cid:
            cids.add(str(cid))
    for row in note_concept_rows:
        if row:
            try:
                parsed = json.loads(row)
                if isinstance(parsed, list):
                    for cid in parsed:
                        if cid:
                            cids.add(str(cid))
            except Exception:
                pass
    for t in test_rows:
        if t.concept_ids:
            try:
                parsed = json.loads(t.concept_ids)
                if isinstance(parsed, list):
                    for cid in parsed:
                        if cid:
                            cids.add(str(cid))
            except Exception:
                pass
        if t.questions:
            try:
                parsed_q = json.loads(t.questions)
                if isinstance(parsed_q, list):
                    for q in parsed_q:
                        if isinstance(q, dict) and q.get("conceptId"):
                            cids.add(str(q["conceptId"]))
            except Exception:
                pass
    return cids


async def _format_classroom(c: ClassroomRow, db: AsyncSession) -> dict[str, Any]:
    enrolled = (
        await db.scalars(
            select(EnrollmentRow.student_id).where(EnrollmentRow.classroom_id == c.id)
        )
    ).all()
    tests_count = len(
        (
            await db.scalars(select(TestRow.id).where(TestRow.classroom_id == c.id))
        ).all()
    )
    notes_count = len(
        (
            await db.scalars(select(NoteRow.id).where(NoteRow.classroom_id == c.id))
        ).all()
    )
    concept_ids = await _get_classroom_concept_ids(c.id, db)

    return {
        "id": c.id,
        "name": c.name,
        "subject": c.subject,
        "joinCode": c.join_code,
        "teacherId": c.teacher_id,
        "description": c.description or "",
        "studentIds": list(enrolled),
        "conceptIds": sorted(list(concept_ids)),
        "activity": [],
        "testsCount": tests_count,
        "notesCount": notes_count,
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_classroom(
    req: CreateClassroomRequest,
    teacher_id: str = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Classroom name cannot be empty")

    for _ in range(10):
        code = _gen_join_code()
        existing = await db.scalar(select(ClassroomRow).where(ClassroomRow.join_code == code))
        if not existing:
            break
    else:
        code = _gen_join_code()

    cid = f"c-{uuid.uuid4().hex[:8]}"
    classroom = ClassroomRow(
        id=cid,
        name=name,
        subject=req.subject.strip(),
        join_code=code,
        teacher_id=teacher_id,
        description=req.description or "A newly created classroom.",
    )
    db.add(classroom)
    await db.commit()
    await db.refresh(classroom)

    return await _format_classroom(classroom, db)


@router.get("")
async def list_classrooms(
    token_payload: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    role = token_payload.get("role", "teacher")
    user_id = token_payload.get("sub", "")

    if role == "teacher":
        rows = (
            await db.scalars(
                select(ClassroomRow).where(ClassroomRow.teacher_id == user_id)
            )
        ).all()
    else:
        enrolled_class_ids = (
            await db.scalars(
                select(EnrollmentRow.classroom_id).where(EnrollmentRow.student_id == user_id)
            )
        ).all()
        rows = (
            await db.scalars(
                select(ClassroomRow).where(ClassroomRow.id.in_(enrolled_class_ids))
            )
        ).all()

    return [await _format_classroom(r, db) for r in rows]


@router.get("/enrolled/concepts")
async def list_enrolled_concepts(
    token_payload: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = token_payload.get("sub", "")
    enrolled_class_ids = (
        await db.scalars(
            select(EnrollmentRow.classroom_id).where(EnrollmentRow.student_id == user_id)
        )
    ).all()
    if not enrolled_class_ids:
        return []

    classrooms = (
        await db.scalars(
            select(ClassroomRow).where(ClassroomRow.id.in_(enrolled_class_ids))
        )
    ).all()
    class_map = {c.id: c.name for c in classrooms}

    rows = (
        await db.scalars(
            select(ConceptRow)
            .where(ConceptRow.classroom_id.in_(enrolled_class_ids))
            .order_by(ConceptRow.created_at.asc())
        )
    ).all()

    seen_ids = set()
    result = []
    for r in rows:
        if r.id in seen_ids:
            continue
        seen_ids.add(r.id)
        f = format_concept_row(r)
        f["classroomName"] = class_map.get(r.classroom_id, "Classroom")
        result.append(f)
    return result


@router.get("/{classroom_id}/concepts")
async def list_classroom_concepts(
    classroom_id: str,
    token_payload: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    classroom = await db.scalar(
        select(ClassroomRow).where(ClassroomRow.id == classroom_id)
    )
    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")

    user_id = token_payload.get("sub", "")
    role = token_payload.get("role", "teacher")
    if role == "teacher":
        if classroom.teacher_id != user_id:
            raise HTTPException(status_code=403, detail="Forbidden: You do not own this classroom")
    else:
        enrolled = await db.scalar(
            select(EnrollmentRow).where(
                EnrollmentRow.classroom_id == classroom_id,
                EnrollmentRow.student_id == user_id,
            )
        )
        if not enrolled:
            raise HTTPException(status_code=403, detail="Forbidden: You are not enrolled in this classroom")

    rows = (
        await db.scalars(
            select(ConceptRow)
            .where(ConceptRow.classroom_id == classroom_id)
            .order_by(ConceptRow.created_at.asc())
        )
    ).all()
    return [format_concept_row(r) for r in rows]


@router.get("/{classroom_id}")
async def get_classroom(
    classroom_id: str,
    token_payload: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    classroom = await db.scalar(
        select(ClassroomRow).where(ClassroomRow.id == classroom_id)
    )
    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")

    user_id = token_payload.get("sub", "")
    role = token_payload.get("role", "teacher")
    if role == "teacher":
        if classroom.teacher_id != user_id:
            raise HTTPException(status_code=403, detail="Forbidden: You do not own this classroom")
    else:
        enrolled = await db.scalar(
            select(EnrollmentRow).where(
                EnrollmentRow.classroom_id == classroom_id,
                EnrollmentRow.student_id == user_id,
            )
        )
        if not enrolled:
            raise HTTPException(status_code=403, detail="Forbidden: You are not enrolled in this classroom")

    return await _format_classroom(classroom, db)


@router.post("/join")
async def join_classroom(
    req: JoinClassroomRequest,
    token_payload: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    student_id = token_payload.get("sub", "")
    code = req.joinCode.strip().upper()

    classroom = await db.scalar(select(ClassroomRow).where(ClassroomRow.join_code == code))
    if not classroom:
        raise HTTPException(
            status_code=404,
            detail="That code doesn't match any classroom. Check with your teacher.",
        )

    already = await db.scalar(
        select(EnrollmentRow).where(
            EnrollmentRow.classroom_id == classroom.id,
            EnrollmentRow.student_id == student_id,
        )
    )
    if already:
        raise HTTPException(
            status_code=400,
            detail=f"You're already enrolled in {classroom.name}.",
        )

    enrollment = EnrollmentRow(
        id=f"e-{uuid.uuid4().hex[:10]}",
        classroom_id=classroom.id,
        student_id=student_id,
    )
    db.add(enrollment)

    # Notify teacher of new enrollment
    student_user = await db.scalar(select(UserRow).where(UserRow.id == student_id))
    student_name = student_user.name if student_user else "A student"
    notif = NotificationRow(
        id=f"notif-{uuid.uuid4().hex[:10]}",
        recipient_id=classroom.teacher_id,
        classroom_id=classroom.id,
        type="student_joined",
        title="Student joined classroom",
        message=f"{student_name} joined {classroom.name}.",
        related_entity_type="classroom",
        related_entity_id=classroom.id,
        created_at=datetime.now(timezone.utc),
    )
    db.add(notif)

    await db.commit()

    return {
        "ok": True,
        "classroom": await _format_classroom(classroom, db),
    }


@router.get("/{classroom_id}/students")
@router.get("/{classroom_id}/roster")
async def list_classroom_students(
    classroom_id: str,
    teacher_id: str = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    classroom = await db.scalar(
        select(ClassroomRow).where(ClassroomRow.id == classroom_id)
    )
    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")
    if classroom.teacher_id != teacher_id:
        raise HTTPException(status_code=403, detail="Forbidden: You do not own this classroom")

    student_ids = (
        await db.scalars(
            select(EnrollmentRow.student_id).where(EnrollmentRow.classroom_id == classroom_id)
        )
    ).all()

    if not student_ids:
        return []

    students = (
        await db.scalars(select(UserRow).where(UserRow.id.in_(student_ids)))
    ).all()

    return [
        {
            "id": s.id,
            "name": s.name,
            "email": s.email,
            "role": s.role,
        }
        for s in students
    ]


@router.delete("/{classroom_id}/membership", status_code=status.HTTP_200_OK)
@router.delete("/{classroom_id}/students/me", status_code=status.HTTP_200_OK)
async def leave_classroom(
    classroom_id: str,
    token_payload: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    role = token_payload.get("role", "")
    if role != "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Only students can leave a classroom",
        )
    student_id = token_payload.get("sub", "")

    classroom = await db.scalar(
        select(ClassroomRow).where(ClassroomRow.id == classroom_id)
    )
    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")

    enrollment = await db.scalar(
        select(EnrollmentRow).where(
            EnrollmentRow.classroom_id == classroom_id,
            EnrollmentRow.student_id == student_id,
        )
    )
    if not enrollment:
        raise HTTPException(
            status_code=404,
            detail="You are not enrolled in this classroom",
        )

    # 1. Identify all tests belonging to this classroom
    class_test_ids = (
        await db.scalars(
            select(TestRow.id).where(TestRow.classroom_id == classroom_id)
        )
    ).all()

    # 2. Delete student's submissions for tests in this classroom
    if class_test_ids:
        subs_to_delete = (
            await db.scalars(
                select(SubmissionRow).where(
                    SubmissionRow.student_id == student_id,
                    SubmissionRow.test_id.in_(class_test_ids),
                )
            )
        ).all()
        for sub in subs_to_delete:
            await db.delete(sub)

    # 3. Concepts and mastery cleanup
    class_cids = await _get_classroom_concept_ids(classroom_id, db)

    # Find remaining classrooms the student is enrolled in
    remaining_class_ids = (
        await db.scalars(
            select(EnrollmentRow.classroom_id).where(
                EnrollmentRow.student_id == student_id,
                EnrollmentRow.classroom_id != classroom_id,
            )
        )
    ).all()

    if not remaining_class_ids:
        # Student has no remaining classes -> clear ALL analysis / mastery payloads for this student
        all_payloads = (
            await db.scalars(
                select(AnalysisPayloadRow).where(
                    AnalysisPayloadRow.student_id == student_id
                )
            )
        ).all()
        for p in all_payloads:
            await db.delete(p)
    else:
        # Check which tests in remaining classrooms have been completed by this student
        remaining_test_ids = (
            await db.scalars(
                select(TestRow.id).where(TestRow.classroom_id.in_(remaining_class_ids))
            )
        ).all()
        remaining_tested_cids: set[str] = set()
        if remaining_test_ids:
            remaining_submissions = (
                await db.scalars(
                    select(SubmissionRow).where(
                        SubmissionRow.student_id == student_id,
                        SubmissionRow.test_id.in_(remaining_test_ids),
                    )
                )
            ).all()

            if remaining_submissions:
                sub_test_ids = {s.test_id for s in remaining_submissions}
                sub_tests = (
                    await db.scalars(
                        select(TestRow).where(TestRow.id.in_(sub_test_ids))
                    )
                ).all()
                for t in sub_tests:
                    if t.concept_ids:
                        try:
                            parsed_cids = json.loads(t.concept_ids)
                            if isinstance(parsed_cids, list):
                                for cid in parsed_cids:
                                    remaining_tested_cids.add(str(cid))
                        except Exception:
                            pass
                    if t.questions:
                        try:
                            parsed_q = json.loads(t.questions)
                            if isinstance(parsed_q, list):
                                for q in parsed_q:
                                    if isinstance(q, dict) and q.get("conceptId"):
                                        remaining_tested_cids.add(str(q["conceptId"]))
                        except Exception:
                            pass

        # Any concept from the departed class:
        # If it is not tested in the student's remaining classrooms, remove the mastery payload.
        for cid in class_cids:
            if cid not in remaining_tested_cids:
                payload = await db.scalar(
                    select(AnalysisPayloadRow).where(
                        AnalysisPayloadRow.student_id == student_id,
                        AnalysisPayloadRow.concept_id == cid,
                    )
                )
                if payload:
                    await db.delete(payload)

    # 4. Remove enrollment
    await db.delete(enrollment)

    # 5. Commit transaction
    await db.commit()

    return {
        "ok": True,
        "message": f"Successfully left classroom {classroom.name}",
    }


@router.delete("/{classroom_id}/notes/{note_id}")
async def delete_classroom_note(
    classroom_id: str,
    note_id: str,
    teacher_id: str = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    from app.routers.notes import delete_note_internal

    return await delete_note_internal(
        note_id, teacher_id, db, expected_classroom_id=classroom_id
    )
