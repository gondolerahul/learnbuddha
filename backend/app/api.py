from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from . import costs, jobs, kit
from .brain import BrainError, CourseRequest, brain_options, get_brain, resolve_brain
from .genai_client import describe as google_describe
from .config import get_settings
from .db import get_db
from .models import QA, Attempt, Course, LearningSession, Lesson, Scene, UsageEvent, new_id
from .pipeline import course_cache_key, scene_cache_key

router = APIRouter(prefix="/api")


# ───────────── schemas ─────────────


class DiagnoseIn(BaseModel):
    topic: str = Field(min_length=2, max_length=300)
    goal: str = Field(default="", max_length=500)
    minutes: int = Field(default=8, ge=2, le=60)
    language: str = "English"
    brain: str = ""  # anthropic | gemini | mock; empty = default


class Answer(BaseModel):
    question: str
    answer: str


class CourseIn(DiagnoseIn):
    answers: list[Answer] = []
    cost_ref: str = ""  # from /diagnose, so the diagnostic questions' cost joins the course
    kit: str = kit.AUTO_KIT  # auto | zen-board-v1 | zen-board-hc-v1 | storybook-v1


class OutlineOp(BaseModel):
    op: Literal["drop", "restore", "move"]
    scene_id: str
    to_index: int | None = None


class OutlineIn(BaseModel):
    ops: list[OutlineOp]


class ReflowIn(BaseModel):
    direction: Literal["gentler", "deeper"]


# ───────────── helpers ─────────────


def scene_out(s: Scene) -> dict:
    return {
        "id": s.id, "kind": s.kind, "title": s.title, "objective": s.objective, "key_points": s.key_points, "visual_idea": s.visual_idea,
        "target_seconds": s.target_seconds, "status": s.status, "stage": s.stage, "progress": round(s.progress or 0, 2), "error": s.error,
        "dropped": s.dropped, "duration": (s.media or {}).get("duration"), "poster": (s.media or {}).get("poster"), "video": (s.media or {}).get("path"),
        "sources": s.sources or [], "idx": s.idx,
    }


def course_out(db: Session, c: Course) -> dict:
    lessons = db.execute(select(Lesson).where(Lesson.course_id == c.id).order_by(Lesson.idx)).scalars().all()
    out_l = []
    for L in lessons:
        scenes = db.execute(select(Scene).where(Scene.lesson_id == L.id, Scene.kind == "lesson").order_by(Scene.idx)).scalars().all()
        out_l.append({
            "id": L.id, "title": L.title, "objective": L.objective, "dropped": L.dropped,
            "checkpoint_count": len((L.checkpoint or {}).get("questions", [])), "scenes": [scene_out(s) for s in scenes],
        })
    total = sum(s["target_seconds"] for L in out_l for s in L["scenes"] if not s["dropped"])
    return {
        "id": c.id, "topic": c.topic, "goal": c.goal, "title": c.title, "summary": c.summary, "level": c.level, "language": c.language,
        "kit": c.kit, "brain": resolve_brain(c.brain or None), "minutes": c.minutes, "status": c.status, "error": c.error, "sources": c.sources, "version": c.version,
        "created_at": c.created_at.isoformat(), "lessons": out_l, "estimated_seconds": total,
    }


def get_course(db: Session, course_id: str) -> Course:
    c = db.get(Course, course_id)
    if c is None:
        raise HTTPException(404, "course not found")
    return c


# ───────────── routes ─────────────


def _gemini_served() -> dict:
    try:
        from .brain.gemini import SERVED

        return dict(SERVED)
    except Exception:
        return {}


@router.get("/health")
def health() -> dict:
    s = get_settings()
    return {
        "ok": True, "brain": s.brain, "brains": brain_options(), "tts": s.tts, "voice": s.voice, "kits": kit.KITS, "google": google_describe(),
        "models": {"claude": s.claude_model, "gemini_brain": s.gemini_brain_model, "gemini_tts": s.gemini_tts_model, "gemini_live": s.gemini_live_model},
        "gemini_served": _gemini_served(),
    }


@router.post("/diagnose")
def diagnose(body: DiagnoseIn) -> dict:
    """The same three questions for every topic, no model call. The planner reads the answers (audience, level, goal)."""
    return {"questions": diagnostic_questions(body.topic), "cost_ref": new_id()}


def diagnostic_questions(topic: str) -> list[dict]:
    return [
        {"id": "who", "question": "Who is learning?", "options": ["A child (6–10)", "A school student (11–17)", "A university or professional student", "An adult, just curious"]},
        {"id": "level", "question": "How much do you already know about this topic?", "options": ["Brand new to it", "I know the basics", "I've studied it before"]},
        {"id": "why", "question": "What do you want out of it?", "options": ["The big-picture intuition", "Exam preparation", "To use it at work or in a project"]},
    ]


def _claim_ref(db: Session, ref: str, course_id: str) -> None:
    if ref:
        db.execute(update(UsageEvent).where(UsageEvent.ref == ref, UsageEvent.course_id.is_(None)).values(course_id=course_id))


@router.post("/courses")
def create_course(body: CourseIn, db: Session = Depends(get_db)) -> dict:
    answers = [a.model_dump() for a in body.answers]
    kit_id = body.kit if body.kit in kit.KITS else kit.AUTO_KIT
    brain = resolve_brain(body.brain or None)
    key = course_cache_key(body.topic, body.goal, body.minutes, answers, kit_id, body.language, brain)
    cached = db.execute(
        select(Course).where(Course.cache_key == key, Course.status.in_(["ready", "planning"])).order_by(Course.created_at.desc()).limit(1)
    ).scalar_one_or_none()
    if cached is not None:
        _claim_ref(db, body.cost_ref, cached.id)
        return {**course_out(db, cached), "cached": True}
    c = Course(topic=body.topic, goal=body.goal, minutes=body.minutes, language=body.language, kit=kit_id, brain=brain, diagnostics=answers, cache_key=key, status="planning")
    db.add(c)
    db.flush()
    jobs.enqueue(db, "plan_course", {"course_id": c.id}, priority=jobs.PRIORITY_PLAN)
    _claim_ref(db, body.cost_ref, c.id)
    return {**course_out(db, c), "cached": False}


@router.get("/courses")
def list_courses(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(select(Course).order_by(Course.created_at.desc()).limit(50)).scalars().all()
    out = []
    for c in rows:
        sess = db.execute(select(LearningSession).where(LearningSession.course_id == c.id).order_by(LearningSession.updated_at.desc()).limit(1)).scalar_one_or_none()
        out.append({"id": c.id, "title": c.title or c.topic, "topic": c.topic, "status": c.status, "kit": c.kit, "created_at": c.created_at.isoformat(),
                    "session_id": sess.id if sess else None, "completed": bool(sess and sess.completed)})
    return out


@router.get("/courses/{course_id}")
def read_course(course_id: str, db: Session = Depends(get_db)) -> dict:
    return course_out(db, get_course(db, course_id))


@router.patch("/courses/{course_id}/outline")
def edit_outline(course_id: str, body: OutlineIn, db: Session = Depends(get_db)) -> dict:
    c = get_course(db, course_id)
    for op in body.ops:
        sc = db.get(Scene, op.scene_id)
        if sc is None or sc.course_id != c.id or sc.kind != "lesson":
            raise HTTPException(404, f"scene {op.scene_id} not found")
        if op.op == "drop":
            sc.dropped = True
        elif op.op == "restore":
            sc.dropped = False
        elif op.op == "move" and op.to_index is not None:
            sibs = db.execute(select(Scene).where(Scene.lesson_id == sc.lesson_id, Scene.kind == "lesson").order_by(Scene.idx)).scalars().all()
            sibs = [s for s in sibs if s.id != sc.id]
            sibs.insert(max(0, min(len(sibs), op.to_index)), sc)
            for i, s in enumerate(sibs):
                s.idx = float(i)
    c.version += 1
    return course_out(db, c)


@router.post("/lessons/{lesson_id}/reflow")
def reflow_lesson(lesson_id: str, body: ReflowIn, db: Session = Depends(get_db)) -> dict:
    """Re-plan one lesson gentler or deeper. Scenes whose content is unchanged keep their cached clips."""
    L = db.get(Lesson, lesson_id)
    if L is None:
        raise HTTPException(404, "lesson not found")
    c = db.get(Course, L.course_id)
    old = db.execute(select(Scene).where(Scene.lesson_id == L.id, Scene.kind == "lesson", Scene.dropped.is_(False)).order_by(Scene.idx)).scalars().all()
    goal = (
        f"Re-plan ONLY the lesson '{L.title}' (objective: {L.objective}) "
        + ("more gently: smaller steps, more intuition and examples, fewer symbols." if body.direction == "gentler" else "in more depth: more rigour, an extra worked example, an edge case.")
        + f" Current scenes: {[s.title for s in old]}. Return a plan with exactly one lesson."
    )
    try:
        with costs.scope(course_id=c.id):
            plan = get_brain(c.brain or None).plan(CourseRequest(topic=c.topic, goal=goal, minutes=max(2, sum(s.target_seconds for s in old) // 60 + (1 if body.direction == "deeper" else 0)), language=c.language, answers=c.diagnostics or []))
    except BrainError as e:
        raise HTTPException(502, str(e))
    new_lesson = (plan.get("lessons") or [None])[0]
    if not new_lesson:
        raise HTTPException(502, "planner returned no lesson")
    for s in old:
        s.dropped = True
    L.objective = new_lesson.get("objective", L.objective)
    L.checkpoint = new_lesson.get("checkpoint", L.checkpoint)
    for si, S in enumerate(new_lesson.get("scenes", [])):
        sc = Scene(course_id=c.id, lesson_id=L.id, idx=float(si), kind="lesson", title=S["title"], objective=S.get("objective", ""), key_points=S.get("key_points", []), visual_idea=S.get("visual_idea", ""), target_seconds=int(S.get("target_seconds", 45)))
        sc.cache_key = scene_cache_key(c, L, sc)
        db.add(sc)
        db.flush()
        jobs.enqueue(db, "produce_scene", {"scene_id": sc.id}, priority=jobs.PRIORITY_SCENE_BASE + 15 - si)
    c.version += 1
    return course_out(db, c)


@router.post("/scenes/{scene_id}/retry")
def retry_scene(scene_id: str, db: Session = Depends(get_db)) -> dict:
    sc = db.get(Scene, scene_id)
    if sc is None:
        raise HTTPException(404, "scene not found")
    sc.status, sc.stage, sc.progress, sc.error = "queued", "queued", 0, None
    job = {"answer": "produce_answer", "recap": "produce_recap"}.get(sc.kind, "produce_scene")
    jobs.enqueue(db, job, {"scene_id": sc.id}, priority=jobs.PRIORITY_ANSWER if sc.kind in ("answer", "recap") else jobs.PRIORITY_SCENE_BASE + 20)
    return scene_out(sc)


@router.get("/scenes/{scene_id}")
def read_scene(scene_id: str, db: Session = Depends(get_db)) -> dict:
    sc = db.get(Scene, scene_id)
    if sc is None:
        raise HTTPException(404, "scene not found")
    return {**scene_out(sc), "script": sc.script, "timings": sc.timings, "spec": sc.spec, "question": sc.question}


@router.post("/courses/{course_id}/sessions")
def open_session(course_id: str, fresh: bool = False, db: Session = Depends(get_db)) -> dict:
    c = get_course(db, course_id)
    if not fresh:
        ls = db.execute(
            select(LearningSession).where(LearningSession.course_id == c.id, LearningSession.learner_id == "local").order_by(LearningSession.updated_at.desc()).limit(1)
        ).scalar_one_or_none()
        if ls is not None:
            return {"id": ls.id, "course_id": c.id, "resumed": True}
    ls = LearningSession(id=new_id(), course_id=c.id, state={})
    db.add(ls)
    return {"id": ls.id, "course_id": c.id, "resumed": False}


def session_summary(db: Session, ls: LearningSession) -> dict:
    c = db.get(Course, ls.course_id)
    qa = db.execute(select(QA).where(QA.session_id == ls.id).order_by(QA.created_at)).scalars().all()
    attempts = db.execute(select(Attempt).where(Attempt.session_id == ls.id).order_by(Attempt.created_at)).scalars().all()
    answer_ids = [q.answer_scene_id for q in qa if q.answer_scene_id]
    answers = {s.id: s for s in db.execute(select(Scene).where(Scene.id.in_(answer_ids))).scalars()} if answer_ids else {}
    mastery: dict[str, dict] = {}
    for a in attempts:
        m = mastery.setdefault(a.lesson_id, {"objective": a.objective, "attempts": 0, "correct": 0})
        m["attempts"] += 1
        m["correct"] += int(a.correct)
    # review cards: concepts asked about more than once, plus missed checkpoint objectives
    concepts: dict[str, list[QA]] = {}
    for q in qa:
        if q.kind == "question" and q.concept:
            concepts.setdefault(q.concept.lower(), []).append(q)
    cards = [{"front": f"Explain: {qs[0].concept}", "back": qs[-1].spoken_answer, "reason": f"asked {len(qs)}×"} for qs in concepts.values() if len(qs) >= 2]
    cards += [{"front": m["objective"], "back": "Revisit this lesson's checkpoint.", "reason": "missed a checkpoint"} for m in mastery.values() if m["correct"] < m["attempts"]]
    return {
        "id": ls.id, "course_id": c.id, "course_title": c.title or c.topic, "completed": ls.completed, "position": (ls.state or {}).get("position"),
        "qa": [{
            "id": q.id, "question": q.question, "answer": q.spoken_answer, "kind": q.kind, "concept": q.concept, "t": q.t, "scene_id": q.scene_id,
            "created_at": q.created_at.isoformat(),
            "answer_clip": ({"id": answers[q.answer_scene_id].id, "status": answers[q.answer_scene_id].status, "video": (answers[q.answer_scene_id].media or {}).get("path")} if q.answer_scene_id in answers else None),
        } for q in qa],
        "mastery": [{"lesson_id": k, **v, "score": v["correct"] / max(1, v["attempts"])} for k, v in mastery.items()],
        "review_cards": cards,
    }


@router.get("/costs")
def read_costs(course_id: str = "", session_id: str = "", limit: int = 300, db: Session = Depends(get_db)) -> dict:
    """Cost of every charged model call (newest first), with totals per operation, in INR and USD."""
    q = select(UsageEvent)
    if course_id:
        q = q.where(UsageEvent.course_id == course_id)
    if session_id:
        q = q.where(UsageEvent.session_id == session_id)
    events = db.execute(q.order_by(UsageEvent.created_at.desc(), UsageEvent.id.desc())).scalars().all()
    titles = {}
    ids = {e.course_id for e in events if e.course_id}
    if ids:
        titles = {c.id: (c.title or c.topic) for c in db.execute(select(Course).where(Course.id.in_(ids))).scalars()}
    out = costs.summarize(events)
    out["events"] = [{**costs.event_out(e), "course_title": titles.get(e.course_id, "")} for e in events[: max(1, min(limit, 2000))]]
    out["courses"] = [
        {"course_id": cid, "title": titles.get(cid, ""), "cost_inr": round(sum(e.cost_inr for e in events if e.course_id == cid), 4)}
        for cid in sorted(ids, key=lambda i: -sum(e.cost_inr for e in events if e.course_id == i))
    ]
    return out


@router.get("/sessions/{session_id}")
def read_session(session_id: str, db: Session = Depends(get_db)) -> dict:
    ls = db.get(LearningSession, session_id)
    if ls is None:
        raise HTTPException(404, "session not found")
    return session_summary(db, ls)


@router.get("/sessions/{session_id}/notes.md", response_class=PlainTextResponse)
def notes(session_id: str, db: Session = Depends(get_db)) -> str:
    ls = db.get(LearningSession, session_id)
    if ls is None:
        raise HTTPException(404, "session not found")
    c = db.get(Course, ls.course_id)
    summ = session_summary(db, ls)
    lines = [f"# {c.title or c.topic}", "", f"_{c.summary}_", ""]
    for L in db.execute(select(Lesson).where(Lesson.course_id == c.id, Lesson.dropped.is_(False)).order_by(Lesson.idx)).scalars():
        lines += [f"## {L.title}", "", f"**Objective:** {L.objective}", ""]
        for s in db.execute(select(Scene).where(Scene.lesson_id == L.id, Scene.kind == "lesson", Scene.dropped.is_(False)).order_by(Scene.idx)).scalars():
            lines += [f"### {s.title}", ""] + [f"- {k}" for k in s.key_points] + [""]
            if s.script:
                lines += ["> " + " ".join(s.script), ""]
    if summ["qa"]:
        lines += ["## Your questions", ""]
        for q in summ["qa"]:
            if q["kind"] == "question":
                lines += [f"**Q:** {q['question']}", "", f"**A:** {q['answer']}", ""]
    if summ["review_cards"]:
        lines += ["## Review cards", ""] + [f"- **{r['front']}** — {r['back']} _({r['reason']})_" for r in summ["review_cards"]] + [""]
    if c.sources:
        lines += ["## Sources", ""] + [f"- [{s.get('title')}]({s.get('url')})" for s in c.sources] + [""]
    return "\n".join(lines)
