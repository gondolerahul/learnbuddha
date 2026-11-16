from __future__ import annotations

import threading

from ..config import get_settings
from .base import AnswerContext, Brain, BrainError, CourseRequest, SceneContext, TutorContext

__all__ = ["get_brain", "brain_options", "resolve_brain", "Brain", "BrainError", "CourseRequest", "SceneContext", "AnswerContext", "TutorContext"]

_cache: dict[str, Brain] = {}
_lock = threading.Lock()


def resolve_brain(name: str | None) -> str:
    """A configured brain name: the requested one if available, else the default."""
    s = get_settings()
    if name and (name in s.brains or name == "mock"):
        return name
    return s.brain


def get_brain(name: str | None = None) -> Brain:
    key = resolve_brain(name)
    with _lock:
        if key not in _cache:
            if key == "anthropic":
                from .claude import ClaudeBrain

                _cache[key] = ClaudeBrain()
            elif key == "gemini":
                from .gemini import GeminiBrain

                _cache[key] = GeminiBrain()
            else:
                from .mock import MockBrain

                _cache[key] = MockBrain()
        return _cache[key]


def brain_options() -> list[dict]:
    s = get_settings()
    labels = {"anthropic": f"Claude · {s.claude_model}", "gemini": f"Gemini · {s.gemini_brain_model}", "mock": "Offline mock"}
    return [{"id": b, "label": labels[b], "default": b == s.brain} for b in s.brains]
