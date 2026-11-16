"""Job worker: `python -m app.worker` (or started in-process by the API in dev)."""
from __future__ import annotations

import logging
import threading
import time

from . import costs, jobs
from .db import init_db, session
from .pipeline import HANDLERS

log = logging.getLogger("lb.worker")
_stop = threading.Event()


def run_one(min_priority: int = 0) -> bool:
    with session() as db:
        job = jobs.claim(db, min_priority)
        if job is None:
            return False
        job_id, kind, payload = job.id, job.kind, dict(job.payload)
    log.info("job %s %s %s", job_id, kind, payload)
    err = None
    try:
        handler = HANDLERS.get(kind)
        if handler is None:
            raise ValueError(f"unknown job kind {kind}")
        with costs.scope(course_id=payload.get("course_id"), scene_id=payload.get("scene_id")):
            handler(payload)
    except Exception as e:  # recorded on the job; scene/course rows carry user-facing status
        err = f"{type(e).__name__}: {e}"
        log.error("job %s failed: %s", job_id, err)
    with session() as db:
        jobs.finish(db, job_id, err)
    return True


def loop(name: str, min_priority: int = 0) -> None:
    while not _stop.is_set():
        try:
            if not run_one(min_priority):
                _stop.wait(0.5)
        except Exception:
            log.exception("worker %s loop error", name)
            _stop.wait(2)


def start_threads(n: int) -> list[threading.Thread]:
    with session() as db:
        n_reset = jobs.reset_stale(db)
        if n_reset:
            log.info("re-queued %d stale jobs", n_reset)
    threads = [threading.Thread(target=loop, args=(f"w{i}",), daemon=True, name=f"lb-worker-{i}") for i in range(n)]
    # Express lane: one worker that only takes plans, answers, recaps and remediation, so a learner's
    # doubt never queues behind lesson renders.
    threads.append(threading.Thread(target=loop, args=("express", jobs.PRIORITY_PLAN), daemon=True, name="lb-worker-express"))
    for t in threads:
        t.start()
    return threads


def stop() -> None:
    _stop.set()


if __name__ == "__main__":
    from .config import get_settings

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    init_db()
    start_threads(get_settings().worker_threads)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        stop()
