import asyncio
from unittest.mock import patch
import pytest

from app.curriculum.tagging import ProposedConcept
from app.llm.client import NimError


@pytest.fixture(autouse=True)
def _mock_extractor(monkeypatch):
    async def mock_extract(source_text: str, title: str = "", **kwargs):
        name = title.strip() or "Core Concept"
        return [ProposedConcept(name=name, summary=f"Summary of {name}.", relatedNames=[])]

    monkeypatch.setattr("app.routers.notes.extract_concepts", mock_extract)


@pytest.mark.asyncio
async def test_normal_note_processing_lifecycle(client):
    import uuid
    uid = uuid.uuid4().hex[:6]
    # 1. Register teacher and create classroom
    t_res = await client.post(
        "/auth/register/teacher",
        json={"name": "Prof Processing", "email": f"proc_teacher_{uid}@test.edu", "password": "password123"},
    )
    assert t_res.status_code == 201
    t_headers = {"Authorization": f"Bearer {t_res.json()['accessToken']}"}

    c_res = await client.post(
        "/classrooms",
        json={"name": "Operating Systems", "subject": "CS"},
        headers=t_headers,
    )
    assert c_res.status_code == 201
    class_id = c_res.json()["id"]

    # 2. Teacher uploads note - verify immediate 201 with status="PROCESSING"
    create_res = await client.post(
        "/notes",
        json={
            "title": "Virtual Memory",
            "classroomId": class_id,
            "content": "# Virtual Memory\nPaging translates virtual addresses to physical frames.",
            "published": True,
        },
        headers=t_headers,
    )
    assert create_res.status_code == 201
    note = create_res.json()
    assert note["status"] == "PROCESSING"
    assert note["conceptIds"] == []
    note_id = note["id"]

    # 3. Query notes list immediately - shows note with status="PROCESSING"
    list_res = await client.get(f"/notes?classroomId={class_id}", headers=t_headers)
    assert list_res.status_code == 200
    listed_note = next(n for n in list_res.json() if n["id"] == note_id)
    assert listed_note["status"] == "PROCESSING"

    # 4. Wait for background AI extraction to finish
    ready_note = None
    poll_res = None
    for _ in range(80):
        await asyncio.sleep(0.1)
        poll_res = await client.get(f"/notes/{note_id}", headers=t_headers)
        if poll_res.json().get("status") == "READY":
            ready_note = poll_res.json()
            break

    assert ready_note is not None, f"Final poll result: {poll_res.json() if poll_res else None}"
    assert ready_note["status"] == "READY"
    assert len(ready_note["conceptIds"]) >= 1


@pytest.mark.asyncio
async def test_multiple_concurrent_notes_processing(client):
    import uuid
    uid = uuid.uuid4().hex[:6]
    t_res = await client.post(
        "/auth/register/teacher",
        json={"name": "Prof Multi", "email": f"multi_teacher_{uid}@test.edu", "password": "password123"},
    )
    t_headers = {"Authorization": f"Bearer {t_res.json()['accessToken']}"}

    c_res = await client.post(
        "/classrooms",
        json={"name": "Database Systems", "subject": "CS"},
        headers=t_headers,
    )
    class_id = c_res.json()["id"]

    # Upload Note A and Note B in rapid succession
    res_a = await client.post(
        "/notes",
        json={
            "title": "Indexing & B-Trees",
            "classroomId": class_id,
            "content": "B-Trees provide balanced logarithmic search and index structures.",
            "published": True,
        },
        headers=t_headers,
    )
    res_b = await client.post(
        "/notes",
        json={
            "title": "Transactions & ACID",
            "classroomId": class_id,
            "content": "ACID properties ensure reliable processing of database transactions.",
            "published": True,
        },
        headers=t_headers,
    )

    note_a = res_a.json()
    note_b = res_b.json()
    assert note_a["status"] == "PROCESSING"
    assert note_b["status"] == "PROCESSING"
    assert note_a["id"] != note_b["id"]

    # Both independently finish
    for _ in range(80):
        await asyncio.sleep(0.1)
        poll_a = (await client.get(f"/notes/{note_a['id']}", headers=t_headers)).json()
        poll_b = (await client.get(f"/notes/{note_b['id']}", headers=t_headers)).json()
        if poll_a.get("status") == "READY" and poll_b.get("status") == "READY":
            break

    assert poll_a["status"] == "READY"
    assert poll_b["status"] == "READY"
    assert len(poll_a["conceptIds"]) >= 1
    assert len(poll_b["conceptIds"]) >= 1


@pytest.mark.asyncio
async def test_extraction_failure_and_retry(client):
    import uuid
    uid = uuid.uuid4().hex[:6]
    t_res = await client.post(
        "/auth/register/teacher",
        json={"name": "Prof Failure", "email": f"fail_teacher_{uid}@test.edu", "password": "password123"},
    )
    t_headers = {"Authorization": f"Bearer {t_res.json()['accessToken']}"}

    c_res = await client.post(
        "/classrooms",
        json={"name": "Compilers", "subject": "CS"},
        headers=t_headers,
    )
    class_id = c_res.json()["id"]

    # Mock extract_concepts to fail on first attempt
    with patch("app.routers.notes.extract_concepts", side_effect=RuntimeError("AI API connection timed out")):
        res = await client.post(
            "/notes",
            json={
                "title": "Lexical Analysis",
                "classroomId": class_id,
                "content": "Lexers tokenize source code into tokens.",
                "published": True,
            },
            headers=t_headers,
        )
        assert res.status_code == 201
        failed_note_id = res.json()["id"]

        # Wait for error handler to set status="FAILED"
        for _ in range(50):
            await asyncio.sleep(0.05)
            poll = (await client.get(f"/notes/{failed_note_id}", headers=t_headers)).json()
            if poll.get("status") == "FAILED":
                break

        assert poll["status"] == "FAILED"

    # Now retry note extraction (without failure mock)
    retry_res = await client.post(f"/notes/{failed_note_id}/retry", headers=t_headers)
    assert retry_res.status_code == 200
    retried = retry_res.json()
    assert retried["status"] == "PROCESSING"

    # Wait for retry to succeed
    for _ in range(50):
        await asyncio.sleep(0.05)
        poll = (await client.get(f"/notes/{failed_note_id}", headers=t_headers)).json()
        if poll.get("status") == "READY":
            break

    assert poll["status"] == "READY"
    assert len(poll["conceptIds"]) >= 1


@pytest.mark.asyncio
async def test_existing_notes_remain_ready(client):
    t_res = await client.post(
        "/auth/register/teacher",
        json={"name": "Prof Existing", "email": "exist_teacher@test.edu", "password": "password123"},
    )
    t_headers = {"Authorization": f"Bearer {t_res.json()['accessToken']}"}

    c_res = await client.post(
        "/classrooms",
        json={"name": "Discrete Math", "subject": "Math"},
        headers=t_headers,
    )
    class_id = c_res.json()["id"]

    # When conceptIds is already supplied, note is immediately READY
    res = await client.post(
        "/notes",
        json={
            "title": "Set Theory",
            "classroomId": class_id,
            "conceptIds": ["c-sets-1"],
            "published": True,
        },
        headers=t_headers,
    )
    assert res.status_code == 201
    data = res.json()
    assert data["status"] == "READY"
    assert data["conceptIds"] == ["c-sets-1"]
