"""Sound on the action: a quiet effects track built from the scene spec, synthesised in code.

Every visible action gets a small sound in sync with it (cinecode's "sound from version 1"): a soft pop when an
illustration appears, a tick when a label lands, a breathy rise when a process starts (particles, a journey, flows),
an air whoosh on a camera move, a chime on a cheer. Deterministic (seeded noise), mono, mixed low under narration.
"""
from __future__ import annotations

import array
import math
import random

RATE = 24000
KIT_GAIN = {"storybook-v1": 1.0, "zen-board-v1": 0.75, "zen-board-hc-v1": 0.6, "papercut-v1": 0.95, "schematic-v1": 0.55}

# Each kit's sounds come from one set of materials (its tokens.sound), so a scene sounds like one room rather than a
# beep per event: what a "pop", "tick", "rise" or "whoosh" becomes in that kit.
PALETTES: dict[str, dict[str, str]] = {
    "zen": {"pop": "wood", "tick": "wood", "rise": "breath", "whoosh": "whoosh", "chime": "bell", "bloop": "wood", "thunk": "wood"},
    "storybook": {"pop": "pluck", "tick": "pluck_hi", "rise": "rise", "whoosh": "whoosh", "chime": "chime", "bloop": "bloop", "thunk": "pop"},
    "flat": {"pop": "blip", "tick": "tick", "rise": "rise", "whoosh": "whoosh", "chime": "chime", "bloop": "blip", "thunk": "thunk"},
    "field": {"pop": "pluck", "tick": "pencil", "rise": "breath", "whoosh": "whoosh", "chime": "bell", "bloop": "pluck", "thunk": "wood"},
    "night": {"pop": "swell", "tick": "glint", "rise": "swell", "whoosh": "whoosh", "chime": "glint", "bloop": "swell", "thunk": "boom"},
    "clinical": {"pop": "blip", "tick": "tick", "rise": "breath", "whoosh": "whoosh", "chime": "bell", "bloop": "blip", "thunk": "blip"},
    "chalk": {"pop": "chalk", "tick": "chalk", "rise": "breath", "whoosh": "eraser", "chime": "chime", "bloop": "chalk", "thunk": "wood"},
    "paper": {"pop": "paper", "tick": "paper", "rise": "breath", "whoosh": "paper_slide", "chime": "music_box", "bloop": "pluck", "thunk": "paper"},
    "blueprint": {"pop": "click", "tick": "click", "rise": "breath", "whoosh": "whoosh", "chime": "bell", "bloop": "click", "thunk": "thunk"},
    "riso": {"pop": "thunk", "tick": "click", "rise": "rise", "whoosh": "paper_slide", "chime": "chime", "bloop": "thunk", "thunk": "thunk"},
}


def _env_exp(n: int, tau: float) -> list[float]:
    return [math.exp(-i / (tau * RATE)) for i in range(n)]


def pop(rng: random.Random) -> list[float]:
    n = int(0.11 * RATE)
    out, ph = [], 0.0
    for i in range(n):
        f = 520 * (0.5 ** (i / n))  # 520 → 260 Hz
        ph += 2 * math.pi * f / RATE
        e = math.exp(-i / (0.028 * RATE))
        click = (rng.random() * 2 - 1) * 0.3 if i < 0.003 * RATE else 0.0
        out.append(0.9 * math.sin(ph) * e + click)
    return out


def tick(rng: random.Random) -> list[float]:
    n = int(0.04 * RATE)
    out, prev = [], 0.0
    for i in range(n):
        noise = rng.random() * 2 - 1
        hp = noise - prev  # crude high-pass
        prev = noise
        e = math.exp(-i / (0.006 * RATE))
        out.append(0.5 * hp * e + 0.4 * math.sin(2 * math.pi * 2100 * i / RATE) * math.exp(-i / (0.01 * RATE)))
    return out


def rise(rng: random.Random, dur: float = 0.8) -> list[float]:
    n = int(dur * RATE)
    out, lp = [], 0.0
    for i in range(n):
        k = i / n
        cutoff = 300 + 2600 * k
        a = 1 - math.exp(-2 * math.pi * cutoff / RATE)
        lp += a * ((rng.random() * 2 - 1) - lp)
        out.append(lp * math.sin(math.pi * k) ** 1.5 * 1.6)
    return out


def whoosh(rng: random.Random, dur: float = 1.0) -> list[float]:
    n = int(max(0.3, min(1.8, dur)) * RATE)
    out, lp = [], 0.0
    for i in range(n):
        k = i / n
        cutoff = 250 + 1500 * math.sin(math.pi * k)
        a = 1 - math.exp(-2 * math.pi * cutoff / RATE)
        lp += a * ((rng.random() * 2 - 1) - lp)
        out.append(lp * math.sin(math.pi * k) ** 2 * 2.0)
    return out


def chime(rng: random.Random) -> list[float]:
    n = int(0.9 * RATE)
    return [(0.5 * math.sin(2 * math.pi * 1046.5 * i / RATE) + 0.35 * math.sin(2 * math.pi * 1568 * i / RATE) + 0.15 * math.sin(2 * math.pi * 2093 * i / RATE))
            * math.exp(-i / (0.32 * RATE)) * min(1.0, i / (0.004 * RATE)) for i in range(n)]


def bloop(rng: random.Random) -> list[float]:
    n = int(0.14 * RATE)
    out, ph = [], 0.0
    for i in range(n):
        f = 300 * (2 ** (i / n))  # 300 → 600 Hz
        ph += 2 * math.pi * f / RATE
        out.append(0.8 * math.sin(ph) * math.sin(math.pi * i / n))
    return out


def _noise_band(rng: random.Random, dur: float, lo: float, hi: float, env_tau: float, attack: float = 0.002) -> list[float]:
    """Noise between two cutoffs (a cheap band-pass: high-pass of a low-pass), with an exponential decay."""
    n = int(dur * RATE)
    out, lp, lp2 = [], 0.0, 0.0
    a_hi = 1 - math.exp(-2 * math.pi * hi / RATE)
    a_lo = 1 - math.exp(-2 * math.pi * lo / RATE)
    for i in range(n):
        lp += a_hi * ((rng.random() * 2 - 1) - lp)
        lp2 += a_lo * (lp - lp2)
        e = math.exp(-i / (env_tau * RATE)) * min(1.0, i / max(1, attack * RATE))
        out.append((lp - lp2) * e * 2.2)
    return out


def _pluck(freq: float, dur: float, rng: random.Random, damp: float = 0.996) -> list[float]:
    """Karplus-Strong: a plucked string (kalimba, pizzicato, music box when high)."""
    period = max(2, int(RATE / freq))
    buf = [rng.random() * 2 - 1 for _ in range(period)]
    out = []
    for i in range(int(dur * RATE)):
        v = buf[i % period]
        nxt = buf[(i + 1) % period]
        buf[i % period] = damp * 0.5 * (v + nxt)
        out.append(v * 0.6)
    return out


def _tone(freqs: list[float], dur: float, tau: float, attack: float = 0.004) -> list[float]:
    n = int(dur * RATE)
    return [sum(math.sin(2 * math.pi * f * i / RATE) / (k + 1) for k, f in enumerate(freqs)) * math.exp(-i / (tau * RATE)) * min(1.0, i / max(1, attack * RATE)) for i in range(n)]


def synth(kind: str, rng: random.Random, arg: float = 1.0) -> list[float]:
    """One sound by material name."""
    if kind == "pop":
        return pop(rng)
    if kind == "tick":
        return tick(rng)
    if kind == "rise":
        return rise(rng)
    if kind == "whoosh":
        return whoosh(rng, arg)
    if kind == "chime":
        return chime(rng)
    if kind == "bloop":
        return bloop(rng)
    if kind == "wood":  # a small wood block
        return [v * 0.9 for v in _tone([820, 1640], 0.12, 0.022)]
    if kind == "bell":  # a soft temple bell
        return [v * 0.5 for v in _tone([523.25, 1318.5, 2093], 1.4, 0.55, 0.002)]
    if kind == "breath":  # air through a reed: a soft rising breath
        return [v * 0.7 for v in rise(rng, 0.9)]
    if kind == "pluck":
        return _pluck(392 * (1 + rng.choice([0, 0.25, 0.5])), 0.5, rng, 0.993)
    if kind == "pluck_hi":
        return _pluck(784, 0.3, rng, 0.99)
    if kind == "music_box":
        return [v * 0.7 for v in _tone([1046.5 * rng.choice([1, 1.26, 1.5]), 3139.5], 0.9, 0.3, 0.001)]
    if kind == "blip":  # a clean interface blip
        return [v * 0.6 for v in _tone([880, 1760], 0.09, 0.025, 0.001)]
    if kind == "thunk":  # a print drum landing, a stamp
        return [a * 0.9 + b * 0.4 for a, b in zip(_tone([90, 180], 0.25, 0.06, 0.001), _noise_band(rng, 0.25, 200, 2000, 0.03))]
    if kind == "boom":
        return [v * 1.1 for v in _tone([55, 82.4], 1.2, 0.45, 0.01)]
    if kind == "swell":  # a deep, slow swell of air
        n = int(1.1 * RATE)
        base = rise(rng, 1.1)
        return [base[i] * 0.4 + 0.5 * math.sin(2 * math.pi * 110 * i / RATE) * math.sin(math.pi * i / n) ** 2 for i in range(n)]
    if kind == "glint":
        return [v * 0.45 for v in _tone([2637, 3951, 5274], 0.7, 0.2, 0.002)]
    if kind == "chalk":  # chalk on slate: a gritty high scratch
        return [v * 0.9 for v in _noise_band(rng, 0.16, 1800, 6500, 0.05, 0.004)]
    if kind == "pencil":
        return [v * 0.7 for v in _noise_band(rng, 0.12, 1500, 5000, 0.04, 0.003)]
    if kind == "eraser":  # felt on slate, a long soft rub
        return [v * math.sin(math.pi * i / int(0.9 * RATE)) for i, v in enumerate(_noise_band(rng, 0.9, 300, 2500, 2.0, 0.05))]
    if kind == "paper":  # a rustle of paper
        return [v * (0.6 + 0.4 * (rng.random() < 0.08)) for v in _noise_band(rng, 0.2, 800, 6000, 0.06, 0.005)]
    if kind == "paper_slide":
        return [v * math.sin(math.pi * i / int(0.7 * RATE)) for i, v in enumerate(_noise_band(rng, 0.7, 400, 4000, 3.0, 0.02))]
    if kind == "click":
        return [v * 0.8 for v in _noise_band(rng, 0.03, 2000, 9000, 0.005, 0.0005)]
    return tick(rng)


def events(spec: dict) -> list[tuple[float, str, float]]:
    """(time, sound, gain) for the scene's visible actions."""
    ev: list[tuple[float, str, float]] = []
    for el in spec.get("elements", []):
        at = float(el.get("at", 0) or 0)
        typ, p = el.get("type"), el.get("props") or {}
        if typ == "Prop" and p.get("entrance") != "none":
            ev.append((at + 0.05, "pop", 0.20))
        elif typ == "Label":
            ev.append((at + 0.3, "tick", 0.14))
        elif typ in ("Particles", "Tube"):
            ev.append((at, "rise", 0.07))
        elif typ == "Journey":
            ev.append((at, "bloop", 0.14))
        elif typ == "Heading":
            ev.append((at, "rise", 0.05))
        elif typ == "Guide":
            ev.append((at + 0.3, "bloop", 0.10))
            for k in p.get("poses", []) or []:
                if isinstance(k, dict) and k.get("pose") == "cheer" and isinstance(k.get("at"), (int, float)):
                    ev.append((float(k["at"]), "chime", 0.12))
        elif typ == "Nephron":
            for f in p.get("flows", []) or []:
                if isinstance(f, dict) and isinstance(f.get("at"), (int, float)):
                    ev.append((float(f["at"]), "rise", 0.06))
        elif typ in ("Synapse", "Cell", "Machine", "Circuit", "Orbits", "Reaction", "Molecule", "Contraption"):
            ev.append((at + 0.1, "rise", 0.06))
            for st in p.get("stages", []) or []:
                if isinstance(st, dict) and isinstance(st.get("at"), (int, float)):
                    ev.append((float(st["at"]), "pop", 0.12))
            for lb in p.get("labels", []) or []:
                if isinstance(lb, dict) and isinstance(lb.get("at"), (int, float)):
                    ev.append((float(lb["at"]) + 0.3, "tick", 0.12))
        elif typ in ("Timeline", "WorldMap", "TokenGrid", "Bars"):
            for key in ("events", "pins", "routes", "regions", "groups", "items"):
                for it in p.get(key, []) or []:
                    if isinstance(it, dict) and isinstance(it.get("at"), (int, float)):
                        ev.append((float(it["at"]), "tick", 0.12))
            if isinstance((p.get("highlight") or {}).get("at") if isinstance(p.get("highlight"), dict) else None, (int, float)):
                ev.append((float(p["highlight"]["at"]), "chime", 0.1))
        elif typ == "Stamp":
            ev.append((at + 0.18, "thunk", 0.25))
            if isinstance(p.get("strikeAt"), (int, float)):
                ev.append((float(p["strikeAt"]), "whoosh:0.40", 0.12))
        elif typ == "Transition":
            ev.append((at, f"whoosh:{float(el.get('dur') or 1.0):.2f}", 0.09))
        elif typ == "Epithelium":
            for tr in p.get("transporters", []) or []:
                if isinstance(tr, dict) and isinstance(tr.get("at"), (int, float)):
                    ev.append((float(tr["at"]), "tick", 0.12))
    prev = (640.0, 360.0, 1.0)
    for c in sorted(spec.get("camera", []) or [], key=lambda c: c.get("t", 0)):
        x, y, z = float(c.get("x", prev[0])), float(c.get("y", prev[1])), float(c.get("zoom", prev[2]))
        if abs(z - prev[2]) >= 0.15 or math.hypot(x - prev[0], y - prev[1]) > 140:
            ev.append((float(c.get("t", 0)), f"whoosh:{float(c.get('dur', 1.6)):.2f}", 0.07))
        prev = (x, y, z)
    return [e for e in ev if 0 <= e[0] < float(spec.get("duration", 0))]


def build(spec: dict) -> array.array:
    """The effects track as int16 mono at RATE, the scene's length."""
    dur = float(spec.get("duration", 0))
    buf = [0.0] * max(1, int(dur * RATE))
    kit_id = str(spec.get("kit", ""))
    gain = KIT_GAIN.get(kit_id, 0.75)
    rng = random.Random(int(spec.get("seed", 7)) * 7919)
    try:
        from . import kit as _kit

        palette = PALETTES.get(str(_kit.tokens(kit_id).get("sound", "")), {})
    except Exception:
        palette = {}
    for t0, name, g in events(spec):
        kind, _, arg = name.partition(":")
        samples = synth(palette.get(kind, kind), rng, float(arg or 1.0))
        start = int(t0 * RATE)
        for i, v in enumerate(samples):
            j = start + i
            if j >= len(buf):
                break
            buf[j] += v * g * gain
    out = array.array("h", (int(max(-1.0, min(1.0, math.tanh(v * 1.2))) * 32767) for v in buf))
    return out
