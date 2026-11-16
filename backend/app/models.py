from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def new_id() -> str:
    return uuid.uuid4().hex[:16]


def now() -> datetime:
    return datetime.now(timezone.utc)


class Course(Base):
    """Shareable course content. Cached globally by topic+level+kit+language."""

    __tablename__ = "courses"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    topic: Mapped[str] = mapped_column(Text)
    goal: Mapped[str] = mapped_column(Text, default="")
    level: Mapped[str] = mapped_column(Text, default="")
    language: Mapped[str] = mapped_column(String(32), default="English")
    kit: Mapped[str] = mapped_column(String(64), default="zen-board-v1")
    brain: Mapped[str] = mapped_column(String(32), default="")
    minutes: Mapped[int] = mapped_column(Integer, default=8)
    diagnostics: Mapped[list] = mapped_column(JSONB, default=list)
    cache_key: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(Text, default="")
    summary: Mapped[str] = mapped_column(Text, default="")
    sources: Mapped[list] = mapped_column(JSONB, default=list)
    status: Mapped[str] = mapped_column(String(16), default="planning")  # planning|ready|failed
    version: Mapped[int] = mapped_column(Integer, default=1)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    learner_id: Mapped[str] = mapped_column(String(64), default="local")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Lesson(Base):
    __tablename__ = "lessons"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    idx: Mapped[float] = mapped_column(Float)
    title: Mapped[str] = mapped_column(Text)
    objective: Mapped[str] = mapped_column(Text, default="")
    checkpoint: Mapped[dict] = mapped_column(JSONB, default=dict)
    dropped: Mapped[bool] = mapped_column(Boolean, default=False)


class Scene(Base):
    """A rendered clip: lesson scene, answer clip, recap card, remediation or explain-again."""

    __tablename__ = "scenes"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    lesson_id: Mapped[str | None] = mapped_column(ForeignKey("lessons.id", ondelete="CASCADE"), nullable=True, index=True)
    idx: Mapped[float] = mapped_column(Float, default=0)
    kind: Mapped[str] = mapped_column(String(16), default="lesson")  # lesson|answer|recap|remediation|simpler
    title: Mapped[str] = mapped_column(Text, default="")
    objective: Mapped[str] = mapped_column(Text, default="")
    key_points: Mapped[list] = mapped_column(JSONB, default=list)
    visual_idea: Mapped[str] = mapped_column(Text, default="")
    target_seconds: Mapped[int] = mapped_column(Integer, default=45)
    cache_key: Mapped[str] = mapped_column(String(64), default="", index=True)
    status: Mapped[str] = mapped_column(String(16), default="queued")  # queued|working|ready|failed
    stage: Mapped[str] = mapped_column(String(24), default="queued")
    progress: Mapped[float] = mapped_column(Float, default=0)
    script: Mapped[list] = mapped_column(JSONB, default=list)  # narration sentences
    sources: Mapped[list] = mapped_column(JSONB, default=list)
    timings: Mapped[list] = mapped_column(JSONB, default=list)  # [{text,start,end,words:[{w,s,e}]}]
    spec: Mapped[dict] = mapped_column(JSONB, default=dict)
    media: Mapped[dict] = mapped_column(JSONB, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    dropped: Mapped[bool] = mapped_column(Boolean, default=False)
    parent_scene_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    parent_t: Mapped[float | None] = mapped_column(Float, nullable=True)
    question: Mapped[str | None] = mapped_column(Text, nullable=True)
    session_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class LearningSession(Base):
    __tablename__ = "learning_sessions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    learner_id: Mapped[str] = mapped_column(String(64), default="local")
    state: Mapped[dict] = mapped_column(JSONB, default=dict)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class QA(Base):
    __tablename__ = "qa_log"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(ForeignKey("learning_sessions.id", ondelete="CASCADE"), index=True)
    scene_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    t: Mapped[float] = mapped_column(Float, default=0)
    question: Mapped[str] = mapped_column(Text, default="")
    kind: Mapped[str] = mapped_column(String(16), default="question")  # question|control|noise
    spoken_answer: Mapped[str] = mapped_column(Text, default="")
    answer_scene_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    concept: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Attempt(Base):
    __tablename__ = "checkpoint_attempts"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(ForeignKey("learning_sessions.id", ondelete="CASCADE"), index=True)
    lesson_id: Mapped[str] = mapped_column(String(32))
    objective: Mapped[str] = mapped_column(Text, default="")
    question_idx: Mapped[int] = mapped_column(Integer, default=0)
    choice: Mapped[int] = mapped_column(Integer, default=0)
    correct: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class UsageEvent(Base):
    """One charged model call: tokens as reported, list price that day, USD→INR rate used."""

    __tablename__ = "usage_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    course_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    scene_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    session_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    ref: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)  # pre-course work (diagnostics)
    operation: Mapped[str] = mapped_column(String(32))
    provider: Mapped[str] = mapped_column(String(16))
    model: Mapped[str] = mapped_column(String(64))
    units: Mapped[dict] = mapped_column(JSONB, default=dict)
    cost_usd: Mapped[float] = mapped_column(Float, default=0)
    usd_inr: Mapped[float] = mapped_column(Float, default=0)
    cost_inr: Mapped[float] = mapped_column(Float, default=0)
    detail: Mapped[str] = mapped_column(Text, default="")


class Job(Base):
    """Postgres-backed priority queue (claimed with FOR UPDATE SKIP LOCKED)."""

    __tablename__ = "jobs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="queued")  # queued|running|done|failed
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (Index("ix_jobs_claim", "status", "priority", "id"),)
