import asyncio
import json
import logging
import os
import signal
from datetime import datetime, timezone
from typing import Any, Optional

from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import TimeoutError as RedisTimeoutError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.ai_jobs import AIJobManager, DEFAULT_QUEUE_NAME
from app.core.db import (
    AIJobRow,
    NoteRow,
    get_session_context,
)
from app.core.redis import close_redis, get_redis, init_redis
from app.curriculum.concept_service import sync_classroom_concepts
from app.curriculum.tagging import extract_concepts

logger = logging.getLogger("synapse.ai_worker")

DEFAULT_CONCURRENCY = int(os.environ.get("AI_WORKER_CONCURRENCY", "4"))


async def execute_note_concept_extraction(
    payload: dict[str, Any],
    db: AsyncSession,
) -> dict[str, Any]:
    """
    Executes concept extraction for a note using existing curriculum AI pipeline.
    Persists extracted concepts into ConceptRow and updates NoteRow status to READY.
    """
    note_id = payload.get("note_id")
    classroom_id = payload.get("classroom_id")
    source_text = payload.get("source_text", "")
    title = payload.get("title", "")

    if not note_id or not classroom_id:
        raise ValueError("Missing note_id or classroom_id in payload")

    # Call existing concept extraction logic
    proposals = await extract_concepts(source_text, title=title)

    note = await db.scalar(select(NoteRow).where(NoteRow.id == note_id))
    if not note:
        raise ValueError(f"Note {note_id} not found in database")

    concept_ids = []
    if proposals:
        concept_ids = await sync_classroom_concepts(classroom_id, proposals, db)

    # Re-link sections if needed
    sections = []
    try:
        sections = json.loads(note.sections) if note.sections else []
    except Exception:
        sections = []

    if concept_ids and sections:
        for s in sections:
            if not s.get("conceptId"):
                s["conceptId"] = concept_ids[0]
        note.sections = json.dumps(sections)

    note.concept_ids = json.dumps(concept_ids)
    note.status = "READY"
    note.updated_at = datetime.now(timezone.utc)
    await db.commit()

    return {
        "note_id": note_id,
        "concept_ids": concept_ids,
        "concepts_extracted": len(concept_ids),
    }


class AIWorker:
    """
    Dedicated AI worker that pulls jobs from Redis and executes them durably.
    Bounded concurrency via asyncio.Semaphore.
    """

    def __init__(
        self,
        queue_name: str = DEFAULT_QUEUE_NAME,
        concurrency: int = DEFAULT_CONCURRENCY,
        job_manager: Optional[AIJobManager] = None,
    ):
        self.queue_name = queue_name
        self.concurrency = concurrency
        self.semaphore = asyncio.Semaphore(concurrency)
        self.job_manager = job_manager or AIJobManager(queue_name=queue_name)
        self.running = False
        self._active_tasks: set[asyncio.Task] = set()

    async def process_job(self, job_id: str) -> bool:
        """
        Executes a single claimed job inside an isolated DB session with concurrency gating.
        Returns True if execution succeeded, False otherwise.
        """
        async with self.semaphore:
            async with get_session_context() as db:
                job = await self.job_manager.claim_job(job_id, db)
                if not job:
                    # Job was already completed, currently running, or invalid
                    return False

                payload = {}
                try:
                    payload = json.loads(job.payload) if job.payload else {}
                except Exception:
                    payload = {}

                try:
                    # Dispatch by job type
                    if job.job_type in ("NOTE_CONCEPT_EXTRACTION", "NOTE_CONCEPT_EXTRACTION_RETRY"):
                        result = await execute_note_concept_extraction(payload, db)
                        await self.job_manager.complete_job(job.id, result, db)
                        return True
                    else:
                        raise ValueError(f"Unknown job_type: {job.job_type}")
                except Exception as exc:
                    logger.exception("AI worker failed executing job %s: %s", job.id, exc)
                    error_msg = str(exc)
                    updated_job, was_requeued = await self.job_manager.fail_job(
                        job.id,
                        error=error_msg,
                        db=db,
                        retryable=True,
                        queue_name=self.queue_name,
                    )
                    # If this was a note job and it permanently failed, update note.status = FAILED
                    if not was_requeued and job.job_type in (
                        "NOTE_CONCEPT_EXTRACTION",
                        "NOTE_CONCEPT_EXTRACTION_RETRY",
                    ):
                        note_id = payload.get("note_id")
                        if note_id:
                            note = await db.scalar(select(NoteRow).where(NoteRow.id == note_id))
                            if note:
                                note.status = "FAILED"
                                note.updated_at = datetime.now(timezone.utc)
                                await db.commit()
                    return False

    async def process_one(self, timeout: float = 1.0) -> bool:
        """
        Pulls one job from Redis queue and processes it.
        Useful for synchronous test invocations and deterministic sweeps.
        """
        try:
            redis = get_redis()
            item = await redis.blpop(self.queue_name, timeout=timeout)
            if not item:
                return False
            _, job_id = item
            return await self.process_job(job_id)
        except (RedisConnectionError, RedisTimeoutError, RuntimeError) as e:
            logger.error("Worker: Redis error while checking queue %s: %s", self.queue_name, e)
            return False

    async def run(self, poll_interval: float = 1.0, reconcile_interval: float = 60.0):
        """
        Main worker execution loop.
        Continuously polls Redis queue and periodically runs crash/stale reconciliation.
        """
        self.running = True
        logger.info(
            "Starting AI Worker: queue=%s concurrency=%d",
            self.queue_name,
            self.concurrency,
        )

        last_reconcile = 0.0

        while self.running:
            # 1. Periodic reconciliation
            now = asyncio.get_event_loop().time()
            if now - last_reconcile > reconcile_interval:
                last_reconcile = now
                try:
                    async with get_session_context() as db:
                        stats = await self.job_manager.reconcile_and_recover(db, queue_name=self.queue_name)
                        if any(stats.values()):
                            logger.info("Worker periodic reconciliation result: %s", stats)
                except Exception as e:
                    logger.error("Error during periodic reconciliation: %s", e)

            # 2. Dequeue next job
            try:
                redis = get_redis()
                item = await redis.blpop(self.queue_name, timeout=poll_interval)
                if not item:
                    continue

                _, job_id = item

                # Spawn background processing task under bounded semaphore
                task = asyncio.create_task(self.process_job(job_id))
                self._active_tasks.add(task)
                task.add_done_callback(self._active_tasks.discard)

            except (RedisConnectionError, RedisTimeoutError, RuntimeError) as e:
                logger.error("Worker: Redis connection drop (%s). Backing off for 2s.", e)
                await asyncio.sleep(2.0)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.exception("Unexpected error in worker loop: %s", e)
                await asyncio.sleep(1.0)

        # Graceful shutdown: wait for active tasks
        if self._active_tasks:
            logger.info("Worker shutting down. Awaiting %d active tasks...", len(self._active_tasks))
            await asyncio.gather(*self._active_tasks, return_exceptions=True)
        logger.info("AI Worker stopped cleanly.")

    def stop(self):
        """Signals worker to stop."""
        self.running = False


async def start_standalone_worker():
    """CLI entrypoint for standalone worker process."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info("Initializing Redis and DB for standalone AI worker...")
    await init_redis()

    worker = AIWorker()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, worker.stop)
        except NotImplementedError:
            pass

    try:
        await worker.run()
    finally:
        await close_redis()


if __name__ == "__main__":
    asyncio.run(start_standalone_worker())
