"""Style Kit access for the pipeline: tokens, component schemas, shot grammar, golden scenes,
spec validation and cue → time resolution."""
from __future__ import annotations

import json
import re
from functools import lru_cache
from typing import Any

from jsonschema import Draft202012Validator

from .config import STYLEKIT_DIR

DEFAULT_KIT = "zen-board-v1"
CHILD_KIT = "storybook-v1"
AUTO_KIT = "auto"  # chosen by the planner from who the learner is
KITS = {
    "zen-board-v1": "Zen Board", "zen-board-hc-v1": "Zen Board · High contrast", "storybook-v1": "Storybook",
    "chalkboard-v1": "Chalkboard", "blueprint-v1": "Blueprint", "watercolor-v1": "Field notes", "papercut-v1": "Paper cut-out",
    "inkwash-v1": "Ink wash", "schematic-v1": "Clinical schematic", "cinematic-dark-v1": "Dark cinematic", "comic-v1": "Comic",
}
CHILD_AUDIENCES = {"young_child", "child"}
# Styles the planner may choose, with what each is for (shown to the planner).
STYLE_GUIDE = {
    "zen-board-v1": "calm paper and ink: the general default (humanities, business, everyday skills, anything not below)",
    "chalkboard-v1": "chalk on a board: maths, statistics, physics derivations, worked problems",
    "blueprint-v1": "technical drawing on blue: engineering, machines, how things work, architecture, electronics",
    "watercolor-v1": "naturalist's field notes: biology, ecology, plants and animals, geography, earth science",
    "schematic-v1": "clean textbook figure: medicine, anatomy, physiology, pharmacology, chemistry, professional training",
    "cinematic-dark-v1": "dark documentary: space and astronomy, the very large or very small, dramatic history",
    "inkwash-v1": "brush and ink: literature, philosophy, poetry, art, culture, reflective history",
    "comic-v1": "comic page: stories, events, economics and social topics told through characters (teens)",
    "storybook-v1": "picture book with a guide character: children aged about 5–11, any subject",
    "papercut-v1": "paper puppet theatre: children's stories, history and social studies for young learners",
}
CHILD_KITS = {"storybook-v1", "papercut-v1"}
CHILD_OK = CHILD_KITS | {"watercolor-v1", "comic-v1", "chalkboard-v1"}
GENERIC_PROPS = ("motion", "loop", "loopSpeed", "depth")  # any element may carry these
LOOPS = {"bob", "float", "pulse", "breathe", "spin", "sway", "shake"}
PARTICLE_KINDS = {"dot", "drop", "vapor", "bubble", "snow", "spark", "arrow", "rbc", "wbc", "water", "molecule", "oxygen", "co2", "glucose",
                  "salt", "urea", "ion", "electron", "photon", "heat", "leaf", "nutrient"}


CHARS_PER_WORD = 6.2  # a typical teaching sentence (spaces included); technical prose runs longer


def word_budget(seconds: float, kit_id: str, chars_per_word: float = CHARS_PER_WORD) -> dict:
    """How much narration fits in `seconds`. The kit voice's measured rate is in characters per second (pauses
    included), which tracks spoken length better than words when the vocabulary is long; the prompt still
    talks in words, so the character budget is converted with the expected word length."""
    cps = float(tokens(kit_id)["voice"].get("cps", 10.5))
    chars = round(seconds * cps)
    words = max(20, round(chars / max(3.0, chars_per_word)))
    per = 11 if kit_id == CHILD_KIT else 16
    return {"chars": chars, "words": words, "sentences": max(3, -(-words // round(per * 0.75))), "per_sentence": per, "wps": cps / chars_per_word}


def narration_words(draft: dict) -> int:
    return sum(len(str(s).split()) for s in draft.get("sentences", []))


def narration_chars(draft: dict) -> int:
    return sum(len(" ".join(str(s).split())) for s in draft.get("sentences", [])) + max(0, len(draft.get("sentences", [])) - 1)


def choose_kit(requested: str, audience: str | None, style: str | None = None) -> str:
    """An explicit kit wins. With "auto", the planner's style for the subject is used, except that children always
    get a child-friendly style (Storybook unless the planner picked another one that suits them)."""
    if requested in KITS:
        return requested
    child = (audience or "") in CHILD_AUDIENCES
    if style in STYLE_GUIDE:
        if child and style not in CHILD_OK:
            return CHILD_KIT
        return style
    return CHILD_KIT if child else DEFAULT_KIT

# Glyphs the bundled fonts can draw (Latin + common maths). Anything else becomes tofu.
_ALLOWED = re.compile(r"^[ -~ -ɏ̀-ͯͰ-Ͽ‐-‧‰-⁞⁰-₟€℀-⅏←-⇿∀-⋿⌀-⏿■-◿☀-☃✓✗⟨⟩\n]*$")


@lru_cache
def tokens(kit: str) -> dict:
    kit = kit if kit in KITS else DEFAULT_KIT
    return json.loads((STYLEKIT_DIR / kit / "tokens.json").read_text(encoding="utf-8"))


@lru_cache
def components() -> dict:
    return json.loads((STYLEKIT_DIR / "components.json").read_text(encoding="utf-8"))


@lru_cache
def skill_md(kit: str = DEFAULT_KIT) -> str:
    base = (STYLEKIT_DIR / "zen-board-v1" / "SKILL.md").read_text(encoding="utf-8")
    extra = STYLEKIT_DIR / kit / "SKILL.md"
    if kit != "zen-board-v1" and extra.exists():
        base += "\n\n" + extra.read_text(encoding="utf-8")
    return base


@lru_cache
def _all_golden() -> list[dict]:
    d = STYLEKIT_DIR / "zen-board-v1" / "golden"
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(d.glob("*.json"))]


def golden_scenes(kit: str = DEFAULT_KIT) -> list[dict]:
    """Reference scenes for the prompt: the children's ones for Storybook, the others for everyone else
    (the answer-clip example goes to both). `speech` is pipeline-provided, so it is left out."""
    child = kit in CHILD_KITS
    out = []
    for g in _all_golden():
        answer = any(e.get("type") == "FrozenFrame" for e in g.get("elements", []))
        if answer or (g.get("kit") in CHILD_KITS) == child:
            out.append({k: v for k, v in g.items() if k != "speech"})
    return out


@lru_cache
def props_catalog() -> dict:
    """Illustration library (generated from the renderer on build): kind → {group, aspect, anchors}."""
    p = STYLEKIT_DIR / "props.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def props_reference() -> str:
    groups: dict[str, list[str]] = {}
    for k, v in props_catalog().items():
        anchors = [a for a in v.get("anchors", []) if a not in ("center",)]
        groups.setdefault(v.get("group", "other"), []).append(k + (f"({', '.join(anchors)})" if anchors else ""))
    lines = [f"  {g}: " + "; ".join(ks) for g, ks in groups.items()]
    return "Prop catalog (kind(extra anchors)); every prop also has center, top, bottom, left, right:\n" + "\n".join(lines)


@lru_cache
def _validators() -> dict[str, Draft202012Validator]:
    return {name: Draft202012Validator(c["props"]) for name, c in components()["components"].items()}


def component_names(include_internal: bool = False) -> list[str]:
    names = list(components()["components"].keys())
    if not include_internal:
        names = [n for n in names if n not in ("FrozenFrame", "RecapCard", "ProgressBar")]
    return names


def component_reference(answer_mode: bool = False) -> str:
    """Compact component docs for prompts."""
    lines = [str(components().get("common", {}).get("motion", ""))]
    for name, c in components()["components"].items():
        if name in ("RecapCard", "ProgressBar"):
            continue
        if name == "FrozenFrame" and not answer_mode:
            continue
        props = c["props"].get("properties", {})
        req = set(c["props"].get("required", []))
        plist = ", ".join(f"{k}{'*' if k in req else ''}: {_short(v)}" for k, v in props.items() if k != "spec")
        lines.append(f"- {name}: {c['description']}\n  props: {plist}")
        if name == "Prop":
            lines.append(props_reference())
    return "\n".join(lines)


def _short(schema: dict) -> str:
    if "enum" in schema:
        return "|".join(map(str, schema["enum"]))
    if "anyOf" in schema:
        return " or ".join(_short(s) for s in schema["anyOf"])
    t = schema.get("type", "any")
    if t == "array":
        return f"[{_short(schema.get('items', {}))}]"
    if t == "object":
        inner = schema.get("properties", {})
        return "{" + ", ".join(f"{k}: {_short(v)}" for k, v in inner.items()) + "}" if inner else "object"
    return str(t)


# ───────────────────────────── cue resolution ─────────────────────────────


def cue_time(timings: list[dict], cue: Any, fallback: float = 0.0) -> float:
    """[sentence, word] → seconds, using real narration timings."""
    if not timings:
        return fallback
    if isinstance(cue, (int, float)):
        cue = [int(cue), 0]
    if not isinstance(cue, (list, tuple)) or not cue:
        return fallback
    si = max(0, min(len(timings) - 1, int(cue[0])))
    s = timings[si]
    words = s.get("words") or []
    wi = int(cue[1]) if len(cue) > 1 and cue[1] is not None else 0
    if not words or wi <= 0:
        return float(s["start"])
    wi = min(len(words) - 1, wi)
    return float(words[wi]["s"])


def resolve_cues(draft: dict, timings: list[dict], duration: float, kit: str) -> dict:
    """Turn the LLM's cue-based draft into an absolute-time scene spec."""
    elements = []
    for raw in draft.get("elements", []):
        props = raw.get("props") or {}
        at = round(cue_time(timings, raw.get("cue"), 0.0) + float(raw.get("delay") or 0), 3)
        el: dict[str, Any] = {"id": str(raw.get("id")), "type": raw.get("type"), "at": max(0.0, at), "props": props}
        if raw.get("until_cue") is not None:
            el["until"] = round(cue_time(timings, raw["until_cue"], duration), 3)
        if raw.get("dur"):
            el["dur"] = float(raw["dur"])
        if raw.get("fixed"):
            el["fixed"] = True
        # nested cues
        if isinstance(props.get("paracellular"), dict) and "cue" in props["paracellular"]:
            props["paracellular"]["at"] = round(cue_time(timings, props["paracellular"].pop("cue"), at), 3)
        if isinstance(props.get("cues"), list):
            props["times"] = [round(cue_time(timings, c, at), 3) for c in props.pop("cues")]
        for key in ("marks", "series", "motion", "poses", "flows", "stateKeys", "transporters"):
            if isinstance(props.get(key), list):
                for item in props[key]:
                    if isinstance(item, dict) and "cue" in item:
                        item["at"] = round(cue_time(timings, item.pop("cue"), at), 3)
        elements.append(el)
    camera = []
    for c in draft.get("camera", []) or []:
        try:
            key = {"t": round(cue_time(timings, c.get("cue"), 0), 3), "x": float(c["x"]), "y": float(c["y"]), "zoom": float(c.get("zoom", 1))}
            for opt, lo, hi in (("dur", 0.3, 8.0), ("focus", -1.0, 1.0), ("dof", 0.0, 10.0)):
                if isinstance(c.get(opt), (int, float)):
                    key[opt] = max(lo, min(hi, float(c[opt])))
            camera.append(key)
        except (KeyError, TypeError, ValueError):
            continue
    spec: dict[str, Any] = {"kit": kit, "duration": duration, "seed": int(draft.get("seed") or 7), "elements": elements}
    if timings:  # sentence spans: talking characters move their mouths only while the narrator speaks
        spec["speech"] = [[round(float(s["start"]), 3), round(float(s["end"]), 3)] for s in timings]
    if camera:
        spec["camera"] = sorted(camera, key=lambda c: c["t"])
    return spec


# ───────────────────────────── validation ─────────────────────────────


def _texts(props: Any):
    if isinstance(props, str):
        yield props
    elif isinstance(props, dict):
        for k, v in props.items():
            if k != "spec":
                yield from _texts(v)
    elif isinstance(props, list):
        for v in props:
            yield from _texts(v)


def validate_spec(spec: dict, allow_internal: bool = False) -> list[str]:
    errors: list[str] = []
    ids: set[str] = set()
    names = set(component_names(include_internal=True))
    vals = _validators()
    for el in spec.get("elements", []):
        eid = el.get("id", "?")
        if eid in ids:
            errors.append(f"[{eid}] duplicate id")
        ids.add(eid)
        typ = el.get("type")
        if typ not in names:
            errors.append(f"[{eid}] unknown component type '{typ}'")
            continue
        if typ in ("FrozenFrame", "RecapCard") and not allow_internal:
            errors.append(f"[{eid}] {typ} is reserved for the pipeline")
        props = el.get("props", {}) if isinstance(el.get("props"), dict) else {}
        core = {k: v for k, v in props.items() if k not in GENERIC_PROPS}
        for e in vals[typ].iter_errors(core):
            loc = "/".join(map(str, e.absolute_path)) or "props"
            errors.append(f"[{eid}] {typ}.{loc}: {e.message[:200]}")
        errors.extend(_generic_errors(eid, props))
        errors.extend(_kind_errors(eid, typ, props))
        for txt in _texts(el.get("props", {})):
            if not _ALLOWED.match(txt):
                bad = sorted({ch for ch in txt if not _ALLOWED.match(ch)})
                errors.append(f"[{eid}] text uses characters the fonts cannot draw: {' '.join(bad)} (use plain Unicode maths)")
    return errors


def repair_props(spec: dict) -> tuple[dict, list[str]]:
    """Mend small prop mistakes instead of losing the element: a number past its limit is clamped to it, and an
    unknown value or extra key for an optional prop is removed so the component default applies. What still fails
    validation afterwards is dropped by the caller."""
    vals = _validators()
    fixed: list[str] = []
    for el in spec.get("elements", []):
        typ, eid = el.get("type"), el.get("id", "?")
        props = el.get("props")
        if typ not in vals or not isinstance(props, dict):
            continue
        if "loop" in props and props["loop"] not in LOOPS:
            fixed.append(f"{eid}: dropped unknown loop {props.pop('loop')!r}")
        if "depth" in props and isinstance(props["depth"], (int, float)) and not -1 <= props["depth"] <= 1:
            props["depth"] = max(-1, min(1, props["depth"]))
            fixed.append(f"{eid}: depth clamped")
        core = {k: v for k, v in props.items() if k not in GENERIC_PROPS}
        for e in sorted(vals[typ].iter_errors(core), key=lambda e: -len(e.absolute_path)):
            path = list(e.absolute_path)
            parent = props
            try:
                for k in path[:-1]:
                    parent = parent[k]
            except (KeyError, IndexError, TypeError):
                continue
            key = path[-1] if path else None
            if e.validator in ("minimum", "exclusiveMinimum", "maximum", "exclusiveMaximum") and key is not None:
                limit = e.validator_value
                parent[key] = limit if "imum" in e.validator and not e.validator.startswith("exclusive") else (limit + 1e-3 if "Min" in e.validator else limit - 1e-3)
                fixed.append(f"{eid}: {'/'.join(map(str, path))} clamped to {parent[key]}")
            elif e.validator == "enum" and isinstance(key, str) and key not in (e.parent.schema.get("required", []) if e.parent else []):
                fixed.append(f"{eid}: dropped unknown {key} {parent.pop(key, None)!r}")
            elif e.validator == "additionalProperties" and isinstance(parent, dict):
                allowed = set(e.schema.get("properties", {}))
                for extra in [k for k in parent if k not in allowed and k not in GENERIC_PROPS]:
                    parent.pop(extra)
                    fixed.append(f"{eid}: dropped unknown prop {extra}")
    return spec, fixed


def _generic_errors(eid: str, props: dict) -> list[str]:
    out = []
    m = props.get("motion")
    if m is not None and not (isinstance(m, list) and all(isinstance(k, dict) and isinstance(k.get("at"), (int, float)) for k in m)):
        out.append(f"[{eid}] motion must be a list of keys, each with a cue (or at)")
    if "loop" in props and props["loop"] not in LOOPS:
        out.append(f"[{eid}] loop must be one of {', '.join(sorted(LOOPS))}")
    if "depth" in props and not (isinstance(props["depth"], (int, float)) and -1 <= props["depth"] <= 1):
        out.append(f"[{eid}] depth must be a number from -1 (far) to 1 (near)")
    return out


def _kind_errors(eid: str, typ: str, props: dict) -> list[str]:
    cat = props_catalog()
    if not cat:
        return []
    if typ == "Prop" and props.get("kind") not in cat:
        return [f"[{eid}] unknown prop kind '{props.get('kind')}' (use one from the Prop catalog)"]
    if typ in ("Particles", "Journey") and props.get("kind") is not None and props["kind"] not in cat and props["kind"] not in PARTICLE_KINDS:
        return [f"[{eid}] unknown {typ} kind '{props['kind']}'"]
    flow = props.get("flow")
    if typ == "Tube" and isinstance(flow, dict) and flow.get("kind") is not None and flow["kind"] not in cat and flow["kind"] not in PARTICLE_KINDS:
        return [f"[{eid}] unknown flow kind '{flow['kind']}'"]
    return []


def drop_invalid(spec: dict, errors: list[str]) -> dict:
    """Last resort after the fix round: remove elements that still fail validation."""
    bad = {m.group(1) for e in errors if (m := re.match(r"\[([^\]]+)\]", e))}
    spec = dict(spec)
    spec["elements"] = [el for el in spec["elements"] if el.get("id") not in bad]
    return spec


def visible_text(spec: dict, t: float) -> list[str]:
    """Python mirror of renderer visibleText(): on-screen strings at time t."""
    out: list[str] = []
    for el in spec.get("elements", []):
        if t < el.get("at", 0):
            continue
        if isinstance(el.get("until"), (int, float)) and t > el["until"]:
            continue
        p = el.get("props") or {}
        if el.get("type") == "FrozenFrame" and isinstance(p.get("spec"), dict):
            out.extend(visible_text(p["spec"], float(p.get("t", 0))))
            continue
        for k in ("title", "subtitle", "text", "label", "xLabel", "yLabel"):
            if isinstance(p.get(k), str):
                out.append(p[k])
        if isinstance(p.get("items"), list):
            out.extend(map(str, p["items"]))
        for side in ("left", "right"):
            if isinstance(p.get(side), dict):
                out.append(str(p[side].get("title", "")))
                out.extend(map(str, p[side].get("items", [])))
        if isinstance(p.get("nodes"), list):
            out.extend(str(n.get("label", "")) for n in p["nodes"] if isinstance(n, dict))
        if isinstance(p.get("rows"), list):
            out.extend(" | ".join(map(str, r)) if isinstance(r, list) else str(r) for r in p["rows"])
        typ = el.get("type")
        if typ in ("Prop", "Journey"):
            out.append(f"[picture: {p.get('kind')}]")
        elif typ in ("Particles", "Tube"):
            out.append(f"[moving {p.get('kind') or (p.get('flow') or {}).get('kind') or 'particles'}]")
        elif typ == "Landscape":
            out.append("[landscape: sky, sea, land, mountains, river]")
        elif typ == "Nephron":
            out.append("[diagram: nephron with " + ", ".join(f.get("kind", "") for f in p.get("flows", []) if isinstance(f, dict)) + " flows]")
        elif typ == "Epithelium":
            out.append("[diagram: epithelial transport from lumen to blood: " + ", ".join(str(x.get("label") or x.get("kind")) for x in p.get("transporters", []) if isinstance(x, dict)) + "]")
        elif typ == "Body":
            out.append("[diagram: human body" + (f", highlighting {p['highlight']}" if p.get("highlight") else "") + "]")
    return [s for s in out if s]


def visible_elements(spec: dict, t: float) -> list[dict]:
    """Element ids/types/text on screen at t (lets answer clips annotate the frozen frame)."""
    res = []
    for el in spec.get("elements", []):
        if t < el.get("at", 0) or (isinstance(el.get("until"), (int, float)) and t > el["until"]):
            continue
        res.append({"id": el["id"], "type": el["type"], "text": "; ".join(visible_text({"elements": [dict(el, at=0, until=None)]}, 0))[:160]})
    return res
