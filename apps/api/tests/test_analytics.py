import pytest
from httpx import ASGITransport, AsyncClient

from tests.conftest import CLIENT_HEADERS
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import Base, get_db
from app.main import app

VALID = {
    "studentId": "s1",
    "conceptId": "c1",
    "mastery": 0.6,
    "trend": "still_weak",
    "computedAt": "2026-01-01T00:00:00Z",
}




async def test_health(client):
    r = await client.get("/health")
    assert r.status_code == 200


async def test_ingest_then_fetch(client, teacher_headers):
    r = await client.post("/analytics/payload", json=VALID, headers=CLIENT_HEADERS)
    assert r.status_code == 204

    r = await client.get("/analytics/payload/s1/c1", headers=teacher_headers)
    assert r.status_code == 200
    assert r.json()["mastery"] == 0.6


async def test_extra_field_rejected(client):
    leaky = {**VALID, "noteText": "should never leave the device"}
    r = await client.post("/analytics/payload", json=leaky, headers=CLIENT_HEADERS)
    assert r.status_code == 422


async def test_upsert_overwrites(client, teacher_headers):
    await client.post("/analytics/payload", json=VALID, headers=CLIENT_HEADERS)
    updated = {**VALID, "mastery": 0.9, "trend": "improving"}
    r = await client.post("/analytics/payload", json=updated, headers=CLIENT_HEADERS)
    assert r.status_code == 204

    r = await client.get("/analytics/payload/s1/c1", headers=teacher_headers)
    assert r.json()["mastery"] == 0.9

    r = await client.get("/analytics/payloads", headers=teacher_headers)
    assert len(r.json()) == 1


async def test_missing_required_field_rejected(client):
    incomplete = {k: v for k, v in VALID.items() if k != "trend"}
    r = await client.post("/analytics/payload", json=incomplete, headers=CLIENT_HEADERS)
    assert r.status_code == 422

async def test_summary_empty(client, teacher_headers):
    r = await client.get("/analytics/summary", headers=teacher_headers)
    assert r.status_code == 200
    assert r.json() == []


async def test_summary_aggregates_per_concept(client, teacher_headers):
    await client.post("/analytics/payload", headers=CLIENT_HEADERS, json={**VALID, "studentId": "s1", "conceptId": "c1", "mastery": 0.8, "trend": "improving"})
    await client.post("/analytics/payload", headers=CLIENT_HEADERS, json={**VALID, "studentId": "s2", "conceptId": "c1", "mastery": 0.4, "trend": "still_weak"})
    await client.post("/analytics/payload", headers=CLIENT_HEADERS, json={**VALID, "studentId": "s3", "conceptId": "c2", "mastery": 0.1, "trend": "new_gap"})

    r = await client.get("/analytics/summary", headers=teacher_headers)
    assert r.status_code == 200
    body = r.json()
    assert body == [
        {
            "conceptId": "c1",
            "studentCount": 2,
            "avgMastery": 0.6,
            "trendCounts": {"improving": 1, "still_weak": 1, "new_gap": 0},
        },
        {
            "conceptId": "c2",
            "studentCount": 1,
            "avgMastery": 0.1,
            "trendCounts": {"improving": 0, "still_weak": 0, "new_gap": 1},
        },
    ]


async def test_teacher_dashboard_empty(client, teacher_headers):
    r = await client.get("/analytics/teacher-dashboard", headers=teacher_headers)
    assert r.status_code == 200
    data = r.json()
    assert data["overview"]["classroomCount"] == 0
    assert data["classrooms"] == []
    assert data["concepts"] == []
    assert data["students"] == []
    assert data["tests"] == []


async def test_teacher_dashboard_with_data_and_filtering(client, teacher_headers):
    import json
    from datetime import datetime, timezone
    from app.core.db import (
        ClassroomRow,
        ConceptRow,
        EnrollmentRow,
        SubmissionRow,
        TestRow,
        UserRow,
        AnalysisPayloadRow,
        get_db,
    )
    from app.main import app

    now = datetime.now(timezone.utc)
    # Obtain db session
    override = app.dependency_overrides.get(get_db)
    async for db in override():
        # Setup teacher
        t1 = UserRow(id="teacher1", name="Prof Turing", email="turing@example.com", password_hash="hash", role="teacher")
        t2 = UserRow(id="teacher2", name="Prof Hopper", email="hopper@example.com", password_hash="hash", role="teacher")
        # Setup student
        s1 = UserRow(id="stu1", name="Alice Student", email="alice@example.com", password_hash="hash", role="student")
        
        c1 = ClassroomRow(id="cls1", name="Algorithms 101", subject="CS", join_code="ALGO1", teacher_id="teacher1")
        c2 = ClassroomRow(id="cls2", name="Systems 101", subject="CS", join_code="SYS1", teacher_id="teacher1")
        c_other = ClassroomRow(id="cls_other", name="Other Room", subject="Math", join_code="MTH1", teacher_id="teacher2")
        
        e1 = EnrollmentRow(id="enr1", classroom_id="cls1", student_id="stu1", enrolled_at=now)
        con1 = ConceptRow(id="c-dijkstra", classroom_id="cls1", name="Dijkstra's Algorithm", normalized_name="dijkstra")
        
        q1 = {
            "id": "q1",
            "prompt": "What is the complexity of Dijkstra?",
            "type": "mcq",
            "answer": "O(E log V)",
            "conceptId": "c-dijkstra",
            "options": ["O(E log V)", "O(V^3)", "O(1)"],
        }
        test1 = TestRow(
            id="t1",
            title="Dijkstra Quiz",
            classroom_id="cls1",
            duration_min=15,
            status="published",
            concept_ids=json.dumps(["c-dijkstra"]),
            questions=json.dumps([q1]),
            created_at=now,
        )
        sub1 = SubmissionRow(
            id="sub1",
            test_id="t1",
            student_id="stu1",
            score=100.0,
            answers=json.dumps({"q1": "O(E log V)"}),
            is_late=False,
            submitted_at=now,
        )
        pay1 = AnalysisPayloadRow(
            id="p1",
            student_id="stu1",
            concept_id="c-dijkstra",
            mastery=45.0,  # struggling (<55)
            trend="still_weak",
            computed_at=now,
        )
        db.add_all([t1, t2, s1, c1, c2, c_other, e1, con1, test1, sub1, pay1])
        await db.commit()
        break

    # 1. Fetch dashboard without filter (All Classrooms)
    r = await client.get("/analytics/teacher-dashboard", headers=teacher_headers)
    assert r.status_code == 200
    res = r.json()
    assert res["overview"]["classroomCount"] == 2
    assert res["overview"]["studentCount"] == 1
    assert res["overview"]["totalSubmissionCount"] == 1
    assert res["overview"]["weakConceptCount"] == 1
    assert len(res["classrooms"]) == 2
    assert len(res["allClassrooms"]) == 2
    
    # Check concept drilldown
    assert len(res["concepts"]) == 1
    con_res = res["concepts"][0]
    assert con_res["name"] == "Dijkstra's Algorithm"
    assert con_res["status"] == "Needs Attention"
    assert con_res["strugglingCount"] == 1
    assert len(con_res["students"]) == 1
    assert con_res["students"][0]["name"] == "Alice Student"
    assert con_res["students"][0]["mastery"] == 45.0

    # Check student support
    assert len(res["students"]) == 1
    stu_res = res["students"][0]
    assert stu_res["name"] == "Alice Student"
    assert stu_res["weakConceptCount"] == 1
    assert stu_res["classroomName"] == "Algorithms 101"

    # Check test performance & question analytics
    assert len(res["tests"]) == 1
    t_res = res["tests"][0]
    assert t_res["title"] == "Dijkstra Quiz"
    assert t_res["completionRate"] == 100.0
    assert len(t_res["questions"]) == 1
    assert t_res["questions"][0]["correctPercentage"] == 100.0

    # 2. Filter by cls1
    r_cls1 = await client.get(f"/analytics/teacher-dashboard?classroom_id=cls1", headers=teacher_headers)
    assert r_cls1.status_code == 200
    d_cls1 = r_cls1.json()
    assert d_cls1["selectedClassroomId"] == "cls1"
    assert d_cls1["overview"]["classroomCount"] == 1
    assert len(d_cls1["concepts"]) == 1

    # 3. Filter by cls2 (which has no students or tests)
    r_cls2 = await client.get(f"/analytics/teacher-dashboard?classroom_id=cls2", headers=teacher_headers)
    assert r_cls2.status_code == 200
    d_cls2 = r_cls2.json()
    assert d_cls2["selectedClassroomId"] == "cls2"
    assert d_cls2["overview"]["studentCount"] == 0
    assert len(d_cls2["concepts"]) == 0

    # 4. Filter by non-existent classroom
    r_404 = await client.get("/analytics/teacher-dashboard?classroom_id=nonexistent", headers=teacher_headers)
    assert r_404.status_code == 404

    # 5. Filter by classroom owned by another teacher -> 403 Forbidden
    r_403 = await client.get("/analytics/teacher-dashboard?classroom_id=cls_other", headers=teacher_headers)
    assert r_403.status_code == 403

