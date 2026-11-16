"""Postgres job queue: enqueue + claim with FOR UPDATE SKIP LOCKED, highest priority first."""
from __future__ import annotations

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .models import Job, now

# Priorities: barge-in answers beat everything; then remediation; then lesson scenes in order.
PRIORITY_ANSWER = 100
PRIORITY_REMEDIATION = 90
PRIORITY_SIMPLER = 85
PRIORITY_PLAN = 70
PRIORITY_SCENE_BASE = 50


def enqueue(db: Session, kind: str, payload: dict, priority: int = 0) -> Job:
    job = Job(kind=kind, payload=payload, priority=priority)
    db.add(job)
    db.flush()
    db.execute(text("NOTIFY lb_jobs"))
    return job


def claim(db: Session, min_priority: int = 0) -> Job | None:
    row = db.execute(
        select(Job)
        .where(Job.status == "queued", Job.priority >= min_priority)
        .order_by(Job.priority.desc(), Job.id.asc())
        .limit(1)
        .with_for_update(skip_locked=True)
    ).scalar_one_or_none()
    if row is None:
        return None
    row.status = "running"
    row.attempts += 1
    row.started_at = now()
    db.flush()
    return row


def finish(db: Session, job_id: int, error: str | None = None, retry: bool = False) -> None:
    job = db.get(Job, job_id)
    if job is None:
        return
    if error and retry and job.attempts < 2:
        job.status = "queued"
        job.error = error
        return
    job.status = "failed" if error else "done"
    job.error = error
    job.finished_at = now()


def reset_stale(db: Session) -> int:
    """On worker start, re-queue jobs that were running when a previous worker died."""
    res = db.execute(text("UPDATE jobs SET status='queued' WHERE status='running'"))
    return res.rowcount or 0
