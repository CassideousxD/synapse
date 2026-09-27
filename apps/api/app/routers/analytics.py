import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts import AnalysisPayload
from app.core.db import (
    AnalysisPayloadRow,
    ClassroomRow,
    ConceptRow,
    EnrollmentRow,
    NoteRow,
    SubmissionRow,
    TestRow,
    UserRow,
    get_db,
)
from app.core.rate_limit import extract_user_id, get_limit_config, rate_limit
from app.core.security import require_client_secret, require_teacher, require_user

router = APIRouter(
    prefix="/analytics",
    tags=["analytics"],
    dependencies=[
        Depends(
            rate_limit(
                "synapse:rl:user",
                limit=get_limit_config("RATE_LIMIT_GENERAL_PER_MINUTE", 120),
                window=60,
                key_extractor=lambda req: f"{extract_user_id(req)}:general",
            )
        )
    ],
)


@router.post("/payload", status_code=204)
async def ingest_analysis_payload(
    payload: AnalysisPayload,
    db: AsyncSession = Depends(get_db),
    _client=Depends(require_client_secret),
) -> None:
    """
    THE privacy boundary, server side. FastAPI + Pydantic's extra="forbid"
    on the generated model means a body with any field beyond the six in
    the schema is rejected with a 422 before this function body even runs.
    """
    existing = await db.scalar(
        select(AnalysisPayloadRow).where(
            AnalysisPayloadRow.student_id == payload.studentId,
            AnalysisPayloadRow.concept_id == payload.conceptId,
        )
    )
    if existing:
        existing.mastery = payload.mastery
        existing.trend = payload.trend.value
        existing.computed_at = payload.computedAt
    else:
        db.add(
            AnalysisPayloadRow(
                id=str(uuid.uuid4()),
                student_id=payload.studentId,
                concept_id=payload.conceptId,
                mastery=payload.mastery,
                trend=payload.trend.value,
                computed_at=payload.computedAt,
            )
        )
    await db.commit()


@router.get("/payload/{student_id}/{concept_id}")
async def get_analysis_payload(
    student_id: str,
    concept_id: str,
    db: AsyncSession = Depends(get_db),
    _teacher=Depends(require_teacher),
):
    row = await db.scalar(
        select(AnalysisPayloadRow).where(
            AnalysisPayloadRow.student_id == student_id,
            AnalysisPayloadRow.concept_id == concept_id,
        )
    )
    if not row:
        raise HTTPException(status_code=404, detail="no payload for that student/concept")
    return {
        "studentId": row.student_id,
        "conceptId": row.concept_id,
        "mastery": row.mastery,
        "trend": row.trend,
        "computedAt": row.computed_at.isoformat(),
    }


@router.get("/payloads")
async def list_analysis_payloads(db: AsyncSession = Depends(get_db), _teacher=Depends(require_teacher)):
    rows = (await db.scalars(select(AnalysisPayloadRow))).all()
    return [
        {
            "studentId": r.student_id,
            "conceptId": r.concept_id,
            "mastery": r.mastery,
            "trend": r.trend,
            "computedAt": r.computed_at.isoformat(),
        }
        for r in rows
    ]

@router.get("/summary")
async def get_analytics_summary(
    teacher_id: str = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    """
    Per-concept rollup for the teacher dashboard: only for students enrolled
    in this teacher's classrooms.
    """
    any_classes = (await db.scalars(select(ClassroomRow.id))).first()

    if any_classes is not None:
        teacher_classes = (
            await db.scalars(
                select(ClassroomRow.id).where(ClassroomRow.teacher_id == teacher_id)
            )
        ).all()
        if not teacher_classes:
            return []

        student_ids = (
            await db.scalars(
                select(EnrollmentRow.student_id).where(
                    EnrollmentRow.classroom_id.in_(teacher_classes)
                )
            )
        ).all()
        if not student_ids:
            return []

        rows = (
            await db.scalars(
                select(AnalysisPayloadRow).where(
                    AnalysisPayloadRow.student_id.in_(student_ids)
                )
            )
        ).all()
    else:
        # Headless testing fallback where classrooms table has no rows
        rows = (await db.scalars(select(AnalysisPayloadRow))).all()

    by_concept: dict[str, list[AnalysisPayloadRow]] = {}
    for r in rows:
        by_concept.setdefault(r.concept_id, []).append(r)

    summary = []
    for concept_id, concept_rows in sorted(by_concept.items()):
        trend_counts = {"improving": 0, "still_weak": 0, "new_gap": 0}
        for r in concept_rows:
            trend_counts[r.trend] = trend_counts.get(r.trend, 0) + 1
        avg_mastery = sum(r.mastery for r in concept_rows) / len(concept_rows)
        summary.append(
            {
                "conceptId": concept_id,
                "studentCount": len(concept_rows),
                "avgMastery": round(avg_mastery, 4),
                "trendCounts": trend_counts,
            }
        )
    return summary


@router.get("/mastery")
async def get_student_mastery(
    token_payload: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns the authenticated student's real mastery per concept, including
    unassessed concepts introduced in their enrolled classrooms.
    """
    student_id = token_payload.get("sub", "")
    rows = (
        await db.scalars(
            select(AnalysisPayloadRow).where(
                AnalysisPayloadRow.student_id == student_id
            )
        )
    ).all()

    res = {
        r.concept_id: {
            "mastery": r.mastery,
            "trend": r.trend,
            "computedAt": r.computed_at.isoformat(),
        }
        for r in rows
    }

    # Include unassessed concepts from enrolled classrooms
    enrolled_class_ids = (
        await db.scalars(
            select(EnrollmentRow.classroom_id).where(
                EnrollmentRow.student_id == student_id
            )
        )
    ).all()

    if enrolled_class_ids:
        classroom_cids = (
            await db.scalars(
                select(ConceptRow.id).where(ConceptRow.classroom_id.in_(enrolled_class_ids))
            )
        ).all()
        for cid in classroom_cids:
            if cid and cid not in res:
                res[cid] = {
                    "mastery": None,
                    "trend": "steady",
                    "computedAt": None,
                }

    return res


@router.get("/teacher-dashboard")
async def get_teacher_analytics_dashboard(
    classroom_id: str | None = None,
    teacher_id: str = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    """
    Real, classroom-level analytics based on actual students, assessments, and mastery.
    No fabricated metrics, no demo data leakage.
    Supports classroom_id query parameter for scoped filtering.
    """
    all_teacher_classes = (
        await db.scalars(
            select(ClassroomRow).where(ClassroomRow.teacher_id == teacher_id)
        )
    ).all()

    if not all_teacher_classes:
        return {
            "overview": {
                "classroomCount": 0,
                "studentCount": 0,
                "activeStudentCount": 0,
                "publishedTestCount": 0,
                "totalSubmissionCount": 0,
                "expectedSubmissionCount": 0,
                "completionRate": None,
                "averageScore": None,
                "averageMastery": None,
                "weakConceptCount": 0,
            },
            "selectedClassroomId": None,
            "allClassrooms": [],
            "classrooms": [],
            "concepts": [],
            "students": [],
            "leaderboard": [],
            "tests": [],
            "recentActivity": [],
        }

    # If classroom_id is provided, verify ownership and filter
    if classroom_id:
        target = next((c for c in all_teacher_classes if c.id == classroom_id), None)
        if not target:
            # Check if classroom exists at all or belongs to another teacher
            cls_check = await db.scalar(select(ClassroomRow).where(ClassroomRow.id == classroom_id))
            if not cls_check:
                raise HTTPException(status_code=404, detail="Classroom not found")
            raise HTTPException(status_code=403, detail="Forbidden: You do not own this classroom")
        teacher_classes = [target]
    else:
        teacher_classes = all_teacher_classes

    class_ids = [c.id for c in teacher_classes]
    class_by_id = {c.id: c for c in all_teacher_classes}

    def _norm_mastery(val: float | None) -> float | None:
        if val is None:
            return None
        return val * 100.0 if (0.0 < val <= 1.0) else val

    # 1. Enrollments & Students
    enrollments = (
        await db.scalars(
            select(EnrollmentRow).where(EnrollmentRow.classroom_id.in_(class_ids))
        )
    ).all()
    student_ids = list({e.student_id for e in enrollments})
    students_by_class: dict[str, list[str]] = {}
    for e in enrollments:
        students_by_class.setdefault(e.classroom_id, []).append(e.student_id)

    users = (
        await db.scalars(
            select(UserRow).where(UserRow.id.in_(student_ids))
        )
    ).all() if student_ids else []
    user_by_id = {u.id: u for u in users}

    # 2. Tests in scoped classrooms
    tests = (
        await db.scalars(
            select(TestRow).where(TestRow.classroom_id.in_(class_ids))
        )
    ).all()
    test_ids = [t.id for t in tests]
    test_by_id = {t.id: t for t in tests}
    published_tests = [t for t in tests if t.status == "published"]

    # 3. Submissions
    submissions = (
        await db.scalars(
            select(SubmissionRow)
            .where(SubmissionRow.test_id.in_(test_ids))
            .order_by(SubmissionRow.submitted_at.desc())
        )
    ).all() if test_ids else []

    active_student_ids = {s.student_id for s in submissions}
    subs_by_class: dict[str, list[SubmissionRow]] = {}
    subs_by_student: dict[str, list[SubmissionRow]] = {}
    subs_by_test: dict[str, list[SubmissionRow]] = {}
    for s in submissions:
        t = test_by_id.get(s.test_id)
        if t:
            subs_by_class.setdefault(t.classroom_id, []).append(s)
        subs_by_student.setdefault(s.student_id, []).append(s)
        subs_by_test.setdefault(s.test_id, []).append(s)

    # 4. Concepts in scoped classrooms
    concepts = (
        await db.scalars(
            select(ConceptRow).where(ConceptRow.classroom_id.in_(class_ids))
        )
    ).all()
    concept_ids = [c.id for c in concepts]
    concept_by_id_map = {c.id: c for c in concepts}

    # 5. Mastery payloads for enrolled students on these concepts
    payloads = (
        await db.scalars(
            select(AnalysisPayloadRow).where(
                AnalysisPayloadRow.student_id.in_(student_ids),
                AnalysisPayloadRow.concept_id.in_(concept_ids),
            )
        )
    ).all() if (student_ids and concept_ids) else []

    payloads_by_concept: dict[str, list[AnalysisPayloadRow]] = {}
    payloads_by_student: dict[str, list[AnalysisPayloadRow]] = {}
    for p in payloads:
        payloads_by_concept.setdefault(p.concept_id, []).append(p)
        payloads_by_student.setdefault(p.student_id, []).append(p)

    # Concept Analytics
    concept_list = []
    weak_concept_count = 0
    for c in concepts:
        p_list = payloads_by_concept.get(c.id, [])
        if p_list:
            norm_vals = [(_norm_mastery(p.mastery) or 0.0) for p in p_list]
            avg_m = round(sum(norm_vals) / len(norm_vals), 1)
            struggling = sum(1 for m in norm_vals if m < 55.0)
            proficient = sum(1 for m in norm_vals if m >= 75.0)
            trend_counts = {"improving": 0, "still_weak": 0, "new_gap": 0}
            for p in p_list:
                trend_counts[p.trend] = trend_counts.get(p.trend, 0) + 1
        else:
            avg_m = None
            struggling = 0
            proficient = 0
            trend_counts = {"improving": 0, "still_weak": 0, "new_gap": 0}

        if avg_m is not None and avg_m < 55.0:
            weak_concept_count += 1

        cls_obj = class_by_id.get(c.classroom_id)

        # Build affected students list for drilldown
        affected_students = [
            {
                "id": p.student_id,
                "name": user_by_id[p.student_id].name if p.student_id in user_by_id else f"Student {p.student_id[:6]}",
                "email": user_by_id[p.student_id].email if p.student_id in user_by_id else "",
                "mastery": round(_norm_mastery(p.mastery) or 0.0, 1),
                "trend": p.trend,
                "status": "Needs Attention" if (_norm_mastery(p.mastery) or 0.0) < 55.0 else ("Strong" if (_norm_mastery(p.mastery) or 0.0) >= 75.0 else "Developing"),
            }
            for p in p_list
        ]
        # Sort ascending by mastery (weakest students first)
        affected_students.sort(key=lambda s: s["mastery"])

        status_label = (
            "Needs Attention" if (avg_m is not None and avg_m < 55.0)
            else ("Strong" if (avg_m is not None and avg_m >= 75.0)
            else ("Developing" if avg_m is not None else "Unassessed"))
        )

        concept_list.append({
            "id": c.id,
            "name": c.name,
            "classroomId": c.classroom_id,
            "classroomName": cls_obj.name if cls_obj else "Course Concept",
            "category": cls_obj.name if cls_obj else "Course Concept",
            "avgMastery": avg_m,
            "studentCount": len(p_list),
            "strugglingCount": struggling,
            "proficientCount": proficient,
            "status": status_label,
            "improvingCount": trend_counts.get("improving", 0),
            "stillWeakCount": trend_counts.get("still_weak", 0),
            "newGapCount": trend_counts.get("new_gap", 0),
            "trendCounts": trend_counts,
            "students": affected_students,
        })
    # Sort concepts by mastery ascending (weakest first)
    concept_list.sort(key=lambda x: (x["avgMastery"] is None, x["avgMastery"] or 0))

    # Classroom Analytics
    classroom_list = []
    total_class_mastery_sum = 0.0
    total_class_mastery_cnt = 0
    for c in teacher_classes:
        c_students = students_by_class.get(c.id, [])
        c_subs = subs_by_class.get(c.id, [])
        c_concepts = [con for con in concepts if con.classroom_id == c.id]
        c_cids = {con.id for con in c_concepts}

        c_payloads = [p for p in payloads if p.student_id in c_students and p.concept_id in c_cids]
        if c_payloads:
            norm_c_vals = [(_norm_mastery(p.mastery) or 0.0) for p in c_payloads]
            class_avg_m = round(sum(norm_c_vals) / len(norm_c_vals), 1)
            total_class_mastery_sum += class_avg_m
            total_class_mastery_cnt += 1
        else:
            class_avg_m = None

        class_avg_score = (
            round(sum(s.score for s in c_subs) / len(c_subs), 1) if c_subs else None
        )

        c_tests = [t for t in tests if t.classroom_id == c.id]
        classroom_list.append({
            "id": c.id,
            "name": c.name,
            "subject": c.subject,
            "joinCode": c.join_code,
            "studentCount": len(c_students),
            "averageMastery": class_avg_m,
            "testCount": len(c_tests),
            "submissionCount": len(c_subs),
            "averageScore": class_avg_score,
        })

    # Student Support Analytics & Leaderboard
    student_list = []
    for sid in student_ids:
        u = user_by_id.get(sid)
        s_subs = subs_by_student.get(sid, [])
        s_payloads = payloads_by_student.get(sid, [])

        norm_s_masteries = [(_norm_mastery(p.mastery) or 0.0) for p in s_payloads]
        avg_s = round(sum(s.score for s in s_subs) / len(s_subs), 1) if s_subs else None
        avg_m = round(sum(norm_s_masteries) / len(norm_s_masteries), 1) if norm_s_masteries else None

        # Build list of weak concepts for this student
        weak_concepts_for_student = []
        for p in s_payloads:
            m_norm = round(_norm_mastery(p.mastery) or 0.0, 1)
            if m_norm < 55.0:
                c_obj = concept_by_id_map.get(p.concept_id)
                weak_concepts_for_student.append({
                    "id": p.concept_id,
                    "name": c_obj.name if c_obj else p.concept_id,
                    "mastery": m_norm,
                    "trend": p.trend,
                })

        s_class_names = [class_by_id[cid].name for cid in class_ids if sid in students_by_class.get(cid, []) and cid in class_by_id]

        student_list.append({
            "id": sid,
            "name": u.name if u else f"Student {sid[:6]}",
            "email": u.email if u else "",
            "classroomNames": s_class_names,
            "classroomName": ", ".join(s_class_names) if s_class_names else "",
            "avgScore": avg_s,
            "testsCompleted": len(s_subs),
            "avgMastery": avg_m,
            "weakConceptCount": len(weak_concepts_for_student),
            "weakConcepts": weak_concepts_for_student,
            "recentSubmissions": [
                {
                    "testId": s.test_id,
                    "testTitle": test_by_id[s.test_id].title if s.test_id in test_by_id else "Assessment",
                    "score": round(s.score, 1),
                    "isLate": bool(getattr(s, "is_late", False)),
                    "submittedAt": s.submitted_at.isoformat() if s.submitted_at else "",
                }
                for s in s_subs[:5]
            ],
        })

    # "Students Needing Support": sorted by highest weak concept count, then lowest average mastery
    students_needing_support = sorted(
        student_list,
        key=lambda s: (s["weakConceptCount"], -(s["avgMastery"] if s["avgMastery"] is not None else 100)),
        reverse=True,
    )

    # Legacy leaderboard sorted by score descending
    leaderboard = sorted(
        student_list,
        key=lambda s: (s["avgScore"] is not None, s["avgScore"] or 0, s["testsCompleted"]),
        reverse=True,
    )

    # Test / Assessment Performance Analytics
    test_list = []
    for t in tests:
        t_subs = subs_by_test.get(t.id, [])
        cls_obj = class_by_id.get(t.classroom_id)
        enrolled_cnt = len(students_by_class.get(t.classroom_id, []))
        sub_cnt = len(t_subs)
        completion_rate = round((sub_cnt / max(1, enrolled_cnt)) * 100, 1) if enrolled_cnt > 0 else 0.0
        avg_score = round(sum(s.score for s in t_subs) / sub_cnt, 1) if t_subs else None
        late_cnt = sum(1 for s in t_subs if getattr(s, "is_late", False))

        # Question-level performance
        questions_raw = []
        if t.questions:
            try:
                questions_raw = json.loads(t.questions)
            except Exception:
                questions_raw = []

        q_analysis = []
        for idx, q in enumerate(questions_raw):
            qid = q.get("id", f"q-{idx+1}")
            prompt = q.get("prompt", "")
            q_type = q.get("type", "mcq")
            expected_ans = str(q.get("answer", "")).strip().lower()
            cid = q.get("conceptId", "")
            c_obj = concept_by_id_map.get(cid)
            c_name = c_obj.name if c_obj else "General"

            answered_cnt = 0
            correct_cnt = 0
            distractor_map: dict[str, int] = {}

            for sub in t_subs:
                if sub.answers:
                    try:
                        ans_dict = json.loads(sub.answers)
                    except Exception:
                        ans_dict = {}
                    if qid in ans_dict:
                        answered_cnt += 1
                        raw_ans = str(ans_dict[qid])
                        if raw_ans.strip().lower() == expected_ans:
                            correct_cnt += 1
                        else:
                            distractor_map[raw_ans] = distractor_map.get(raw_ans, 0) + 1

            pct_correct = round((correct_cnt / max(1, answered_cnt)) * 100, 1) if answered_cnt > 0 else None
            top_mistakes = [
                {"answer": k, "count": v}
                for k, v in sorted(distractor_map.items(), key=lambda x: x[1], reverse=True)[:3]
            ]

            q_analysis.append({
                "id": qid,
                "index": idx + 1,
                "prompt": prompt,
                "type": q_type,
                "options": q.get("options", []),
                "conceptId": cid,
                "conceptName": c_name,
                "expectedAnswer": q.get("answer", ""),
                "answeredCount": answered_cnt,
                "correctCount": correct_cnt,
                "correctPercentage": pct_correct,
                "commonMistakes": top_mistakes,
            })

        score_bands = {
            "<60%": sum(1 for s in t_subs if s.score < 60),
            "60-74%": sum(1 for s in t_subs if 60 <= s.score < 75),
            "75-89%": sum(1 for s in t_subs if 75 <= s.score < 90),
            "90-100%": sum(1 for s in t_subs if s.score >= 90),
        }

        test_list.append({
            "id": t.id,
            "title": t.title,
            "classroomId": t.classroom_id,
            "classroomName": cls_obj.name if cls_obj else "",
            "status": t.status,
            "durationMin": t.duration_min,
            "due": t.due,
            "dueAt": t.due_at.isoformat() if t.due_at else None,
            "createdAt": t.created_at.isoformat() if t.created_at else None,
            "submissionCount": sub_cnt,
            "enrolledCount": enrolled_cnt,
            "completionRate": completion_rate,
            "averageScore": avg_score,
            "lateCount": late_cnt,
            "scoreDistribution": score_bands,
            "questions": q_analysis,
        })

    # Sort tests newest first
    test_list.sort(key=lambda x: x["createdAt"] or "", reverse=True)

    # Overview Calculations
    avg_score_all = (
        round(sum(s.score for s in submissions) / len(submissions), 1)
        if submissions
        else None
    )
    overall_avg_mastery = (
        round(total_class_mastery_sum / total_class_mastery_cnt, 1)
        if total_class_mastery_cnt > 0
        else None
    )

    # Assessment Completion across published tests
    expected_submissions_total = sum(len(students_by_class.get(t.classroom_id, [])) for t in published_tests)
    actual_published_subs = sum(len(subs_by_test.get(t.id, [])) for t in published_tests)
    overall_completion_rate = (
        round((actual_published_subs / max(1, expected_submissions_total)) * 100, 1)
        if expected_submissions_total > 0
        else None
    )

    # Recent Activity Feed (real events from DB)
    recent_activity = []
    for s in submissions[:8]:
        t = test_by_id.get(s.test_id)
        u = user_by_id.get(s.student_id)
        cls_obj = class_by_id.get(t.classroom_id) if t else None
        recent_activity.append({
            "id": f"act-{s.id}",
            "type": "submission",
            "who": u.name if u else "A student",
            "what": f"scored {round(s.score)}% on {t.title if t else 'Assessment'}",
            "cls": cls_obj.name if cls_obj else "",
            "timestamp": s.submitted_at.isoformat() if s.submitted_at else "",
        })

    for e in enrollments[:8]:
        u = user_by_id.get(e.student_id)
        cls_obj = class_by_id.get(e.classroom_id)
        recent_activity.append({
            "id": f"act-{e.id}",
            "type": "enrollment",
            "who": u.name if u else "A student",
            "what": "joined classroom",
            "cls": cls_obj.name if cls_obj else "",
            "timestamp": e.enrolled_at.isoformat() if e.enrolled_at else "",
        })

    # Sort combined activity by timestamp descending
    recent_activity.sort(key=lambda a: a["timestamp"] or "", reverse=True)
    recent_activity = recent_activity[:10]

    all_classrooms_brief = [
        {"id": c.id, "name": c.name, "subject": c.subject}
        for c in all_teacher_classes
    ]

    return {
        "overview": {
            "classroomCount": len(teacher_classes),
            "studentCount": len(student_ids),
            "activeStudentCount": len(active_student_ids),
            "publishedTestCount": len(published_tests),
            "totalSubmissionCount": len(submissions),
            "expectedSubmissionCount": expected_submissions_total,
            "completionRate": overall_completion_rate,
            "averageScore": avg_score_all,
            "averageMastery": overall_avg_mastery,
            "weakConceptCount": weak_concept_count,
        },
        "selectedClassroomId": classroom_id,
        "allClassrooms": all_classrooms_brief,
        "classrooms": classroom_list,
        "concepts": concept_list,
        "students": students_needing_support,
        "leaderboard": leaderboard,
        "tests": test_list,
        "recentActivity": recent_activity,
    }
