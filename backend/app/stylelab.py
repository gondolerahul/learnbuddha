"""The style lab: render fixed scenes in every kit as contact sheets, so a look can be judged (and perfected) before
it reaches a learner. Dev tool only; it makes no model call unless --critic is given.

    python -m app.stylelab                       # each kit's own example scene, in its own kit
    python -m app.stylelab --bench               # every example scene in every kit (the cross-kit benchmark)
    python -m app.stylelab --kits zen-board-v1 --critic   # also ask a vision model to critique each sheet

Sheets land in media/stylelab/. Example drafts are cue-based (the scene writer's own format), so they are resolved
with synthetic word timings, validated, mended and laid out exactly as the pipeline does for a real scene.
"""
from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

from . import kit, media
from .config import STYLEKIT_DIR, get_settings

log = logging.getLogger("lb.stylelab")

WORD_S = 0.36  # synthetic narration pace: seconds a word
GAP_S = 0.35  # pause between sentences

RUBRIC = """You are a film director and art director reviewing a contact sheet from an animated lesson (one row per
look, five moments across). Judge each row against this rubric, 1-5 each, and give the two changes that would raise it
most, concretely (what to move, remove, enlarge, recolour, retime):
1. One clear central image per scene that carries the idea (no stand-in boxes, no clutter).
2. Composition: subject large and placed with intent, deliberate empty space, nothing cut by the frame edge.
3. Style fidelity: the row looks like its named look, consistently, in line, colour, texture and type.
4. Legibility: labels short, readable, pointing at real parts, never over the drawing.
5. Progression: the five moments show the idea developing (beats), not a slideshow of unrelated pictures.
Answer in short plain text."""


def synthetic_timings(sentences: list[str]) -> tuple[list[dict], float]:
    out, t = [], 0.3
    for s in sentences:
        words = s.split()
        start = t
        ws = [{"w": w, "s": round(start + i * WORD_S, 3), "e": round(start + (i + 1) * WORD_S, 3)} for i, w in enumerate(words)]
        t = start + len(words) * WORD_S
        out.append({"text": s, "start": round(start, 3), "end": round(t, 3), "words": ws})
        t += GAP_S
    return out, round(t + 1.2, 3)


def draft_to_spec(draft: dict, kit_id: str) -> tuple[dict, list[str]]:
    """The pipeline's own path (cue resolution → mend → validate → layout repair), with synthetic timings."""
    timings, duration = synthetic_timings(draft["sentences"])
    d = json.loads(json.dumps(draft))
    spec = kit.resolve_cues(d, timings, duration, kit_id)
    spec, mended = kit.repair_props(spec)
    errs = kit.validate_spec(spec)
    if errs:
        spec = kit.drop_invalid(spec, errs)
    fixed = media.fix_spec(spec)
    notes = mended + errs + [f"layout: {i.get('message', i)}" for i in fixed.get("issues", [])]
    return fixed["spec"], notes


def examples() -> dict[str, dict]:
    out = {}
    for k in kit.STYLE_GUIDE:
        for p in sorted((STYLEKIT_DIR / k / "examples").glob("*.json")):
            out[f"{k}/{p.stem}"] = json.loads(p.read_text(encoding="utf-8"))
    return out


def sheet(spec: dict, kits: list[str], out: Path) -> None:
    tmp = out.with_suffix(".spec.json")
    tmp.write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
    times = ",".join(f"{spec['duration'] * f:.2f}" for f in (0.12, 0.32, 0.52, 0.72, 0.93))
    media.run_renderer(["sheet", "--spec", str(tmp), "--kits", ",".join(kits), "--times", times, "--scale", "0.3", "--out", str(out)], timeout=600)


def critique(image: Path) -> str:
    """A vision model's notes on a contact sheet (Gemini). Lab only: never part of making a course."""
    from google.genai import types

    from .genai_client import client

    c = client("brain")
    resp = c.models.generate_content(
        model=get_settings().gemini_brain_model,
        contents=[types.Part.from_bytes(data=image.read_bytes(), mime_type="image/jpeg"), RUBRIC],
    )
    return resp.text or ""


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bench", action="store_true", help="every example scene in every kit")
    ap.add_argument("--kits", default="", help="comma-separated kit ids (default: the ten styles)")
    ap.add_argument("--only", default="", help="only examples whose name contains this")
    ap.add_argument("--critic", action="store_true", help="ask a vision model to critique each sheet (costs a model call per sheet)")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    out_dir = get_settings().media_dir / "stylelab"
    out_dir.mkdir(parents=True, exist_ok=True)
    all_kits = [k for k in (a.kits.split(",") if a.kits else kit.STYLE_GUIDE)]
    for name, draft in examples().items():
        own = name.split("/")[0]
        if a.only and a.only not in name:
            continue
        if not a.bench and own not in all_kits:
            continue
        kits = all_kits if a.bench else [own]
        spec, notes = draft_to_spec(draft, own)
        img = out_dir / f"{name.replace('/', '__')}{'__bench' if a.bench else ''}.jpg"
        sheet(spec, kits, img)
        log.info("%s → %s (%.1f s)%s", name, img, spec["duration"], "".join(f"\n   · {n}" for n in notes[:8]))
        if a.critic:
            notes_path = img.with_suffix(".critic.txt")
            notes_path.write_text(critique(img), encoding="utf-8")
            log.info("   critic → %s", notes_path)


if __name__ == "__main__":
    main()
