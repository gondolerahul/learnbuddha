"""The video factory: course planning and per-clip production.

produce_scene = script (Claude) → fact-check (Claude) → narrate (TTS, per sentence)
              → animate (resolve word cues → spec) → validate + lint → one fix round
              → render (node, TCP) | ffmpeg mix + encode → fMP4 fragment index → publish
"""
from __future__ import annotations

import hashlib
import json
import logging
import shutil
import time
from pathlib import Path
from typing import Any

from sqlalchemy import select

from . import jobs, kit, media, sfx, tts
from .brain import AnswerContext, BrainError, CourseRequest, SceneContext, get_brain, resolve_brain
from .config import get_settings
from .db import session
from .models import QA, Course, Lesson, Scene

log = logging.getLogger("lb.pipeline")

PIPELINE_VERSION = "3"  # 3: style library (11 kits) chosen by subject and learner
RECAP_SECONDS = 4.0


def sha(obj: Any) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:40]


def course_cache_key(topic: str, goal: str, minutes: int, answers: list[dict], kit_id: str, language: str, brain: str = "") -> str:
    norm = " ".join(topic.lower().split())
    ans = sorted(f"{a.get('question', '')}={a.get('answer', '')}".lower() for a in answers)
    return sha([norm, " ".join(goal.lower().split()), minutes, ans, kit_id, language.lower(), resolve_brain(brain or None), PIPELINE_VERSION])


def course_brain(course_id: str):
    with session() as db:
        c = db.get(Course, course_id)
        return get_brain(c.brain if c else None)


def media_root() -> Path:
    return get_settings().media_dir


# ───────────────────────────── status helpers ─────────────────────────────


def set_stage(scene_id: str, stage: str, progress: float | None = None, **fields: Any) -> None:
    with session() as db:
        sc = db.get(Scene, scene_id)
        if not sc:
            return
        sc.stage = stage
        if stage not in ("ready", "failed"):
            sc.status = "working"
        if progress is not None:
            sc.progress = progress
        for k, v in fields.items():
            setattr(sc, k, v)


def fail_scene(scene_id: str, err: str) -> None:
    with session() as db:
        sc = db.get(Scene, scene_id)
        if sc:
            sc.status = "failed"
            sc.stage = "failed"
            sc.error = err[:4000]


# ───────────────────────────── planning ─────────────────────────────


def plan_course(course_id: str) -> None:
    with session() as db:
        c = db.get(Course, course_id)
        if c is None:
            return
        req = CourseRequest(topic=c.topic, goal=c.goal, minutes=c.minutes, language=c.language, answers=c.diagnostics or [])
    try:
        plan = course_brain(course_id).plan(req)
    except Exception as e:  # any failure (model error, expired Google sign-in, network) must not leave it "planning"
        with session() as db:
            c = db.get(Course, course_id)
            c.status = "failed"
            c.error = f"{type(e).__name__}: {e}" if not isinstance(e, BrainError) else str(e)
        raise
    with session() as db:
        c = db.get(Course, course_id)
        c.kit = kit.choose_kit(c.kit, plan.get("audience"), plan.get("style"))  # "auto": the look follows who is learning
        c.title = plan.get("title") or c.topic
        c.summary = plan.get("summary", "")
        c.level = plan.get("level", c.level)
        c.sources = plan.get("sources", [])
        order = 0
        for li, L in enumerate(plan.get("lessons", [])):
            lesson = Lesson(course_id=c.id, idx=float(li), title=L["title"], objective=L.get("objective", ""), checkpoint=L.get("checkpoint", {"questions": []}))
            db.add(lesson)
            db.flush()
            for si, S in enumerate(L.get("scenes", [])):
                sc = Scene(
                    course_id=c.id, lesson_id=lesson.id, idx=float(si), kind="lesson", title=S["title"], objective=S.get("objective", ""),
                    key_points=S.get("key_points", []), visual_idea=S.get("visual_idea", ""), target_seconds=int(S.get("target_seconds", 45)),
                )
                sc.cache_key = scene_cache_key(c, lesson, sc)
                db.add(sc)
                db.flush()
                jobs.enqueue(db, "produce_scene", {"scene_id": sc.id}, priority=max(1, jobs.PRIORITY_SCENE_BASE + 10 - order))
                order += 1
        c.status = "ready"


def scene_cache_key(c: Course, lesson: Lesson, sc: Scene, extra: Any = None) -> str:
    s = get_settings()
    return sha([
        c.cache_key, resolve_brain(c.brain or None), lesson.title, lesson.objective, sc.title, sc.objective, sc.key_points, sc.visual_idea, sc.target_seconds,
        c.kit, c.language, c.level, s.tts, kit.tokens(c.kit)["voice"], s.render_width, s.render_height, s.render_fps, PIPELINE_VERSION, extra,
    ])


# ───────────────────────────── scene production ─────────────────────────────


def _reuse_cached(scene_id: str) -> bool:
    with session() as db:
        sc = db.get(Scene, scene_id)
        if not sc.cache_key:
            return False
        twin = db.execute(
            select(Scene).where(Scene.cache_key == sc.cache_key, Scene.status == "ready", Scene.id != sc.id).limit(1)
        ).scalar_one_or_none()
        if twin is None or not (media_root() / twin.media.get("path", "")).exists():
            return False
        for f in ("script", "timings", "spec", "media", "sources"):
            setattr(sc, f, getattr(twin, f))
        sc.status, sc.stage, sc.progress = "ready", "ready", 1.0
        log.info("scene %s reused cached clip from %s", scene_id, twin.id)
        return True


def scene_context(scene_id: str) -> tuple[SceneContext, str]:
    with session() as db:
        sc = db.get(Scene, scene_id)
        c = db.get(Course, sc.course_id)
        lesson = db.get(Lesson, sc.lesson_id) if sc.lesson_id else None
        siblings = []
        if lesson:
            siblings = db.execute(
                select(Scene).where(Scene.lesson_id == lesson.id, Scene.kind == "lesson", Scene.dropped.is_(False)).order_by(Scene.idx)
            ).scalars().all()
        idx = next((i for i, s in enumerate(siblings) if s.id == sc.id), 0)
        prev = siblings[idx - 1] if idx > 0 else None
        nxt = siblings[idx + 1] if idx + 1 < len(siblings) else None
        prev_summary = ""
        if prev is not None:
            prev_summary = " ".join(prev.script[-2:]) if prev.script else "; ".join(prev.key_points)
        mode = {"remediation": "remediation", "simpler": "simpler"}.get(sc.kind, "lesson")
        original: list[str] = []
        if sc.parent_scene_id:
            parent = db.get(Scene, sc.parent_scene_id)
            original = parent.script if parent else []
        ctx = SceneContext(
            course_title=c.title or c.topic, level=c.level or "curious learner", language=c.language,
            lesson_title=lesson.title if lesson else c.title, lesson_objective=lesson.objective if lesson else "",
            scene_title=sc.title, scene_objective=sc.objective, key_points=sc.key_points or [], visual_idea=sc.visual_idea,
            target_seconds=sc.target_seconds, index_in_lesson=idx if sc.kind == "lesson" else 1, scenes_in_lesson=max(1, len(siblings)),
            previous_summary=prev_summary, next_title=nxt.title if nxt else "", sources=c.sources or [], mode=mode,
            misconception=sc.question or "", original_script=original, kit=c.kit,
        )
        return ctx, c.kit


LENGTH_SLACK = 1.15  # narration more than 15% over its planned length is spoken a little faster (media.fit_to_length)




def produce_scene(scene_id: str) -> None:
    """Lesson, remediation and 'explain again' scenes."""
    if _reuse_cached(scene_id):
        return
    with session() as db:
        brain = course_brain(db.get(Scene, scene_id).course_id)
    s = get_settings()
    ctx, kit_id = scene_context(scene_id)
    try:
        set_stage(scene_id, "scripting", 0.05)
        draft = brain.draft_scene(ctx)
        if not draft["sentences"]:
            raise BrainError("scene draft has no narration")
        _narrate_animate_render(scene_id, draft, ctx, kit_id, target=ctx.target_seconds)
    except Exception as e:
        log.exception("scene %s failed", scene_id)
        fail_scene(scene_id, f"{type(e).__name__}: {e}")
        raise


def _narrate_animate_render(scene_id: str, draft: dict, ctx, kit_id: str, frozen: dict | None = None, target: float | None = None) -> None:
    s = get_settings()
    tok = kit.tokens(kit_id)
    out_dir = media_root() / "clips" / scene_id
    out_dir.mkdir(parents=True, exist_ok=True)

    set_stage(scene_id, "narrating", 0.25, script=draft["sentences"])
    clips = tts.synthesize(draft["sentences"], tok["voice"]["name"], tok["voice"]["style"], ctx.language)
    if target:
        clips, factor = media.fit_to_length(clips, float(target), LENGTH_SLACK)
        if factor > 1:
            log.info("scene %s narration sped up %.2f× to stay near %ss", scene_id, factor, target)
    nar = media.assemble_narration(draft["sentences"], clips, s.render_fps)
    (out_dir / "narration.wav").write_bytes(nar.wav)

    set_stage(scene_id, "animating", 0.35, timings=nar.timings)
    spec = finalize_spec(draft, nar, kit_id, frozen=frozen)
    (out_dir / "spec.json").write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
    set_stage(scene_id, "rendering", 0.4, spec=spec)

    last = [0.0]

    def on_progress(p: float) -> None:
        if time.monotonic() - last[0] > 1.0:
            last[0] = time.monotonic()
            set_stage(scene_id, "rendering", 0.4 + 0.58 * p)

    publish(scene_id, spec, out_dir, nar, music_level=float(tok["music"]["level"]), on_progress=on_progress)


def publish(scene_id: str, spec: dict, out_dir: Path, nar: media.Narration, music_level: float, on_progress=None) -> None:
    mp4 = out_dir / "scene.mp4"
    starts = [t["start"] for t in nar.timings]
    sfx_path = out_dir / "sfx.wav"
    try:
        sfx_path.write_bytes(media.pcm_to_wav(sfx.build(spec), sfx.RATE))
    except Exception as e:  # sound effects are a nicety; never fail a scene over them
        log.warning("sfx failed: %s", e)
        sfx_path = None
    with session() as db:
        sc = db.get(Scene, scene_id)
        lesson = db.get(Lesson, sc.lesson_id) if sc.lesson_id else None
        urgent = sc.kind != "lesson"  # a learner is waiting on answers, recaps and re-explanations
        rank = (lesson.idx if lesson else 0.0, sc.idx, time.monotonic(), scene_id)
    with media.RENDER_GATE.slot(rank, urgent=urgent, on_wait=lambda: set_stage(scene_id, "waiting to render", 0.4)):
        kf = media.encode_scene(spec, out_dir / "narration.wav", mp4, keyframes=starts, music_level=music_level, on_progress=on_progress, sfx_wav=sfx_path)
    idx = media.index_fmp4(mp4)
    frag_list = normalize_fragments(idx["fragments"], kf, spec["duration"])
    pts_offset = idx["fragments"][1][0] - frag_list[1][0] if len(frag_list) > 1 else 0.0
    try:
        media.still(spec, min(spec["duration"] - 0.1, spec["duration"] * 0.6), out_dir / "poster.jpg")
    except Exception as e:  # poster is cosmetic
        log.warning("poster failed: %s", e)
    rel = mp4.relative_to(media_root()).as_posix()
    with session() as db:
        sc = db.get(Scene, scene_id)
        sc.media = {
            "path": rel,
            "poster": (out_dir / "poster.jpg").relative_to(media_root()).as_posix() if (out_dir / "poster.jpg").exists() else None,
            "duration": spec["duration"],
            "init_size": idx["init_size"],
            "codec": idx["codec"],
            "pts_offset": round(pts_offset, 5),
            "fragments": frag_list,
            "sentence_starts": [round(x, 4) for x in starts],
        }
        sc.status, sc.stage, sc.progress, sc.error = "ready", "ready", 1.0, None


def normalize_fragments(frags: list[list], keyframes: list[float], duration: float) -> list[list]:
    """ffmpeg shifts video timestamps by the AAC priming delay (~21 ms) except on the very first
    frame. Map every fragment back to the nominal keyframe time it was forced at, so fragment
    starts equal sentence starts exactly. The shift is kept as `pts_offset` for the player."""
    if not frags:
        return []
    delta = 0.0
    if len(frags) > 1:
        cand = [k for k in keyframes if k <= frags[1][0] + 1e-6]
        delta = frags[1][0] - (cand[-1] if cand else frags[1][0])
    starts = []
    for f in frags:
        nominal = max(0.0, f[0] - delta)
        near = min(keyframes, key=lambda k: abs(k - nominal)) if keyframes else nominal
        starts.append(round(near if abs(near - nominal) < 0.004 else nominal, 4))
    out = []
    for i, (f, st) in enumerate(zip(frags, starts)):
        end = starts[i + 1] if i + 1 < len(starts) else duration
        out.append([st, round(end, 4), f[1], f[2]])
    return out


def finalize_spec(draft: dict, nar: media.Narration, kit_id: str, frozen: dict | None = None) -> dict:
    """Cue resolution → schema validation (invalid elements dropped) → layout repair in code → final spec."""
    answer_mode = frozen is not None

    def build(d: dict) -> tuple[dict, list[str]]:
        spec = kit.resolve_cues(d, nar.timings, nar.duration, kit_id)
        if frozen is not None:
            ff = next((e for e in spec["elements"] if e["type"] == "FrozenFrame"), None)
            if ff is None:
                ff = {"id": "bg", "type": "FrozenFrame", "at": 0, "props": {}}
                spec["elements"].insert(0, ff)
            ff["at"] = 0
            ff["props"] = {k: v for k, v in ff["props"].items() if k in ("dim", "hold", "zoom", "cx", "cy")} | {"t": frozen["t"], "spec": frozen["spec"]}
            ff["props"]["dim"] = max(0.72, float(ff["props"].get("dim", 0.8)))  # the lesson must recede behind the answer
            spec["elements"].remove(ff)
            spec["elements"].insert(0, ff)
        return spec

    spec = build(draft)
    spec, mended = kit.repair_props(spec)
    if mended:
        log.info("mended %d props: %s", len(mended), mended[:6])
    errs = kit.validate_spec(spec, allow_internal=answer_mode)
    bad = [e["id"] for e in spec["elements"] if "__invalid__" in e.get("props", {})]
    if errs or bad:
        log.info("dropping %d invalid elements: %s", len(errs) + len(bad), (errs + bad)[:6])
        spec = kit.drop_invalid(spec, errs)
        spec["elements"] = [e for e in spec["elements"] if "__invalid__" not in e.get("props", {})]
    fixed = media.fix_spec(spec)
    if fixed["before"]:
        log.info("layout: %d issues → %d after repair; %s", fixed["before"], len(fixed["issues"]), fixed["changes"][:8])
    return fixed["spec"]


# ───────────────────────────── answers, recaps ─────────────────────────────


def produce_recap(recap_id: str) -> None:
    with session() as db:
        sc = db.get(Scene, recap_id)
        c = db.get(Course, sc.course_id)
        kit_id = c.kit
        title, line = sc.title, sc.question or ""
    try:
        spec = {"kit": kit_id, "duration": RECAP_SECONDS, "seed": 3, "elements": [{"id": "recap", "type": "RecapCard", "at": 0, "props": {"title": title, "line": line, "label": "Back to the lesson"}}]}
        nar = media.Narration(wav=media.pcm_to_wav(media.silence(RECAP_SECONDS), media.NARRATION_RATE), duration=RECAP_SECONDS, timings=[])
        out_dir = media_root() / "clips" / recap_id
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "narration.wav").write_bytes(nar.wav)
        set_stage(recap_id, "rendering", 0.5, spec=spec)
        publish(recap_id, spec, out_dir, nar, music_level=float(kit.tokens(kit_id)["music"]["level"]))
    except Exception as e:
        fail_scene(recap_id, f"{type(e).__name__}: {e}")
        raise


def produce_answer(answer_id: str) -> None:
    with session() as db:
        sc = db.get(Scene, answer_id)
        parent = db.get(Scene, sc.parent_scene_id)
        c = db.get(Course, sc.course_id)
        t = float(sc.parent_t or 0)
        si = sentence_index(parent.timings, t)
        recent = []
        if sc.session_id:
            recent = [
                {"q": q.question, "a": q.spoken_answer}
                for q in db.execute(select(QA).where(QA.session_id == sc.session_id).order_by(QA.created_at.desc()).limit(4)).scalars()
            ]
        ctx = AnswerContext(
            course_title=c.title or c.topic, level=c.level, language=c.language, question=sc.question or "",
            scene_title=parent.title, script=parent.script or [], sentence_index=si, paused_t=t,
            visible=kit.visible_elements(parent.spec, t), recent_qa=recent, kit=c.kit,
        )
        frozen = {"t": t, "spec": parent.spec}
        kit_id = c.kit
        c_id = c.id
    try:
        set_stage(answer_id, "scripting", 0.05)
        brain = course_brain(c_id)
        draft = brain.draft_answer(ctx)
        if not draft["sentences"]:
            raise BrainError("answer has no narration")
        _narrate_animate_render(answer_id, draft, ctx, kit_id, frozen=frozen, target=30)
    except Exception as e:
        log.exception("answer %s failed", answer_id)
        fail_scene(answer_id, f"{type(e).__name__}: {e}")
        raise


def sentence_index(timings: list[dict], t: float) -> int:
    idx = 0
    for i, s in enumerate(timings or []):
        if s["start"] <= t + 1e-6:
            idx = i
    return idx


# ───────────────────────────── job dispatch ─────────────────────────────

HANDLERS = {
    "plan_course": lambda p: plan_course(p["course_id"]),
    "produce_scene": lambda p: produce_scene(p["scene_id"]),
    "produce_answer": lambda p: produce_answer(p["scene_id"]),
    "produce_recap": lambda p: produce_recap(p["scene_id"]),
}


def cleanup_clip_dir(scene_id: str) -> None:
    shutil.rmtree(media_root() / "clips" / scene_id, ignore_errors=True)
