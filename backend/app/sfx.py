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
KIT_GAIN = {"storybook-v1": 1.0, "zen-board-v1": 0.75, "zen-board-hc-v1": 0.6}


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
    gain = KIT_GAIN.get(str(spec.get("kit", "")), 0.75)
    rng = random.Random(int(spec.get("seed", 7)) * 7919)
    for t0, name, g in events(spec):
        kind, _, arg = name.partition(":")
        snd = {"pop": pop, "tick": tick, "chime": chime, "bloop": bloop}.get(kind)
        samples = snd(rng) if snd else rise(rng) if kind == "rise" else whoosh(rng, float(arg or 1.0))
        start = int(t0 * RATE)
        for i, v in enumerate(samples):
            j = start + i
            if j >= len(buf):
                break
            buf[j] += v * g * gain
    out = array.array("h", (int(max(-1.0, min(1.0, math.tanh(v * 1.2))) * 32767) for v in buf))
    return out
