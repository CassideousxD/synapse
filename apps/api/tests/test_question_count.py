import uuid
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.core.db import ClassroomRow, ConceptRow, SessionLocal, engine
from app.core.redis import close_redis, init_redis
from app.main import app
from app.routers.tests import GenerateQuestionsRequest


@pytest_asyncio.fixture
async def client(monkeypatch):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "true")
    r = await init_redis()
    cursor = 0
    while True:
        cursor, keys = await r.scan(cursor=cursor, match="synapse:rl:*", count=100)
        if keys:
            await r.delete(*keys)
        if cursor == 0:
            break
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    await close_redis()
    await engine.dispose()


def test_generate_questions_request_schema_validation():
    # Default count is 5
    req_default = GenerateQuestionsRequest(classroomId="room-1")
    assert req_default.count == 5

    # Boundary valid values: 1, 3, 5, 8, 15, 30
    for valid_count in [1, 3, 5, 8, 15, 30]:
        req = GenerateQuestionsRequest(classroomId="room-1", count=valid_count)
        assert req.count == valid_count

    # Invalid boundary values: 0, -1, 31, 100
    for invalid_count in [0, -1, -5, 31, 100]:
        with pytest.raises(ValidationError):
            GenerateQuestionsRequest(classroomId="room-1", count=invalid_count)


@pytest.fixture(autouse=True)
def _mock_mcq_generation(monkeypatch):
    call_counter = 0

    async def mock_generate_mcq(concept_id: str, concept_name: str, concept_summary: str, *args, **kwargs):
        nonlocal call_counter
        call_counter += 1
        return {
            "id": f"q-{concept_id}-{call_counter}",
            "type": "mcq",
            "prompt": f"Test question {call_counter} on {concept_name}",
            "options": ["Opt A", "Opt B", "Opt C", "Opt D"],
            "answer": "Opt A",
            "conceptId": concept_id,
        }

    monkeypatch.setattr("app.routers.tests.generate_mcq_for_concept", mock_generate_mcq)


@pytest.mark.asyncio
async def test_generate_questions_boundary_and_count_control(client):
    uid = uuid.uuid4().hex[:6]

    # Register Teacher
    t_res = await client.post(
        "/auth/register/teacher",
        json={"name": "Teacher Count", "email": f"teacher_count_{uid}@test.edu", "password": "password123"},
    )
    assert t_res.status_code == 201
    t_data = t_res.json()
    t_id = t_data["user"]["id"]
    t_headers = {"Authorization": f"Bearer {t_data['accessToken']}"}

    # Setup Classroom and Concepts in DB
    room_id = f"room-count-{uid}"
    c1_id = f"c1-{uid}"
    c2_id = f"c2-{uid}"
    c3_id = f"c3-{uid}"
    c4_id = f"c4-{uid}"
    c5_id = f"c5-{uid}"

    async with SessionLocal() as session:
        session.add(ClassroomRow(id=room_id, name="Networking 101", subject="CS", teacher_id=t_id, join_code=f"NET{uid[:4]}"))
        session.add(ConceptRow(id=c1_id, classroom_id=room_id, name="Routing", normalized_name="routing", description="Dynamic routing"))
        session.add(ConceptRow(id=c2_id, classroom_id=room_id, name="Switching", normalized_name="switching", description="Ethernet switching"))
        session.add(ConceptRow(id=c3_id, classroom_id=room_id, name="Subnetting", normalized_name="subnetting", description="CIDR and subnets"))
        session.add(ConceptRow(id=c4_id, classroom_id=room_id, name="DNS", normalized_name="dns", description="Domain Name System"))
        session.add(ConceptRow(id=c5_id, classroom_id=room_id, name="TCP", normalized_name="tcp", description="Transmission Control Protocol"))
        await session.commit()

    # 1. Invalid counts rejected with 422
    for bad_count in [0, -1, 31, 50]:
        res = await client.post(
            "/tests/generate-questions",
            json={"classroomId": room_id, "conceptIds": [c1_id], "count": bad_count},
            headers=t_headers,
        )
        assert res.status_code == 422, f"Expected 422 for count={bad_count}, got {res.status_code}"

    # 2. Omitted count defaults to 5
    res_default = await client.post(
        "/tests/generate-questions",
        json={"classroomId": room_id, "conceptIds": [c1_id]},
        headers=t_headers,
    )
    assert res_default.status_code == 200
    assert len(res_default.json()) == 5

    # 3. Exactly 1 concept + count = 8 -> generates 8 questions
    res_1_concept_8_q = await client.post(
        "/tests/generate-questions",
        json={"classroomId": room_id, "conceptIds": [c1_id], "count": 8},
        headers=t_headers,
    )
    assert res_1_concept_8_q.status_code == 200
    questions_8 = res_1_concept_8_q.json()
    assert len(questions_8) == 8
    assert all(q["conceptId"] == c1_id for q in questions_8)

    # 4. Multiple concepts (5) + count = 2 -> generates 2 questions (less than concept count)
    res_5_concept_2_q = await client.post(
        "/tests/generate-questions",
        json={"classroomId": room_id, "conceptIds": [c1_id, c2_id, c3_id, c4_id, c5_id], "count": 2},
        headers=t_headers,
    )
    assert res_5_concept_2_q.status_code == 200
    questions_2 = res_5_concept_2_q.json()
    assert len(questions_2) == 2

    # 5. Boundary valid values: 1 and 30
    res_1 = await client.post(
        "/tests/generate-questions",
        json={"classroomId": room_id, "conceptIds": [c1_id], "count": 1},
        headers=t_headers,
    )
    assert res_1.status_code == 200
    assert len(res_1.json()) == 1

    res_30 = await client.post(
        "/tests/generate-questions",
        json={"classroomId": room_id, "conceptIds": [c1_id, c2_id], "count": 30},
        headers=t_headers,
    )
    assert res_30.status_code == 200
    assert len(res_30.json()) == 30
