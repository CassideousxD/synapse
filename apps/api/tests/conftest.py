import os

import pytest


@pytest.fixture(autouse=True)
def _auth_env(monkeypatch):
    from app.core.security import hash_password

    monkeypatch.setenv("SYNAPSE_CLIENT_SECRET", "test-client-secret")
    monkeypatch.setenv("JWT_SECRET", "test-jwt-secret-that-is-long-enough")
    monkeypatch.setenv("TEACHER_USERNAME", "teacher1")
    monkeypatch.setenv("TEACHER_PASSWORD_HASH", hash_password("correct-horse"))


CLIENT_HEADERS = {"Authorization": "Bearer test-client-secret"}


@pytest.fixture
def teacher_headers():
    from app.core.security import create_access_token

    token = create_access_token("teacher1")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def client():
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.core.db import Base, get_db
    from app.main import app

    from sqlalchemy.pool import StaticPool

    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    TestSession = async_sessionmaker(engine, expire_on_commit=False)

    async def override_get_db():
        async with TestSession() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
    await engine.dispose()