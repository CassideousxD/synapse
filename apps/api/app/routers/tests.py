import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import (
    AnalysisPayloadRow,
    ClassroomRow,
    ConceptRow,
    EnrollmentRow,
    NotificationRow,
    SubmissionRow,
    TestRow,
    UserRow,
    get_db,
)
from app.core.security import require_teacher, require_user
from app.curriculum.mcq_generation import generate_mcq_for_concept

router = APIRouter(tags=["tests"])


class GenerateQuestionsRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    classroomId: str
    conceptIds: list[str] | None = None
    count: int = 3


class CreateTestRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str
    classroomId: str
    durationMin: int = 20
    due: str | None = "Next Week"
    dueAt: str | datetime | None = None
    status: str = "draft"  # "draft" | "published"
    conceptIds: list[str] | None = None
    questions: list[dict[str, Any]]


class UpdateTestStatusRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    status: str


class SubmitTestRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    answers: dict[str, str]


def _format_test(t: TestRow) -> dict[str, Any]:
    try:
        concept_ids = json.loads(t.concept_ids) if t.concept_ids else []
    except Exception:
        concept_ids = []
    try:
        questions = json.loads(t.questions) if t.questions else []
    except Exception:
        questions = []

    now = datetime.now(timezone.utc)
    due_at_dt = None
    is_overdue = False
    if getattr(t, "due_at", None):
        raw_due_at = t.due_at
        due_at_dt = raw_due_at if raw_due_at.tzinfo else raw_due_at.replace(tzinfo=timezone.utc)
        is_overdue = now > due_at_dt

    return {
        "id": t.id,
        "title": t.title,
        "classroomId": t.classroom_id,
        "durationMin": t.duration_min,
        "due": t.due or "",
        "dueAt": due_at_dt.isoformat() if due_at_dt else None,
        "isOverdue": is_overdue,
        "status": t.status,
        "conceptIds": concept_ids,
        "questions": questions,
    }


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.strip().lower())


@router.post("/tests/generate-questions")
async def generate_questions_for_test(
    req: GenerateQuestionsRequest,
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

    target_cids = list(req.conceptIds or [])
    if not target_cids:
        concept_rows = (
            await db.scalars(
                select(ConceptRow).where(ConceptRow.classroom_id == req.classroomId)
            )
        ).all()
        if not concept_rows:
            raise HTTPException(
                status_code=400,
                detail="No concepts found for this classroom. Upload notes first before generating questions.",
            )

        # Knowledge-gap weighting:
        # Check classroom student mastery to prioritize weak and partial concepts while retaining strong concepts
        cid_list = [c.id for c in concept_rows]
        mastery_rows = (
            await db.scalars(
                select(AnalysisPayloadRow).where(AnalysisPayloadRow.concept_id.in_(cid_list))
            )
        ).all()
        mastery_by_cid: dict[str, list[float]] = {}
        for m in mastery_rows:
            mastery_by_cid.setdefault(m.concept_id, []).append(m.mastery)

        # Build weighted list:
        # weak (<50%): weight 5
        # partial (50-75%): weight 3
        # unassessed: weight 4
        # strong (>75%): weight 1 (retained, never removed!)
        weighted_concepts: list[ConceptRow] = []
        for c in concept_rows:
            vals = mastery_by_cid.get(c.id)
            if not vals:
                w = 4
            else:
                avg_m = sum(vals) / len(vals)
                if avg_m < 50:
                    w = 5
                elif avg_m <= 75:
                    w = 3
                else:
                    w = 1
            weighted_concepts.extend([c] * w)

        concepts_to_use = weighted_concepts if weighted_concepts else list(concept_rows)
    else:
        concepts_to_use = (
            await db.scalars(
                select(ConceptRow).where(
                    ConceptRow.classroom_id == req.classroomId,
                    ConceptRow.id.in_(target_cids),
                )
            )
        ).all()
        if not concepts_to_use:
            raise HTTPException(
                status_code=400,
                detail="None of the specified concepts were found in this classroom.",
            )

    generated = []
    idx = 0
    # Deduplicate within small batches while respecting weighting
    used_ids: list[str] = []
    while len(generated) < req.count and concepts_to_use:
        c = concepts_to_use[idx % len(concepts_to_use)]
        idx += 1
        q = await generate_mcq_for_concept(c.id, c.name, c.description or "")
        generated.append(q)
        used_ids.append(c.id)

    return generated


@router.post("/tests", status_code=status.HTTP_201_CREATED)
async def create_test(
    req: CreateTestRequest,
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

    parsed_due_at = None
    if req.dueAt:
        if isinstance(req.dueAt, datetime):
            parsed_due_at = req.dueAt if req.dueAt.tzinfo else req.dueAt.replace(tzinfo=timezone.utc)
        elif isinstance(req.dueAt, str) and req.dueAt.strip():
            try:
                dt = datetime.fromisoformat(req.dueAt.replace("Z", "+00:00"))
                parsed_due_at = dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
            except Exception:
                pass

    test_id = f"t-{uuid.uuid4().hex[:8]}"
    test = TestRow(
        id=test_id,
        title=req.title.strip(),
        classroom_id=req.classroomId,
        duration_min=req.durationMin,
        due=req.due or ("Upcoming"),
        due_at=parsed_due_at,
        status=req.status,
        concept_ids=json.dumps(req.conceptIds or []),
        questions=json.dumps(req.questions),
    )
    db.add(test)
    await db.commit()
    await db.refresh(test)

    if req.status == "published":
        from app.routers.notifications import create_classroom_notifications
        msg = f"“{test.title}” is now available in {classroom.name}."
        if test.due:
            msg += f" Due: {test.due}"
        await create_classroom_notifications(
            db=db,
            classroom_id=req.classroomId,
            notif_type="new_test",
            title="New test published",
            message=msg,
            related_entity_type="test",
            related_entity_id=test.id,
        )

    return _format_test(test)


@router.get("/tests")
async def list_tests(
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
        query = select(TestRow).where(TestRow.classroom_id.in_(allowed_classes))
    else:
        enrolled_classes = (
            await db.scalars(
                select(EnrollmentRow.classroom_id).where(EnrollmentRow.student_id == user_id)
            )
        ).all()
        query = select(TestRow).where(
            TestRow.classroom_id.in_(enrolled_classes),
            TestRow.status == "published",
        )

    if classroomId:
        query = query.where(TestRow.classroom_id == classroomId)

    rows = (await db.scalars(query)).all()
    return [_format_test(r) for r in rows]


@router.get("/tests/{test_id}")
async def get_test(
    test_id: str,
    token_payload: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    test = await db.scalar(select(TestRow).where(TestRow.id == test_id))
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")

    user_id = token_payload.get("sub", "")
    role = token_payload.get("role", "teacher")

    if role == "teacher":
        classroom = await db.scalar(
            select(ClassroomRow).where(ClassroomRow.id == test.classroom_id)
        )
        if not classroom or classroom.teacher_id != user_id:
            raise HTTPException(status_code=403, detail="Forbidden: You do not own this test")
    else:
        if test.status != "published":
            raise HTTPException(status_code=404, detail="Test not found")
        enrolled = await db.scalar(
            select(EnrollmentRow).where(
                EnrollmentRow.classroom_id == test.classroom_id,
                EnrollmentRow.student_id == user_id,
            )
        )
        if not enrolled:
            raise HTTPException(status_code=403, detail="Forbidden: You are not enrolled in this classroom")

    return _format_test(test)


@router.patch("/tests/{test_id}")
async def update_test_status(
    test_id: str,
    req: UpdateTestStatusRequest,
    teacher_id: str = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    test = await db.scalar(select(TestRow).where(TestRow.id == test_id))
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")

    classroom = await db.scalar(
        select(ClassroomRow).where(ClassroomRow.id == test.classroom_id)
    )
    if not classroom or classroom.teacher_id != teacher_id:
        raise HTTPException(status_code=403, detail="Forbidden: You do not own this test")

    was_published = test.status == "published"
    test.status = req.status
    await db.commit()
    await db.refresh(test)

    if req.status == "published" and not was_published:
        from app.routers.notifications import create_classroom_notifications
        msg = f"“{test.title}” is now available in {classroom.name}."
        if test.due:
            msg += f" Due: {test.due}"
        await create_classroom_notifications(
            db=db,
            classroom_id=test.classroom_id,
            notif_type="new_test",
            title="New test published",
            message=msg,
            related_entity_type="test",
            related_entity_id=test.id,
        )

    return _format_test(test)


@router.post("/tests/{test_id}/submit")
async def submit_test(
    test_id: str,
    req: SubmitTestRequest,
    token_payload: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    student_id = token_payload.get("sub", "")
    test = await db.scalar(select(TestRow).where(TestRow.id == test_id))
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")

    questions = json.loads(test.questions) if test.questions else []
    correct: list[str] = []
    incorrect: list[str] = []
    delta: dict[str, int] = {}
    concept_q_stats: dict[str, dict[str, int]] = {}

    for q in questions:
        qid = q.get("id", "")
        expected = q.get("answer", "")
        student_ans = req.answers.get(qid, "")
        cid = q.get("conceptId", "")

        is_correct = _norm(student_ans) == _norm(expected)
        if is_correct:
            correct.append(qid)
        else:
            incorrect.append(qid)

        if cid:
            stats = concept_q_stats.setdefault(cid, {"correct": 0, "total": 0})
            stats["total"] += 1
            if is_correct:
                stats["correct"] += 1
                delta[cid] = delta.get(cid, 0) + 4
            else:
                delta[cid] = delta.get(cid, 0) - 3

    score = round((len(correct) / max(1, len(questions))) * 100)

    # Fallback if questions lacked conceptId tags
    test_cids = json.loads(test.concept_ids) if test.concept_ids else []
    if not concept_q_stats and test_cids:
        for cid in test_cids:
            concept_q_stats[cid] = {"correct": len(correct), "total": len(questions)}
            delta[cid] = 4 if score >= 70 else -3

    # Server-side deadline check
    now = datetime.now(timezone.utc)
    is_late = False
    if getattr(test, "due_at", None):
        raw_due = test.due_at
        due_dt = raw_due if raw_due.tzinfo else raw_due.replace(tzinfo=timezone.utc)
        if now > due_dt:
            is_late = True

    # Save submission
    sub_id = f"sub-{uuid.uuid4().hex[:10]}"
    sub = SubmissionRow(
        id=sub_id,
        test_id=test_id,
        student_id=student_id,
        score=float(score),
        answers=json.dumps(req.answers),
        is_late=is_late,
        submitted_at=now,
    )
    db.add(sub)

    # Query concept rows to get their real human-readable names
    cids = list(concept_q_stats.keys())
    concept_names: dict[str, str] = {}
    if cids:
        c_rows = (await db.scalars(select(ConceptRow).where(ConceptRow.id.in_(cids)))).all()
        for cr in c_rows:
            concept_names[cr.id] = cr.name

    detailed_mastery_changes: list[dict[str, Any]] = []
    revision_concepts: list[dict[str, Any]] = []

    for cid, stats in concept_q_stats.items():
        c_name = concept_names.get(cid)
        if not c_name:
            c_name = re.sub(r"^c-", "", cid).replace("-", " ").title()

        existing_mastery = await db.scalar(
            select(AnalysisPayloadRow).where(
                AnalysisPayloadRow.student_id == student_id,
                AnalysisPayloadRow.concept_id == cid,
            )
        )

        d = delta.get(cid, 0)
        if existing_mastery:
            prev_mastery = existing_mastery.mastery
            new_val = max(0.0, min(100.0, existing_mastery.mastery + d))
            existing_mastery.mastery = new_val
            existing_mastery.trend = "improving" if d > 0 else "still_weak"
            existing_mastery.computed_at = now
        else:
            prev_mastery = 50.0  # standard baseline before assessment
            new_val = max(0.0, min(100.0, 50.0 + d))
            existing_mastery = AnalysisPayloadRow(
                id=str(uuid.uuid4()),
                student_id=student_id,
                concept_id=cid,
                mastery=new_val,
                trend="improving" if d > 0 else "new_gap",
                computed_at=now,
            )
            db.add(existing_mastery)

        correct_cnt = stats["correct"]
        total_cnt = stats["total"]
        pct = round((correct_cnt / max(1, total_cnt)) * 100)
        actual_change = round(new_val - prev_mastery)

        detailed_mastery_changes.append({
            "conceptId": cid,
            "conceptName": c_name,
            "previousMastery": round(prev_mastery),
            "newMastery": round(new_val),
            "change": actual_change,
            "delta": actual_change,
            "correctCount": correct_cnt,
            "totalCount": total_cnt,
            "performance": f"{correct_cnt}/{total_cnt} correct ({pct}%)",
            "testPerformance": f"{correct_cnt}/{total_cnt} correct ({pct}%)",
        })

        # Concept needing revision criteria:
        # 1. New mastery below proficiency threshold (55%)
        # 2. Made mistakes on this concept in recent test (correct_cnt < total_cnt)
        # 3. Mastery dropped (actual_change < 0)
        if new_val < 55.0 or correct_cnt < total_cnt or actual_change < 0:
            if correct_cnt == 0 and total_cnt > 1:
                reason = f"All {total_cnt} questions answered incorrectly"
            elif correct_cnt == 0:
                reason = "Incorrect answer on recent assessment"
            elif correct_cnt < total_cnt:
                reason = f"Missed {total_cnt - correct_cnt} of {total_cnt} questions"
            elif new_val < 55.0:
                reason = f"Mastery ({round(new_val)}%) is below the 55% proficiency threshold"
            else:
                reason = "Needs review to reinforce understanding"

            revision_concepts.append({
                "conceptId": cid,
                "conceptName": c_name,
                "currentMastery": round(new_val),
                "reason": reason,
                "recentPerformance": f"{correct_cnt}/{total_cnt} ({pct}%)",
            })

    # Notify teacher of submission
    classroom = await db.scalar(select(ClassroomRow).where(ClassroomRow.id == test.classroom_id))
    if classroom:
        student_user = await db.scalar(select(UserRow).where(UserRow.id == student_id))
        student_name = student_user.name if student_user else "A student"
        notif = NotificationRow(
            id=f"notif-{uuid.uuid4().hex[:10]}",
            recipient_id=classroom.teacher_id,
            classroom_id=test.classroom_id,
            type="student_submitted",
            title="Test submission received",
            message=f"{student_name} completed “{test.title}” with {score}%{' (late)' if is_late else ''}.",
            related_entity_type="test",
            related_entity_id=test.id,
            created_at=now,
        )
        db.add(notif)

    await db.commit()

    return {
        "testId": test_id,
        "score": score,
        "correct": correct,
        "incorrect": incorrect,
        "masteryChanges": {c["conceptId"]: c["change"] for c in detailed_mastery_changes},
        "detailedMasteryChanges": detailed_mastery_changes,
        "revisionConcepts": revision_concepts,
        "date": "Today",
        "isLate": is_late,
        "status": "submitted_late" if is_late else "submitted",
    }


@router.get("/submissions")
async def list_submissions(
    token_payload: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    role = token_payload.get("role", "teacher")
    user_id = token_payload.get("sub", "")

    if role == "teacher":
        # Submissions for teacher's classrooms
        class_ids = (
            await db.scalars(
                select(ClassroomRow.id).where(ClassroomRow.teacher_id == user_id)
            )
        ).all()
        test_ids = (
            await db.scalars(
                select(TestRow.id).where(TestRow.classroom_id.in_(class_ids))
            )
        ).all()
        rows = (
            await db.scalars(
                select(SubmissionRow).where(SubmissionRow.test_id.in_(test_ids))
            )
        ).all()
    else:
        # Submissions by this student
        rows = (
            await db.scalars(
                select(SubmissionRow).where(SubmissionRow.student_id == user_id)
            )
        ).all()

    return [
        {
            "id": r.id,
            "testId": r.test_id,
            "studentId": r.student_id,
            "score": r.score,
            "isLate": bool(getattr(r, "is_late", False)),
            "date": r.submitted_at.strftime("%b %d") if r.submitted_at else "Today",
        }
        for r in rows
    ]
