"""The fast lane: a voice tutor that answers interruptions in ~1 s.

GeminiLiveAgent streams the learner's mic to Gemini Live and relays spoken audio back; it decides
via tool calls whether a visual answer is worth drawing (show_visual_answer) or whether the
interruption was a playback command (lesson_control). TextAgent is the fallback when no Gemini key
is configured: typed (or browser-recognised) questions go to the brain, and the browser speaks the reply.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Protocol

from . import costs
from .brain import TutorContext, get_brain
from .brain.prompts import TUTOR_PERSONA
from .config import get_settings
from .genai_client import client as genai_client

log = logging.getLogger("lb.voice")


@dataclass
class Callbacks:
    user_text: Callable[[str, bool], Awaitable[None]]
    tutor_text: Callable[[str, bool, bool], Awaitable[None]]  # text, final, speak_in_browser
    tutor_audio: Callable[[bytes], Awaitable[None]]
    control: Callable[[str], Awaitable[None]]
    visual: Callable[[str, str], Awaitable[None]]  # question, concept
    turn_done: Callable[[dict], Awaitable[None]]  # {question, answer, kind, concept}
    annotate: Callable[[str, str, str], Awaitable[None]] | None = None  # target id, mark, label: drawn on the paused frame


class VoiceAgent(Protocol):
    mode: str

    def warm(self, course: dict) -> None: ...  # open the fast lane early (course: title, level, language)
    def touch(self) -> None: ...  # the learner is active, so a warm connection is worth keeping
    async def begin(self, ctx: TutorContext) -> None: ...  # a barge-in: hand over the paused moment
    async def audio(self, pcm16k: bytes) -> None: ...
    async def audio_end(self) -> None: ...
    async def ask(self, text: str, ctx: TutorContext) -> None: ...
    async def release(self) -> None: ...  # the lesson resumed: stop relaying this reply, keep the connection
    async def close(self) -> None: ...


def live_instruction(course: dict) -> str:
    return f"""{TUTOR_PERSONA}

You are the live voice of a narrated video lesson. Speak {course.get("language") or "English"}.
Course: {course.get("title", "")}. Learner: {course.get("level", "")}.
You stay connected while the lesson plays. Each time the learner interrupts, you first receive a note
starting with [Paused lesson] that says exactly where the lesson paused and what is on screen. Answer about
that moment, using the most recent note.

How to respond:
- A real question: answer in 1–3 short spoken sentences (under ~15 seconds), warm and concrete, tied to what's on
  screen. If a picture would genuinely help (a why/how, a comparison, a process), ALSO call show_visual_answer with
  the question restated clearly, and say you'll sketch it. Don't call it for quick factual or yes/no doubts.
- When your answer is about something already on screen, call point_at FIRST, before you start speaking: the learner sees a circle,
  arrow or underline appear on that element straight away, with your short label. Use the [id] from the on-screen
  list, at most 3 marks per answer. Prefer pointing at what is there over drawing a new clip.
- A playback command (slower, faster, repeat, skip, continue, pause): call lesson_control and say only a few words.
- A cough, background noise, or nothing meaningful: call lesson_control with action "resume" and say nothing.
Never lecture; the lesson will continue right after you. Never reply to a [Paused lesson] note on its own."""


def context_note(ctx: TutorContext) -> str:
    return f"""[Paused lesson] The learner just interrupted. Reply only to what they say or ask next.
Scene: {ctx.scene_title}.
Narration so far: {' '.join(ctx.script_so_far[-6:])}
They interrupted during: "{ctx.current_sentence}"
On screen right now ([id] what): {' | '.join(ctx.on_screen[:20])}
Recent questions: {json.dumps(ctx.recent_qa[-3:], ensure_ascii=False)}"""


def live_tools(non_blocking: bool) -> list[dict]:
    return [
        {
            "function_declarations": [
                {
                    "name": "show_visual_answer",
                    "description": "Draw a short visual answer clip (20–45 s) that grows out of the paused frame, then resume the lesson.",
                    "parameters": {
                        "type": "OBJECT",
                        "properties": {
                            "question": {"type": "STRING", "description": "The learner's question, restated clearly"},
                            "concept": {"type": "STRING", "description": "2–5 word name of the concept"},
                        },
                        "required": ["question"],
                    },
                    **({"behavior": "NON_BLOCKING"} if non_blocking else {}),
                },
                {
                    "name": "point_at",
                    "description": "Mark something on the paused frame while you talk about it (appears instantly).",
                    "parameters": {
                        "type": "OBJECT",
                        "properties": {
                            "target": {"type": "STRING", "description": "The [id] of an element from the on-screen list"},
                            "mark": {"type": "STRING", "enum": ["circle", "arrow", "underline"]},
                            "label": {"type": "STRING", "description": "At most 6 words, or empty"},
                        },
                        "required": ["target", "mark"],
                    },
                    **({"behavior": "NON_BLOCKING"} if non_blocking else {}),
                },
                {
                    "name": "lesson_control",
                    "description": "Control lesson playback.",
                    "parameters": {
                        "type": "OBJECT",
                        "properties": {"action": {"type": "STRING", "enum": ["slower", "faster", "repeat", "skip", "resume", "pause"]}},
                        "required": ["action"],
                    },
                },
            ]
        }
    ]


class _Conn:
    """One open Gemini Live connection and its receive task."""

    def __init__(self, cm, session) -> None:
        self.cm = cm
        self.session = session
        self.recv: asyncio.Task | None = None
        self.born = time.monotonic()
        self.alive = True
        self.going_away = False

    async def shut(self) -> None:
        self.alive = False
        if self.recv and self.recv is not asyncio.current_task():
            self.recv.cancel()
        try:
            await self.cm.__aexit__(None, None, None)
        except Exception:
            pass


class GeminiLiveAgent:
    """Keeps one Live connection warm per lesson session, so an interruption costs a context note (~1 s to first
    audio) instead of a fresh connection (~5 s). The connection is reopened when the server says it is going
    away, when it drops, or when it gets old, but only while the learner is active."""

    mode = "gemini"
    MAX_AGE = 8 * 60  # reopen between turns, before the server's connection limit
    IDLE = 5 * 60  # don't keep reconnecting for a learner who has walked away

    def __init__(self, cb: Callbacks) -> None:
        self.cb = cb
        self._course: dict = {}
        self._conn: _Conn | None = None
        self._connecting: asyncio.Task | None = None
        self._noise_timer: asyncio.Task | None = None
        self._non_blocking = False
        self._closed = False
        self._last_active = time.monotonic()
        self._in_turn = False  # between a barge-in and the end of the model's reply
        self._muted = False  # the lesson resumed: drop the rest of the current reply
        self._note_sent = False
        self.connects = 0  # diagnostics and tests
        self._spent: dict[str, float] = {}  # Live usage since the last recorded turn
        self._bg: set[asyncio.Task] = set()  # cost writes in flight
        self._reset_turn()

    # ── connection ──

    def warm(self, course: dict) -> None:
        self._course = dict(course)
        self._closed = False
        self.touch()
        self._spawn_connect()

    def touch(self) -> None:
        self._last_active = time.monotonic()

    def _usable(self) -> bool:
        c = self._conn
        return bool(c and c.alive and not c.going_away)

    def _spawn_connect(self) -> None:
        if self._closed or self._usable() or (self._connecting and not self._connecting.done()):
            return
        self._connecting = asyncio.create_task(self._connect())
        self._connecting.add_done_callback(self._connect_done)

    @staticmethod
    def _connect_done(t: asyncio.Task) -> None:
        if not t.cancelled() and t.exception() is not None:
            log.warning("gemini live warm connect failed: %s", t.exception())

    async def _connect(self) -> None:
        s = get_settings()
        client = genai_client("live")  # Vertex AI (us-central1) or the Gemini Developer API
        # Async (NON_BLOCKING) function calls are documented for the Developer API; on Vertex the
        # call blocks briefly until we reply, which we do immediately.
        self._non_blocking = s.google_backend == "studio"
        config = {
            "response_modalities": ["AUDIO"],
            "input_audio_transcription": {},
            "output_audio_transcription": {},
            "system_instruction": live_instruction(self._course),
            "tools": live_tools(self._non_blocking),
            # one connection serves many interruptions, so let the server trim old turns
            "context_window_compression": {"sliding_window": {}, "trigger_tokens": 24000},
        }
        t0 = time.monotonic()
        cm = client.aio.live.connect(model=s.gemini_live_model, config=config)
        session = await cm.__aenter__()
        conn = _Conn(cm, session)
        if self._closed:
            await conn.shut()
            return
        old, self._conn = self._conn, conn
        conn.recv = asyncio.create_task(self._receive(conn))
        self.connects += 1
        log.info("gemini live connected in %.1fs", time.monotonic() - t0)
        if old is not None:
            await old.shut()

    async def _ensure(self) -> _Conn:
        stale = self._usable() and not self._in_turn and time.monotonic() - self._conn.born > self.MAX_AGE
        if stale:
            await self._conn.shut()
        if not self._usable():
            self._spawn_connect()
        if self._connecting and not self._connecting.done():
            await self._connecting
        if not self._usable():
            # the background attempt failed or the connection died meanwhile: one direct attempt
            await self._connect()
        if not self._usable():
            raise RuntimeError("voice connection unavailable")
        return self._conn

    def _after_drop(self, conn: _Conn) -> None:
        """Reopen in the background if the learner is still around, so the next barge-in stays fast."""
        if self._closed or conn is not self._conn:
            return
        if time.monotonic() - self._last_active < self.IDLE:
            self._spawn_connect()

    # ── turns ──

    def _reset_turn(self) -> None:
        self._user, self._tutor, self._visual, self._concept, self._kind = "", "", False, "", "question"
        self._spoke = False  # any audio/transcript this turn
        self._deferred = False  # already waited one extra model turn after a tool call
        self._pointed = False  # point_at was called this turn

    async def begin(self, ctx: TutorContext) -> None:
        self.touch()
        if self._noise_timer:
            self._noise_timer.cancel()
            self._noise_timer = None
        conn = await self._ensure()
        self._reset_turn()
        self._muted = False
        self._in_turn = True
        # Adds the paused moment to the conversation without asking for a reply.
        await conn.session.send_client_content(
            turns=[{"role": "user", "parts": [{"text": context_note(ctx)}]}], turn_complete=False
        )
        self._note_sent = True

    async def audio(self, pcm16k: bytes) -> None:
        c = self._conn
        if c is None or not c.alive or not self._in_turn:
            return
        from google.genai import types

        await c.session.send_realtime_input(audio=types.Blob(data=pcm16k, mime_type="audio/pcm;rate=16000"))

    async def audio_end(self) -> None:
        c = self._conn
        if c is None or not c.alive or not self._in_turn:
            return
        try:
            await c.session.send_realtime_input(audio_stream_end=True)
        except Exception as e:
            log.debug("audio_stream_end: %s", e)
        # If nothing intelligible was heard, treat the barge-in as noise and resume.
        if self._noise_timer:
            self._noise_timer.cancel()
        self._noise_timer = asyncio.create_task(self._noise_check())

    async def _noise_check(self) -> None:
        await asyncio.sleep(3.0)
        if self._in_turn and not self._user.strip() and not self._tutor.strip():
            await self.cb.control("resume")

    async def ask(self, text: str, ctx: TutorContext) -> None:
        if not (self._in_turn and self._note_sent and self._usable()):
            await self.begin(ctx)
        self._user = text
        await self.cb.user_text(text, True)
        await self._conn.session.send_realtime_input(text=text)

    async def release(self) -> None:
        """The learner resumed the lesson: stop relaying the rest of this reply but keep the connection warm."""
        self.touch()
        if self._noise_timer:
            self._noise_timer.cancel()
            self._noise_timer = None
        if self._in_turn and (self._spoke or self._user.strip()):
            self._muted = True  # until this reply's turn_complete
        self._in_turn = False
        self._note_sent = False

    def _record_spent(self, question: str) -> None:
        """Write this turn's Live cost in the background (a DB write must not hold up the conversation)."""
        if not self._spent:
            return
        spent, self._spent = self._spent, {}
        t = asyncio.create_task(asyncio.to_thread(costs.record, "voice", "google", get_settings().gemini_live_model, spent, question or "(no question heard)"))
        self._bg.add(t)
        t.add_done_callback(self._bg.discard)

    async def _finish_turn(self) -> None:
        # Snapshot and reset first: the learner may interrupt again while the callbacks below are awaited.
        user, tutor, kind, concept, muted = self._user, self._tutor, self._kind, self._concept, self._muted
        q, a = user.strip(), tutor.strip()
        self._record_spent(q)
        self._reset_turn()
        self._muted = False
        self._note_sent = False
        self._in_turn = False
        if q or a:
            if not muted:
                await self.cb.user_text(user, True)
                await self.cb.tutor_text(tutor, True, False)
            await self.cb.turn_done({"question": q, "answer": a, "kind": kind, "concept": concept})

    async def _receive(self, conn: _Conn) -> None:
        from google.genai import types

        try:
            while conn.alive:
                async for msg in conn.session.receive():
                    if conn is not self._conn:
                        return
                    if getattr(msg, "usage_metadata", None) is not None:
                        self._spent = costs.add_units(self._spent, costs.live_units(msg.usage_metadata))
                    if getattr(msg, "go_away", None) is not None:
                        conn.going_away = True
                        if not self._in_turn:
                            self._after_drop(conn)
                    sc = getattr(msg, "server_content", None)
                    if sc is not None:
                        if sc.model_turn:
                            for part in sc.model_turn.parts or []:
                                if part.inline_data and part.inline_data.data:
                                    self._spoke = True
                                    if not self._muted:
                                        await self.cb.tutor_audio(part.inline_data.data)
                        if sc.input_transcription and sc.input_transcription.text:
                            self._user += sc.input_transcription.text
                            if not self._muted:
                                await self.cb.user_text(self._user, False)
                        if sc.output_transcription and sc.output_transcription.text:
                            self._tutor += sc.output_transcription.text
                            self._spoke = True
                            if not self._muted:
                                await self.cb.tutor_text(self._tutor, False, False)
                        if sc.turn_complete:
                            # With blocking tools (Vertex) the model often calls show_visual_answer first,
                            # ends that turn silently, and speaks in the next turn after our reply.
                            # The same happens after point_at when it is called first, as instructed: the answer comes next turn.
                            if (self._visual or (self._pointed and not self._spoke)) and not self._deferred and not self._muted:
                                self._deferred = True
                                continue
                            await self._finish_turn()
                            if conn.going_away:
                                self._after_drop(conn)
                    tc = getattr(msg, "tool_call", None)
                    if tc is not None:
                        responses = []
                        for fc in tc.function_calls or []:
                            args = dict(fc.args or {})
                            if fc.name == "show_visual_answer":
                                if not self._muted:
                                    self._visual = True
                                    self._concept = str(args.get("concept", ""))
                                    await self.cb.visual(str(args.get("question") or self._user), self._concept)
                                resp = {"result": "Drawing it now. Continue your spoken answer from where you stopped; don't repeat yourself."} | (
                                    {"scheduling": "SILENT"} if self._non_blocking else {}
                                )
                                responses.append(types.FunctionResponse(id=fc.id, name=fc.name, response=resp))
                            elif fc.name == "point_at":
                                self._pointed = True
                                if not self._muted and self.cb.annotate:
                                    await self.cb.annotate(str(args.get("target", "")), str(args.get("mark", "circle")), str(args.get("label", ""))[:60])
                                resp = {"result": "Shown. Keep talking."} | ({"scheduling": "SILENT"} if self._non_blocking else {})
                                responses.append(types.FunctionResponse(id=fc.id, name=fc.name, response=resp))
                            elif fc.name == "lesson_control":
                                self._kind = "control"
                                if not self._muted:
                                    await self.cb.control(str(args.get("action", "resume")))
                                responses.append(types.FunctionResponse(id=fc.id, name=fc.name, response={"result": "ok"}))
                        if responses:
                            await conn.session.send_tool_response(function_responses=responses)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            log.info("gemini live connection ended: %s", e)
        finally:
            conn.alive = False
            if self._spent:
                try:
                    self._record_spent(self._user.strip())
                except Exception:
                    pass
            if conn is self._conn and not self._closed:
                if self._in_turn and not self._muted and not self._spoke:
                    # dropped mid-question before any reply: don't leave the learner hanging
                    try:
                        await self.cb.tutor_text("Sorry, I lost the connection for a moment. Could you ask that again?", True, True)
                    except Exception:
                        pass
                self._in_turn = False
                self._note_sent = False
                self._after_drop(conn)

    async def close(self) -> None:
        self._closed = True
        if self._noise_timer:
            self._noise_timer.cancel()
            self._noise_timer = None
        if self._connecting and not self._connecting.done():
            self._connecting.cancel()
        self._connecting = None
        if self._conn is not None:
            await self._conn.shut()
        self._conn = None
        if self._bg:  # let the last cost rows land
            await asyncio.wait(list(self._bg), timeout=5)


class TextAgent:
    """Fallback lane: brain decides; browser speaks (speechSynthesis) and listens (SpeechRecognition)."""

    mode = "text"

    def __init__(self, cb: Callbacks, brain: str | None = None) -> None:
        self.cb = cb
        self.brain = brain

    def warm(self, course: dict) -> None:
        return None

    def touch(self) -> None:
        return None

    async def begin(self, ctx: TutorContext) -> None:
        return None

    async def release(self) -> None:
        return None

    async def audio(self, pcm16k: bytes) -> None:
        return None

    async def audio_end(self) -> None:
        return None

    async def ask(self, text: str, ctx: TutorContext) -> None:
        await self.cb.user_text(text, True)
        try:
            r = await asyncio.to_thread(get_brain(self.brain).tutor_reply, ctx, text)
        except Exception as e:
            log.warning("tutor reply failed: %s", e)
            r = {"kind": "question", "say": "Sorry, I couldn't think that through just now. Let's keep going and try again in a moment.", "control": "resume", "visual": False, "concept": ""}
        if r.get("say"):
            await self.cb.tutor_text(r["say"], True, True)
        if r["kind"] in ("control", "noise") and r.get("control") not in (None, "none"):
            await self.cb.control(r["control"])
        if r["kind"] == "question" and self.cb.annotate:
            for m in (r.get("marks") or [])[:3]:
                await self.cb.annotate(str(m.get("target", "")), str(m.get("mark", "circle")), str(m.get("label", ""))[:60])
        if r["kind"] == "question" and r.get("visual"):
            await self.cb.visual(text, r.get("concept", ""))
        if r["kind"] != "noise":
            await self.cb.turn_done({"question": text, "answer": r.get("say", ""), "kind": r["kind"], "concept": r.get("concept", "")})

    async def close(self) -> None:
        return None


def make_agent(cb: Callbacks, brain: str | None = None) -> VoiceAgent:
    return GeminiLiveAgent(cb) if get_settings().voice == "gemini" else TextAgent(cb, brain)
