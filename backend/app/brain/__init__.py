from __future__ import annotations

import threading
from dataclasses import dataclass

from ..config import get_settings
from .base import AnswerContext, Brain, BrainError, CourseRequest, SceneContext, TutorContext

__all__ = [
    "get_brain", "brain_options", "resolve_brain", "provider_of", "brain_label", "MODELS",
    "Brain", "BrainError", "CourseRequest", "SceneContext", "AnswerContext", "TutorContext",
]


@dataclass(frozen=True)
class BrainModel:
    id: str  # the model id sent to the provider; also what a course stores in `brain`
    provider: str  # gemini | anthropic
    label: str
    note: str


# Models a course can be written by. Gemini runs on Vertex AI (or the Gemini API); Claude on Vertex AI (same project and
# sign-in as Gemini) or on the Anthropic API when ANTHROPIC_API_KEY is set.
MODELS: list[BrainModel] = [
    BrainModel("gemini-4-hydrogen", "gemini", "Gemini 4 Hydrogen", "fast and cheap"),
    BrainModel("gemini-4-carbon", "gemini", "Gemini 4 Carbon", "deeper, slower"),
    BrainModel("gemini-4-neon", "gemini", "Gemini 4 Neon", "price not published: costs show ₹0"),
    BrainModel("claude-opus-5-5", "anthropic", "Claude Opus 5.5", "most capable Claude"),
    BrainModel("claude-sonnet-5-5", "anthropic", "Claude Sonnet 5.5", "fast, strong"),
    BrainModel("claude-haiku-5-5", "anthropic", "Claude Haiku 5.5", "fastest, cheapest"),
]
_BY_ID = {m.id: m for m in MODELS}

_cache: dict[str, Brain] = {}
_lock = threading.Lock()


def provider_of(model_id: str) -> str:
    """gemini | anthropic | mock, for a model id (or a bare provider name, as older courses stored)."""
    if model_id in ("gemini", "anthropic", "mock"):
        return model_id
    m = _BY_ID.get(model_id)
    if m:
        return m.provider
    return "anthropic" if model_id.startswith("claude") else "gemini" if model_id.startswith("gemini") else "mock"


def _provider_default(provider: str) -> str:
    s = get_settings()
    if provider == "gemini":
        return s.gemini_brain_model
    if provider == "anthropic":
        return s.claude_model
    return "mock"


def _available(model_id: str) -> bool:
    return provider_of(model_id) in get_settings().brains


def _default_model() -> str:
    s = get_settings()
    if s.brain_model and _available(s.brain_model):
        return s.brain_model
    return _provider_default(s.brain)


def resolve_brain(name: str | None) -> str:
    """The model a course runs on: the requested model if its provider is configured, else the default model. Older
    courses stored a provider ("gemini", "anthropic"); those resolve to that provider's default model."""
    if name == "mock":
        return "mock"
    if name and _available(name):
        return _provider_default(name) if name in ("gemini", "anthropic") else name
    return _default_model()


def brain_label(model_id: str) -> str:
    m = _BY_ID.get(model_id)
    if m:
        return m.label
    if model_id == "mock":
        return "Offline mock"
    if model_id.startswith("gemini-4-"):  # e.g. the Argon fallback
        return "Gemini 4 " + model_id.removeprefix("gemini-4-").replace("-", " ").title()
    return model_id


def get_brain(name: str | None = None) -> Brain:
    key = resolve_brain(name)
    with _lock:
        if key not in _cache:
            provider = provider_of(key)
            if provider == "anthropic":
                from .claude import ClaudeBrain

                _cache[key] = ClaudeBrain(model=key)
            elif provider == "gemini":
                from .gemini import GeminiBrain

                _cache[key] = GeminiBrain(model=key, allow_fallback=key == get_settings().gemini_brain_model)
            else:
                from .mock import MockBrain

                _cache[key] = MockBrain()
        return _cache[key]


def brain_options() -> list[dict]:
    """Every model the learner can pick, for the configured providers (the default model marked)."""
    s = get_settings()
    default = _default_model()
    out = []
    ids = [m.id for m in MODELS]
    for extra in (s.gemini_brain_model, s.claude_model):  # a model set in .env but not listed above
        if extra not in ids:
            ids.append(extra)
    for mid in ids:
        if not _available(mid):
            continue
        m = _BY_ID.get(mid)
        via = s.claude_via if provider_of(mid) == "anthropic" else s.google_backend
        out.append({
            "id": mid, "label": brain_label(mid), "provider": provider_of(mid), "note": m.note if m else "",
            "via": "Vertex AI" if via == "vertex" else "Anthropic API" if via == "api" else "Gemini API",
            "default": mid == default,
        })
    if not out:
        out.append({"id": "mock", "label": "Offline mock", "provider": "mock", "note": "", "via": "", "default": True})
    return out
