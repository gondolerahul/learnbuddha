"""Claude brain: planner, scene writer, fact-checker, fixer, answer writer and text tutor."""
from __future__ import annotations

import json
import logging
from typing import Any

import anthropic

from .. import costs
from ..config import get_settings
from . import prompts
from .prompts import answer_user as _answer_user, from_wire as _from_wire, scene_user as _scene_user
from .base import AnswerContext, BrainError, CourseRequest, SceneContext, TutorContext

log = logging.getLogger("lb.brain")

FALLBACK_BETA = "server-side-fallback-2026-07-01"


class ClaudeBrain:
    name = "anthropic"

    def __init__(self) -> None:
        s = get_settings()
        self.model = s.claude_model
        self.client = anthropic.Anthropic(api_key=s.anthropic_api_key, base_url=s.anthropic_base_url, max_retries=3, timeout=600)

    # ───────────── core call ─────────────

    def _json(self, system: str, user: str, schema: dict, effort: str = "medium", tools: list[dict] | None = None, max_tokens: int = 32000, op: str = "") -> dict:
        """One structured call; records what it cost, including attempts that end in an error."""
        spent: dict[str, float] = {}
        served = [self.model]
        try:
            return self._json_call(system, user, schema, effort, tools, max_tokens, spent, served)
        finally:
            if spent:
                costs.record(op or "brain", "anthropic", served[0], spent)

    def _json_call(
        self,
        system: str,
        user: str,
        schema: dict,
        effort: str,
        tools: list[dict] | None,
        max_tokens: int,
        spent: dict,
        served: list,
    ) -> dict:
        """One structured-output call (streamed), with server-side refusal fallback and pause_turn handling."""
        messages: list[dict[str, Any]] = [{"role": "user", "content": user}]
        params: dict[str, Any] = dict(
            model=self.model,
            max_tokens=max_tokens,
            # Static system prompt first → cached across every scene of every course.
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral", "ttl": "1h"}}],
            output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
            betas=[FALLBACK_BETA],
            fallbacks="default",
        )
        if tools:
            params["tools"] = tools
        for _ in range(4):
            try:
                with self.client.beta.messages.stream(messages=messages, **params) as stream:
                    msg = stream.get_final_message()
                spent.update(costs.add_units(spent, costs.claude_units(msg.usage)))
                served[0] = getattr(msg, "model", None) or self.model
            except anthropic.BadRequestError as e:
                if tools and "tool" in str(e).lower():
                    log.warning("retrying without tools: %s", e)
                    params.pop("tools", None)
                    tools = None
                    continue
                raise BrainError(f"Claude rejected the request: {e}") from e
            except anthropic.RateLimitError as e:
                raise BrainError("Claude rate limit hit; try again shortly") from e
            except anthropic.APIStatusError as e:
                raise BrainError(f"Claude API error {e.status_code}: {e}") from e
            except anthropic.APIConnectionError as e:
                raise BrainError(f"Could not reach Claude: {e}") from e
            if msg.stop_reason == "pause_turn":
                messages = messages + [{"role": "assistant", "content": msg.content}]
                continue
            if msg.stop_reason == "refusal":
                raise BrainError("Claude declined this request")
            if msg.stop_reason == "max_tokens":
                raise BrainError("Claude ran out of output tokens")
            texts = [b.text for b in msg.content if getattr(b, "type", "") == "text"]
            if not texts:
                raise BrainError("Claude returned no text")
            try:
                return json.loads(texts[-1])
            except json.JSONDecodeError as e:
                raise BrainError(f"Claude returned invalid JSON: {e}") from e
        raise BrainError("Claude did not finish after several continuations")

    # ───────────── tasks ─────────────

    def plan(self, req: CourseRequest) -> dict:
        answers = "\n".join(f"- {a.get('question')}: {a.get('answer')}" for a in req.answers) or "(none)"
        user = (
            f"Topic: {req.topic}\nLearner's goal: {req.goal or '(not given)'}\nAvailable time: {req.minutes} minutes\n"
            f"Language: {req.language}\nDiagnostic answers:\n{answers}\n\nDesign the course."
        )
        return self._json(prompts.planner_system(), user, prompts.PLAN_SCHEMA, effort="high", op="plan")

    def draft_scene(self, ctx: SceneContext) -> dict:
        return self._scene_call(prompts.scene_system(kit_id=ctx.kit), _scene_user(ctx), op="scene_script")

    def draft_answer(self, ctx: AnswerContext) -> dict:
        return self._scene_call(prompts.scene_system(answer_mode=True, kit_id=ctx.kit), _answer_user(ctx), answer_mode=True, op="answer_script")

    def tutor_reply(self, ctx: TutorContext, utterance: str) -> dict:
        user = (
            f"Course: {ctx.course_title} · learner: {ctx.level} · language: {ctx.language}\n"
            f"Scene: {ctx.scene_title}\nNarration so far (last part):\n{' '.join(ctx.script_so_far[-6:])}\n"
            f"Sentence being spoken when they interrupted: {ctx.current_sentence}\n"
            f"On screen: {' | '.join(ctx.on_screen[:20])}\n"
            f"Recent Q&A: {json.dumps(ctx.recent_qa[-3:], ensure_ascii=False)}\n\n"
            f'The learner said: "{utterance}"'
        )
        return self._json(prompts.tutor_system(), user, prompts.TUTOR_SCHEMA, effort="low", max_tokens=2000, op="tutor_reply")

    def _scene_call(self, system: str, user: str, effort: str = "medium", answer_mode: bool = False, op: str = "") -> dict:
        raw = self._json(system, user, prompts.scene_schema(answer_mode), effort=effort, op=op)
        return _from_wire(raw)
