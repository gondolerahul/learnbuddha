"""Narration TTS, one call per sentence (Gemini returns no timestamps; per-sentence gives exact
sentence boundaries). Providers: gemini · sapi (Windows dev voice) · silent."""
from __future__ import annotations

import array
import base64
import logging
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import costs
from .config import get_settings
from .genai_client import client as genai_client
from .media import NARRATION_RATE, resample, silence, trim_silence, wav_to_pcm

log = logging.getLogger("lb.tts")


class TTSError(RuntimeError):
    pass


def synthesize(sentences: list[str], voice: str, style: str, language: str = "English") -> list[array.array]:
    """Returns one mono int16 clip at NARRATION_RATE per sentence, silence-trimmed."""
    provider = get_settings().tts
    fn = {"gemini": _gemini, "sapi": _sapi, "silent": _silent}.get(provider, _silent)
    if provider == "gemini":
        with ThreadPoolExecutor(max_workers=4) as ex:
            pairs = list(ex.map(lambda s: _gemini_usage(s, voice, style, language), sentences))
        clips = [p[0] for p in pairs]
        spent: dict[str, float] = {}
        for _, u in pairs:
            spent = costs.add_units(spent, u)
        costs.record("narration", "google", get_settings().gemini_tts_model, spent)
        return [trim_silence(c, NARRATION_RATE) for c in clips]
    with ThreadPoolExecutor(max_workers=2) as ex:
        clips = list(ex.map(lambda s: fn(s, voice, style, language), sentences))
    return [trim_silence(c, NARRATION_RATE) if provider != "silent" else c for c in clips]


def _silent(text: str, voice: str, style: str, language: str) -> array.array:
    # ~2.6 words/second reading pace; lets the pipeline run without any TTS.
    return silence(max(1.2, len(text.split()) / 2.6))


def _gemini(text: str, voice: str, style: str, language: str) -> array.array:
    return _gemini_usage(text, voice, style, language)[0]


def _gemini_usage(text: str, voice: str, style: str, language: str) -> tuple[array.array, dict]:
    """Gemini TTS → (clip, billable units). Vertex AI serves it through generate_content (no Interactions
    API there); the Gemini Developer API through interactions.create."""
    s = get_settings()
    c = genai_client("tts")
    last: Exception | None = None
    for attempt in range(3):
        try:
            if s.google_backend == "vertex":
                resp = c.models.generate_content(
                    model=s.gemini_tts_model,
                    contents=[{"role": "user", "parts": [{"text": text, "speech_metadata": {"style": f"{style}; speak {language}"}}]}],
                    config={"response_modalities": ["AUDIO"], "speech_config": {"voice_config": {"voice": voice}}},
                )
                data = resp.candidates[0].content.parts[0].inline_data.data  # WAV bytes (already decoded)
                pcm, rate = wav_to_pcm(data) if data[:4] == b"RIFF" else (_raw(data), 24000)
                return resample(pcm, rate, NARRATION_RATE), costs.gemini_tts_units(getattr(resp, "usage_metadata", None), len(pcm) / rate)
            interaction = c.interactions.create(
                model=s.gemini_tts_model,
                input=[{
                    "type": "user_input",
                    "content": [{
                        "type": "text",
                        "text": text,
                        "annotations": [{"type": "speech_metadata", "style": f"{style}; speak {language}"}],
                    }],
                }],
                response_format={"type": "audio"},
                generation_config={"speech_config": [{"voice": voice}]},
            )
            data = base64.b64decode(interaction.output_audio.data)
            pcm, rate = wav_to_pcm(data) if data[:4] == b"RIFF" else (_raw(data), 24000)
            return resample(pcm, rate, NARRATION_RATE), costs.gemini_tts_units(getattr(interaction, "usage", None), len(pcm) / rate)
        except Exception as e:  # network / quota; retried, then surfaced
            last = e
            log.warning("gemini tts failed (attempt %d): %s", attempt + 1, e)
            time.sleep(1.5 * (attempt + 1))
    raise TTSError(f"Gemini TTS failed: {last}")


def _raw(data: bytes) -> array.array:
    a = array.array("h")
    a.frombytes(data[: len(data) // 2 * 2])
    return a


def _sapi(text: str, voice: str, style: str, language: str) -> array.array:
    """Windows' built-in voice — a dev stand-in so you can hear lessons without a Gemini key."""
    if sys.platform != "win32":
        return _silent(text, voice, style, language)
    with tempfile.TemporaryDirectory() as d:
        out = Path(d) / "s.wav"
        txt = Path(d) / "s.txt"
        txt.write_text(text, encoding="utf-8")
        ps = (
            "Add-Type -AssemblyName System.Speech;"
            "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;"
            "$s.Rate = -1;"
            f"$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo({NARRATION_RATE}, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono);"
            f"$s.SetOutputToWaveFile('{out}', $fmt);"
            f"$s.Speak([IO.File]::ReadAllText('{txt}'));"
            "$s.Dispose()"
        )
        p = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], capture_output=True, timeout=60)
        if p.returncode != 0 or not out.exists():
            log.warning("sapi failed (%s); using silence", p.stderr.decode(errors="replace")[:300])
            return _silent(text, voice, style, language)
        pcm, rate = wav_to_pcm(out.read_bytes())
        return resample(pcm, rate, NARRATION_RATE)
