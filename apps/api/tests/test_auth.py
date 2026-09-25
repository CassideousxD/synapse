from httpx import ASGITransport, AsyncClient
import pytest

from app.main import app
from tests.conftest import CLIENT_HEADERS

VALID = {
    "studentId": "s1", "conceptId": "c1", "mastery": 0.5,
    "trend": "still_weak", "computedAt": "2026-01-01T00:00:00Z",
}


async def test_login_success_returns_jwt(client):
    r = await client.post("/auth/login", json={"username": "teacher1", "password": "correct-horse"})
    assert r.status_code == 200
    assert r.json()["tokenType"] == "bearer"
    assert len(r.json()["accessToken"]) > 20


async def test_login_wrong_password_rejected(client):
    r = await client.post("/auth/login", json={"username": "teacher1", "password": "wrong"})
    assert r.status_code == 401


async def test_login_unknown_username_rejected(client):
    r = await client.post("/auth/login", json={"username": "nope", "password": "correct-horse"})
    assert r.status_code == 401


async def test_teacher_token_unlocks_summary(client, teacher_headers):
    r = await client.get("/analytics/summary", headers=teacher_headers)
    assert r.status_code == 200


async def test_summary_without_token_rejected(client):
    r = await client.get("/analytics/summary")
    assert r.status_code == 401


async def test_summary_with_garbage_token_rejected(client):
    r = await client.get("/analytics/summary", headers={"Authorization": "Bearer not-a-real-jwt"})
    assert r.status_code == 401


async def test_summary_with_client_secret_still_rejected(client):
    r = await client.get("/analytics/summary", headers=CLIENT_HEADERS)
    assert r.status_code == 401


async def test_ingest_without_client_secret_rejected(client):
    r = await client.post("/analytics/payload", json=VALID)
    assert r.status_code == 401


async def test_ingest_with_wrong_client_secret_rejected(client):
    r = await client.post("/analytics/payload", json=VALID, headers={"Authorization": "Bearer wrong-secret"})
    assert r.status_code == 401


async def test_ingest_with_teacher_jwt_rejected(client, teacher_headers):
    r = await client.post("/analytics/payload", json=VALID, headers=teacher_headers)
    assert r.status_code == 401


async def test_teacher_registration_and_login(client):
    reg = await client.post(
        "/auth/register/teacher",
        json={"name": "Dr. Ananya Raman", "email": "raman@university.edu", "password": "secure-password-123"},
    )
    assert reg.status_code == 201
    data = reg.json()
    assert data["tokenType"] == "bearer"
    assert data["user"]["role"] == "teacher"
    assert data["user"]["email"] == "raman@university.edu"
    assert data["user"]["name"] == "Dr. Ananya Raman"
    token = data["accessToken"]

    # Verify /auth/me with new token
    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["role"] == "teacher"
    assert me.json()["id"] == data["user"]["id"]

    # Login with email
    login_resp = await client.post(
        "/auth/login",
        json={"email": "raman@university.edu", "password": "secure-password-123"},
    )
    assert login_resp.status_code == 200
    assert login_resp.json()["user"]["role"] == "teacher"


async def test_student_registration_and_login(client):
    reg = await client.post(
        "/auth/register/student",
        json={"name": "Arjun Kumar", "email": "arjun@college.edu", "password": "student-password-456"},
    )
    assert reg.status_code == 201
    data = reg.json()
    assert data["user"]["role"] == "student"
    assert data["user"]["email"] == "arjun@college.edu"
    token = data["accessToken"]

    # Verify /auth/me
    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["role"] == "student"

    # Login with email
    login_resp = await client.post(
        "/auth/login",
        json={"email": "arjun@college.edu", "password": "student-password-456"},
    )
    assert login_resp.status_code == 200
    assert login_resp.json()["user"]["role"] == "student"


async def test_duplicate_registration_rejected(client):
    req_data = {"name": "Priya Sharma", "email": "priya@college.edu", "password": "password123"}
    r1 = await client.post("/auth/register/student", json=req_data)
    assert r1.status_code == 201

    r2 = await client.post("/auth/register/student", json=req_data)
    assert r2.status_code == 409
    assert "already exists" in r2.json()["detail"]


async def test_student_forbidden_from_teacher_route(client):
    reg = await client.post(
        "/auth/register/student",
        json={"name": "Student A", "email": "studenta@college.edu", "password": "password123"},
    )
    token = reg.json()["accessToken"]

    # Analytics summary requires teacher role
    r = await client.get("/analytics/summary", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
    assert "Teacher role required" in r.json()["detail"]
