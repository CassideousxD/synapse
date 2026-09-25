import asyncio
import uuid
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.core.db import AnalysisPayloadRow, ConceptRow, SessionLocal
from app.curriculum.tagging import ProposedConcept
from app.main import app


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture(autouse=True)
def _mock_extractor(monkeypatch):
    async def mock_extract(source_text: str, title: str = "", **kwargs):
        name = title.strip() or "Database Indexing"
        return [
            ProposedConcept(name=name, summary=f"Summary of {name}.", relatedNames=[]),
            ProposedConcept(name="B-Trees", summary="Summary of B-Trees.", relatedNames=[]),
        ]

    monkeypatch.setattr("app.routers.notes.extract_concepts", mock_extract)


@pytest.mark.asyncio
async def test_audit_fixes_e2e(client):
    uid = uuid.uuid4().hex[:6]

    # 1. Register Teacher A, Teacher B, and Student
    t_a_res = await client.post(
        "/auth/register/teacher",
        json={"name": "Prof Audit A", "email": f"profa_{uid}@test.edu", "password": "password123"},
    )
    assert t_a_res.status_code == 201
    t_a_token = t_a_res.json()["accessToken"]
    t_a_headers = {"Authorization": f"Bearer {t_a_token}"}

    t_b_res = await client.post(
        "/auth/register/teacher",
        json={"name": "Prof Audit B", "email": f"profb_{uid}@test.edu", "password": "password123"},
    )
    assert t_b_res.status_code == 201
    t_b_token = t_b_res.json()["accessToken"]
    t_b_headers = {"Authorization": f"Bearer {t_b_token}"}

    s_res = await client.post(
        "/auth/register/student",
        json={"name": "Alice Wonder", "email": f"alice_{uid}@test.edu", "password": "password123"},
    )
    assert s_res.status_code == 201
    s_user = s_res.json()["user"]
    s_id = s_user["id"]
    s_token = s_res.json()["accessToken"]
    s_headers = {"Authorization": f"Bearer {s_token}"}

    # 2. Teacher A creates Classroom A
    c_res = await client.post(
        "/classrooms",
        json={"name": "Databases 401", "subject": "CS"},
        headers=t_a_headers,
    )
    assert c_res.status_code == 201
    class_id = c_res.json()["id"]
    join_code = c_res.json()["joinCode"]

    # 3. Test Note Upload Classroom Ownership Validation
    # Teacher B cannot create note in Teacher A's classroom
    t_b_note_res = await client.post(
        "/notes",
        json={"title": "Hacked Note", "classroomId": class_id, "content": "Should be rejected.", "published": True},
        headers=t_b_headers,
    )
    assert t_b_note_res.status_code == 403

    # Teacher A creates note in their own classroom
    note_res = await client.post(
        "/notes",
        json={
            "title": "B-Tree Indexing",
            "classroomId": class_id,
            "content": "# B-Tree Indexing\nComprehensive guide to storage engines and disk layout.",
            "published": True,
        },
        headers=t_a_headers,
    )
    assert note_res.status_code == 201
    note_id = note_res.json()["id"]

    # Wait briefly for concept extraction
    await asyncio.sleep(0.5)

    # 4. Student joins Classroom A
    join_res = await client.post("/classrooms/join", json={"joinCode": join_code}, headers=s_headers)
    assert join_res.status_code == 200

    # 5. Verify Teacher A received "student_joined" notification
    t_a_notifs = await client.get("/notifications", headers=t_a_headers)
    assert t_a_notifs.status_code == 200
    join_notif = next((n for n in t_a_notifs.json() if n["type"] == "student_joined"), None)
    assert join_notif is not None
    assert "Alice Wonder" in join_notif["message"]
    assert join_notif["relatedEntityType"] == "classroom"
    assert join_notif["relatedEntityId"] == class_id

    # Verify Teacher B does NOT see Teacher A's notification (Isolation)
    t_b_notifs = await client.get("/notifications", headers=t_b_headers)
    assert len(t_b_notifs.json()) == 0

    # 6. Create Test with real concepts
    async with SessionLocal() as session:
        from sqlalchemy import select
        c_query = select(ConceptRow).where(ConceptRow.classroom_id == class_id)
        c_rows = (await session.execute(c_query)).scalars().all()
        assert len(c_rows) > 0
        cid1 = c_rows[0].id
        cname1 = c_rows[0].name
        cid2 = c_rows[1].id if len(c_rows) > 1 else cid1
        cname2 = c_rows[1].name if len(c_rows) > 1 else cname1

    test_create_res = await client.post(
        "/tests",
        json={
            "classroomId": class_id,
            "title": "Midterm Checkpoint",
            "due": "Friday",
            "durationMin": 25,
            "status": "published",
            "conceptIds": [cid1, cid2],
            "questions": [
                {
                    "id": "q1",
                    "prompt": "What is the branching factor of a B-tree?",
                    "options": ["Degree of internal node", "Total tree depth", "Root only", "Leaf count"],
                    "answer": "Degree of internal node",
                    "conceptId": cid1,
                },
                {
                    "id": "q2",
                    "prompt": "How does write amplification occur?",
                    "options": ["Sequential logging", "Page splits and rewrites", "Read caching", "None"],
                    "answer": "Page splits and rewrites",
                    "conceptId": cid2,
                },
            ],
        },
        headers=t_a_headers,
    )
    assert test_create_res.status_code == 201
    test_id = test_create_res.json()["id"]

    # 7. Student submits Test:
    # Answers q1 correctly, q2 incorrectly
    submit_res = await client.post(
        f"/tests/{test_id}/submit",
        json={
            "answers": {
                "q1": "Degree of internal node",
                "q2": "Sequential logging",  # wrong answer
            }
        },
        headers=s_headers,
    )
    assert submit_res.status_code == 200
    res_data = submit_res.json()
    assert res_data["score"] == 50

    # Verify detailedMasteryChanges
    mastery_changes = res_data.get("detailedMasteryChanges", [])
    assert len(mastery_changes) >= 1
    for mc in mastery_changes:
        assert "conceptId" in mc
        assert "conceptName" in mc
        assert "previousMastery" in mc
        assert "newMastery" in mc
        assert "delta" in mc
        assert "testPerformance" in mc
        assert mc["conceptName"] != mc["conceptId"]  # Resolved real concept name

    # Verify revisionConcepts for the concept answered incorrectly
    rev_concepts = res_data.get("revisionConcepts", [])
    assert len(rev_concepts) >= 1
    rev_match = next((rc for rc in rev_concepts if rc["conceptId"] == cid2), None)
    if rev_match:
        assert rev_match["conceptName"] == cname2
        assert "recentPerformance" in rev_match
        assert "reason" in rev_match

    # Verify stored mastery in AnalysisPayloadRow
    async with SessionLocal() as session:
        from sqlalchemy import select
        m_rows = (await session.execute(
            select(AnalysisPayloadRow).where(AnalysisPayloadRow.student_id == s_id)
        )).scalars().all()
        assert len(m_rows) >= 1
        for row in m_rows:
            assert row.mastery >= 0.0
            assert row.computed_at is not None

    # 8. Verify Teacher A received "student_submitted" notification
    t_a_notifs_after = await client.get("/notifications", headers=t_a_headers)
    sub_notif = next((n for n in t_a_notifs_after.json() if n["type"] == "student_submitted"), None)
    assert sub_notif is not None
    assert "Alice Wonder" in sub_notif["message"]
    assert "Midterm Checkpoint" in sub_notif["message"]
    assert sub_notif["relatedEntityType"] == "test"
    assert sub_notif["relatedEntityId"] == test_id

    # 9. Verify Teacher Analytics Dashboard endpoint (GET /analytics/teacher-dashboard)
    dash_res = await client.get("/analytics/teacher-dashboard", headers=t_a_headers)
    assert dash_res.status_code == 200
    dash = dash_res.json()

    # Overview
    overview = dash["overview"]
    assert overview["classroomCount"] == 1
    assert overview["studentCount"] == 1
    assert overview["publishedTestCount"] == 1
    assert overview["totalSubmissionCount"] == 1
    assert overview["averageScore"] == 50.0
    assert overview["averageMastery"] is not None and overview["averageMastery"] > 0

    # Classrooms
    dash_classes = dash["classrooms"]
    assert len(dash_classes) == 1
    c_entry = dash_classes[0]
    assert c_entry["id"] == class_id
    assert c_entry["studentCount"] == 1
    assert c_entry["submissionCount"] == 1
    assert c_entry["averageScore"] == 50.0

    # Leaderboard
    leaderboard = dash["leaderboard"]
    assert len(leaderboard) == 1
    s_entry = leaderboard[0]
    assert s_entry["id"] == s_id
    assert s_entry["name"] == "Alice Wonder"
    assert s_entry["testsCompleted"] == 1
    assert s_entry["avgScore"] == 50.0

    # Recent Activity
    recent_activity = dash["recentActivity"]
    assert len(recent_activity) >= 2
    types = [a["type"] for a in recent_activity]
    assert "submission" in types
    assert "enrollment" in types

    # Teacher B Dashboard Isolation:
    dash_b_res = await client.get("/analytics/teacher-dashboard", headers=t_b_headers)
    assert dash_b_res.status_code == 200
    dash_b = dash_b_res.json()
    assert dash_b["overview"]["classroomCount"] == 0
    assert dash_b["overview"]["studentCount"] == 0
    assert len(dash_b["classrooms"]) == 0
    assert len(dash_b["leaderboard"]) == 0
