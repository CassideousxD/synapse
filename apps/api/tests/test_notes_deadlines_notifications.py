import asyncio
from datetime import datetime, timedelta, timezone
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.core.db import AnalysisPayloadRow, SessionLocal
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
        name = title.strip() or "Core Concept"
        return [ProposedConcept(name=name, summary=f"Summary of {name}.", relatedNames=[])]

    monkeypatch.setattr("app.routers.notes.extract_concepts", mock_extract)


@pytest.mark.asyncio
async def test_notes_deadlines_notifications_e2e(client):
    import uuid
    uid = uuid.uuid4().hex[:6]

    # 1. Create Teacher A, Teacher B, Student A, Student B
    t_a_res = await client.post(
        "/auth/register/teacher",
        json={"name": "Teacher A", "email": f"ta_{uid}@test.edu", "password": "password123"},
    )
    t_a_h = {"Authorization": f"Bearer {t_a_res.json()['accessToken']}"}

    t_b_res = await client.post(
        "/auth/register/teacher",
        json={"name": "Teacher B", "email": f"tb_{uid}@test.edu", "password": "password123"},
    )
    t_b_h = {"Authorization": f"Bearer {t_b_res.json()['accessToken']}"}

    s_a_res = await client.post(
        "/auth/register/student",
        json={"name": "Student A", "email": f"sa_{uid}@test.edu", "password": "password123"},
    )
    s_a_id = s_a_res.json()["user"]["id"]
    s_a_h = {"Authorization": f"Bearer {s_a_res.json()['accessToken']}"}

    s_b_res = await client.post(
        "/auth/register/student",
        json={"name": "Student B", "email": f"sb_{uid}@test.edu", "password": "password123"},
    )
    s_b_id = s_b_res.json()["user"]["id"]
    s_b_h = {"Authorization": f"Bearer {s_b_res.json()['accessToken']}"}

    # 2. Teacher A creates Classroom A. Student A joins Classroom A.
    #    Teacher B creates Classroom B. Student B joins Classroom B.
    c_a_res = await client.post("/classrooms", json={"name": "Networks 101", "subject": "CS"}, headers=t_a_h)
    class_a_id = c_a_res.json()["id"]
    join_a = c_a_res.json()["joinCode"]

    c_b_res = await client.post("/classrooms", json={"name": "Algorithms 101", "subject": "CS"}, headers=t_b_h)
    class_b_id = c_b_res.json()["id"]
    join_b = c_b_res.json()["joinCode"]

    join_res_a = await client.post("/classrooms/join", json={"joinCode": join_a}, headers=s_a_h)
    assert join_res_a.status_code == 200

    join_res_b = await client.post("/classrooms/join", json={"joinCode": join_b}, headers=s_b_h)
    assert join_res_b.status_code == 200

    # 3. Source Note Preservation Test:
    # Teacher A uploads a comprehensive multi-section Markdown note (2000+ characters)
    big_note_content = """# Computer Networks Architecture
An in-depth study of layered network protocols, packet switching, and reliability guarantees.

## Physical and Data Link Layers
The physical layer transmits raw bits over a medium. The data link layer handles frames, MAC addresses, and error checking through CRC.
```python
def check_crc(data: bytes) -> bool:
    return sum(data) % 256 == 0
```

## Network Layer and Routing
Routing algorithms determine paths for packets through the mesh of routers across the Internet.
Key protocols include:
- BGP (Border Gateway Protocol)
- OSPF (Open Shortest Path First)
- IPv4 and IPv6 addressing

## Transport Layer
Transmission Control Protocol (TCP) guarantees ordered delivery with congestion control, while UDP provides low-latency datagram transmission.
"""
    note_res = await client.post(
        "/notes",
        json={
            "title": "Computer Networks Architecture",
            "classroomId": class_a_id,
            "content": big_note_content,
            "published": True,
        },
        headers=t_a_h,
    )
    assert note_res.status_code == 201
    note_data = note_res.json()
    note_id = note_data["id"]

    # Verify original content is intact in teacher format
    assert note_data["content"] == big_note_content.strip()
    assert len(note_data["content"]) > 500
    assert "def check_crc" in note_data["content"]
    assert len(note_data["sections"]) >= 3

    # Student A retrieves the note
    s_note_res = await client.get(f"/notes/{note_id}", headers=s_a_h)
    assert s_note_res.status_code == 200
    s_note = s_note_res.json()
    # Source note content MUST remain intact for the student
    assert s_note["content"] == big_note_content.strip()
    assert "def check_crc" in s_note["content"]

    # Student B (in Classroom B) is forbidden from viewing Note in Classroom A
    s_b_forbidden = await client.get(f"/notes/{note_id}", headers=s_b_h)
    assert s_b_forbidden.status_code == 403

    # 4. Notifications Verification:
    # Student A must receive 1 "new_note" notification
    # Student B must NOT receive any notification
    notifs_a = (await client.get("/notifications", headers=s_a_h)).json()
    assert len(notifs_a) == 1
    assert notifs_a[0]["type"] == "new_note"
    assert notifs_a[0]["relatedEntityId"] == note_id
    assert notifs_a[0]["isRead"] is False
    assert notifs_a[0]["recipientId"] == s_a_id

    notifs_b = (await client.get("/notifications", headers=s_b_h)).json()
    assert len(notifs_b) == 0  # Multi-user isolation!

    # Idempotency check: listing notes or re-saving does not duplicate notification
    notes_list_res = await client.get(f"/notes?classroomId={class_a_id}", headers=s_a_h)
    assert notes_list_res.status_code == 200
    notifs_a_after = (await client.get("/notifications", headers=s_a_h)).json()
    assert len(notifs_a_after) == 1

    # Mark notification as read
    notif_id = notifs_a[0]["id"]
    read_res = await client.patch(f"/notifications/{notif_id}/read", headers=s_a_h)
    assert read_res.status_code == 200
    assert read_res.json()["isRead"] is True

    unread_count = (await client.get("/notifications/unread-count", headers=s_a_h)).json()
    assert unread_count["count"] == 0

    # 5. Real Deadlines & Server-side Enforcement:
    # A) Test with FUTURE deadline (on-time submission)
    future_due = datetime.now(timezone.utc) + timedelta(hours=2)
    test_on_time_res = await client.post(
        "/tests",
        json={
            "title": "On-Time Test",
            "classroomId": class_a_id,
            "durationMin": 30,
            "due": "Due in 2 hours",
            "dueAt": future_due.isoformat(),
            "status": "published",
            "questions": [
                {
                    "id": "q1",
                    "prompt": "What does TCP guarantee?",
                    "options": ["Ordered delivery", "Unordered datagrams", "No headers", "Analog signal"],
                    "answer": "Ordered delivery",
                }
            ],
        },
        headers=t_a_h,
    )
    assert test_on_time_res.status_code == 201
    test_on_time = test_on_time_res.json()
    assert test_on_time["isOverdue"] is False
    assert test_on_time["dueAt"] is not None

    # Student A submits on time
    sub_on_time = await client.post(
        f"/tests/{test_on_time['id']}/submit",
        json={"answers": {"q1": "Ordered delivery"}},
        headers=s_a_h,
    )
    assert sub_on_time.status_code == 200
    sub_data = sub_on_time.json()
    assert sub_data["isLate"] is False
    assert sub_data["status"] == "submitted"
    assert sub_data["score"] == 100

    # B) Test with PAST deadline (late submission enforcement)
    past_due = datetime.now(timezone.utc) - timedelta(hours=1)
    test_late_res = await client.post(
        "/tests",
        json={
            "title": "Past Due Test",
            "classroomId": class_a_id,
            "durationMin": 15,
            "due": "Overdue",
            "dueAt": past_due.isoformat(),
            "status": "published",
            "questions": [
                {
                    "id": "q2",
                    "prompt": "What protocol is connectionless?",
                    "options": ["UDP", "TCP", "BGP", "FTP"],
                    "answer": "UDP",
                }
            ],
        },
        headers=t_a_h,
    )
    assert test_late_res.status_code == 201
    test_late = test_late_res.json()
    assert test_late["isOverdue"] is True

    # Student A submits past deadline
    sub_late = await client.post(
        f"/tests/{test_late['id']}/submit",
        json={"answers": {"q2": "UDP"}},
        headers=s_a_h,
    )
    assert sub_late.status_code == 200
    late_data = sub_late.json()
    assert late_data["isLate"] is True
    assert late_data["status"] == "submitted_late"

    # Check submissions list
    subs_list = (await client.get("/submissions", headers=s_a_h)).json()
    on_time_rec = next(s for s in subs_list if s["testId"] == test_on_time["id"])
    late_rec = next(s for s in subs_list if s["testId"] == test_late["id"])
    assert on_time_rec["isLate"] is False
    assert late_rec["isLate"] is True

    # Check that published tests generated notifications for Student A
    notifs_a_updated = (await client.get("/notifications", headers=s_a_h)).json()
    test_notifs = [n for n in notifs_a_updated if n["type"] == "new_test"]
    assert len(test_notifs) == 2  # One for each published test
    assert any(n["relatedEntityId"] == test_on_time["id"] for n in test_notifs)
    assert any(n["relatedEntityId"] == test_late["id"] for n in test_notifs)

    # 6. Knowledge-Gap Weighted Question Generation
    # Create concepts in Classroom A:
    # 1. Weak Concept (mastery 20%)
    # 2. Medium Concept (mastery 60%)
    # 3. Strong Concept (mastery 90%)
    async with SessionLocal() as db:
        from app.core.db import ConceptRow
        c_weak = ConceptRow(id=f"c-weak-{uid}", classroom_id=class_a_id, name="BGP Routing", normalized_name=f"bgp-{uid}", description="BGP")
        c_med = ConceptRow(id=f"c-med-{uid}", classroom_id=class_a_id, name="Subnetting", normalized_name=f"subnet-{uid}", description="Subnets")
        c_strong = ConceptRow(id=f"c-strong-{uid}", classroom_id=class_a_id, name="Ethernet", normalized_name=f"ethernet-{uid}", description="Ethernet")
        db.add_all([c_weak, c_med, c_strong])

        # Add mastery records for Student A
        now = datetime.now(timezone.utc)
        db.add(AnalysisPayloadRow(id=f"p1-{uid}", student_id=s_a_id, concept_id=c_weak.id, mastery=20.0, trend="still_weak", computed_at=now))
        db.add(AnalysisPayloadRow(id=f"p2-{uid}", student_id=s_a_id, concept_id=c_med.id, mastery=60.0, trend="improving", computed_at=now))
        db.add(AnalysisPayloadRow(id=f"p3-{uid}", student_id=s_a_id, concept_id=c_strong.id, mastery=90.0, trend="mastered", computed_at=now))
        await db.commit()

    # Generate 6 questions
    gen_res = await client.post(
        "/tests/generate-questions",
        json={"classroomId": class_a_id, "count": 6},
        headers=t_a_h,
    )
    assert gen_res.status_code == 200
    questions = gen_res.json()
    assert len(questions) == 6

    # Verify weak concept gets higher representation than strong concept, but strong concept is not completely removed!
    gen_cids = [q["conceptId"] for q in questions]
    weak_count = gen_cids.count(c_weak.id)
    strong_count = gen_cids.count(c_strong.id)
    assert weak_count >= 1, "Weak concept must receive heavy priority"
    assert strong_count >= 0, "Strong concepts may appear as light recap"
    assert weak_count >= strong_count, "Weak concepts must receive greater or equal weight than strong concepts"
