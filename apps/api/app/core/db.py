from contextlib import asynccontextmanager
from datetime import datetime, timezone
import os
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

def get_database_url() -> str:
    # Priority: DATABASE_URL, then SYNAPSE_DB_URL, then default sqlite
    raw_url = os.environ.get("DATABASE_URL") or os.environ.get("SYNAPSE_DB_URL")
    if not raw_url:
        return "sqlite+aiosqlite:///./synapse.db"

    # Normalize standard postgres URLs to asyncpg dialect
    if raw_url.startswith("postgres://"):
        return raw_url.replace("postgres://", "postgresql+asyncpg://", 1)
    if raw_url.startswith("postgresql://") and not raw_url.startswith("postgresql+"):
        return raw_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return raw_url


DB_URL = get_database_url()

# Connection pool configuration
engine_kwargs = {"echo": False}
if DB_URL.startswith("postgresql") or "asyncpg" in DB_URL:
    engine_kwargs.update(
        {
            "pool_size": int(os.environ.get("DB_POOL_SIZE", "5")),
            "max_overflow": int(os.environ.get("DB_MAX_OVERFLOW", "10")),
            "pool_pre_ping": True,
        }
    )

engine = create_async_engine(DB_URL, **engine_kwargs)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class UserRow(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False)  # "teacher" | "student"
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class ClassroomRow(Base):
    __tablename__ = "classrooms"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    subject = Column(String, nullable=False)
    join_code = Column(String, unique=True, nullable=False, index=True)
    teacher_id = Column(String, ForeignKey("users.id"), nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class EnrollmentRow(Base):
    __tablename__ = "enrollments"
    __table_args__ = (UniqueConstraint("classroom_id", "student_id", name="uq_classroom_student"),)

    id = Column(String, primary_key=True)
    classroom_id = Column(String, ForeignKey("classrooms.id"), nullable=False)
    student_id = Column(String, ForeignKey("users.id"), nullable=False)
    enrolled_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class NoteRow(Base):
    __tablename__ = "notes"

    id = Column(String, primary_key=True)
    title = Column(String, nullable=False)
    classroom_id = Column(String, ForeignKey("classrooms.id"), nullable=False)
    published = Column(Boolean, nullable=False, default=False)
    summary = Column(Text, nullable=True)
    content = Column(Text, nullable=True)  # Full raw content (e.g. Markdown)
    sections = Column(Text, nullable=False, default="[]")  # JSON string of sections
    concept_ids = Column(Text, nullable=False, default="[]")  # JSON string of concept ids
    status = Column(String, nullable=False, default="READY")  # "PROCESSING" | "READY" | "FAILED"
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class TestRow(Base):
    __tablename__ = "tests"

    id = Column(String, primary_key=True)
    title = Column(String, nullable=False)
    classroom_id = Column(String, ForeignKey("classrooms.id"), nullable=False)
    duration_min = Column(Integer, nullable=False, default=20)
    due = Column(String, nullable=True)
    due_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String, nullable=False, default="draft")  # "draft" | "published"
    concept_ids = Column(Text, nullable=False, default="[]")  # JSON string
    questions = Column(Text, nullable=False, default="[]")  # JSON string
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class SubmissionRow(Base):
    __tablename__ = "submissions"

    id = Column(String, primary_key=True)
    test_id = Column(String, ForeignKey("tests.id"), nullable=False)
    student_id = Column(String, ForeignKey("users.id"), nullable=False)
    score = Column(Float, nullable=False)
    answers = Column(Text, nullable=True)  # JSON string
    is_late = Column(Boolean, nullable=False, default=False)
    submitted_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class NotificationRow(Base):
    __tablename__ = "notifications"

    id = Column(String, primary_key=True)
    recipient_id = Column(String, ForeignKey("users.id"), nullable=False)
    classroom_id = Column(String, ForeignKey("classrooms.id"), nullable=False)
    type = Column(String, nullable=False)  # "new_note" | "new_test" | "deadline_approaching"
    title = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    related_entity_type = Column(String, nullable=True)  # "note" | "test"
    related_entity_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    read_at = Column(DateTime(timezone=True), nullable=True)


class AnalysisPayloadRow(Base):
    __tablename__ = "analysis_payloads"
    __table_args__ = (UniqueConstraint("student_id", "concept_id", name="uq_student_concept"),)

    id = Column(String, primary_key=True)
    student_id = Column(String, nullable=False)
    concept_id = Column(String, nullable=False)
    mastery = Column(Float, nullable=False)
    trend = Column(String, nullable=False)
    computed_at = Column(DateTime(timezone=True), nullable=False)


class ConceptRow(Base):
    __tablename__ = "concepts"
    __table_args__ = (UniqueConstraint("classroom_id", "normalized_name", name="uq_classroom_concept_name"),)

    id = Column(String, primary_key=True)
    classroom_id = Column(String, ForeignKey("classrooms.id"), nullable=False)
    name = Column(String, nullable=False)
    normalized_name = Column(String, nullable=False, index=True)
    description = Column(Text, nullable=True)
    related_concept_ids = Column(Text, nullable=False, default="[]")  # JSON string
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


async def init_db() -> None:
    # When connecting to PostgreSQL, Alembic migrations own the production schema.
    # We only run create_all and legacy SQLite ALTERs when running on SQLite (e.g. legacy local dev).
    if "sqlite" in DB_URL:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            # Legacy SQLite-only catch-up migrations
            from sqlalchemy import text
            try:
                await conn.execute(text("ALTER TABLE notes ADD COLUMN content TEXT"))
            except Exception:
                pass  # Column already exists
            try:
                await conn.execute(text("ALTER TABLE notes ADD COLUMN status VARCHAR DEFAULT 'READY'"))
            except Exception:
                pass  # Column already exists
            try:
                await conn.execute(text("UPDATE notes SET status = 'READY' WHERE status IS NULL"))
            except Exception:
                pass
            try:
                await conn.execute(text("ALTER TABLE tests ADD COLUMN due_at DATETIME"))
            except Exception:
                pass
            try:
                await conn.execute(text("ALTER TABLE submissions ADD COLUMN is_late BOOLEAN DEFAULT 0"))
            except Exception:
                pass


async def get_db():
    async with SessionLocal() as session:
        yield session


@asynccontextmanager
async def get_session_context():
    try:
        from app.main import app
        override = app.dependency_overrides.get(get_db)
        if override:
            async for s in override():
                yield s
                return
    except Exception:
        pass
    async with SessionLocal() as session:
        yield session
