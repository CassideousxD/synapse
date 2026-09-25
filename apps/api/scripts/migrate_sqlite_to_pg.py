"""
SQLite -> PostgreSQL data migration script.

This script migrates data from the SQLite database (synapse.db) to PostgreSQL.
It is deterministic, preserves all IDs, timestamps, foreign key relationships,
and JSON content strings.

Usage:
    DATABASE_URL="postgresql+asyncpg://postgres:password@localhost:5432/synapse" \
    python scripts/migrate_sqlite_to_pg.py [--sqlite-path apps/api/synapse.db]
"""
import argparse
import asyncio
from datetime import datetime
import os
from pathlib import Path
import sqlite3
import sys

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

# Ensure apps/api is in sys.path
api_dir = Path(__file__).resolve().parents[1]
if str(api_dir) not in sys.path:
    sys.path.insert(0, str(api_dir))

from app.core.db import (
    AnalysisPayloadRow,
    Base,
    ClassroomRow,
    ConceptRow,
    EnrollmentRow,
    NoteRow,
    NotificationRow,
    SubmissionRow,
    TestRow,
    UserRow,
    get_database_url,
)

# Ordered tables according to foreign key dependencies
MIGRATION_ORDER = [
    ("users", UserRow),
    ("classrooms", ClassroomRow),
    ("enrollments", EnrollmentRow),
    ("notes", NoteRow),
    ("concepts", ConceptRow),
    ("tests", TestRow),
    ("submissions", SubmissionRow),
    ("notifications", NotificationRow),
    ("analysis_payloads", AnalysisPayloadRow),
]


def parse_datetime(val):
    if val is None:
        return None
    if isinstance(val, datetime):
        return val
    try:
        # SQLite stores timestamps as ISO strings or 'YYYY-MM-DD HH:MM:SS.mmmmmm'
        return datetime.fromisoformat(val)
    except Exception:
        return val


async def run_data_migration(sqlite_path: Path, target_pg_url: str):
    if not sqlite_path.exists():
        print(f"Error: SQLite database file not found at {sqlite_path}")
        sys.exit(1)

    print(f"Reading from SQLite database: {sqlite_path}")
    print(f"Target PostgreSQL URL: {target_pg_url}")

    if "sqlite" in target_pg_url:
        print("Error: Target database URL must be a PostgreSQL connection, not SQLite.")
        sys.exit(1)

    # 1. Connect to SQLite
    sqlite_conn = sqlite3.connect(sqlite_path)
    sqlite_conn.row_factory = sqlite3.Row
    sqlite_cur = sqlite_conn.cursor()

    # 2. Connect to PostgreSQL
    pg_engine = create_async_engine(target_pg_url, echo=False)
    pg_session_factory = async_sessionmaker(pg_engine, expire_on_commit=False)

    async with pg_session_factory() as session:
        # Verify PostgreSQL tables exist
        for table_name, model_cls in MIGRATION_ORDER:
            try:
                await session.execute(select(model_cls).limit(1))
            except Exception as e:
                print(f"Error: PostgreSQL table '{table_name}' does not appear to exist or cannot be queried.")
                print(f"Please run 'alembic upgrade head' before running data migration. Details: {e}")
                sys.exit(1)

        print("\n--- Starting Data Migration in Dependency Order ---")
        migrated_counts = {}

        for table_name, model_cls in MIGRATION_ORDER:
            sqlite_cur.execute(f"SELECT * FROM {table_name}")
            rows = sqlite_cur.fetchall()
            print(f"Migrating '{table_name}': {len(rows)} records in SQLite...")

            inserted_for_table = 0
            for row in rows:
                row_dict = dict(row)

                # Ensure datetimes are parsed properly
                for col in model_cls.__table__.columns:
                    col_name = col.name
                    if col_name in row_dict and "datetime" in str(col.type).lower():
                        row_dict[col_name] = parse_datetime(row_dict[col_name])
                    elif col_name in row_dict and "boolean" in str(col.type).lower():
                        if row_dict[col_name] is not None:
                            row_dict[col_name] = bool(row_dict[col_name])

                # Check if record already exists to ensure idempotency
                pk_col = model_cls.__table__.primary_key.columns.keys()[0]
                pk_val = row_dict[pk_col]
                existing = await session.get(model_cls, pk_val)
                if existing is None:
                    obj = model_cls(**row_dict)
                    session.add(obj)
                    inserted_for_table += 1

            await session.commit()
            migrated_counts[table_name] = (len(rows), inserted_for_table)
            print(f" -> '{table_name}' committed ({inserted_for_table} inserted, {len(rows) - inserted_for_table} existing).")

        print("\n--- Verifying Row Counts ---")
        print(f"{'TABLE':<22} {'SQLITE':<12} {'POSTGRES':<12} {'STATUS'}")
        print("-" * 55)

        all_matched = True
        for table_name, model_cls in MIGRATION_ORDER:
            sqlite_cur.execute(f"SELECT COUNT(*) FROM {table_name}")
            sq_count = sqlite_cur.fetchone()[0]

            pg_res = await session.execute(text(f"SELECT COUNT(*) FROM {table_name}"))
            pg_count = pg_res.scalar()

            status = "MATCH" if sq_count == pg_count else "MISMATCH"
            if sq_count != pg_count:
                all_matched = False
            print(f"{table_name:<22} {sq_count:<12} {pg_count:<12} {status}")

        if not all_matched:
            print("\nWARNING: Some table counts did not match! Inspect details above.")
        else:
            print("\nAll table row counts verified successfully!")

    sqlite_conn.close()
    await pg_engine.dispose()


def main():
    parser = argparse.ArgumentParser(description="Migrate SQLite data to PostgreSQL")
    parser.add_argument(
        "--sqlite-path",
        type=Path,
        default=Path("apps/api/synapse.db"),
        help="Path to SQLite database",
    )
    parser.add_argument(
        "--pg-url",
        type=str,
        default=None,
        help="PostgreSQL connection string (defaults to DATABASE_URL or SYNAPSE_DB_URL env var)",
    )
    args = parser.parse_args()

    target_url = args.pg_url or get_database_url()
    if not target_url or "sqlite" in target_url:
        print("Error: DATABASE_URL must be specified and point to a PostgreSQL instance.")
        sys.exit(1)

    asyncio.run(run_data_migration(args.sqlite_path, target_url))


if __name__ == "__main__":
    main()
