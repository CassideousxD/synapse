import json
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional, Tuple

from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import TimeoutError as RedisTimeoutError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import AIJobRow
from app.core.redis import get_redis

logger = logging.getLogger("synapse.ai_jobs")

DEFAULT_QUEUE_NAME = os.environ.get("AI_QUEUE_NAME", "synapse:queue:ai")
DEFAULT_MAX_ATTEMPTS = int(os.environ.get("AI_JOB_MAX_ATTEMPTS", "3"))
DEFAULT_STALE_SECONDS = int(os.environ.get("AI_JOB_STALE_AFTER_SECONDS", "300"))


class AIJobManager:
    """
    Manages durable AI job lifecycle in PostgreSQL and dispatch through Redis.
    PostgreSQL is the authoritative source of truth. Redis is the dispatch queue.
    """

    def __init__(self, queue_name: str = DEFAULT_QUEUE_NAME):
        self.queue_name = queue_name

    @staticmethod
    def get_max_attempts() -> int:
        return int(os.environ.get("AI_JOB_MAX_ATTEMPTS", str(DEFAULT_MAX_ATTEMPTS)))

    @staticmethod
    def get_stale_threshold_seconds() -> int:
        return int(os.environ.get("AI_JOB_STALE_AFTER_SECONDS", str(DEFAULT_STALE_SECONDS)))

    async def create_job(
        self,
        db: AsyncSession,
        user_id: str,
        job_type: str,
        payload: dict[str, Any],
        classroom_id: Optional[str] = None,
        priority: int = 0,
        max_attempts: Optional[int] = None,
    ) -> AIJobRow:
        """
        Creates and durably commits an AIJob in PostgreSQL in QUEUED state.
        Never stores API keys or raw secrets in payload.
        """
        job_id = f"job-{uuid.uuid4().hex[:12]}"
        attempts_limit = max_attempts if max_attempts is not None else self.get_max_attempts()

        job = AIJobRow(
            id=job_id,
            user_id=user_id,
            classroom_id=classroom_id,
            job_type=job_type,
            status="QUEUED",
            priority=priority,
            attempts=0,
            max_attempts=attempts_limit,
            payload=json.dumps(payload),
            result=None,
            error=None,
            created_at=datetime.now(timezone.utc),
            started_at=None,
            completed_at=None,
            updated_at=datetime.now(timezone.utc),
        )

        db.add(job)
        await db.commit()
        await db.refresh(job)

        logger.info(
            "AI job created: job_id=%s job_type=%s user_id=%s status=QUEUED",
            job.id,
            job.job_type,
            job.user_id,
        )
        return job

    async def enqueue_job(self, job_id: str, queue_name: Optional[str] = None) -> bool:
        """
        Enqueues job ID into Redis FIFO queue (RPUSH).
        If Redis is unreachable or fails, returns False without raising 500.
        The job remains safe in PostgreSQL in QUEUED status.
        """
        q = queue_name or self.queue_name
        try:
            redis = get_redis()
            await redis.rpush(q, job_id)
            logger.info("AI job enqueued: job_id=%s queue=%s", job_id, q)
            return True
        except (RedisConnectionError, RedisTimeoutError, RuntimeError) as e:
            logger.error(
                "Failed to enqueue AI job %s into Redis queue %s (%s). Job remains durable in PostgreSQL QUEUED status.",
                job_id,
                q,
                e,
            )
            return False

    async def create_and_enqueue_job(
        self,
        db: AsyncSession,
        user_id: str,
        job_type: str,
        payload: dict[str, Any],
        classroom_id: Optional[str] = None,
        priority: int = 0,
        max_attempts: Optional[int] = None,
        queue_name: Optional[str] = None,
    ) -> Tuple[AIJobRow, bool]:
        """
        Atomically commits AIJob to PostgreSQL, then attempts Redis enqueue.
        PostgreSQL commit occurs FIRST so job is never lost.
        """
        job = await self.create_job(
            db=db,
            user_id=user_id,
            job_type=job_type,
            payload=payload,
            classroom_id=classroom_id,
            priority=priority,
            max_attempts=max_attempts,
        )
        enqueued = await self.enqueue_job(job.id, queue_name=queue_name)
        return job, enqueued

    async def claim_job(
        self,
        job_id: str,
        db: AsyncSession,
    ) -> Optional[AIJobRow]:
        """
        Atomically claims a job for worker processing.
        Transitions QUEUED -> RUNNING.
        If job is already SUCCEEDED or FAILED, skips duplicate execution.
        """
        job = await db.scalar(select(AIJobRow).where(AIJobRow.id == job_id).with_for_update())
        if not job:
            logger.warning("Claim rejected: job_id=%s not found in database", job_id)
            return None

        if job.status in ("SUCCEEDED", "FAILED"):
            logger.info(
                "Skipping terminal job: job_id=%s status=%s",
                job.id,
                job.status,
            )
            return None

        # Check if already running and not stale
        if job.status == "RUNNING" and job.started_at:
            stale_threshold = timedelta(seconds=self.get_stale_threshold_seconds())
            if datetime.now(timezone.utc) - job.started_at < stale_threshold:
                logger.warning(
                    "Job already claimed and actively running: job_id=%s started_at=%s",
                    job.id,
                    job.started_at,
                )
                return None

        job.status = "RUNNING"
        job.started_at = datetime.now(timezone.utc)
        job.attempts += 1
        job.updated_at = datetime.now(timezone.utc)

        await db.commit()
        await db.refresh(job)

        logger.info(
            "AI job started: job_id=%s job_type=%s attempt=%d status=RUNNING",
            job.id,
            job.job_type,
            job.attempts,
        )
        return job

    async def complete_job(
        self,
        job_id: str,
        result: dict[str, Any],
        db: AsyncSession,
    ) -> Optional[AIJobRow]:
        """
        Marks job as SUCCEEDED and persists execution result.
        """
        job = await db.scalar(select(AIJobRow).where(AIJobRow.id == job_id))
        if not job:
            logger.error("Complete failed: job_id=%s not found", job_id)
            return None

        job.status = "SUCCEEDED"
        job.result = json.dumps(result)
        job.completed_at = datetime.now(timezone.utc)
        job.updated_at = datetime.now(timezone.utc)

        await db.commit()
        await db.refresh(job)

        logger.info(
            "AI job succeeded: job_id=%s job_type=%s attempt=%d status=SUCCEEDED",
            job.id,
            job.job_type,
            job.attempts,
        )
        return job

    async def fail_job(
        self,
        job_id: str,
        error: str,
        db: AsyncSession,
        retryable: bool = True,
        queue_name: Optional[str] = None,
    ) -> Tuple[Optional[AIJobRow], bool]:
        """
        Handles job failure with bounded retries.
        If attempts < max_attempts and retryable, resets to QUEUED and re-enqueues.
        Otherwise permanently transitions to FAILED.
        Returns (job, was_requeued).
        """
        job = await db.scalar(select(AIJobRow).where(AIJobRow.id == job_id))
        if not job:
            logger.error("Fail failed: job_id=%s not found", job_id)
            return None, False

        job.error = error[:2000] if error else "Unknown error"
        job.updated_at = datetime.now(timezone.utc)

        if retryable and job.attempts < job.max_attempts:
            job.status = "QUEUED"
            job.started_at = None
            await db.commit()
            await db.refresh(job)

            logger.warning(
                "AI job retry scheduled: job_id=%s job_type=%s attempt=%d/%d error=%s",
                job.id,
                job.job_type,
                job.attempts,
                job.max_attempts,
                job.error,
            )
            requeued = await self.enqueue_job(job.id, queue_name=queue_name)
            return job, requeued
        else:
            job.status = "FAILED"
            job.completed_at = datetime.now(timezone.utc)
            await db.commit()
            await db.refresh(job)

            logger.error(
                "AI job failed permanently: job_id=%s job_type=%s attempt=%d/%d error=%s status=FAILED",
                job.id,
                job.job_type,
                job.attempts,
                job.max_attempts,
                job.error,
            )
            return job, False

    async def reconcile_and_recover(
        self,
        db: AsyncSession,
        queue_name: Optional[str] = None,
    ) -> dict[str, int]:
        """
        Reconciliation and crash recovery:
        1. Stale RUNNING jobs: jobs in RUNNING longer than stale threshold are recovered or failed.
        2. Unqueued QUEUED jobs: jobs in PostgreSQL with status QUEUED not present in Redis queue are enqueued.
        """
        q = queue_name or self.queue_name
        stale_threshold = timedelta(seconds=self.get_stale_threshold_seconds())
        cutoff = datetime.now(timezone.utc) - stale_threshold

        stats = {
            "stale_requeued": 0,
            "stale_failed": 0,
            "missing_enqueued": 0,
        }

        # 1. Recover stale RUNNING jobs
        stale_query = select(AIJobRow).where(
            AIJobRow.status == "RUNNING",
            AIJobRow.started_at <= cutoff,
        )
        stale_jobs = (await db.scalars(stale_query)).all()

        for j in stale_jobs:
            if j.attempts >= j.max_attempts:
                j.status = "FAILED"
                j.error = f"Stale worker timeout after {self.get_stale_threshold_seconds()}s (attempts exceeded)"
                j.completed_at = datetime.now(timezone.utc)
                j.updated_at = datetime.now(timezone.utc)
                stats["stale_failed"] += 1
                logger.error("Job recovery: marked permanently FAILED due to timeout: job_id=%s", j.id)
            else:
                j.status = "QUEUED"
                j.error = f"Recovered from stale RUNNING state (started_at={j.started_at})"
                j.started_at = None
                j.updated_at = datetime.now(timezone.utc)
                stats["stale_requeued"] += 1
                logger.warning("Job recovery: requeued stale RUNNING job: job_id=%s", j.id)

        await db.commit()

        # Re-enqueue any recovered jobs to Redis
        for j in stale_jobs:
            if j.status == "QUEUED":
                await self.enqueue_job(j.id, queue_name=q)

        # 2. Check for missing QUEUED jobs in Redis
        try:
            redis = get_redis()
            # Fetch all items in Redis queue to prevent duplicate enqueues
            queued_items = await redis.lrange(q, 0, -1)
            queued_set = set(queued_items) if queued_items else set()

            queued_db_query = select(AIJobRow).where(AIJobRow.status == "QUEUED")
            db_queued = (await db.scalars(queued_db_query)).all()

            for qj in db_queued:
                if qj.id not in queued_set:
                    success = await self.enqueue_job(qj.id, queue_name=q)
                    if success:
                        stats["missing_enqueued"] += 1
                        logger.info("Job reconciliation: enqueued missing QUEUED job: job_id=%s", qj.id)
        except (RedisConnectionError, RedisTimeoutError, RuntimeError) as e:
            logger.error("Job reconciliation: Redis unavailable during queue check: %s", e)

        return stats
