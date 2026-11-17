"""LearnBuddha Stream: one WebSocket per learner session.

Downstream: fMP4 init/fragments (binary) pumped ~AHEAD seconds ahead of the playhead, plus JSON control
            (entry, truncate, checkpoint, waiting, course_status, tutor text/audio, control …).
Upstream:   mic PCM16 @16 kHz (binary) and JSON control (playhead, barge_in, ask, explain_again, …).

Binary frames: [u32 LE header length][JSON header][payload].
"""
from __future__ import annotations

import asyncio
import json
import logging
import struct
import time
from pathlib import Path
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy import select

from . import jobs, kit
from .brain import TutorContext
from .config import get_settings
from .db import session
from .models import QA, Attempt, Course, LearningSession, Lesson, Scene, new_id
from .pipeline import sentence_index
from .playlist import build_base, describe, first_fragment, index_of, rebuild_keeping_position, scene_entry, sentence_start_at
from . import costs
from .voice import Callbacks, make_agent

log = logging.getLogger("lb.ws")

AHEAD = 18.0  # seconds of media kept in flight ahead of the playhead


def pack(header: dict, payload: bytes) -> bytes:
    h = json.dumps(header).encode()
    return struct.pack("<I", len(h)) + h + payload


class Conn:
    def __init__(self, ws: WebSocket, session_id: str) -> None:
        self.ws = ws
        self.sid = session_id
        self.send_lock = asyncio.Lock()
        self.state_lock = asyncio.Lock()  # serialises pump steps and playlist edits
        self.wake = asyncio.Event()
        self.closed = False
        # playlist + pump state
        self.playlist: list[dict] = []
        self.idx = 0  # playlist cursor
        self.frag: int | None = None  # next fragment of the current entry (None = entry not started)
        self.placed: list[dict] = []  # entries on the client timeline: {eid, tl_start, tl_end, src_from, src_to, scene_id}
        self.tl_end = 0.0
        self.playhead = 0.0
        self.blocked: str | None = None
        self.checkpoint_eid: str | None = None
        self.course_id = ""
        self.course_version = 1
        self.scene_cache: dict[str, dict] = {}
        self.files: dict[str, Any] = {}
        self.last_wait_msg = 0.0
        self.last_saved = 0.0
        self.status_sig = ""
        # interruption state
        self.barge: dict | None = None
        self.agent = make_agent(Callbacks(self.on_user_text, self.on_tutor_text, self.on_tutor_audio, self.on_control, self.on_visual, self.on_turn_done, self.on_annotate))

    # ───────────── send helpers ─────────────

    async def send(self, msg: dict) -> None:
        if self.closed:
            return
        async with self.send_lock:
            await self.ws.send_text(json.dumps(msg))

    async def send_bin(self, header: dict, payload: bytes) -> None:
        if self.closed:
            return
        async with self.send_lock:
            await self.ws.send_bytes(pack(header, payload))

    # ───────────── lifecycle ─────────────

    async def run(self) -> None:
        await self.ws.accept()
        ok = await asyncio.to_thread(self.load)
        if not ok:
            await self.send({"type": "error", "message": "session not found"})
            await self.ws.close()
            return
        await self.send({"type": "hello", "session_id": self.sid, "voice_mode": self.agent.mode, "playlist": [describe(e) for e in self.playlist], "cursor": self.idx})
        costs.set_scope(course_id=self.course_id, session_id=self.sid)  # inherited by the voice tasks
        self.agent.warm(self.course_info)  # open the voice connection now so the first interruption is fast
        tasks = [asyncio.create_task(self.pump_loop()), asyncio.create_task(self.status_loop())]
        try:
            while True:
                msg = await self.ws.receive()
                if msg.get("type") == "websocket.disconnect":
                    break
                if msg.get("bytes") is not None:
                    await self.on_binary(msg["bytes"])
                elif msg.get("text") is not None:
                    await self.on_json(json.loads(msg["text"]))
        except WebSocketDisconnect:
            pass
        except Exception:
            log.exception("session %s socket error", self.sid)
        finally:
            self.closed = True
            for t in tasks:
                t.cancel()
            await self.agent.close()
            for f in self.files.values():
                f.close()
            await asyncio.to_thread(self.save, True)

    def load(self) -> bool:
        with session() as db:
            ls = db.get(LearningSession, self.sid)
            if ls is None:
                return False
            c = db.get(Course, ls.course_id)
            self.course_id = c.id
            if hasattr(self.agent, "brain"):
                self.agent.brain = c.brain or None  # typed tutor uses the course's brain
            self.course_info = {"title": c.title or c.topic, "level": c.level, "language": c.language}
            st = dict(ls.state or {})
            pl = st.get("playlist")
            pos = st.get("position")
            if not pl:
                pl = build_base(db, c)
                idx = 0
            elif st.get("course_version") != c.version:
                pl, idx = rebuild_keeping_position(db, c, pl, pos)
            else:
                idx = max(0, index_of(pl, pos["eid"])) if pos else int(st.get("cursor", 0))
                if pos and idx >= 0 and pl[idx]["kind"] == "scene":
                    pl[idx]["src_from"] = pos.get("resume_from", pl[idx].get("src_from", 0.0))
            self.playlist, self.idx, self.course_version = pl, idx, c.version
            ls.state = {**st, "playlist": pl, "cursor": idx, "course_version": c.version}
        return True

    def save(self, force: bool = False) -> None:
        if not force and time.monotonic() - self.last_saved < 4:
            return
        self.last_saved = time.monotonic()
        pos = self.position_at(self.playhead)
        with session() as db:
            ls = db.get(LearningSession, self.sid)
            if ls is None:
                return
            st = dict(ls.state or {})
            st.update({"playlist": self.playlist, "course_version": self.course_version})
            if pos:
                st["position"] = pos
            ls.state = st

    # ───────────── timeline mapping ─────────────

    def placed_at(self, tl: float) -> dict | None:
        cand = None
        for p in self.placed:
            if p["tl_start"] <= tl + 1e-6:
                cand = p
        return cand

    def position_at(self, tl: float) -> dict | None:
        p = self.placed_at(tl)
        if not p:
            return None
        media_t = p["src_from"] + (tl - p["tl_start"])
        sc = self.scene_cache.get(p["scene_id"]) or {}
        return {"eid": p["eid"], "scene_id": p["scene_id"], "media_t": round(media_t, 3), "resume_from": sentence_start_at(sc.get("media", {}), media_t)}

    # ───────────── scene loading ─────────────

    def load_scene(self, scene_id: str) -> dict | None:
        with session() as db:
            sc = db.get(Scene, scene_id)
            if sc is None:
                return None
            lesson = db.get(Lesson, sc.lesson_id) if sc.lesson_id else None
            d = {
                "id": sc.id, "status": sc.status, "stage": sc.stage, "progress": sc.progress, "kind": sc.kind, "title": sc.title,
                "media": sc.media or {}, "timings": sc.timings or [], "script": sc.script or [], "spec": sc.spec or {},
                "lesson_id": sc.lesson_id, "lesson_title": lesson.title if lesson else "", "error": sc.error, "key_points": sc.key_points or [],
            }
        if d["status"] == "ready":
            self.scene_cache[scene_id] = d
        return d

    async def scene(self, scene_id: str) -> dict | None:
        if scene_id in self.scene_cache:
            return self.scene_cache[scene_id]
        return await asyncio.to_thread(self.load_scene, scene_id)

    def read(self, path: str, offset: int, size: int) -> bytes:
        f = self.files.get(path)
        if f is None:
            f = open(get_settings().media_dir / path, "rb")
            self.files[path] = f
        f.seek(offset)
        return f.read(size)

    # ───────────── the pump ─────────────

    async def pump_loop(self) -> None:
        while not self.closed:
            try:
                async with self.state_lock:
                    progressed = await self.pump_step()
            except Exception:
                log.exception("pump error")
                progressed = False
            if not progressed:
                self.wake.clear()
                try:
                    await asyncio.wait_for(self.wake.wait(), timeout=0.4)
                except asyncio.TimeoutError:
                    pass

    async def pump_step(self) -> bool:
        if self.blocked or self.tl_end > self.playhead + AHEAD:
            return False
        if self.idx >= len(self.playlist):
            self.blocked = "end"
            return False
        e = self.playlist[self.idx]
        if e["kind"] == "checkpoint":
            await self.send_checkpoint(e)
            return True
        if e["kind"] == "end":
            self.blocked = "end"
            await self.send({"type": "course_end", "tl_at": round(self.tl_end, 4)})
            await asyncio.to_thread(self.mark_complete)
            return True
        sc = await self.scene(e["scene_id"])
        if sc is None:
            self.idx += 1
            return True
        live = sc["status"] == "working" and bool((sc.get("media") or {}).get("live"))
        if sc["status"] == "failed" and self.frag is not None:
            # it failed while we were streaming it: end what was played and move on
            self.placed[-1]["tl_end"] = round(self.tl_end, 4)
            self.idx += 1
            self.frag = None
            await self.send({"type": "scene_failed", "scene_id": sc["id"], "kind": sc["kind"], "title": sc["title"], "error": (sc.get("error") or "")[:300]})
            return True
        if sc["status"] != "ready" and not live:
            if sc["status"] == "failed":
                await self.send({"type": "scene_failed", "scene_id": sc["id"], "kind": sc["kind"], "title": sc["title"], "error": (sc.get("error") or "")[:300]})
                self.playlist.pop(self.idx)
                return True
            if time.monotonic() - self.last_wait_msg > 1.0:
                self.last_wait_msg = time.monotonic()
                await self.send({"type": "waiting", "scene_id": sc["id"], "kind": sc["kind"], "title": sc["title"], "stage": sc["stage"], "progress": sc["progress"], "key_points": sc["key_points"], "tl_at": round(self.tl_end, 4)})
            return False
        m = sc["media"]
        frags = m["fragments"]
        src_to = e.get("src_to") if e.get("src_to") is not None else m["duration"]
        if self.frag is None:
            i0 = first_fragment(m, e.get("src_from", 0.0))
            src_from = frags[i0][0]
            e["src_from"] = src_from
            placed = {"eid": e["eid"], "scene_id": sc["id"], "tl_start": round(self.tl_end, 4), "tl_end": None, "src_from": src_from, "src_to": src_to}
            self.placed.append(placed)
            await self.send({
                "type": "entry", "eid": e["eid"], "scene_id": sc["id"], "kind": sc["kind"], "title": sc["title"], "tag": e.get("tag", ""),
                "lesson_id": sc["lesson_id"], "lesson_title": sc["lesson_title"], "tl_start": placed["tl_start"],
                "src_from": src_from, "src_to": src_to, "pts_offset": m.get("pts_offset", 0.0), "codec": m.get("codec"),
                "timings": sc["timings"], "duration": m["duration"],
            })
            await self.send_bin({"k": "init", "eid": e["eid"]}, self.read(m["path"], 0, m["init_size"]))
            self.frag = i0
        if self.frag >= len(frags) and live:
            return False  # streaming a scene that is still rendering: everything finished so far has been sent
        if self.frag < len(frags) and frags[self.frag][0] < src_to - 1e-3:
            start, end, off, size = frags[self.frag]
            await self.send_bin({"k": "frag", "eid": e["eid"], "i": self.frag, "start": start}, self.read(m["path"], off, size))
            p = self.placed[-1]
            self.tl_end = p["tl_start"] + (min(end, src_to) - p["src_from"])
            self.frag += 1
        if (self.frag >= len(frags) and not live) or (self.frag < len(frags) and frags[self.frag][0] >= src_to - 1e-3):
            self.placed[-1]["tl_end"] = round(self.tl_end, 4)
            self.idx += 1
            self.frag = None
        return True

    def mark_complete(self) -> None:
        with session() as db:
            ls = db.get(LearningSession, self.sid)
            if ls:
                ls.completed = True

    # ───────────── splicing ─────────────

    async def splice(self, tl: float, insert: list[dict], resume: bool) -> None:
        async with self.state_lock:
            await self._splice(tl, insert, resume)
        self.wake.set()
        await asyncio.to_thread(self.save, True)

    async def _splice(self, tl: float, insert: list[dict], resume: bool) -> None:
        """Cut the timeline at tl; play `insert`, then (optionally) the interrupted scene again from the
        start of the interrupted sentence; then the rest of the playlist."""
        p = self.placed_at(tl)
        if p is None:
            return
        pi = index_of(self.playlist, p["eid"])
        if pi < 0:
            return
        cur = self.playlist[pi]
        media_t = p["src_from"] + (tl - p["tl_start"])
        orig_to = cur.get("src_to")
        cur["src_to"] = round(media_t, 4)
        new = list(insert)
        if resume:
            sc = self.scene_cache.get(cur["scene_id"]) or {}
            new.append(scene_entry(cur["scene_id"], cur.get("lesson_id"), sentence_start_at(sc.get("media", {}), media_t), orig_to, tag="resume"))
        self.playlist[pi + 1 : pi + 1] = new
        # discard everything already pumped beyond the cut
        self.placed = [x for x in self.placed if x["tl_start"] <= tl + 1e-6]
        self.placed[-1]["tl_end"] = round(tl, 4)
        self.tl_end = tl
        self.idx = pi + 1
        self.frag = None
        if self.blocked != "checkpoint":
            self.blocked = None
        await self.send({"type": "truncate", "tl": round(tl, 4), "playlist": [describe(e) for e in self.playlist], "cursor": self.idx})

    def new_clip(self, kind: str, parent: dict, t: float, question: str, title: str, priority: int, job: str) -> str:
        with session() as db:
            sc = Scene(
                id=new_id(), course_id=self.course_id, lesson_id=parent.get("lesson_id"), kind=kind, title=title, objective=parent.get("objective", ""),
                key_points=parent.get("key_points", []), parent_scene_id=parent["id"], parent_t=t, question=question, session_id=self.sid,
                target_seconds=30 if kind in ("answer", "remediation") else 45, status="queued", stage="queued",
            )
            db.add(sc)
            db.flush()
            jobs.enqueue(db, job, {"scene_id": sc.id}, priority=priority)
            return sc.id

    # ───────────── interruptions ─────────────

    def tutor_context(self) -> TutorContext:
        b = self.barge or {}
        sc = b.get("scene") or {}
        t = b.get("media_t", 0.0)
        si = sentence_index(sc.get("timings", []), t)
        script = sc.get("script", [])
        recent = []
        with session() as db:
            c = db.get(Course, self.course_id)
            for q in db.execute(select(QA).where(QA.session_id == self.sid).order_by(QA.created_at.desc()).limit(3)).scalars():
                recent.append({"q": q.question, "a": q.spoken_answer})
            return TutorContext(
                course_title=c.title or c.topic, level=c.level, language=c.language, scene_title=sc.get("title", ""),
                script_so_far=script[: si + 1], current_sentence=script[si] if script else "", on_screen=[f"[{e['id']}] {e['text'] or e['type']}" for e in kit.visible_elements(sc.get("spec", {}), t)], recent_qa=recent,
            )

    async def set_barge(self, tl: float) -> None:
        p = self.placed_at(tl)
        if p is None:
            self.barge = None
            return
        sc = await self.scene(p["scene_id"])
        media_t = p["src_from"] + (tl - p["tl_start"])
        self.barge = {"tl": tl, "eid": p["eid"], "scene": sc, "media_t": media_t, "qa_id": None}

    async def on_annotate(self, target: str, mark: str, label: str) -> None:
        """The tutor points at something on the paused frame: the browser draws it at once (no clip needed)."""
        b = self.barge or {}
        sc = b.get("scene") or {}
        t = float(b.get("media_t", 0.0))
        ids = {e["id"] for e in kit.visible_elements(sc.get("spec", {}), t)}
        target = target.strip().strip("[]")
        if target.split(".")[0] not in ids:
            log.info("tutor pointed at %r, which is not on screen; ignored", target)
            return
        await self.send({"type": "annotate", "scene_id": sc.get("id"), "eid": b.get("eid"), "t": round(t, 3), "target": target,
                         "mark": mark if mark in ("circle", "arrow", "underline") else "circle", "label": label})

    async def on_user_text(self, text: str, final: bool) -> None:
        await self.send({"type": "user_text", "text": text, "final": final})

    async def on_tutor_text(self, text: str, final: bool, speak: bool) -> None:
        await self.send({"type": "tutor_text", "text": text, "final": final, "speak": speak})

    async def on_tutor_audio(self, pcm: bytes) -> None:
        await self.send_bin({"k": "tts", "rate": 24000}, pcm)

    async def on_control(self, action: str) -> None:
        if action == "skip" and self.barge:
            await self.splice(self.barge["tl"], [], resume=False)
        await self.send({"type": "control", "action": action})

    async def on_visual(self, question: str, concept: str) -> None:
        b = self.barge
        if not b or not b.get("scene") or b["scene"].get("kind") == "recap":
            return
        parent = b["scene"]
        t = b["media_t"]
        si = sentence_index(parent.get("timings", []), t)
        line = parent.get("script", [""])[si] if parent.get("script") else ""
        recap_id = await asyncio.to_thread(self.new_clip, "recap", parent, t, line, parent.get("lesson_title") or parent.get("title", ""), jobs.PRIORITY_ANSWER + 1, "produce_recap")
        answer_id = await asyncio.to_thread(self.new_clip, "answer", parent, t, question, question[:80], jobs.PRIORITY_ANSWER, "produce_answer")
        b["answer_id"] = answer_id
        await self.splice(b["tl"], [scene_entry(answer_id, parent.get("lesson_id"), tag="answer"), scene_entry(recap_id, parent.get("lesson_id"), tag="recap")], resume=True)
        await self.send({"type": "answer_pending", "scene_id": answer_id, "recap_id": recap_id, "question": question})

    async def on_turn_done(self, turn: dict) -> None:
        b = self.barge or {}

        def write() -> None:
            with session() as db:
                db.add(QA(
                    session_id=self.sid, scene_id=(b.get("scene") or {}).get("id"), t=b.get("media_t", 0.0), question=turn.get("question", ""),
                    kind=turn.get("kind", "question"), spoken_answer=turn.get("answer", ""), answer_scene_id=b.get("answer_id"), concept=turn.get("concept", ""),
                ))

        if turn.get("question") or turn.get("answer"):
            await asyncio.to_thread(write)

    # ───────────── checkpoints ─────────────

    async def send_checkpoint(self, e: dict) -> None:
        def q() -> dict:
            with session() as db:
                L = db.get(Lesson, e["lesson_id"])
                qs = (L.checkpoint or {}).get("questions", []) if L else []
                return {"lesson_title": L.title if L else "", "objective": L.objective if L else "", "questions": [{"question": x["question"], "options": x["options"]} for x in qs]}

        data = await asyncio.to_thread(q)
        self.blocked = "checkpoint"
        self.checkpoint_eid = e["eid"]
        await self.send({"type": "checkpoint", "eid": e["eid"], "lesson_id": e["lesson_id"], "tl_at": round(self.tl_end, 4), **data})

    async def checkpoint_answer(self, msg: dict) -> None:
        e = next((x for x in self.playlist if x["eid"] == msg.get("eid")), None)
        if not e:
            return
        qi, choice = int(msg.get("q", 0)), int(msg.get("choice", 0))

        def grade() -> dict:
            with session() as db:
                L = db.get(Lesson, e["lesson_id"])
                qs = (L.checkpoint or {}).get("questions", [])
                if qi >= len(qs):
                    return {}
                q = qs[qi]
                correct = choice == int(q["answer_index"])
                db.add(Attempt(session_id=self.sid, lesson_id=L.id, objective=L.objective, question_idx=qi, choice=choice, correct=correct))
                expl = q.get("explanations", [])
                return {"correct": correct, "correct_index": q["answer_index"], "explanation": expl[choice] if choice < len(expl) else ""}

        res = await asyncio.to_thread(grade)
        await self.send({"type": "checkpoint_result", "eid": e["eid"], "q": qi, "choice": choice, **res})

    async def checkpoint_done(self, msg: dict) -> None:
        if self.blocked != "checkpoint" or msg.get("eid") != self.checkpoint_eid:
            return
        pi = index_of(self.playlist, self.checkpoint_eid)
        rem = msg.get("remediate")
        if rem and pi >= 0:
            e = self.playlist[pi]

            def make() -> str:
                with session() as db:
                    L = db.get(Lesson, e["lesson_id"])
                    q = L.checkpoint["questions"][int(rem.get("q", 0))]
                    choice = int(rem.get("choice", 0))
                    expl = q.get("explanations", [])
                    misconception = f"Question: {q['question']} They chose: {q['options'][choice]}. {expl[choice] if choice < len(expl) else ''} Correct: {q['options'][q['answer_index']]}."
                    sc = Scene(
                        id=new_id(), course_id=self.course_id, lesson_id=L.id, kind="remediation", title=f"Another look: {L.title}", objective=L.objective,
                        key_points=[q["options"][q["answer_index"]], expl[q["answer_index"]] if q["answer_index"] < len(expl) else ""], visual_idea="a different visual than before",
                        question=misconception, session_id=self.sid, target_seconds=35,
                    )
                    db.add(sc)
                    db.flush()
                    jobs.enqueue(db, "produce_scene", {"scene_id": sc.id}, priority=jobs.PRIORITY_REMEDIATION)
                    return sc.id

            sid = await asyncio.to_thread(make)
            async with self.state_lock:
                self.playlist.insert(pi + 1, scene_entry(sid, e["lesson_id"], tag="remediation"))
        async with self.state_lock:
            self.idx = pi + 1 if pi >= 0 else self.idx + 1
            self.frag = None
            self.blocked = None
            self.checkpoint_eid = None
        self.wake.set()
        await asyncio.to_thread(self.save, True)

    # ───────────── inbound ─────────────

    async def on_binary(self, data: bytes) -> None:
        if len(data) < 4:
            return
        n = struct.unpack("<I", data[:4])[0]
        header = json.loads(data[4 : 4 + n])
        if header.get("k") == "mic":
            await self.agent.audio(data[4 + n :])

    async def on_json(self, msg: dict) -> None:
        t = msg.get("type")
        if t == "playhead":
            self.playhead = float(msg.get("tl", 0))
            self.agent.touch()
            self.wake.set()
            await asyncio.to_thread(self.save)
        elif t == "barge_in":
            await self.set_barge(float(msg.get("tl", self.playhead)))
            if self.barge:
                try:
                    ctx = await asyncio.to_thread(self.tutor_context)
                    await self.agent.begin(ctx)
                except Exception as e:
                    log.warning("voice agent failed to start: %s", e)
                    await self.send({"type": "voice_error", "message": str(e)[:300]})
        elif t == "speech_end":
            await self.agent.audio_end()
        elif t == "ask":
            text = str(msg.get("text", "")).strip()
            if not text:
                return
            await self.set_barge(float(msg.get("tl", self.playhead)))
            ctx = await asyncio.to_thread(self.tutor_context)
            try:
                await self.agent.ask(text, ctx)
            except Exception as e:
                log.warning("ask failed: %s", e)
                await self.send({"type": "voice_error", "message": str(e)[:300]})
        elif t == "resume_lesson":
            await self.agent.release()
        elif t == "skip_answer":
            # learner chose not to wait: drop pending answer + recap (the clip still lands in the Q&A log)
            async with self.state_lock:
                while self.idx < len(self.playlist) and self.playlist[self.idx].get("tag") in ("answer", "recap", "simpler") and self.frag is None:
                    self.playlist.pop(self.idx)
                self.frag = None
            self.wake.set()
            await self.send({"type": "playlist", "playlist": [describe(e) for e in self.playlist], "cursor": self.idx})
        elif t == "explain_again":
            await self.set_barge(float(msg.get("tl", self.playhead)))
            b = self.barge
            if b and b.get("scene") and b["scene"]["kind"] in ("lesson", "simpler", "remediation"):
                parent = b["scene"]
                sid = await asyncio.to_thread(self.new_clip, "simpler", parent, b["media_t"], "", parent["title"], jobs.PRIORITY_SIMPLER, "produce_scene")
                await self.splice(b["tl"], [scene_entry(sid, parent.get("lesson_id"), tag="simpler")], resume=False)
                await self.send({"type": "simpler_pending", "scene_id": sid})
        elif t == "checkpoint_answer":
            await self.checkpoint_answer(msg)
        elif t == "checkpoint_done":
            await self.checkpoint_done(msg)
        elif t == "ping":
            await self.send({"type": "pong"})

    # ───────────── course status ─────────────

    async def status_loop(self) -> None:
        while not self.closed:
            try:
                data = await asyncio.to_thread(self.status_snapshot)
                sig = json.dumps(data, sort_keys=True)
                if sig != self.status_sig:
                    self.status_sig = sig
                    await self.send({"type": "course_status", **data})
                    # a scene became ready → the pump may continue
                    self.scene_cache = {k: v for k, v in self.scene_cache.items() if v.get("status") == "ready"}
                    self.wake.set()
            except Exception:
                log.exception("status loop")
            await asyncio.sleep(1.5)

    def status_snapshot(self) -> dict:
        with session() as db:
            rows = db.execute(
                select(Scene.id, Scene.kind, Scene.status, Scene.stage, Scene.progress, Scene.title, Scene.lesson_id).where(
                    Scene.course_id == self.course_id, (Scene.session_id.is_(None)) | (Scene.session_id == self.sid)
                )
            ).all()
        return {"scenes": [{"id": r[0], "kind": r[1], "status": r[2], "stage": r[3], "progress": round(r[4] or 0, 2), "title": r[5], "lesson_id": r[6]} for r in rows]}


async def handle(ws: WebSocket, session_id: str) -> None:
    await Conn(ws, session_id).run()
