import os
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import (
    Base,
    UserRow,
    ClassroomRow,
    EnrollmentRow,
    NoteRow,
    TestRow,
    SubmissionRow,
    NotificationRow,
    AnalysisPayloadRow,
    ConceptRow,
    get_database_url,
)

# Load URL using app's resolver
PG_URL = os.environ.get("TEST_POSTGRES_URL") or get_database_url()
RUN_PG_TESTS = PG_URL is not None and "postgresql" in PG_URL


@pytest.mark.skipif(not RUN_PG_TESTS, reason="PostgreSQL test URL not configured in TEST_POSTGRES_URL or DATABASE_URL")
@pytest.mark.asyncio
async def test_postgres_schema_and_crud():
    engine = create_async_engine(PG_URL, echo=False)
    async_session = async_sessionmaker(engine, expire_on_commit=False)

    async with async_session() as session:
        # 1. Connection check
        res = await session.execute(text("SELECT 1"))
        assert res.scalar() == 1

        # 2. Check all 9 tables exist in database
        tables = [
            "users",
            "classrooms",
            "enrollments",
            "notes",
            "tests",
            "submissions",
            "notifications",
            "analysis_payloads",
            "concepts",
        ]
        for tbl in tables:
            r = await session.execute(text(f"SELECT COUNT(*) FROM {tbl}"))
            assert r.scalar() is not None

        # 3. Test CRUD transaction
        test_user = UserRow(
            id="test-pg-user-1",
            name="PG Test User",
            email="pg_test_user@synapse.internal",
            password_hash="testhash",
            role="student",
        )
        session.add(test_user)
        await session.commit()

        # Read back
        user = await session.get(UserRow, "test-pg-user-1")
        assert user is not None
        assert user.name == "PG Test User"

        # Cleanup
        await session.delete(user)
        await session.commit()

    await engine.dispose()
