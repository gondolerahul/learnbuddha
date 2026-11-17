from __future__ import annotations

import os
import sys
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent
RENDERER_DIR = REPO_DIR / "renderer"
STYLEKIT_DIR = RENDERER_DIR / "stylekit"


# Measured 2026-11-15 on a 12-thread laptop (i5-1334U, throttles under load). In 30 s clip benchmarks one render at a
# time with 8 threads got the first scene out ~35% sooner, but in a real course the renders ran 2-4x slower than
# benchmarked and the first scene arrived later than with 3 at once. So the default stays 3 at once (the behaviour
# before the gate); set RENDER_SLOTS=1 and measure again on a machine with steady clocks (the deployment VM).
RENDER_SLOTS_AUTO = 3


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+psycopg://learnbuddha@localhost:5433/learnbuddha"
    media_dir: Path = BACKEND_DIR / "media"

    anthropic_api_key: str = ""
    # The app's own Claude endpoint. Set explicitly so an inherited ANTHROPIC_BASE_URL
    # (e.g. from a developer tool's environment) is never picked up by accident.
    anthropic_base_url: str = "https://api.anthropic.com"
    claude_model: str = "claude-opus-5-5"

    # Google models run on Vertex AI (Gemini Enterprise Agent Platform) when a project is set,
    # otherwise on the Gemini Developer API with GEMINI_API_KEY.
    google_genai_backend: str = "auto"  # auto | vertex | studio
    google_cloud_project: str = ""  # never taken from the gcloud default config; set it explicitly
    google_cloud_location: str = "global"  # TTS (gemini-3.8-flash-tts: global | us | eu)
    gemini_brain_location: str = "us"  # global | us | eu (`us` gave the fewest access errors for Gemini 4)
    gemini_live_location: str = "us-central1"  # Live API is not served from `global` (us | eu | us-central1)
    google_application_credentials: str = ""  # optional service-account JSON; otherwise ADC

    gemini_api_key: str = ""
    gemini_brain_model: str = "gemini-4-hydrogen"  # fast and cheap; Carbon was ~3× slower per scene
    gemini_brain_fallback_model: str = "gemini-4-argon"  # used if Hydrogen is unavailable (403/404)
    gemini_tts_model: str = "gemini-3.8-flash-tts"
    gemini_live_model: str = "gemini-3.8-live"

    brain_provider: str = "auto"  # auto | anthropic | gemini | mock  (default brain; courses may pick another)
    tts_provider: str = "auto"  # auto | gemini | sapi | silent
    voice_provider: str = "auto"  # auto | gemini | text

    # Costs are shown in INR. USD_INR fixes the rate; otherwise it is fetched every 12 h (FX_LIVE) with this fallback.
    usd_inr: float = 0.0
    usd_inr_default: float = 94.29  # open.er-api.com, 2026-11-14
    fx_live: bool = True


    render_width: int = 1280
    render_height: int = 720
    render_fps: int = 24  # film rate; 30 cost 30% more render time for no visible gain in these drawings
    # Scene jobs in flight. Scripts and narration are network waits, so all of a course's scenes can be written at once
    # while renders queue at the render gate (render_slots), earliest scene first.
    worker_threads: int = 8
    # How hard the model thinks before writing a scene or answer: low | medium | high. Most of a script's time is
    # thinking (~8k of ~10.5k output tokens at medium), so lower is faster and cheaper; check richness before lowering.
    scene_thinking: str = "medium"
    # ...for what a learner is waiting on: the course's first scene, visual answers, remediation and explain-again.
    # Measured 2026-11-17 on a 55 s scene: low wrote it in 46 s vs 73 s at medium, same richness score, slightly fewer
    # labels; the other scenes are written in the background while earlier ones play, so they keep medium.
    urgent_thinking: str = "low"
    # Lesson renders that may run at once (0 = auto: 3). Fewer slots give each render more threads; scripts and
    # narration (network-bound) still overlap across worker_threads. Answers, recaps and re-explanations never wait.
    render_slots: int = 0
    # Threads each scene render uses (frames are drawn in parallel and streamed in order). 0 = the CPU cores shared
    # between the render slots.
    render_threads: int = 0
    run_worker_in_process: bool = True

    node_bin: str = "node"
    ffmpeg_bin: str = "ffmpeg"

    @property
    def render_slots_effective(self) -> int:
        return self.render_slots if self.render_slots > 0 else RENDER_SLOTS_AUTO

    @property
    def render_threads_effective(self) -> int:
        if self.render_threads > 0:
            return self.render_threads
        # the cores shared between the slots, but never more than about two thirds of them on one render (the rest feed
        # the x264 encoder): 3 slots -> 4 threads, 2 -> 6, 1 -> 8 on 12 cores
        cores = os.cpu_count() or 4
        return max(1, min(cores // self.render_slots_effective, round(cores * 2 / 3)))

    @property
    def google_backend(self) -> str:
        """vertex | studio | none"""
        if self.google_genai_backend == "vertex":
            return "vertex"
        if self.google_genai_backend == "studio":
            return "studio" if self.gemini_api_key else "none"
        if self.google_cloud_project:
            return "vertex"
        return "studio" if self.gemini_api_key else "none"

    @property
    def gemini_ready(self) -> bool:
        return self.google_backend != "none"

    @property
    def brains(self) -> list[str]:
        """Brains that are configured and selectable per course."""
        out = []
        if self.anthropic_api_key:
            out.append("anthropic")
        if self.gemini_ready:
            out.append("gemini")
        return out or ["mock"]

    @property
    def brain(self) -> str:
        if self.brain_provider != "auto":
            return self.brain_provider
        return self.brains[0]

    @property
    def tts(self) -> str:
        if self.tts_provider != "auto":
            return self.tts_provider
        if self.gemini_ready:
            return "gemini"
        return "sapi" if sys.platform == "win32" else "silent"

    @property
    def voice(self) -> str:
        if self.voice_provider != "auto":
            return self.voice_provider
        return "gemini" if self.gemini_ready else "text"


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if os.environ.get("LB_TEST_DATABASE_URL"):
        s.database_url = os.environ["LB_TEST_DATABASE_URL"]
    s.media_dir.mkdir(parents=True, exist_ok=True)
    return s
