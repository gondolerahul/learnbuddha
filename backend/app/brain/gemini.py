"""Gemini brain (default model: gemini-4-hydrogen on Vertex AI): planner, scene writer, fact-checker,
fixer, answer writer and text tutor. Same prompts, schemas and wire format as the Claude brain."""
from __future__ import annotations

import json
from types import SimpleNamespace
import logging
import time
from typing import Any

from .. import costs
from ..config import get_settings
from ..genai_client import GoogleConfigError, client
from . import prompts
from .base import AnswerContext, BrainError, CourseRequest, SceneContext, TutorContext

log = logging.getLogger("lb.brain.gemini")

# effort → Gemini thinking level (gemini-4-* accept LOW | MEDIUM | HIGH; MINIMAL / budgets are rejected)
THINKING = {"low": "LOW", "medium": "MEDIUM", "high": "HIGH"}
# Which model actually answered (exposed in /api/health so fallbacks are visible).
SERVED: dict[str, int] = {}
MAX_OUTPUT = 32768  # caps a runaway call (Carbon once spent all of it thinking and returned nothing)


def _thinking(urgent: bool) -> str:
    s = get_settings()
    return s.urgent_thinking if urgent else s.scene_thinking


class GeminiBrain:
    name = "gemini"

    def __init__(self, model: str | None = None, allow_fallback: bool = True) -> None:
        s = get_settings()
        self.model = model or s.gemini_brain_model
        # A model the learner picked is never swapped for another without saying so: only the default model falls back.
        self.fallback_model = s.gemini_brain_fallback_model if allow_fallback else ""
        self._thinking_ok: dict[str, bool] = {}

    @property
    def label(self) -> str:
        return self.model

    # ───────────── core call ─────────────

    def _json(self, system: str, user: str, schema: dict, effort: str = "medium", op: str = "", on_text=None) -> dict:
        """One JSON call with model fallback and retries. With `on_text`, the response is streamed and on_text(text so
        far) is called as it grows (errors in the callback are logged, never fatal)."""
        from google.genai import errors, types

        try:
            c = client("brain")
        except GoogleConfigError as e:
            raise BrainError(str(e)) from e
        models = [self.model] + ([self.fallback_model] if self.fallback_model and self.fallback_model != self.model else [])
        last: Exception | None = None
        for model in list(models):
            for attempt in range(4):
                cfg: dict[str, Any] = dict(
                    system_instruction=system,  # static prefix first → implicit caching
                    response_mime_type="application/json",
                    response_json_schema=schema,
                    max_output_tokens=MAX_OUTPUT,
                )
                if self._thinking_ok.get(model, True):
                    cfg["thinking_config"] = types.ThinkingConfig(thinking_level=THINKING.get(effort, "MEDIUM"))
                try:
                    if on_text is None:
                        resp = c.models.generate_content(model=model, contents=user, config=types.GenerateContentConfig(**cfg))
                    else:
                        resp = self._stream(c, model, user, types.GenerateContentConfig(**cfg), on_text)
                except errors.APIError as e:
                    last = e
                    msg = str(e).lower()
                    code = getattr(e, "code", 0) or 0
                    if code == 400 and "thinking" in msg and self._thinking_ok.get(model, True):
                        self._thinking_ok[model] = False  # older models: no thinking_level
                        continue
                    if code == 403 and model == self.model and attempt < 2 and "billing" in msg:
                        # Gemini 4's eligibility gate (seen on Carbon) fails intermittently; a retry usually passes
                        time.sleep(1.0 + attempt)
                        continue
                    if code in (403, 404):
                        if model == models[-1]:
                            raise BrainError(f"{model} is not available on this Google Cloud project ({code}): {getattr(e, 'message', '') or e}") from e
                        log.warning("%s unavailable for this request (%s); trying fallback %s", model, code, models[-1])
                        break  # next model
                    if code == 429 or code >= 500:
                        time.sleep(min(20, 2 ** attempt * 2))
                        continue
                    raise BrainError(f"Gemini ({model}) error {code}: {e}") from e
                costs.record(op or "brain", "google", model, costs.gemini_units(getattr(resp, "usage_metadata", None)))
                out = self._parse(resp, model)
                SERVED[model] = SERVED.get(model, 0) + 1
                return out
        raise BrainError(f"Gemini failed: {last}")

    @staticmethod
    def _stream(c, model: str, user: str, config, on_text):
        text, cand, usage = "", None, None
        for ch in c.models.generate_content_stream(model=model, contents=user, config=config):
            usage = getattr(ch, "usage_metadata", None) or usage
            cand = (getattr(ch, "candidates", None) or [cand])[0] or cand
            if ch.text:
                text += ch.text
                try:
                    on_text(text)
                except Exception:  # noqa: BLE001 - the caller's problem, not the call's
                    log.exception("on_text callback failed")
        return SimpleNamespace(text=text, candidates=[cand], usage_metadata=usage)

    def _parse(self, resp, model: str) -> dict:
        cand = (resp.candidates or [None])[0]
        finish = str(getattr(cand, "finish_reason", "") or "")
        if "SAFETY" in finish or "PROHIBITED" in finish or "BLOCKLIST" in finish:
            raise BrainError(f"Gemini ({model}) declined this request ({finish})")
        if "MAX_TOKENS" in finish:
            raise BrainError(f"Gemini ({model}) ran out of output tokens")
        text = resp.text or ""
        if not text.strip():
            raise BrainError(f"Gemini ({model}) returned no text ({finish or 'no candidates'})")
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # tolerate a fenced block
            t = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```")
            try:
                return json.loads(t)
            except json.JSONDecodeError as e:
                raise BrainError(f"Gemini ({model}) returned invalid JSON: {e}") from e

    # ───────────── tasks ─────────────

    def plan(self, req: CourseRequest, on_partial=None) -> dict:
        answers = "\n".join(f"- {a.get('question')}: {a.get('answer')}" for a in req.answers) or "(none)"
        user = (
            f"Topic: {req.topic}\nLearner's goal: {req.goal or '(not given)'}\nAvailable time: {req.minutes} minutes\n"
            f"Language: {req.language}\nDiagnostic answers:\n{answers}\n\nDesign the course."
        )
        return self._json(prompts.planner_system(), user, prompts.PLAN_SCHEMA, effort="high", op="plan", on_text=on_partial)

    def draft_scene(self, ctx: SceneContext) -> dict:
        return prompts.from_wire(self._json(prompts.scene_system(kit_id=ctx.kit, sets=prompts.scene_sets(ctx)), prompts.scene_user(ctx), prompts.scene_schema(False), effort=_thinking(ctx.urgent), op="scene_script"))

    def draft_answer(self, ctx: AnswerContext) -> dict:
        return prompts.from_wire(self._json(prompts.scene_system(answer_mode=True, kit_id=ctx.kit), prompts.answer_user(ctx), prompts.scene_schema(True), effort=_thinking(True), op="answer_script"))

    def tutor_reply(self, ctx: TutorContext, utterance: str) -> dict:
        user = (
            f"Course: {ctx.course_title} · learner: {ctx.level} · language: {ctx.language}\n"
            f"Scene: {ctx.scene_title}\nNarration so far (last part):\n{' '.join(ctx.script_so_far[-6:])}\n"
            f"Sentence being spoken when they interrupted: {ctx.current_sentence}\n"
            f"On screen ([id] what): {' | '.join(ctx.on_screen[:20])}\n"
            f"Recent Q&A: {json.dumps(ctx.recent_qa[-3:], ensure_ascii=False)}\n\n"
            f'The learner said: "{utterance}"'
        )
        return self._json(prompts.tutor_system(), user, prompts.TUTOR_SCHEMA, effort="low", op="tutor_reply")
