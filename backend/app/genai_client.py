"""One place that builds google-genai clients, for Vertex AI (Gemini Enterprise Agent Platform)
or the Gemini Developer API, per purpose (brain, TTS, live voice use different locations)."""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from .config import get_settings

Purpose = Literal["brain", "tts", "live"]


class GoogleConfigError(RuntimeError):
    pass


def _credentials():
    path = get_settings().google_application_credentials
    if not path:
        return None  # Application Default Credentials (gcloud auth application-default login / workload identity)
    from google.oauth2 import service_account

    return service_account.Credentials.from_service_account_file(path, scopes=["https://www.googleapis.com/auth/cloud-platform"])


def location_for(purpose: Purpose) -> str:
    s = get_settings()
    if purpose == "live":
        return s.gemini_live_location
    if purpose == "brain":
        return s.gemini_brain_location
    return s.google_cloud_location


def _adc_stamp() -> float:
    """When the Application Default Credentials file last changed (0 when absent). A new `gcloud auth
    application-default login` rewrites it, and the clients below are rebuilt so they pick the new sign-in up without
    restarting the server (a client keeps the refresh token it was created with)."""
    path = get_settings().google_application_credentials
    if not path:
        try:
            from google.auth import _cloud_sdk

            path = _cloud_sdk.get_application_default_credentials_path()
        except Exception:
            return 0.0
    try:
        import os

        return os.path.getmtime(path)
    except OSError:
        return 0.0


def client(purpose: Purpose = "brain"):
    return _client(purpose, _adc_stamp())


def _cache_clear() -> None:
    _client.cache_clear()


client.cache_clear = _cache_clear  # type: ignore[attr-defined]  # callers (and tests) reset the clients this way


@lru_cache(maxsize=8)
def _client(purpose: Purpose, _stamp: float):
    from google import genai

    s = get_settings()
    backend = s.google_backend
    if backend == "vertex":
        if not s.google_cloud_project:
            raise GoogleConfigError("GOOGLE_CLOUD_PROJECT is required for Vertex AI")
        return genai.Client(
            enterprise=True,
            project=s.google_cloud_project,
            location=location_for(purpose),
            credentials=_credentials(),
            http_options={"api_version": "v1beta1"},
        )
    if backend == "studio":
        return genai.Client(api_key=s.gemini_api_key, http_options={"api_version": "v1beta"})
    raise GoogleConfigError("No Google model access configured: set GOOGLE_CLOUD_PROJECT (Vertex AI) or GEMINI_API_KEY")


def describe() -> dict:
    s = get_settings()
    b = s.google_backend
    return {
        "backend": b,
        "project": s.google_cloud_project if b == "vertex" else None,
        "location": s.google_cloud_location if b == "vertex" else None,
        "brain_location": s.gemini_brain_location if b == "vertex" else None,
        "live_location": s.gemini_live_location if b == "vertex" else None,
    }
