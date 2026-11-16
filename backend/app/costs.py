"""What every paid model call costs, in USD and INR.

Each call to Claude, the Gemini brain, Gemini TTS or Gemini Live records one `usage_events` row: the token
counts the API reported, the list price that applied that day, and the USD→INR rate used. Rows are tagged with
the course, scene and learning session they belong to (from a context variable set by the job worker, the
session socket and the API), so the app can show the cost of every operation, a course and a session.

Prices are list prices (no free tiers or committed-use discounts) and live in PRICES below with their sources.
The INR rate is fetched once every 12 hours from open.er-api.com, unless USD_INR is set in backend/.env.
"""
from __future__ import annotations

import contextlib
import contextvars
import json
import logging
import threading
import time
import urllib.request
from datetime import date, datetime, timezone
from typing import Any, Iterator

from .config import get_settings

log = logging.getLogger("lb.costs")

M = 1_000_000

# USD per 1M tokens (per 1,000 for `search`). Each model maps to [(effective_from, rates), ...], newest last.
# Sources (checked 2026-11-14):
#   Claude: Anthropic pricing for claude-opus-5-5 ($4 in, $20 out, $0.20 cache read; 1-hour cache writes are
#     2× input; web search $10 per 1,000 searches).
#   Gemini: Google's Gemini pricing page (aistudio.google.com/docs/pricing), which Vertex AI's standard
#     pay-as-you-go rates follow. Carbon/Argon are at an introductory rate until 2026-11-30, Flash TTS until
#     2026-12-31. Grounding with Google Search: $14 per 1,000 searches after 5,000 free searches a month
#     (shared across Gemini 3+ models) — charged here at list price, so small runs may really cost less.
PRICES: dict[str, list[tuple[str, dict[str, float]]]] = {
    "claude-opus-5-5": [("2026-01-01", {"in": 4.0, "out": 20.0, "cache_read": 0.20, "cache_write": 8.0, "search": 10.0})],
    "claude-opus-5": [("2026-01-01", {"in": 5.0, "out": 25.0, "cache_read": 0.50, "cache_write": 10.0, "search": 10.0})],
    "claude-opus-4-8": [("2026-01-01", {"in": 5.0, "out": 25.0, "cache_read": 0.50, "cache_write": 10.0, "search": 10.0})],
    # Hydrogen (released 2026-11-12): $1.50 in / $7.50 out per Google's launch post (checked 2026-11-15). The cached-input
    # rate is not published yet; 10% of input is assumed, as for the other Gemini 4 models.
    "gemini-4-hydrogen": [("2026-01-01", {"in": 1.50, "out": 7.50, "cache_read": 0.15})],
    "gemini-4-carbon": [
        ("2026-01-01", {"in": 2.0, "out": 10.0, "cache_read": 0.10, "search": 14.0}),
        ("2026-12-01", {"in": 4.0, "out": 20.0, "cache_read": 0.20, "search": 14.0}),
    ],
    "gemini-4-argon": [
        ("2026-01-01", {"in": 2.0, "out": 10.0, "cache_read": 0.10, "search": 14.0}),
        ("2026-12-01", {"in": 4.0, "out": 20.0, "cache_read": 0.20, "search": 14.0}),
    ],
    "gemini-3.8-flash-tts": [
        ("2026-01-01", {"in": 0.50, "audio_out": 9.0}),
        ("2027-01-01", {"in": 1.00, "audio_out": 18.0}),
    ],
    "gemini-3.8-live": [("2026-01-01", {"in": 0.75, "audio_in": 3.0, "out": 4.50, "audio_out": 12.0, "search": 14.0})],
}

PRICE_NOTES = [
    "List prices: Anthropic (Claude Opus 5.5) and Google's Gemini pricing page (Vertex AI pay-as-you-go).",
    "Gemini 4 Hydrogen (the default brain): $1.50 / $7.50 per 1M tokens (cached input assumed at $0.15).",
    "Gemini 4 Carbon/Argon are at an introductory rate until 30 Nov 2026 ($2 / $10 per 1M tokens), then $4 / $20.",
    "Google Search grounding is charged at $14 per 1,000 searches; the first 5,000 searches a month are free, so actual bills can be lower.",
    "Rendering (Node + ffmpeg) runs on this machine and is not charged.",
]

OPERATIONS = {
    "diagnose": "Diagnostic questions",
    "plan": "Course plan",
    "scene_script": "Scene script",
    "fact_check": "Fact check",
    "layout_fix": "Layout fix",
    "length_fix": "Length fix",
    "answer_script": "Visual answer script",
    "narration": "Narration (TTS)",
    "voice": "Voice tutor reply",
    "tutor_reply": "Typed tutor reply",
}

# ───────────────────────────── scope ─────────────────────────────

_scope: contextvars.ContextVar[dict] = contextvars.ContextVar("lb_cost_scope", default={})


@contextlib.contextmanager
def scope(**kw: Any) -> Iterator[None]:
    """Tag every cost recorded inside this block (and in threads/tasks started from it) with these ids."""
    token = _scope.set({**_scope.get(), **{k: v for k, v in kw.items() if v is not None}})
    try:
        yield
    finally:
        _scope.reset(token)


def set_scope(**kw: Any) -> None:
    """Like scope(), for the rest of the current task (the session socket sets it once)."""
    _scope.set({**_scope.get(), **{k: v for k, v in kw.items() if v is not None}})


# ───────────────────────────── prices ─────────────────────────────


def rates_for(model: str, on: date | None = None) -> dict[str, float] | None:
    table = PRICES.get(model)
    if table is None:
        # tolerate version suffixes such as "gemini-4-argon-001" or "claude-opus-5-5@..."
        table = next((v for k, v in PRICES.items() if model.startswith(k)), None)
    if not table:
        return None
    day = (on or date.today()).isoformat()
    current = table[0][1]
    for since, rates in table:
        if since <= day:
            current = rates
    return current


def compute_usd(model: str, units: dict[str, float], on: date | None = None) -> float:
    """units: in, out, cache_read, cache_write, audio_in, audio_out (tokens); search (count)."""
    r = rates_for(model, on)
    if r is None:
        return 0.0
    usd = 0.0
    for k, n in units.items():
        if not n:
            continue
        if k == "search":
            usd += n * r.get("search", 0.0) / 1000
        elif k in r:
            usd += n * r[k] / M
        elif k == "cache_read":
            usd += n * r.get("in", 0.0) / M
    return usd


# ───────────────────────────── USD → INR ─────────────────────────────

_fx = {"rate": 0.0, "at": 0.0, "source": ""}
_fx_lock = threading.Lock()
FX_URL = "https://open.er-api.com/v6/latest/USD"


def usd_inr() -> tuple[float, str]:
    s = get_settings()
    if s.usd_inr > 0:
        return s.usd_inr, "fixed in backend/.env (USD_INR)"
    with _fx_lock:
        if _fx["rate"] and time.time() - _fx["at"] < 12 * 3600:
            return _fx["rate"], _fx["source"]
        if s.fx_live:
            try:
                req = urllib.request.Request(FX_URL, headers={"User-Agent": "learnbuddha-cost-tracker"})
                with urllib.request.urlopen(req, timeout=4) as resp:
                    data = json.loads(resp.read())
                rate = float(data["rates"]["INR"])
                _fx.update(rate=rate, at=time.time(), source=f"open.er-api.com, {data.get('time_last_update_utc', '')}".strip(", "))
                return rate, _fx["source"]
            except Exception as e:
                log.warning("could not fetch USD→INR rate (%s); using the default", e)
                _fx.update(rate=s.usd_inr_default, at=time.time() - 11 * 3600, source="default rate (live rate unavailable)")
                return _fx["rate"], _fx["source"]
        return s.usd_inr_default, "default rate"


# ───────────────────────────── recording ─────────────────────────────


def record(operation: str, provider: str, model: str, units: dict[str, float], detail: str = "", **ids: Any) -> float:
    """Store one charged call. Never raises: cost tracking must not break teaching. Returns the cost in INR."""
    try:
        units = {k: float(v) for k, v in units.items() if v}
        if not units:
            return 0.0
        usd = compute_usd(model, units)
        rate, _ = usd_inr()
        sc = {**_scope.get(), **{k: v for k, v in ids.items() if v is not None}}
        detail = detail or sc.get("detail", "")
        from .db import session
        from .models import Course, Scene, UsageEvent

        with session() as db:
            course_id, scene_id, session_id = sc.get("course_id"), sc.get("scene_id"), sc.get("session_id")
            if scene_id and (not course_id or not session_id or not detail):
                s = db.get(Scene, scene_id)
                if s is not None:
                    course_id = course_id or s.course_id
                    session_id = session_id or s.session_id
                    detail = detail or (s.question or s.title or "")
            if course_id and not detail:
                c = db.get(Course, course_id)
                if c is not None:
                    detail = c.title or c.topic
            db.add(UsageEvent(
                course_id=course_id, scene_id=scene_id, session_id=session_id, ref=sc.get("ref"), operation=operation,
                provider=provider, model=model, units=units, cost_usd=usd, usd_inr=rate, cost_inr=usd * rate, detail=(detail or "")[:300],
            ))
        return usd * rate
    except Exception as e:
        log.warning("could not record cost of %s/%s: %s", operation, model, e)
        return 0.0


# ───────────────────────────── usage extraction ─────────────────────────────


def _g(obj: Any, name: str, default: Any = 0) -> Any:
    v = getattr(obj, name, None)
    return default if v is None else v


def claude_units(usage: Any) -> dict[str, float]:
    stu = getattr(usage, "server_tool_use", None)
    return {
        "in": _g(usage, "input_tokens"),
        "cache_write": _g(usage, "cache_creation_input_tokens"),
        "cache_read": _g(usage, "cache_read_input_tokens"),
        "out": _g(usage, "output_tokens"),
        "search": _g(stu, "web_search_requests") if stu is not None else 0,
    }


def add_units(a: dict[str, float], b: dict[str, float]) -> dict[str, float]:
    out = dict(a)
    for k, v in b.items():
        out[k] = out.get(k, 0) + (v or 0)
    return out


def _by_modality(details: Any) -> dict[str, int]:
    out: dict[str, int] = {}
    for d in details or []:
        m = str(getattr(d, "modality", "") or "").upper().rsplit(".", 1)[-1]
        out[m] = out.get(m, 0) + int(_g(d, "token_count"))
    return out


def gemini_units(um: Any, searches: int = 0) -> dict[str, float]:
    """generate_content usage → billable units (thinking is billed as output; search results as input)."""
    if um is None:
        return {"search": searches}
    prompt = _g(um, "prompt_token_count")
    cached = _g(um, "cached_content_token_count")
    out = _g(um, "candidates_token_count") + _g(um, "thoughts_token_count")
    return {"in": max(0, prompt - cached) + _g(um, "tool_use_prompt_token_count"), "cache_read": cached, "out": out, "search": searches}


def gemini_tts_units(um: Any, seconds: float) -> dict[str, float]:
    if um is None:  # not reported: Gemini audio is 25 tokens per second
        return {"audio_out": round(seconds * 25)}
    out = _by_modality(getattr(um, "candidates_tokens_details", None) or getattr(um, "response_tokens_details", None))
    audio = out.get("AUDIO") or _g(um, "candidates_token_count") or _g(um, "response_token_count") or round(seconds * 25)
    return {"in": _g(um, "prompt_token_count"), "audio_out": audio}


def live_units(um: Any) -> dict[str, float]:
    """Gemini Live reports usage once per model turn, including the conversation it re-read as input."""
    if um is None:
        return {}
    pin = _by_modality(getattr(um, "prompt_tokens_details", None))
    pout = _by_modality(getattr(um, "response_tokens_details", None))
    prompt, resp = _g(um, "prompt_token_count"), _g(um, "response_token_count")
    audio_in = pin.get("AUDIO", 0)
    audio_out = pout.get("AUDIO", 0)
    text_in = max(0, prompt - audio_in) if pin else prompt
    text_out = max(0, resp - audio_out) if pout else resp
    return {"in": text_in, "audio_in": audio_in, "out": text_out + _g(um, "thoughts_token_count"), "audio_out": audio_out}


# ───────────────────────────── reporting ─────────────────────────────


def event_out(e: Any) -> dict:
    return {
        "id": e.id, "at": e.created_at.isoformat(), "operation": e.operation, "label": OPERATIONS.get(e.operation, e.operation),
        "provider": e.provider, "model": e.model, "units": e.units, "cost_usd": round(e.cost_usd, 6), "cost_inr": round(e.cost_inr, 4),
        "usd_inr": e.usd_inr, "detail": e.detail, "course_id": e.course_id, "scene_id": e.scene_id, "session_id": e.session_id,
    }


def summarize(events: list[Any]) -> dict:
    by: dict[str, dict] = {}
    for e in events:
        b = by.setdefault(e.operation, {"operation": e.operation, "label": OPERATIONS.get(e.operation, e.operation), "count": 0, "cost_inr": 0.0, "cost_usd": 0.0})
        b["count"] += 1
        b["cost_inr"] += e.cost_inr
        b["cost_usd"] += e.cost_usd
    order = list(OPERATIONS)
    ops = sorted(by.values(), key=lambda b: order.index(b["operation"]) if b["operation"] in order else 99)
    for b in ops:
        b["cost_inr"] = round(b["cost_inr"], 4)
        b["cost_usd"] = round(b["cost_usd"], 6)
    rate, source = usd_inr()
    return {
        "total_inr": round(sum(e.cost_inr for e in events), 4),
        "total_usd": round(sum(e.cost_usd for e in events), 6),
        "count": len(events),
        "by_operation": ops,
        "usd_inr": rate,
        "fx_source": source,
        "notes": PRICE_NOTES,
        "as_of": datetime.now(timezone.utc).isoformat(),
    }
