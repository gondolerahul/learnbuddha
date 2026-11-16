"""Audio assembly, the render+encode pipeline, and the fMP4 fragment indexer."""
from __future__ import annotations

import array
import io
import json
import math
import socket
import struct
import subprocess
import threading
import wave
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .config import RENDERER_DIR, get_settings

NARRATION_RATE = 24000
LEAD_IN = 0.6  # seconds of paper before the first word
SENTENCE_GAP = 0.35
TAIL = 1.6  # seconds after the last word (lets the takeaway breathe)


# ───────────────────────────── audio ─────────────────────────────


def wav_to_pcm(data: bytes) -> tuple[array.array, int]:
    """Decode WAV bytes to mono int16 samples + sample rate."""
    with wave.open(io.BytesIO(data), "rb") as w:
        rate = w.getframerate()
        ch = w.getnchannels()
        width = w.getsampwidth()
        frames = w.readframes(w.getnframes())
    if width != 2:
        raise ValueError(f"unsupported sample width {width}")
    pcm = array.array("h")
    pcm.frombytes(frames)
    if ch > 1:
        pcm = array.array("h", (int(sum(pcm[i : i + ch]) / ch) for i in range(0, len(pcm), ch)))
    return pcm, rate


def resample(pcm: array.array, src: int, dst: int) -> array.array:
    if src == dst or not pcm:
        return pcm
    n = int(len(pcm) * dst / src)
    out = array.array("h", bytes(2 * n))
    ratio = src / dst
    last = len(pcm) - 1
    for i in range(n):
        x = i * ratio
        j = int(x)
        f = x - j
        a = pcm[j]
        b = pcm[j + 1] if j < last else a
        out[i] = int(a + (b - a) * f)
    return out


def trim_silence(pcm: array.array, rate: int, threshold: float = 0.02, pad: float = 0.04) -> array.array:
    if not pcm:
        return pcm
    peak = max(1, max(abs(v) for v in pcm))
    th = peak * threshold
    start = next((i for i, v in enumerate(pcm) if abs(v) > th), 0)
    end = next((len(pcm) - i for i, v in enumerate(reversed(pcm)) if abs(v) > th), len(pcm))
    p = int(pad * rate)
    return pcm[max(0, start - p) : min(len(pcm), end + p)]


def silence(seconds: float, rate: int = NARRATION_RATE) -> array.array:
    return array.array("h", bytes(2 * max(0, int(seconds * rate))))


def pcm_to_wav(pcm: array.array, rate: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


@dataclass
class Narration:
    wav: bytes
    duration: float
    timings: list[dict]  # [{text,start,end,words:[{w,s,e}]}]


def assemble_narration(sentences: list[str], clips: list[array.array], fps: int) -> Narration:
    """Place sentence clips on one track; sentence starts snap to frame boundaries so each
    can become a keyframe/fragment start (exact resume points)."""
    track = array.array("h")
    timings: list[dict] = []
    t = LEAD_IN
    track.extend(silence(LEAD_IN))
    for text, clip in zip(sentences, clips):
        start = math.ceil(t * fps) / fps
        pad = start - len(track) / NARRATION_RATE
        if pad > 0:
            track.extend(silence(pad))
        track.extend(clip)
        dur = len(clip) / NARRATION_RATE
        timings.append({"text": text, "start": round(start, 4), "end": round(start + dur, 4), "words": word_times(text, start, dur)})
        t = start + dur + SENTENCE_GAP
        track.extend(silence(SENTENCE_GAP))
    track.extend(silence(TAIL - SENTENCE_GAP))
    # normalise narration peak to ~-1 dBFS
    peak = max([abs(v) for v in track] or [1]) or 1
    gain = min(4.0, 29000 / peak)
    if abs(gain - 1) > 0.05:
        track = array.array("h", (max(-32768, min(32767, int(v * gain))) for v in track))
    duration = len(track) / NARRATION_RATE
    return Narration(wav=pcm_to_wav(track, NARRATION_RATE), duration=round(duration, 3), timings=timings)


def word_times(text: str, start: float, dur: float) -> list[dict]:
    """Estimate word times inside a sentence from character weights (TTS gives no timestamps)."""
    words = text.split()
    if not words:
        return []
    weights = [len(w) + 1.5 for w in words]
    total = sum(weights)
    out = []
    acc = start
    for w, wt in zip(words, weights):
        d = dur * wt / total
        out.append({"w": w, "s": round(acc, 3), "e": round(acc + d, 3)})
        acc += d
    return out


# ───────────────────────────── render + encode ─────────────────────────────


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def renderer_cli() -> list[str]:
    s = get_settings()
    cli = RENDERER_DIR / "dist" / "cli.mjs"
    if not cli.exists():
        raise RuntimeError("renderer not built: run `npm run build:renderer` at the repo root")
    return [s.node_bin, str(cli)]


def run_renderer(args: list[str], stdin: bytes | None = None, timeout: float = 120) -> bytes:
    p = subprocess.run(renderer_cli() + args, input=stdin, capture_output=True, timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError(f"renderer {args[0]} failed: {p.stderr.decode(errors='replace')[-2000:]}")
    return p.stdout


class RenderGate:
    """Lets `slots` lesson renders run at once, earliest scene first (so scene 1 is never stuck behind scene 3).
    Urgent renders (a learner's answer, recap or re-explanation) do not wait."""

    def __init__(self) -> None:
        self._cv = threading.Condition()
        self._busy = 0
        self._waiting: list[tuple] = []

    @contextmanager
    def slot(self, rank: tuple, urgent: bool = False, on_wait: Callable[[], None] | None = None):
        if urgent:
            yield
            return
        slots = get_settings().render_slots_effective
        with self._cv:
            self._waiting.append(rank)
            told = False
            while self._busy >= slots or min(self._waiting) != rank:
                if on_wait and not told:
                    told = True
                    on_wait()
                self._cv.wait(1.0)
            self._waiting.remove(rank)
            self._busy += 1
        try:
            yield
        finally:
            with self._cv:
                self._busy -= 1
                self._cv.notify_all()


RENDER_GATE = RenderGate()


def fix_spec(spec: dict) -> dict:
    """Repair layout problems in code (renderer `fix`): {spec, issues (left), before (count), changes}."""
    return json.loads(run_renderer(["fix", "--spec", "-"], stdin=json.dumps(spec).encode()))


MAX_SPEEDUP = 1.12  # faster than this and the narrator starts to sound hurried


def narration_seconds(clips: list[array.array]) -> float:
    return LEAD_IN + sum(len(c) for c in clips) / NARRATION_RATE + SENTENCE_GAP * max(0, len(clips) - 1) + TAIL


def fit_to_length(clips: list[array.array], target: float, slack: float = 1.15) -> tuple[list[array.array], float]:
    """Keep a scene near its planned length without rewriting it: when the narration runs more than `slack` over,
    speak up to 12% faster (pitch kept, ffmpeg atempo). Beyond that the scene simply runs long."""
    total = narration_seconds(clips)
    if target <= 0 or total <= target * slack:
        return clips, 1.0
    speech = sum(len(c) for c in clips) / NARRATION_RATE
    fixed = total - speech
    factor = min(MAX_SPEEDUP, speech / max(1.0, target - fixed))
    if factor <= 1.01:
        return clips, 1.0
    return [time_stretch(c, factor) for c in clips], round(factor, 3)


def time_stretch(pcm: array.array, factor: float) -> array.array:
    s = get_settings()
    p = subprocess.run(
        [s.ffmpeg_bin, "-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", str(NARRATION_RATE), "-ac", "1", "-i", "pipe:0",
         "-filter:a", f"atempo={factor:.4f}", "-f", "s16le", "-ar", str(NARRATION_RATE), "-ac", "1", "pipe:1"],
        input=pcm.tobytes(), capture_output=True, check=True,
    )
    out = array.array("h")
    out.frombytes(p.stdout[: len(p.stdout) // 2 * 2])
    return out


def lint_spec(spec: dict) -> list[dict]:
    out = run_renderer(["lint", "--spec", "-"], stdin=json.dumps(spec).encode())
    return json.loads(out)["issues"]


def still(spec: dict, t: float, out_path: Path) -> None:
    run_renderer(["still", "--spec", "-", "--t", str(t), "--out", str(out_path)], stdin=json.dumps(spec).encode())


def bed_expr(level: float) -> str:
    # A quiet, slowly breathing A-major pad. Deterministic; Lyria can replace this later.
    return (
        f"{level}*0.33*(sin(2*PI*110*t)+0.6*sin(2*PI*164.81*t)+0.45*sin(2*PI*220*t)+0.3*sin(2*PI*277.18*t))"
        "*(0.6+0.4*sin(2*PI*0.06*t+1.3))"
    )


def _grade(spec: dict) -> str:
    """The film finish for the kit (tokens.finish), as an ffmpeg filter chain on [0:v]: halation (a blurred copy
    screened back), the colour grade, a vignette and temporal film grain. Done here because the encoder does it in
    C at a few ms a frame, where reading the canvas back in the renderer cost ~100 ms."""
    try:
        from . import kit as _kit

        f = dict(_kit.tokens(spec.get("kit") or _kit.DEFAULT_KIT).get("finish", {}))
    except Exception:
        f = {}
    chain: list[str] = []
    bloom = float(f.get("bloom", 0) or 0)
    pre = ""
    if bloom > 0:
        st = get_settings()
        pre = (f"split=2[fa][fb];[fb]scale=iw/4:ih/4,gblur=sigma=3.5,scale={st.render_width}:{st.render_height}:flags=bilinear[fbl];"
               f"[fa][fbl]blend=all_mode=screen:all_opacity={bloom:.3f}")
    if str(f.get("ffmpeg", "")).strip():
        chain.append(str(f["ffmpeg"]).strip())
    vig = float(f.get("vignette", 0) or 0)
    if vig > 0:
        chain.append(f"vignette=angle={0.35 + vig:.3f}")
    grain = float(f.get("grain", 0) or 0)
    if grain > 0:
        chain.append(f"noise=alls={max(1, round(grain * 140))}:allf=t")
    body = ",".join(chain)
    if pre:
        return pre + ("," + body if body else "")
    return body or "null"


def encode_scene(
    spec: dict,
    narration_wav: Path,
    out_path: Path,
    keyframes: list[float],
    music_level: float = 0.08,
    on_progress: Callable[[float], None] | None = None,
    sfx_wav: Path | None = None,
) -> list[float]:
    """Render frames (node, over TCP) + mix narration with a ducked bed + encode fMP4 (CMAF-style).

    Uniform encode profile for every clip so MSE can splice them: H.264 Main@3.1 without
    B-frames, AAC-LC 48 kHz stereo, keyframes every second and at every sentence start,
    one fragment per keyframe."""
    s = get_settings()
    w, h, fps = s.render_width, s.render_height, s.render_fps
    dur = float(spec["duration"])
    port = _free_port()
    frames = sorted({0, *[round(k * fps) for k in keyframes if 0 <= k < dur], *[i * fps for i in range(1, int(dur) + 1) if i < dur]})
    # ffmpeg keys the first frame with pts >= the given time; aim half a frame early so rounding
    # can never push a keyframe onto the next frame.
    kf_arg = ",".join("0" if f == 0 else f"{(f - 0.5) / fps:.5f}" for f in frames)
    kf = [round(f / fps, 4) for f in frames]
    afade_out = max(0.0, dur - 0.6)
    filt = (
        f"[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=0:{dur},asplit=2[nar][sc];"
        f"[2:a]aformat=sample_fmts=fltp:channel_layouts=stereo,lowpass=f=1200,afade=t=in:d=0.6,afade=t=out:st={afade_out}:d=0.6[bed0];"
        f"[bed0][sc]sidechaincompress=threshold=0.015:ratio=8:attack=15:release=350[bed];"
        + (f"[3:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=0:{dur}[fx];"
           f"[nar][bed][fx]amix=inputs=3:normalize=0,alimiter=limit=0.95[aout];" if sfx_wav else
           f"[nar][bed]amix=inputs=2:normalize=0,alimiter=limit=0.95[aout];")
        + 
        f"[0:v]{_grade(spec)}[vout]"
    )
    cmd = [
        s.ffmpeg_bin, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{w}x{h}", "-r", str(fps), "-i", f"tcp://127.0.0.1:{port}?listen=1",
        "-i", str(narration_wav),
        "-f", "lavfi", "-i", f"aevalsrc={bed_expr(music_level)}:s=48000:c=stereo:d={dur}",
        *(["-i", str(sfx_wav)] if sfx_wav else []),
        "-filter_complex", filt,
        "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "main", "-level", "3.1", "-pix_fmt", "yuv420p",
        "-crf", "23", "-bf", "0", "-g", "600", "-sc_threshold", "0", "-force_key_frames", kf_arg,
        "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
        "-t", f"{dur}",
        "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
        "-f", "mp4", str(out_path),
    ]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    ff = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    node = subprocess.Popen(
        renderer_cli() + ["frames", "--spec", "-", "--width", str(w), "--height", str(h), "--fps", str(fps), "--tcp", f"127.0.0.1:{port}", "--progress",
                          "--workers", str(s.render_threads_effective)],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
    )
    node_err: list[str] = []

    def read_progress():
        assert node.stderr is not None
        for line in iter(node.stderr.readline, b""):
            txt = line.decode(errors="replace").strip()
            if txt.startswith("progress ") and on_progress:
                try:
                    on_progress(float(txt.split()[1]))
                except ValueError:
                    pass
            elif txt:
                node_err.append(txt)

    th = threading.Thread(target=read_progress, daemon=True)
    th.start()
    assert node.stdin is not None
    node.stdin.write(json.dumps(spec).encode())
    node.stdin.close()
    node.wait(timeout=1800)
    th.join(timeout=5)
    try:
        _, ff_err = ff.communicate(timeout=300)
    except subprocess.TimeoutExpired:
        ff.kill()
        raise RuntimeError("ffmpeg timed out")
    if node.returncode != 0:
        ff.kill()
        raise RuntimeError("renderer failed: " + "\n".join(node_err[-20:]))
    if ff.returncode != 0:
        raise RuntimeError("ffmpeg failed: " + ff_err.decode(errors="replace")[-2000:])
    return kf


# ───────────────────────────── fMP4 index ─────────────────────────────


def _boxes(buf: bytes, start: int = 0, end: int | None = None):
    end = len(buf) if end is None else end
    i = start
    while i + 8 <= end:
        size, typ = struct.unpack(">I4s", buf[i : i + 8])
        hdr = 8
        if size == 1:
            size = struct.unpack(">Q", buf[i + 8 : i + 16])[0]
            hdr = 16
        elif size == 0:
            size = end - i
        if size < hdr:
            break
        yield typ.decode("latin-1"), i, i + hdr, i + size
        i += size


def _child(buf: bytes, start: int, end: int, path: list[str]):
    for typ, b0, c0, b1 in _boxes(buf, start, end):
        if typ == path[0]:
            if len(path) == 1:
                return b0, c0, b1
            return _child(buf, c0, b1, path[1:])
    return None


def index_fmp4(path: Path) -> dict:
    """Split an fMP4 into the init segment and (moof+mdat) fragments with their start times."""
    buf = path.read_bytes()
    tracks: dict[int, dict] = {}
    init_end = None
    frags: list[dict] = []
    codec = None
    for typ, b0, c0, b1 in _boxes(buf):
        if typ == "moov":
            for t2, _, tc0, tb1 in _boxes(buf, c0, b1):
                if t2 != "trak":
                    continue
                tkhd = _child(buf, tc0, tb1, ["tkhd"])
                mdhd = _child(buf, tc0, tb1, ["mdia", "mdhd"])
                hdlr = _child(buf, tc0, tb1, ["mdia", "hdlr"])
                if not (tkhd and mdhd and hdlr):
                    continue
                v = buf[tkhd[1]]
                tid = struct.unpack(">I", buf[tkhd[1] + (20 if v == 1 else 12) : tkhd[1] + (24 if v == 1 else 16)])[0]
                mv = buf[mdhd[1]]
                ts = struct.unpack(">I", buf[mdhd[1] + (20 if mv == 1 else 12) : mdhd[1] + (24 if mv == 1 else 16)])[0]
                handler = buf[hdlr[1] + 8 : hdlr[1] + 12].decode("latin-1")
                tracks[tid] = {"timescale": ts, "handler": handler}
                if handler == "vide":
                    avcc = _child(buf, tc0, tb1, ["mdia", "minf", "stbl", "stsd"])
                    if avcc:
                        j = buf.find(b"avcC", avcc[1], avcc[2])
                        if j > 0:
                            p, c, l = buf[j + 5], buf[j + 6], buf[j + 7]
                            codec = f"avc1.{p:02X}{c:02X}{l:02X}"
        elif typ == "moof":
            if init_end is None:
                init_end = b0
            t0 = None
            for t2, _, tc0, tb1 in _boxes(buf, c0, b1):
                if t2 != "traf":
                    continue
                tfhd = _child(buf, tc0, tb1, ["tfhd"])
                tfdt = _child(buf, tc0, tb1, ["tfdt"])
                if not (tfhd and tfdt):
                    continue
                tid = struct.unpack(">I", buf[tfhd[1] + 4 : tfhd[1] + 8])[0]
                ver = buf[tfdt[1]]
                base = struct.unpack(">Q", buf[tfdt[1] + 4 : tfdt[1] + 12])[0] if ver == 1 else struct.unpack(">I", buf[tfdt[1] + 4 : tfdt[1] + 8])[0]
                tr = tracks.get(tid)
                if tr and tr["handler"] == "vide":
                    t0 = base / tr["timescale"]
            frags.append({"start": round(t0 or 0.0, 4), "offset": b0, "size": None})
        elif typ == "mdat" and frags and frags[-1]["size"] is None:
            frags[-1]["size"] = b1 - frags[-1]["offset"]
    if init_end is None:
        raise ValueError("not a fragmented mp4")
    return {"init_size": init_end, "fragments": [[f["start"], f["offset"], f["size"]] for f in frags if f["size"]], "codec": codec or "avc1.4D401F"}
