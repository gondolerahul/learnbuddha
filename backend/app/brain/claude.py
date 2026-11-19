"""Claude brain: planner, scene writer, answer writer and text tutor. Runs on the Anthropic API (ANTHROPIC_API_KEY) or
on Vertex AI (the same project and Application Default Credentials as Gemini)."""
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
# Models that take the server-side refusal fallback (Anthropic API only; Haiku has none, Vertex AI does not offer it).
FALLBACK_MODELS = ("claude-opus-5-5", "claude-sonnet-5-5")
SUBMIT_TOOL = "submit"
SUBMIT_RULE = (
    "Return your result by calling the `submit` tool exactly once; its input is the complete answer and must follow the "
    "tool's schema. Write no other text."
)


def _types(schema: dict) -> set[str]:
    t = schema.get("type")
    out = set(t) if isinstance(t, list) else {t} if t else set()
    for alt in schema.get("anyOf", []) + schema.get("oneOf", []):
        if isinstance(alt, dict):
            out |= _types(alt)
    return out


def _sub(schema: dict, kind: str) -> dict:
    """The alternative of `schema` that is an object/array (through anyOf), for recursion."""
    if kind in _types({"type": schema.get("type")}):
        return schema
    for alt in schema.get("anyOf", []) + schema.get("oneOf", []):
        if isinstance(alt, dict) and kind in _types(alt):
            return alt
    return schema


def coerce(value: Any, schema: dict) -> Any:
    """Without structured outputs, a model sometimes sends a nested object or list as a JSON string, or a lone object
    where a list is expected. Decode and wrap those where the schema asks for an object or array (recursively)."""
    if not isinstance(schema, dict):
        return value
    kinds = _types(schema)
    if isinstance(value, str) and kinds & {"object", "array"} and "string" not in kinds:
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return value
    if isinstance(value, dict) and "array" in kinds and "object" not in kinds:
        value = [value]
    if isinstance(value, dict):
        sch = _sub(schema, "object")
        props = sch.get("properties", {})
        return {k: coerce(v, props.get(k, {})) for k, v in value.items()}
    if isinstance(value, list):
        items = _sub(schema, "array").get("items", {})
        return [coerce(v, items) for v in value]
    return value


def _parse_json(text: str, model: str) -> dict:
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t[3:]
        t = t.rsplit("```", 1)[0]
    try:
        out = json.loads(t)
    except json.JSONDecodeError as e:
        raise BrainError(f"{model} returned invalid JSON: {e}") from e
    if not isinstance(out, dict):
        raise BrainError(f"{model} returned JSON that is not an object")
    return out


class ClaudeBrain:
    name = "anthropic"

    def __init__(self, model: str | None = None) -> None:
        s = get_settings()
        self.model = model or s.claude_model
        self.via = s.claude_via  # api | vertex
        self._client = None
        self._stamp: float | None = None
        self._pinned = False
        self.structured_ok = True  # False once the platform refuses structured outputs (then a submit tool carries the schema)

    @property
    def client(self):
        """The Anthropic API client, or the Vertex AI one, rebuilt when the Google sign-in (ADC file) changes."""
        s = get_settings()
        if self._pinned:
            return self._client
        if self.via != "vertex":
            if self._client is None:
                self._client = anthropic.Anthropic(api_key=s.anthropic_api_key, base_url=s.anthropic_base_url, max_retries=3, timeout=600)
            return self._client
        from ..genai_client import _adc_stamp, _credentials

        stamp = _adc_stamp()
        if self._client is None or stamp != self._stamp:
            self._client = anthropic.AnthropicVertex(
                project_id=s.google_cloud_project, region=s.claude_vertex_region, credentials=_credentials(), max_retries=3, timeout=600
            )
            self._stamp = stamp
        return self._client

    @client.setter
    def client(self, c) -> None:  # a fixed client (tests)
        self._client = c
        self._pinned = True

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
        """One JSON call (streamed), with server-side refusal fallback (Anthropic API) and pause_turn handling.

        The answer is constrained by structured outputs. Where that is not allowed (an organisation policy on Vertex AI
        can forbid the `structured_outputs` partner-model feature), the schema goes in a `submit` tool instead, which
        the model is told to call once; the scene pipeline repairs anything that does not match."""
        messages: list[dict[str, Any]] = [{"role": "user", "content": user}]
        sys_blocks: list[dict[str, Any]] = [{"type": "text", "text": system, "cache_control": {"type": "ephemeral", "ttl": "1h"}}]
        params: dict[str, Any] = dict(
            model=self.model,
            max_tokens=max_tokens,
            # Static system prompt first → cached across every scene of every course.
            system=sys_blocks,
            output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
        )
        fallback = self.via == "api" and self.model in FALLBACK_MODELS
        if fallback:
            params.update(betas=[FALLBACK_BETA], fallbacks="default")
        if tools:
            params["tools"] = tools

        def use_submit_tool() -> None:
            params["output_config"] = {"effort": effort}
            params["tools"] = (tools or []) + [{"name": SUBMIT_TOOL, "description": "Submit the finished result. Its input is the whole answer.", "input_schema": schema}]
            params["system"] = sys_blocks + [{"type": "text", "text": SUBMIT_RULE}]

        if not self.structured_ok:
            use_submit_tool()
        from google.auth.exceptions import GoogleAuthError

        for _ in range(5):
            try:
                api = self.client.beta.messages if fallback else self.client.messages
                with api.stream(messages=messages, **params) as stream:
                    msg = stream.get_final_message()
                spent.update(costs.add_units(spent, costs.claude_units(msg.usage)))
                served[0] = getattr(msg, "model", None) or self.model
            except anthropic.BadRequestError as e:
                text = str(e)
                if self.structured_ok and "structured_outputs" in text:
                    log.warning("%s: structured outputs not allowed here; using a submit tool instead", self.model)
                    self.structured_ok = False
                    use_submit_tool()
                    continue
                if tools and "tool" in text.lower():
                    log.warning("retrying without tools: %s", e)
                    tools = None
                    if self.structured_ok:
                        params.pop("tools", None)
                    else:
                        use_submit_tool()
                    continue
                raise BrainError(f"{self.model} rejected the request: {e}") from e
            except anthropic.RateLimitError as e:
                raise BrainError(f"{self.model} rate limit hit; try again shortly") from e
            except anthropic.APIStatusError as e:
                raise BrainError(f"{self.model} error {e.status_code}: {e}") from e
            except anthropic.APIConnectionError as e:
                raise BrainError(f"Could not reach Claude: {e}") from e
            except GoogleAuthError as e:
                raise BrainError(f"Google sign-in for Claude on Vertex AI failed (run `gcloud auth application-default login`): {e}") from e
            if msg.stop_reason == "pause_turn":
                messages = messages + [{"role": "assistant", "content": msg.content}]
                continue
            if msg.stop_reason == "refusal":
                raise BrainError(f"{self.model} declined this request")
            if msg.stop_reason == "max_tokens":
                raise BrainError(f"{self.model} ran out of output tokens")
            for b in msg.content:
                if getattr(b, "type", "") == "tool_use" and getattr(b, "name", "") == SUBMIT_TOOL and isinstance(b.input, dict):
                    return coerce(b.input, schema)
            texts = [b.text for b in msg.content if getattr(b, "type", "") == "text"]
            if not texts:
                raise BrainError(f"{self.model} returned no answer")
            return coerce(_parse_json(texts[-1], self.model), schema)
        raise BrainError(f"{self.model} did not finish after several continuations")

    # ───────────── tasks ─────────────

    def plan(self, req: CourseRequest, on_partial=None) -> dict:  # no streaming here: the plan arrives whole
        answers = "\n".join(f"- {a.get('question')}: {a.get('answer')}" for a in req.answers) or "(none)"
        user = (
            f"Topic: {req.topic}\nLearner's goal: {req.goal or '(not given)'}\nAvailable time: {req.minutes} minutes\n"
            f"Language: {req.language}\nDiagnostic answers:\n{answers}\n\nDesign the course."
        )
        return self._json(prompts.planner_system(), user, prompts.PLAN_SCHEMA, effort="high", op="plan")

    def draft_scene(self, ctx: SceneContext) -> dict:
        return self._scene_call(prompts.scene_system(kit_id=ctx.kit, sets=prompts.scene_sets(ctx)), _scene_user(ctx), effort=get_settings().urgent_thinking if ctx.urgent else get_settings().scene_thinking, op="scene_script")

    def draft_answer(self, ctx: AnswerContext) -> dict:
        return self._scene_call(prompts.scene_system(answer_mode=True, kit_id=ctx.kit), _answer_user(ctx), effort=get_settings().urgent_thinking, answer_mode=True, op="answer_script")

    def tutor_reply(self, ctx: TutorContext, utterance: str) -> dict:
        user = (
            f"Course: {ctx.course_title} · learner: {ctx.level} · language: {ctx.language}\n"
            f"Scene: {ctx.scene_title}\nNarration so far (last part):\n{' '.join(ctx.script_so_far[-6:])}\n"
            f"Sentence being spoken when they interrupted: {ctx.current_sentence}\n"
            f"On screen ([id] what): {' | '.join(ctx.on_screen[:20])}\n"
            f"Recent Q&A: {json.dumps(ctx.recent_qa[-3:], ensure_ascii=False)}\n\n"
            f'The learner said: "{utterance}"'
        )
        return self._json(prompts.tutor_system(), user, prompts.TUTOR_SCHEMA, effort="low", max_tokens=2000, op="tutor_reply")

    def _scene_call(self, system: str, user: str, effort: str = "medium", answer_mode: bool = False, op: str = "") -> dict:
        raw = self._json(system, user, prompts.scene_schema(answer_mode), effort=effort, op=op)
        return _from_wire(raw)
