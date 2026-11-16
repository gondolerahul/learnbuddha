"""Gemini on Vertex AI: backend selection, the Gemini brain (Carbon → Argon fallback, JSON, grounding)
and Vertex TTS — with a fake google-genai client (no network)."""
import io
import json
import wave
from types import SimpleNamespace as NS

import pytest
from google.genai import errors

from app import genai_client, tts
from app.brain import gemini as gemini_mod
from app.brain import prompts as prompts_mod
from app.brain.base import CourseRequest
from app.config import get_settings


@pytest.fixture
def vertex(monkeypatch):
    s = get_settings()
    for k, v in {"google_genai_backend": "auto", "google_cloud_project": "test-project", "gemini_api_key": "", "anthropic_api_key": "", "tts_provider": "auto", "voice_provider": "auto", "brain_provider": "auto"}.items():
        monkeypatch.setattr(s, k, v)
    genai_client.client.cache_clear()
    yield s
    genai_client.client.cache_clear()


def test_backend_selection(monkeypatch, vertex):
    s = vertex
    assert s.google_backend == "vertex" and s.gemini_ready
    assert s.brains == ["gemini"] and s.tts == "gemini" and s.voice == "gemini"
    monkeypatch.setattr(s, "anthropic_api_key", "k")
    assert s.brains == ["anthropic", "gemini"]
    monkeypatch.setattr(s, "google_cloud_project", "")
    assert s.google_backend == "none" and s.brains == ["anthropic"]
    monkeypatch.setattr(s, "gemini_api_key", "g")
    assert s.google_backend == "studio"


def test_vertex_client_uses_project_and_per_purpose_location(vertex):
    c = genai_client.client("brain")
    assert c.vertexai and c._api_client.project == "test-project" and c._api_client.location == "us"
    assert genai_client.client("tts")._api_client.location == "global"
    live = genai_client.client("live")
    assert live._api_client.location == "us-central1"


class FakeModels:
    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def generate_content(self, model, contents, config):
        self.calls.append({"model": model, "config": config})
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return step


def response(obj):
    return NS(text=json.dumps(obj), candidates=[NS(finish_reason="STOP")])


def test_gemini_brain_falls_back_from_carbon_without_search(monkeypatch, vertex):
    plan = {"title": "T", "summary": "S", "level": "L", "audience": "adult", "style": "zen-board-v1", "lessons": []}
    fake = FakeModels([
        errors.ClientError(404, {"error": {"code": 404, "message": "Publisher model gemini-4-hydrogen not found", "status": "NOT_FOUND"}}),
        response(plan),
    ])
    monkeypatch.setattr(gemini_mod, "client", lambda purpose="brain": NS(models=fake))
    out = gemini_mod.GeminiBrain().plan(CourseRequest(topic="x"))
    assert [c["model"] for c in fake.calls] == ["gemini-4-hydrogen", "gemini-4-argon"]
    cfg = fake.calls[0]["config"]
    assert cfg.response_mime_type == "application/json" and cfg.response_json_schema["required"]
    assert cfg.thinking_config.thinking_level.name == "HIGH" or str(cfg.thinking_config.thinking_level).endswith("HIGH")
    assert not cfg.tools  # no web search
    assert out["title"] == "T" and "sources" not in prompts_mod.PLAN_SCHEMA["required"]


def test_gemini_brain_drops_thinking_for_models_without_it(monkeypatch, vertex):
    fake = FakeModels([
        errors.ClientError(400, {"error": {"code": 400, "message": "thinking_level is not supported for this model", "status": "INVALID_ARGUMENT"}}),
        response({"title": "T", "summary": "S", "level": "L", "audience": "adult", "style": "zen-board-v1", "lessons": []}),
    ])
    monkeypatch.setattr(gemini_mod, "client", lambda purpose="brain": NS(models=fake))
    assert gemini_mod.GeminiBrain().plan(CourseRequest(topic="x"))["title"] == "T"
    assert fake.calls[1]["config"].thinking_config is None


def test_gemini_scene_props_json_is_decoded(monkeypatch, vertex):
    wire = {"sentences": ["Hello there."], "elements": [{"id": "h", "type": "Heading", "cue": [0, 0], "until_cue": None, "dur": None, "props_json": "{\"text\": \"Hi\"}"}], "camera": []}
    fake = FakeModels([response(wire)])
    monkeypatch.setattr(gemini_mod, "client", lambda purpose="brain": NS(models=fake))
    from app.brain.base import SceneContext

    ctx = SceneContext("C", "L", "English", "Les", "obj", "Scene", "sobj", ["k"], "viz", 30, 0, 1)
    d = gemini_mod.GeminiBrain().draft_scene(ctx)
    assert d["elements"][0]["props"] == {"text": "Hi"}


def test_vertex_tts_uses_generate_content(monkeypatch, vertex):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(b"\x10\x00" * 2400)
    calls = []

    def gen(model, contents, config):
        calls.append((model, contents, config))
        return NS(candidates=[NS(content=NS(parts=[NS(inline_data=NS(data=buf.getvalue()))]))])

    monkeypatch.setattr(tts, "genai_client", lambda purpose: NS(models=NS(generate_content=gen)))
    pcm = tts._gemini("Hello.", "Kore", "calm", "English")
    assert len(pcm) == 2400
    model, contents, config = calls[0]
    assert model == "gemini-3.8-flash-tts"
    assert contents[0]["parts"][0]["speech_metadata"]["style"].startswith("calm")
    assert config["speech_config"]["voice_config"]["voice"] == "Kore"
