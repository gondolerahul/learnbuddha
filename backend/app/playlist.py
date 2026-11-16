"""Session playlists: a list of entries that the pump turns into one continuous MSE timeline.

Entry: {eid, kind: scene|checkpoint|end, scene_id?, lesson_id?, src_from, src_to (None = to the end)}
Splicing never re-encodes: every clip has a fragment boundary at each sentence start, so an entry can
start at any sentence and stop at any time (the player trims with appendWindowEnd / buffer removal).
"""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Course, Lesson, Scene


def eid() -> str:
    return uuid.uuid4().hex[:10]


def scene_entry(scene_id: str, lesson_id: str | None, src_from: float = 0.0, src_to: float | None = None, tag: str = "") -> dict:
    return {"eid": eid(), "kind": "scene", "scene_id": scene_id, "lesson_id": lesson_id, "src_from": src_from, "src_to": src_to, "tag": tag}


def build_base(db: Session, course: Course) -> list[dict]:
    lessons = db.execute(select(Lesson).where(Lesson.course_id == course.id, Lesson.dropped.is_(False)).order_by(Lesson.idx)).scalars().all()
    out: list[dict] = []
    for L in lessons:
        scenes = db.execute(
            select(Scene).where(Scene.lesson_id == L.id, Scene.kind == "lesson", Scene.dropped.is_(False)).order_by(Scene.idx)
        ).scalars().all()
        for sc in scenes:
            out.append(scene_entry(sc.id, L.id))
        if (L.checkpoint or {}).get("questions"):
            out.append({"eid": eid(), "kind": "checkpoint", "lesson_id": L.id})
    out.append({"eid": eid(), "kind": "end"})
    return out


def sentence_start_at(media: dict, t: float) -> float:
    """Latest sentence start (= fragment boundary) at or before t."""
    starts = media.get("sentence_starts") or [0.0]
    best = 0.0
    for s in starts:
        if s <= t + 1e-3:
            best = s
    return best


def first_fragment(media: dict, src_from: float) -> int:
    frags = media.get("fragments") or []
    i0 = 0
    for i, f in enumerate(frags):
        if f[0] <= src_from + 2e-3:
            i0 = i
    return i0


def index_of(playlist: list[dict], entry_id: str) -> int:
    return next((i for i, e in enumerate(playlist) if e["eid"] == entry_id), -1)


def rebuild_keeping_position(db: Session, course: Course, old: list[dict], position: dict | None) -> tuple[list[dict], int]:
    """After an outline edit: fresh base playlist, positioned at the same scene (or its lesson)."""
    base = build_base(db, course)
    if not position:
        return base, 0
    old_e = next((e for e in old if e["eid"] == position.get("eid")), None)
    if old_e is None:
        return base, 0
    for i, e in enumerate(base):
        if e.get("scene_id") and e.get("scene_id") == old_e.get("scene_id"):
            e["src_from"] = position.get("resume_from", 0.0)
            return base, i
    for i, e in enumerate(base):
        if e.get("lesson_id") and e.get("lesson_id") == old_e.get("lesson_id"):
            return base, i
    return base, 0


def describe(e: dict) -> dict[str, Any]:
    return {k: e.get(k) for k in ("eid", "kind", "scene_id", "lesson_id", "src_from", "src_to", "tag")}
