"""Cost tracking: prices by date, usage → INR for every paid call (Claude, Gemini brain, TTS, Live), attribution to
courses/scenes/sessions, and the /api/costs report. Fake clients only; the rate is fixed at ₹90/$ in conftest."""
import io
import json
import uuid
import wave
from datetime import date
from types import SimpleNamespace as NS

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import costs, genai_client, tts
from app.brain import claude as claude_mod
from app.brain import gemini as gemini_mod
from app.brain.base import CourseRequest
from app.config import get_settings
from app.db import session
from app.main import app
from app.models import Course, Scene, UsageEvent


def events(**where):
    with session() as db:
        q = select(UsageEvent)
        for k, v in where.items():
            q = q.where(getattr(UsageEvent, k) == v)
        return db.execute(q.order_by(UsageEvent.id)).scalars().all()


def test_prices_follow_the_calendar():
    u = {"in": 1_000_000, "out": 100_000}
    assert costs.compute_usd("gemini-4-carbon", u, date(2026, 11, 14)) == pytest.approx(2.0 + 1.0)
    assert costs.compute_usd("gemini-4-carbon", u, date(2026, 12, 1)) == pytest.approx(4.0 + 2.0)
    assert costs.compute_usd("gemini-4-hydrogen", u, date(2026, 12, 1)) == pytest.approx(1.5 + 0.75)
    assert costs.compute_usd("claude-opus-5-5", {"in": 1000, "cache_read": 10_000, "cache_write": 2000, "out": 500, "search": 2}) == pytest.approx(
        1000 * 4 / 1e6 + 10_000 * 0.2 / 1e6 + 2000 * 8 / 1e6 + 500 * 20 / 1e6 + 2 * 10 / 1000
    )
    assert costs.compute_usd("gemini-3.8-live", {"audio_in": 1_000_000, "audio_out": 1_000_000}) == pytest.approx(15.0)
    assert costs.compute_usd("mock", {"in": 10}) == 0.0
    assert costs.usd_inr() == (90.0, "fixed in backend/.env (USD_INR)")


def test_live_units_split_audio_and_text():
    um = NS(prompt_token_count=474, response_token_count=190, thoughts_token_count=66,
            prompt_tokens_details=[NS(modality="TEXT", token_count=141), NS(modality="AUDIO", token_count=333)],
            response_tokens_details=[NS(modality="TEXT", token_count=23), NS(modality="AUDIO", token_count=167)])
    assert costs.live_units(um) == {"in": 141, "audio_in": 333, "out": 23 + 66, "audio_out": 167}


@pytest.fixture
def vertex(monkeypatch):
    s = get_settings()
    for k, v in {"google_genai_backend": "auto", "google_cloud_project": "test-project", "tts_provider": "gemini"}.items():
        monkeypatch.setattr(s, k, v)
    genai_client.client.cache_clear()
    yield s
    genai_client.client.cache_clear()


def test_gemini_brain_records_tokens(monkeypatch, vertex):
    um = NS(prompt_token_count=12_000, cached_content_token_count=2_000, candidates_token_count=3_000, thoughts_token_count=1_000, tool_use_prompt_token_count=500)
    cand = NS(finish_reason="STOP")
    resp = NS(text=json.dumps({"title": "T", "summary": "S", "level": "L", "audience": "adult", "style": "zen-board-v1", "lessons": []}), candidates=[cand], usage_metadata=um)
    monkeypatch.setattr(gemini_mod, "client", lambda purpose="brain": NS(models=NS(generate_content=lambda **kw: resp)))
    ref = uuid.uuid4().hex[:16]
    with costs.scope(ref=ref):
        gemini_mod.GeminiBrain().plan(CourseRequest(topic="x"))
    (e,) = events(ref=ref)
    assert (e.operation, e.provider, e.model) == ("plan", "google", "gemini-4-hydrogen")
    assert e.units == {"in": 10_500, "cache_read": 2_000, "out": 4_000}
    usd = costs.compute_usd("gemini-4-hydrogen", e.units)
    assert e.cost_usd == pytest.approx(usd) and e.cost_inr == pytest.approx(usd * 90)


class FakeStream:
    def __init__(self, msg):
        self.msg = msg

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get_final_message(self):
        return self.msg


def test_claude_brain_records_cached_usage(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "anthropic_api_key", "test-key")
    usage = NS(input_tokens=1500, cache_creation_input_tokens=4000, cache_read_input_tokens=0, output_tokens=2500, server_tool_use=None)
    msg = NS(stop_reason="end_turn", model="claude-opus-5-5", usage=usage, content=[NS(type="text", text=json.dumps({"title": "T", "summary": "S", "level": "L", "audience": "adult", "style": "zen-board-v1", "lessons": []}))])
    b = claude_mod.ClaudeBrain()
    b.client = NS(beta=NS(messages=NS(stream=lambda **kw: FakeStream(msg))))
    ref = uuid.uuid4().hex[:16]
    with costs.scope(ref=ref):
        b.plan(CourseRequest(topic="x"))
    (e,) = events(ref=ref)
    assert (e.operation, e.provider, e.model) == ("plan", "anthropic", "claude-opus-5-5")
    assert e.units == {"in": 1500, "cache_write": 4000, "out": 2500}
    assert e.cost_usd == pytest.approx(1500 * 4e-6 + 4000 * 8e-6 + 2500 * 20e-6)


def test_narration_is_one_cost_per_scene(monkeypatch, vertex):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(b"\x10\x00" * 24000)
    resp = NS(candidates=[NS(content=NS(parts=[NS(inline_data=NS(data=buf.getvalue()))]))],
              usage_metadata=NS(prompt_token_count=20, candidates_token_count=25, candidates_tokens_details=[NS(modality="AUDIO", token_count=25)]))
    monkeypatch.setattr(tts, "genai_client", lambda purpose: NS(models=NS(generate_content=lambda **kw: resp)))
    with session() as db:
        c = Course(topic="t", cache_key="k", title="Course T")
        db.add(c)
        db.flush()
        sc = Scene(course_id=c.id, title="Scene S")
        db.add(sc)
        db.flush()
        cid, sid = c.id, sc.id
    with costs.scope(scene_id=sid):
        clips = tts.synthesize(["One.", "Two.", "Three."], "Kore", "calm")
    assert len(clips) == 3
    (e,) = events(scene_id=sid)
    assert e.operation == "narration" and e.course_id == cid and e.detail == "Scene S"
    assert e.units == {"in": 60, "audio_out": 75}
    assert e.cost_usd == pytest.approx(60 * 0.5e-6 + 75 * 9e-6)


def test_costs_api_and_diagnose_ref_join_the_course():
    with TestClient(app) as c:
        d = c.post("/api/diagnose", json={"topic": "Why the sky is blue", "brain": "mock"}).json()
        ref = d["cost_ref"]
        costs.record("diagnose", "google", "gemini-4-carbon", {"in": 1000, "out": 1000}, ref=ref)
        course = c.post("/api/courses", json={"topic": "Why the sky is blue", "brain": "mock", "cost_ref": ref, "answers": []}).json()
        r = c.get("/api/costs", params={"course_id": course["id"]}).json()
        assert r["count"] == 1 and r["by_operation"][0]["label"] == "Diagnostic questions"
        assert r["total_inr"] == pytest.approx((1000 * 2 + 1000 * 10) / 1e6 * 90, rel=1e-3)
        assert r["usd_inr"] == 90 and r["events"][0]["course_title"]
        everything = c.get("/api/costs").json()
        assert everything["count"] >= 1 and any(x["course_id"] == course["id"] for x in everything["courses"])
