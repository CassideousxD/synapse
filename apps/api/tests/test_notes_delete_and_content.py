import asyncio
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_notes_content_and_delete_lifecycle(client):
    import uuid
    uid = uuid.uuid4().hex[:6]
    # 1. Register teacher 1 and student 1
    t1_res = await client.post(
        "/auth/register/teacher",
        json={"name": "Teacher Net", "email": f"tnet_{uid}@example.com", "password": "password123"},
    )
    assert t1_res.status_code == 201
    t1_token = t1_res.json()["accessToken"]
    t1_h = {"Authorization": f"Bearer {t1_token}"}

    t2_res = await client.post(
        "/auth/register/teacher",
        json={"name": "Teacher Other", "email": f"tother_{uid}@example.com", "password": "password123"},
    )
    assert t2_res.status_code == 201
    t2_h = {"Authorization": f"Bearer {t2_res.json()['accessToken']}"}

    s1_res = await client.post(
        "/auth/register/student",
        json={"name": "Student Net", "email": f"snet_{uid}@example.com", "password": "password123"},
    )
    assert s1_res.status_code == 201
    s1_token = s1_res.json()["accessToken"]
    s1_h = {"Authorization": f"Bearer {s1_token}"}

    # 2. Teacher 1 creates classroom
    c_res = await client.post(
        "/classrooms",
        json={"name": "Computer Networks", "subject": "Networking"},
        headers=t1_h,
    )
    assert c_res.status_code == 201
    class_id = c_res.json()["id"]
    join_code = c_res.json()["joinCode"]

    # Student joins classroom
    j_res = await client.post(
        "/classrooms/join",
        json={"joinCode": join_code},
        headers=s1_h,
    )
    assert j_res.status_code == 200

    # 3. Teacher uploads OSI Model note with Markdown content
    osi_markdown = """# OSI Model

The Open Systems Interconnection (OSI) model is a conceptual framework that standardizes network communication into seven distinct layers.

## 1. Physical Layer

The Physical Layer is responsible for transmitting raw unstructured bit streams over physical media.

- Voltage levels and timing
- Physical cables and connectors
- Pin layout and transmission rates

## 2. Data Link Layer

The Data Link Layer provides node-to-node data transfer across a physical network segment.

- Framing data into frames
- Physical MAC addressing
- Error detection and flow control
"""

    note1_res = await client.post(
        "/notes",
        json={
            "title": "OSI Model",
            "classroomId": class_id,
            "content": osi_markdown,
            "published": True,
        },
        headers=t1_h,
    )
    assert note1_res.status_code == 201
    note1 = note1_res.json()
    assert note1["title"] == "OSI Model"
    assert "Physical Layer" in note1["content"]
    assert len(note1["sections"]) >= 3  # Overview, Physical Layer, Data Link Layer
    assert note1["sections"][0]["heading"] == "Overview"
    assert "seven distinct layers" in note1["sections"][0]["body"]
    assert note1["sections"][1]["heading"] == "1. Physical Layer"
    assert "raw unstructured bit streams" in note1["sections"][1]["body"]
    assert note1["sections"][2]["heading"] == "2. Data Link Layer"
    assert "MAC addressing" in note1["sections"][2]["body"]
    note1_id = note1["id"]

    # 4. Student retrieves the note
    s_note_res = await client.get(f"/notes/{note1_id}", headers=s1_h)
    assert s_note_res.status_code == 200
    s_note = s_note_res.json()
    assert s_note["content"] == osi_markdown.strip()
    assert s_note["content"] != "Uploaded document content."
    assert s_note["sections"][1]["body"] != "Uploaded document content."
    assert "raw unstructured bit streams" in s_note["sections"][1]["body"]

    # 5. Access control checks:
    # Unenrolled student cannot access note
    s2_res = await client.post(
        "/auth/register/student",
        json={"name": "Student Other", "email": f"sother_{uid}@example.com", "password": "password123"},
    )
    s2_h = {"Authorization": f"Bearer {s2_res.json()['accessToken']}"}
    forbidden_res = await client.get(f"/notes/{note1_id}", headers=s2_h)
    assert forbidden_res.status_code == 403

    # Teacher 2 cannot delete Teacher 1's note
    del_forbidden = await client.delete(f"/notes/{note1_id}", headers=t2_h)
    assert del_forbidden.status_code == 403

    # Student cannot delete note
    student_del_forbidden = await client.delete(f"/notes/{note1_id}", headers=s1_h)
    assert student_del_forbidden.status_code == 403

    # 6. Test Shared Concept vs Unique Concept Reconciliation
    # Note A introduces "TCP" and "ARP"
    # Note B introduces "TCP" and "IP"
    note_a_res = await client.post(
        "/notes",
        json={
            "title": "Transport and Resolution",
            "classroomId": class_id,
            "content": "## TCP\nTCP provides reliable transmission.\n\n## ARP\nARP maps IP to MAC.",
            "published": True,
        },
        headers=t1_h,
    )
    assert note_a_res.status_code == 201
    note_a = note_a_res.json()
    note_a_id = note_a["id"]

    note_b_res = await client.post(
        "/notes",
        json={
            "title": "Internet Protocols",
            "classroomId": class_id,
            "content": "## TCP\nTCP transmission control.\n\n## IP\nInternet protocol routing.",
            "published": True,
        },
        headers=t1_h,
    )
    assert note_b_res.status_code == 201
    note_b = note_b_res.json()
    note_b_id = note_b["id"]

    # Wait for background concept extraction on note_a and note_b to finish
    for _ in range(80):
        await asyncio.sleep(0.1)
        res_a = await client.get(f"/notes/{note_a_id}", headers=t1_h)
        res_b = await client.get(f"/notes/{note_b_id}", headers=t1_h)
        if res_a.json().get("status") == "READY" and res_b.json().get("status") == "READY":
            break

    # Check concepts in classroom
    concepts_res = await client.get(f"/classrooms/{class_id}/concepts", headers=t1_h)
    assert concepts_res.status_code == 200
    concepts = concepts_res.json()
    c_names = {c["name"].lower() for c in concepts}
    assert "tcp" in c_names

    # Check if ARP was created
    arp_concepts = [c for c in concepts if "arp" in c["name"].lower()]

    # Student takes a test or has historical assessment record on ARP if applicable
    from app.core.db import AnalysisPayloadRow, SessionLocal
    from datetime import datetime, timezone
    async with SessionLocal() as db:
        if arp_concepts:
            arp_id = arp_concepts[0]["id"]
            db.add(AnalysisPayloadRow(
                id=f"test-payload-arp-{uid}",
                student_id=s1_res.json()["user"]["id"],
                concept_id=arp_id,
                mastery=75.0,
                trend="improving",
                computed_at=datetime.now(timezone.utc),
            ))
            await db.commit()

    # Now Teacher deletes Note A!
    del_res = await client.delete(f"/classrooms/{class_id}/notes/{note_a_id}", headers=t1_h)
    assert del_res.status_code == 200
    del_data = del_res.json()
    assert del_data["status"] == "deleted"

    # Verify Note A is deleted from notes list
    t_notes_after = (await client.get(f"/notes?classroomId={class_id}", headers=t1_h)).json()
    assert not any(n["id"] == note_a_id for n in t_notes_after)

    # Verify TCP remains in classroom concepts because Note B still references it!
    concepts_after = (await client.get(f"/classrooms/{class_id}/concepts", headers=t1_h)).json()
    c_names_after = {c["name"].lower() for c in concepts_after}
    assert "tcp" in c_names_after, "TCP must remain because Note B provides it"

    # Verify ARP is no longer an active curriculum concept in the classroom if Note A was its sole provider
    if arp_concepts:
        assert not any(c["id"] == arp_id for c in concepts_after), "ARP should be removed from active curriculum concepts"

        # Verify historical assessment record for student was NOT deleted
        async with SessionLocal() as db:
            from sqlalchemy import select
            payload = await db.scalar(select(AnalysisPayloadRow).where(AnalysisPayloadRow.id == f"test-payload-arp-{uid}"))
            assert payload is not None, "Historical assessment data must NOT be destroyed"
            assert payload.mastery == 75.0
