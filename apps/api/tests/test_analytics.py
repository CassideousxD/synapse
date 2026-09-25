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
