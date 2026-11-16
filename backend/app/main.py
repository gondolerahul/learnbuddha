from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import worker
from .api import router
from .config import get_settings
from .db import init_db
from .session_ws import handle

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    s = get_settings()
    if s.run_worker_in_process:
        worker.start_threads(s.worker_threads)
    logging.getLogger("lb").info("brain=%s tts=%s voice=%s", s.brain, s.tts, s.voice)
    yield
    worker.stop()


app = FastAPI(title="LearnBuddha", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], allow_methods=["*"], allow_headers=["*"])
app.include_router(router)
app.mount("/media", StaticFiles(directory=str(get_settings().media_dir)), name="media")


@app.websocket("/ws/sessions/{session_id}")
async def ws_session(ws: WebSocket, session_id: str) -> None:
    await handle(ws, session_id)
