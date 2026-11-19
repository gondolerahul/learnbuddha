// renderScene(ctx, spec, t): the single deterministic entry point.
import type { CameraKey, Component, Ctx, Env, Rect, SceneElement, SceneSpec, Tokens } from "./types";
import { BulletReveal, Callout, Counter, EquationWrite, Heading, RecapCard, Table, Text, TitleCard } from "./components/text";
import { Arrow, Box, CircleHighlight, Flow, MarkerHighlight, Underline } from "./components/marks";
import { AxesPlot, BarChart, NumberLine } from "./components/charts";
import { ProgressBar, SideBySide } from "./components/layout";
import { Body, Guide, Journey, Label, Landscape, Nephron, Particles, Prop, Tube } from "./components/art";
import { Epithelium } from "./components/cellbio";
import { clamp, ease, hash, lerp, num, rng } from "./util";
import { EASE_IN, inertia, smoothNoise, spring, SPRINGS } from "./motion";
import { textureTile } from "./art/texture";
import { ensureShots, isMoving, MOVE_DUR, moveEase, shakeAt } from "./camera";
import { applyTransitions, setPaperPainter, Transition } from "./components/transition";
import { Cell, Synapse } from "./components/sets/bio";
import { Molecule, Reaction } from "./components/sets/chem";
import { Orbits } from "./components/sets/space";
import { Circuit, Machine } from "./components/sets/mech";
import { Timeline, WorldMap } from "./components/sets/history";
import { Bars, Stamp, TokenGrid } from "./components/sets/data";
import { Contraption } from "./components/sets/contraption";
import { restoreActiveKit, setActiveKit } from "./ink";
import { boilPose } from "./art/paint";

export interface RenderOptions {
  tokens: Tokens;
  makeCanvas: (w: number, h: number) => any;
  /** Output pixel width/height; drawing happens in logical space and is scaled. */
  width?: number;
  height?: number;
  /** Collect layout warnings (lint mode). */
  onWarn?: (id: string, msg: string) => void;
  /** Resolves a kit id to tokens (needed for FrozenFrame of another kit). */
  kits?: Record<string, Tokens>;
  depth?: number;
}

/** Backdrop: re-renders another scene at a frozen time, then dims/zooms it. */
const FrozenFrame: Component = {
  inDur: () => 0.8,
  bounds: () => null,
  draw: (env, p, ph) => {
    if (!p.spec || env.depth > 2) return;
    const { ctx, tokens } = env;
    const W = tokens.canvas.width;
    const H = tokens.canvas.height;
    const hold = num(p.hold, 0.6);
    const k = ease.inOut(clamp((ph.local - hold) / 0.9));
    const zoom = lerp(1, num(p.zoom, 1), k);
    const cx = num(p.cx, W / 2);
    const cy = num(p.cy, H / 2);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-lerp(W / 2, cx, k), -lerp(H / 2, cy, k));
    drawScene(ctx, p.spec as SceneSpec, num(p.t, 0), {
      tokens: env.tokens,
      makeCanvas: env.makeCanvas,
      depth: env.depth + 1,
    });
    ctx.restore();
    const dim = num(p.dim, 0.8) * k;
    if (dim > 0) {
      ctx.save();
      ctx.globalAlpha = dim;
      ctx.fillStyle = tokens.colors.paper;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  },
};

export const COMPONENTS: Record<string, Component> = {
  TitleCard, Heading, Text, EquationWrite, BulletReveal, Callout, Counter, Table, RecapCard,
  Underline, CircleHighlight, MarkerHighlight, Arrow, Box, Flow,
  AxesPlot, NumberLine, BarChart,
  SideBySide, ProgressBar, FrozenFrame,
  Prop, Particles, Tube, Journey, Label, Guide, Landscape, Nephron, Body, Epithelium, Transition,
  Synapse, Cell, Molecule, Reaction, Orbits, Machine, Circuit, Timeline, WorldMap, TokenGrid, Bars, Stamp, Contraption,
};

setPaperPainter((ctx, env) => drawPaper(ctx, env.tokens, env.makeCanvas));

/** Full-frame backdrops: exempt from the out-of-frame lint. */
export const BACKDROPS = new Set(["Landscape", "Timeline"]);
/** Sets that may be larger than the frame: the camera may travel over all of them. */
export const WORLD_SETS = new Set(["Timeline", "WorldMap"]);

interface Xf { dx: number; dy: number; scale: number; rotate: number; opacity: number }

/** Generic `motion` keyframes (any element): each key starts a move at `at`, lasting `dur` (default 1.2 s). */
function motionAt(el: SceneElement, t: number, center: [number, number] | null): Xf | null {
  const keys = Array.isArray(el.props?.motion) ? el.props.motion.filter((k: any) => typeof k?.at === "number").sort((a: any, b: any) => a.at - b.at) : [];
  if (!keys.length) return null;
  let cur: Xf = { dx: 0, dy: 0, scale: 1, rotate: 0, opacity: 1 };
  for (const k of keys) {
    if (t < k.at) break;
    const tgt: Xf = {
      dx: typeof k.x === "number" && center ? k.x - center[0] : num(k.dx, cur.dx),
      dy: typeof k.y === "number" && center ? k.y - center[1] : num(k.dy, cur.dy),
      scale: num(k.scale, cur.scale),
      rotate: num(k.rotate, cur.rotate),
      opacity: num(k.opacity, cur.opacity),
    };
    const e = ease.inOut(clamp((t - k.at) / Math.max(0.05, num(k.dur, 1.2))));
    cur = { dx: lerp(cur.dx, tgt.dx, e), dy: lerp(cur.dy, tgt.dy, e), scale: lerp(cur.scale, tgt.scale, e), rotate: lerp(cur.rotate, tgt.rotate, e), opacity: lerp(cur.opacity, tgt.opacity, e) };
  }
  return cur;
}

/** Idle loops for any element: bob | float | pulse | breathe | spin | sway | shake. */
function loopAt(kind: string | undefined, local: number, speed = 1): Xf | null {
  if (!kind) return null;
  const s = local * speed;
  const id: Xf = { dx: 0, dy: 0, scale: 1, rotate: 0, opacity: 1 };
  switch (kind) {
    case "bob": return { ...id, dy: Math.sin(s * 2.4) * 6 };
    case "float": return { ...id, dy: Math.sin(s * 1.2) * 10, dx: Math.sin(s * 0.7) * 6 };
    case "pulse": return { ...id, scale: 1 + 0.06 * Math.sin(s * 4) };
    case "breathe": return { ...id, scale: 1 + 0.04 * Math.sin(s * 1.6) };
    case "spin": return { ...id, rotate: (s * 40) % 360 };
    case "sway": return { ...id, rotate: Math.sin(s * 1.5) * 6 };
    case "shake": return { ...id, dx: Math.sin(s * 40) * 3 };
    default: return null;
  }
}

const grainCache = new WeakMap<object, Map<string, any>>();

function grainTile(env: { makeCanvas: RenderOptions["makeCanvas"]; tokens: Tokens }) {
  let m = grainCache.get(env.makeCanvas);
  if (!m) {
    m = new Map();
    grainCache.set(env.makeCanvas, m);
  }
  const key = env.tokens.id;
  if (m.has(key)) return m.get(key);
  const size = 160;
  const c = env.makeCanvas(size, size);
  const g = c.getContext("2d") as Ctx;
  const img = g.createImageData(size, size);
  const r = rng(hash("grain:" + key));
  for (let i = 0; i < size * size; i++) {
    const v = r();
    const dark = v < 0.5;
    const a = Math.floor(Math.abs(v - 0.5) * 2 * 255 * env.tokens.grain * 2.2);
    img.data[i * 4] = dark ? 60 : 255;
    img.data[i * 4 + 1] = dark ? 45 : 250;
    img.data[i * 4 + 2] = dark ? 30 : 240;
    img.data[i * 4 + 3] = a;
  }
  g.putImageData(img, 0, 0);
  m.set(key, c);
  return c;
}

const paperCache = new Map<string, any>();

/** The paper never changes: paint it once per kit and output size, then blit it. */
function drawPaper(ctx: Ctx, tokens: Tokens, makeCanvas: RenderOptions["makeCanvas"]) {
  const m = ctx.getTransform();
  const ow = Math.round(tokens.canvas.width * Math.abs(m.a)), oh = Math.round(tokens.canvas.height * Math.abs(m.d));
  if (Math.abs(m.b) > 1e-6 || Math.abs(m.c) > 1e-6 || ow < 8 || oh < 8) return paintPaper(ctx, tokens, makeCanvas);
  const key = `${tokens.id}|${ow}x${oh}`;
  let c = paperCache.get(key);
  if (!c) {
    c = makeCanvas(ow, oh);
    const g = c.getContext("2d") as Ctx;
    g.scale(ow / tokens.canvas.width, oh / tokens.canvas.height);
    paintPaper(g, tokens, makeCanvas);
    if (paperCache.size > 8) paperCache.clear();
    paperCache.set(key, c);
  }
  ctx.drawImage(c, 0, 0, tokens.canvas.width, tokens.canvas.height);
}

/** The surface the lesson is drawn on (tokens.paper.kind): plain paper, chalkboard, blueprint grid, a dark set,
 *  fibred paper, cold-pressed watercolour paper or halftone print paper. Painted once per kit and cached. */
function paintSurface(ctx: Ctx, tokens: Tokens, makeCanvas: RenderOptions["makeCanvas"]) {
  const W = tokens.canvas.width;
  const H = tokens.canvas.height;
  const pp: any = (tokens as any).paper ?? {};
  const r = rng(hash("surface:" + tokens.id));
  const kind = String(pp.kind ?? "plain");
  const light = String(pp.mark ?? "255,255,255");
  ctx.save();
  if (kind === "board") {
    // chalk dust and the ghosts of erased lessons
    for (let i = 0; i < 36; i++) {
      const x = r() * W, y = r() * H, rad = 80 + r() * 260;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, `rgba(${light},${0.025 + r() * 0.035})`);
      g.addColorStop(1, `rgba(${light},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    ctx.strokeStyle = `rgba(${light},0.035)`;
    ctx.lineCap = "round";
    for (let i = 0; i < 9; i++) {
      ctx.lineWidth = 40 + r() * 50;
      const x = r() * W, y = r() * H;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + 200 * (r() - 0.5), y - 120 * r(), x + 400 * r(), y + 100 * (r() - 0.5), x + 300 + 300 * r(), y + 60 * (r() - 0.5));
      ctx.stroke();
    }
  } else if (kind === "grid") {
    const minor = num(pp.minor, 24), major = num(pp.major, 120);
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += minor) {
      ctx.strokeStyle = `rgba(${light},${x % major === 0 ? 0.16 : 0.07})`;
      ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke();
    }
    for (let y = 0; y <= H; y += minor) {
      ctx.strokeStyle = `rgba(${light},${y % major === 0 ? 0.16 : 0.07})`;
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke();
    }
    // sheet border and title block
    ctx.strokeStyle = `rgba(${light},0.45)`;
    ctx.lineWidth = 2;
    ctx.strokeRect(20, 20, W - 40, H - 40);
    ctx.lineWidth = 1;
    ctx.strokeRect(W - 300, H - 70, 280, 50);
    ctx.beginPath(); ctx.moveTo(W - 300, H - 45); ctx.lineTo(W - 20, H - 45); ctx.moveTo(W - 160, H - 70); ctx.lineTo(W - 160, H - 20); ctx.stroke();
  } else if (kind === "dark") {
    const g = ctx.createRadialGradient(W * 0.5, H * 0.42, 40, W * 0.5, H * 0.5, W * 0.75);
    g.addColorStop(0, tokens.colors.paperShade);
    g.addColorStop(1, tokens.colors.paper);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    if (pp.stars !== false) {
      for (let i = 0; i < 140; i++) {
        ctx.globalAlpha = 0.08 + r() ** 2 * 0.5;
        ctx.fillStyle = "#FFFFFF";
        ctx.beginPath();
        ctx.arc(r() * W, r() * H, 0.4 + r() ** 4 * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  } else if (kind === "rice") {
    // rice paper: long fibres, a few warm mottles where the sheet took more moisture
    for (let i = 0; i < 9; i++) {
      const x = r() * W, y = r() * H, rad = 180 + r() * 320;
      const g = ctx.createRadialGradient(x, y, rad * 0.1, x, y, rad);
      g.addColorStop(0, `rgba(170,140,100,${0.035 + r() * 0.03})`);
      g.addColorStop(1, "rgba(170,140,100,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    const pat = ctx.createPattern(textureTile({ makeCanvas, tokens } as any, "fibre"), "repeat");
    if (pat) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  } else if (kind === "dots") {
    // a quiet dot grid, the drafting surface of a motion designer
    ctx.fillStyle = `rgba(${pp.mark ?? "30,40,60"},0.11)`;
    for (let y = 24; y < H; y += 32) for (let x = 24; x < W; x += 32) {
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === "shadowbox") {
    // the back of a paper theatre: a lamp from the upper left, falling off to the corners, and the box's own walls
    const lamp = ctx.createRadialGradient(W * 0.32, H * 0.18, 40, W * 0.45, H * 0.4, W * 0.85);
    lamp.addColorStop(0, "rgba(255,236,200,0.22)");
    lamp.addColorStop(0.55, "rgba(255,236,200,0.06)");
    lamp.addColorStop(1, "rgba(0,0,0,0.25)");
    ctx.fillStyle = lamp;
    ctx.fillRect(0, 0, W, H);
    const pat = ctx.createPattern(textureTile({ makeCanvas, tokens } as any, "fibre"), "repeat");
    if (pat) {
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    // the box's walls: each edge in a little shadow
    for (const [x0, y0, x1, y1] of [[0, 0, 0, 46], [0, H, 0, H - 46], [0, 0, 46, 0], [W, 0, W - 46, 0]] as const) {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, "rgba(0,0,0,0.3)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  } else if (kind === "clinical") {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, tokens.colors.paper);
    g.addColorStop(1, tokens.colors.paperShade);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(40,60,90,0.035)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke(); }
  } else if (kind === "riso") {
    // uncoated stock: speckle, and the faint bands the drum leaves across the sheet
    const pat = ctx.createPattern(textureTile({ makeCanvas, tokens } as any, "riso"), "repeat");
    if (pat) {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    for (let i = 0; i < 6; i++) {
      const y = r() * H, h = 30 + r() * 90;
      ctx.fillStyle = `rgba(60,40,30,${0.012 + r() * 0.018})`;
      ctx.fillRect(0, y, W, h);
    }
  } else if (kind === "wash") {
    // a picture-book page: a few big soft washes of warm colour
    for (let i = 0; i < 6; i++) {
      const x = r() * W, y = r() * H, rad = 220 + r() * 320;
      const g = ctx.createRadialGradient(x, y, rad * 0.15, x, y, rad);
      g.addColorStop(0, `rgba(${pp.wash ?? "255,214,160"},${0.07 + r() * 0.05})`);
      g.addColorStop(1, `rgba(${pp.wash ?? "255,214,160"},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  } else if (kind === "fibre" || kind === "coldpress" || kind === "halftone") {
    const tile = textureTile({ makeCanvas, tokens } as any, kind === "fibre" ? "fibre" : kind === "coldpress" ? "granulation" : "halftone");
    const pat = ctx.createPattern(tile, "repeat");
    if (pat) {
      ctx.globalAlpha = kind === "fibre" ? 0.6 : kind === "coldpress" ? 0.45 : 0.045;
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    if (kind === "coldpress") {
      // faint washes laid on the page before the lesson
      for (let i = 0; i < 7; i++) {
        const x = r() * W, y = r() * H, rad = 160 + r() * 260;
        const g = ctx.createRadialGradient(x, y, rad * 0.2, x, y, rad);
        g.addColorStop(0, `rgba(${pp.wash ?? "140,170,190"},0.05)`);
        g.addColorStop(1, `rgba(${pp.wash ?? "140,170,190"},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
    }
  }
  ctx.restore();
}

function paintPaper(ctx: Ctx, tokens: Tokens, makeCanvas: RenderOptions["makeCanvas"]) {
  const W = tokens.canvas.width;
  const H = tokens.canvas.height;
  ctx.fillStyle = tokens.colors.paper;
  ctx.fillRect(0, 0, W, H);
  paintSurface(ctx, tokens, makeCanvas);
  if (tokens.grain > 0) {
    const tile = grainTile({ makeCanvas, tokens });
    const pat = ctx.createPattern(tile, "repeat");
    if (pat) {
      ctx.save();
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }
  if (tokens.vignette > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(${(tokens as any).paper?.vignetteColor ?? "60,40,20"},${tokens.vignette})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}

/**
 * The camera at time t. Each key starts a move at its `t` that lasts `dur` (default 1.6 s) with inertia easing
 * (cinecode camera-moves.md), so a sequence of keys flows like an operator's moves. On top, unless the scene
 * locks it (`spec.cameraLife: false`), the camera is never dead: a slow push over the whole scene and a
 * low-frequency drift sized by the kit (tokens.camera).
 */
export function cameraAt(spec: SceneSpec, t: number, tokens: Tokens): CameraKey & { focus: number; dof: number } {
  const W = tokens.canvas.width;
  const H = tokens.canvas.height;
  const keys = (spec.camera ?? []).filter((k) => typeof k.t === "number" && typeof k.x === "number").sort((a, b) => a.t - b.t);
  let x = W / 2, y = H / 2, zoom = 1, focus = 0, dof = 0;
  let sx = 0, sy = 0;
  for (const k of keys) {
    if (t < k.t) break;
    const move = (k as any).move as string | undefined;
    const dur = move ? Math.max(0, num(k.dur, MOVE_DUR[move as keyof typeof MOVE_DUR] ?? 1.6)) : Math.max(0.2, num(k.dur, 1.6));
    // keys written as raw x/y/zoom keep the original inertia curve; named moves settle (or whip, or dive)
    const e = dur <= 0.001 ? 1 : (move ? moveEase(move) : inertia)(clamp((t - k.t) / dur));
    x = lerp(x, num(k.x, x), e);
    y = lerp(y, num(k.y, y), e);
    // zoom in log space: the same apparent speed at every scale
    const z1 = Math.max(0.2, num(k.zoom, zoom));
    zoom = Math.exp(lerp(Math.log(Math.max(0.2, zoom)), Math.log(z1), e));
    focus = lerp(focus, num(k.focus, focus), e);
    dof = lerp(dof, num(k.dof, dof), e);
    const amp = num((k as any).shake, 0);
    if (amp > 0) {
      const [dx, dy] = shakeAt(t, k.t, amp);
      sx += dx;
      sy += dy;
    }
  }
  const life = (tokens as any).camera ?? {};
  if ((spec as any).cameraLife !== false) {
    // legacy kits: a slow push over the scene and an operator's drift. Rebuilt kits leave both at 0 so rests are
    // still, and may ask for a small handheld float instead.
    const push = num(life.push, 0.03);
    if (push) zoom *= 1 + push * clamp(t / Math.max(1, spec.duration));
    const drift = num(life.drift, 4) + num(life.handheld, 0);
    if (drift) {
      x += smoothNoise(t * 0.22, 11) * drift;
      y += smoothNoise(t * 0.18, 23) * drift * 0.6;
    }
  }
  return { t, x: x + sx / zoom, y: y + sy / zoom, zoom, focus, dof };
}

/** How fast the frame moves at t, in output px per frame (for motion blur). */
export function cameraSpeed(spec: SceneSpec, t: number, tokens: Tokens, fps: number): number {
  const dt = 1 / fps;
  const a = cameraAt(spec, Math.max(0, t - dt / 2), tokens), b = cameraAt(spec, t + dt / 2, tokens);
  const W = tokens.canvas.width, H = tokens.canvas.height;
  const pan = Math.hypot((b.x - a.x) * b.zoom, (b.y - a.y) * b.zoom);
  const scale = Math.abs(Math.log(b.zoom / a.zoom)) * Math.hypot(W, H) * 0.5;
  return pan + scale;
}

/** Default depth plane per component type: backdrops sit back, characters forward. */
const DEFAULT_DEPTH: Record<string, number> = { Landscape: -0.7, Guide: 0.35 };

const offscreens = new Map<string, any>();
function offscreen(makeCanvas: (w: number, h: number) => any, w: number, h: number) {
  const key = `${w}x${h}`;
  let c = offscreens.get(key);
  if (!c) {
    c = makeCanvas(w, h);
    offscreens.set(key, c);
  }
  const g = c.getContext("2d") as Ctx;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, w, h);
  return { c, g };
}

/** Kit motion tone → spring parameters for entrances. */
function kitSpring(tokens: Tokens) {
  const name = String((tokens.motion as any).spring ?? "soft");
  return SPRINGS[name] ?? SPRINGS.soft;
}

/** Families that rise into place on a spring (on top of their own write-on or draw-on). */
const RISERS = new Set(["Text", "Heading", "Callout", "Label", "Counter", "Box", "Table", "EquationWrite", "BulletReveal", "SideBySide", "Flow", "AxesPlot", "NumberLine", "BarChart"]);

export function makeEnv(ctx: Ctx, spec: SceneSpec, o: RenderOptions): Env {
  const boundsCache = new Map<string, Rect | null>();
  const resolving = new Set<string>();
  const byId = new Map(spec.elements.map((e) => [e.id, e]));
  const env: Env = {
    ctx,
    tokens: o.tokens,
    spec,
    seed: num(spec.seed, 7),
    makeCanvas: o.makeCanvas,
    depth: o.depth ?? 0,
    warn: (id, msg) => o.onWarn?.(id, msg),
    componentOf: (type: string) => COMPONENTS[type],
    pointOf: (ref) => {
      if (Array.isArray(ref) && ref.length >= 2 && typeof ref[0] === "number") return [ref[0], num(ref[1], 0)];
      if (typeof ref !== "string" || !ref) return null;
      if (!ref.startsWith("frozen.")) {
        const dot = ref.indexOf(".");
        if (dot > 0) {
          const el = byId.get(ref.slice(0, dot));
          const comp = el ? COMPONENTS[el.type] : null;
          const a = comp?.anchors?.(env, el!.props ?? {}, el!)?.[ref.slice(dot + 1)];
          if (a) return a;
        }
      }
      const r = env.boundsOf(ref);
      return r ? [r.x + r.w / 2, r.y + r.h / 2] : null;
    },
    boundsOf: (id) => {
      if (boundsCache.has(id)) return boundsCache.get(id)!;
      if (id.startsWith("frozen.")) {
        // Answer clips may annotate elements of the paused lesson frame (no zoom applied).
        const ff = spec.elements.find((e) => e.type === "FrozenFrame" && e.props?.spec);
        if (!ff || env.depth > 2) return null;
        const inner = makeEnv(ctx, ff.props.spec as SceneSpec, { ...o, depth: env.depth + 1 });
        const r = inner.boundsOf(id.slice("frozen.".length));
        boundsCache.set(id, r);
        return r;
      }
      const el = byId.get(id);
      if (!el || resolving.has(id)) return null;
      const comp = COMPONENTS[el.type];
      if (!comp) return null;
      resolving.add(id);
      let r: Rect | null = null;
      try {
        r = comp.bounds(env, el.props ?? {}, el);
      } finally {
        resolving.delete(id);
      }
      boundsCache.set(id, r);
      return r;
    },
  };
  return env;
}

export function elementDur(env: Env, el: SceneElement) {
  const comp = COMPONENTS[el.type];
  if (typeof el.dur === "number" && el.dur > 0) return el.dur;
  return comp ? Math.max(0.05, comp.inDur(env, el.props ?? {})) : 0.5;
}

/** Draw the scene at time t in logical coordinates (no output scaling). */
export function drawScene(ctx: Ctx, spec: SceneSpec, t: number, o: RenderOptions) {
  const env = makeEnv(ctx, spec, o);
  const tokens = o.tokens;
  applyTransitions(spec, tokens);
  ensureShots(spec, tokens, () => env);
  const prevKit = setActiveKit(tokens, t);
  (env as any).t = t;
  try {
    drawSceneBody(ctx, env, spec, t, o);
  } finally {
    restoreActiveKit(prevKit);
  }
}

function drawSceneBody(ctx: Ctx, env: Env, spec: SceneSpec, tReal: number, o: RenderOptions) {
  let t = tReal;
  const tokens = o.tokens;
  const fade = tokens.motion.fadeOut;
  if (env.depth === 0 || !spec.elements.some((e) => e.type === "FrozenFrame")) drawPaper(ctx, tokens, o.makeCanvas);
  const cam = env.depth === 0 ? cameraAt(spec, t, tokens) : { ...cameraAt({ ...spec, cameraLife: false } as any, t, tokens) };
  const W = tokens.canvas.width;
  const H = tokens.canvas.height;
  const sp = kitSpring(tokens);
  const hold = num((tokens.motion as any).hold, 0);
  if (hold > 0) t = Math.floor(t * hold + 1e-6) / hold; // animated on twos/threes; the camera above keeps every frame
  (env as any).cam = env.depth === 0 ? cam : null; // sets use it to keep their own labels out of the frame edge
  // covers (transitions) go over everything else, whatever order they were written in
  const ordered = [...spec.elements.filter((e) => e.type !== "Transition"), ...spec.elements.filter((e) => e.type === "Transition")];
  for (const el of ordered) {
    const comp = COMPONENTS[el.type];
    if (!comp) {
      env.warn(el.id, `unknown component type '${el.type}'`);
      continue;
    }
    const at = num(el.at, 0);
    if (t < at) continue;
    const until = typeof el.until === "number" ? el.until : Infinity;
    if (t >= until + fade) continue;
    const dur = elementDur(env, el);
    const local = t - at;
    const exitK = t > until ? clamp((t - until) / fade) : 0;
    const alpha = 1 - exitK;
    const depth = num(el.props?.depth, DEFAULT_DEPTH[el.type] ?? 0);
    const blur = env.depth === 0 && !el.fixed && el.type !== "Transition" ? Math.min(14, Math.abs(depth - cam.focus) * cam.dof) : 0;
    let target: Ctx = ctx;
    let layer: { c: any; g: Ctx } | null = null;
    if (blur >= 1.2) {
      const cw = (ctx as any).canvas?.width ?? W, ch = (ctx as any).canvas?.height ?? H;
      layer = offscreen(o.makeCanvas, cw, ch);
      layer.g.setTransform(ctx.getTransform());
      target = layer.g;
    }
    const savedCtx = env.ctx;
    env.ctx = target;
    target.save();
    if (!el.fixed && el.type !== "FrozenFrame" && el.type !== "RecapCard" && el.type !== "ProgressBar" && el.type !== "Transition") {
      // parallax: near planes move and scale more than far ones
      const par = 1 + depth * 0.35;
      const zf = 1 + (cam.zoom - 1) * (1 + depth * 0.6);
      target.translate(W / 2, H / 2);
      target.scale(zf, zf);
      target.translate(-(W / 2 + (cam.x - W / 2) * par), -(H / 2 + (cam.y - H / 2) * par));
    }
    // entrances settle on a spring in the kit's tone; exits drift away with an ease-in
    if (RISERS.has(el.type) && !el.fixed) {
      const rise = (1 - spring(local, sp.zeta, sp.f)) * 16;
      target.translate(0, rise - EASE_IN(exitK) * 10);
    }
    let alphaMul = 1;
    if (Array.isArray(el.props?.motion) || typeof el.props?.loop === "string") {
      const r = env.boundsOf(el.id);
      const c: [number, number] | null = r ? [r.x + r.w / 2, r.y + r.h / 2] : null;
      const m = motionAt(el, t, c);
      const l = local >= dur ? loopAt(el.props?.loop, local - dur, num(el.props?.loopSpeed, 1)) : null;
      const dx = (m?.dx ?? 0) + (l?.dx ?? 0), dy = (m?.dy ?? 0) + (l?.dy ?? 0);
      const sc = (m?.scale ?? 1) * (l?.scale ?? 1), rot = ((m?.rotate ?? 0) + (l?.rotate ?? 0)) * (Math.PI / 180);
      alphaMul = m?.opacity ?? 1;
      const px = c ? c[0] : 0, py = c ? c[1] : 0;
      target.translate(px + dx, py + dy);
      if (rot) target.rotate(rot);
      if (sc !== 1) target.scale(sc, sc);
      target.translate(-px, -py);
    }
    try {
      comp.draw(env, el.props ?? {}, { local, k: clamp(local / dur), dur, alpha: alpha * alphaMul }, el);
    } catch (e) {
      env.warn(el.id, `draw failed: ${(e as Error).message}`);
    }
    target.restore();
    env.ctx = savedCtx;
    if (layer) {
      // depth of field: this plane is out of focus
      const m = ctx.getTransform();
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.filter = `blur(${(blur * Math.abs(m.a)).toFixed(2)}px)`;
      ctx.drawImage(layer.c, 0, 0);
      ctx.restore();
    }
  }
  // stop-motion kits: each new exposure is a touch brighter or darker, as under a real rostrum lamp
  const flicker = num((tokens.motion as any).flicker, 0);
  if (flicker > 0 && env.depth === 0) {
    const pose = Math.floor(tReal * Math.max(1, hold || 12) + 1e-6);
    const v = (rng(hash("flicker" + pose))() * 2 - 1) * flicker;
    if (Math.abs(v) > 0.002) {
      ctx.save();
      ctx.globalAlpha = Math.abs(v);
      ctx.fillStyle = v > 0 ? "#FFF8EC" : "#1A1206";
      ctx.fillRect(-W, -H, W * 3, H * 3);
      ctx.restore();
    }
  }
}

/**
 * The film finish, over the whole frame (cinecode finish.md: chosen per look, never everywhere):
 * halation (a blurred copy screened back, so lights and pale areas bloom softly), a vignette that holds the eye,
 * and film grain re-seeded every frame. The colour grade happens in the encoder (tokens.finish.ffmpeg).
 */
function finishFrame(ctx: Ctx, o: RenderOptions, t: number, ow: number, oh: number) {
  const f: any = (o.tokens as any).finish ?? {};
  const canvas = (ctx as any).canvas;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (num(f.bloom, 0) > 0 && canvas) {
    const sw = Math.max(8, Math.round(ow / 6)), sh = Math.max(8, Math.round(oh / 6));
    let small = finishPool.get(`${sw}x${sh}`);
    if (!small) {
      small = o.makeCanvas(sw, sh);
      finishPool.set(`${sw}x${sh}`, small);
    }
    const sg = small.getContext("2d") as Ctx;
    sg.setTransform(1, 0, 0, 1, 0, 0);
    sg.globalCompositeOperation = "copy";
    sg.filter = "blur(3px)";
    sg.drawImage(canvas, 0, 0, sw, sh);
    sg.filter = "none";
    sg.globalCompositeOperation = "source-over";
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = num(f.bloom, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(small, 0, 0, ow, oh);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
  if (num(f.vignette, 0) > 0) {
    const g = ctx.createRadialGradient(ow / 2, oh * 0.48, Math.min(ow, oh) * 0.38, ow / 2, oh / 2, Math.hypot(ow, oh) * 0.58);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(28,18,10,${num(f.vignette, 0)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, ow, oh);
  }
  if (num(f.grain, 0) > 0) {
    const tile = grainTile({ makeCanvas: o.makeCanvas, tokens: { ...o.tokens, id: o.tokens.id + "-film", grain: num(f.grain, 0) } as Tokens });
    const pat = ctx.createPattern(tile, "repeat");
    if (pat) {
      const fr = Math.floor(t * 24);
      const r = rng(hash("frame" + fr));
      ctx.translate(Math.floor(r() * 160), Math.floor(r() * 160));
      ctx.globalCompositeOperation = "overlay";
      ctx.fillStyle = pat;
      ctx.fillRect(-160, -160, ow + 320, oh + 320);
    }
  }
  ctx.restore();
}

const finishPool = new Map<string, any>();

const blurPool = new Map<string, any>();

/** Render at output resolution: scales logical canvas to width/height, then applies the film finish. */
export function renderScene(ctx: Ctx, spec: SceneSpec, t: number, o: RenderOptions & { finish?: boolean; fps?: number; motionBlur?: boolean }) {
  const W = o.tokens.canvas.width;
  const H = o.tokens.canvas.height;
  const ow = o.width ?? W;
  const oh = o.height ?? H;
  const fps = o.fps ?? 24;
  // Fast camera moves are exposed through an open shutter (180°): several sub-frames averaged, so a whip pan smears
  // instead of strobing. Only frames that move fast pay for it.
  const speed = o.motionBlur === false || (o.depth ?? 0) ? 0 : cameraSpeed(spec, t, o.tokens, fps) * (ow / W);
  if (speed > 28) {
    const n = speed > 110 ? 6 : speed > 55 ? 4 : 3;
    const shutter = 0.5 / fps;
    const key = `${ow}x${oh}`;
    let scratch = blurPool.get(key);
    if (!scratch) {
      scratch = o.makeCanvas(ow, oh);
      blurPool.set(key, scratch);
    }
    const g = scratch.getContext("2d") as Ctx;
    for (let i = 0; i < n; i++) {
      const tt = Math.max(0, t + ((i + 0.5) / n - 0.5) * shutter);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.scale(ow / W, oh / H);
      drawScene(g, spec, tt, o);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1 / (i + 1); // a running mean of the sub-frames
      ctx.drawImage(scratch, 0, 0);
      ctx.restore();
      // the canvas defers drawing until pixels are read: force this one before the scratch is drawn into again
      ctx.getImageData(0, 0, 1, 1);
    }
  } else {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(ow / W, oh / H);
    drawScene(ctx, spec, t, o);
    ctx.restore();
  }
  // Video frames are finished by the encoder (halation, vignette, grain, grade: backend media._finish), which is
  // ~30× faster than reading the canvas back here. Previews may opt in.
  if (o.finish === true && !(o.depth ?? 0)) finishFrame(ctx, o, t, ow, oh);
}

export const TEXTY = new Set(["Text", "EquationWrite", "BulletReveal", "Callout", "Heading", "TitleCard", "Table", "SideBySide", "Counter", "Box", "Flow", "AxesPlot", "NumberLine", "BarChart", "Label", "Stamp"]);
// illustrations text must not sit on (their inner part, so labels may touch the edges)
export const PICTURES = new Set(["Prop", "Guide", "Epithelium", "Nephron", "Body", "Molecule", "Reaction", "Orbits", "Circuit", "Machine", "TokenGrid"]); // Tube: by its stroke (parts)
const CAMERA_MUST_SHOW = new Set(["Arrow"]);

export interface PictureBox {
  id: string;
  owner: SceneElement;
  r: Rect;
  from: number;
  to: number;
}

/** Picture boxes text must keep clear of: illustrations (inner part) and the pictures inside backdrops (a landscape's sun, trees). */
export function pictureRects(env: Env, spec: SceneSpec): PictureBox[] {
  const out: PictureBox[] = [];
  const shrink = (r: Rect, f: number): Rect => ({ x: r.x + r.w * f, y: r.y + r.h * f, w: r.w * (1 - 2 * f), h: r.h * (1 - 2 * f) });
  for (const el of spec.elements) {
    const comp = COMPONENTS[el.type];
    if (!comp) continue;
    const to = typeof el.until === "number" ? el.until : spec.duration;
    if (PICTURES.has(el.type)) {
      const r = env.boundsOf(el.id);
      if (r) out.push({ id: el.id, owner: el, r: shrink(r, el.type === "Prop" || el.type === "Guide" ? 0.08 : 0.18), from: el.at, to });
    }
    for (const part of comp.parts?.(env, el.props ?? {}, el) ?? []) out.push({ id: `${el.id}.${part.name}`, owner: el, r: part.rect, from: el.at, to });
  }
  return out;
}

/** An element's box on screen at time t, after the camera (and its depth plane's parallax). Fixed elements ignore the camera. */
export function screenRect(spec: SceneSpec, tokens: Tokens, el: SceneElement, r: Rect, t: number): Rect {
  if (el.fixed) return r;
  const W = tokens.canvas.width, H = tokens.canvas.height;
  const cam = cameraAt(spec, t, tokens); // the exact camera the renderer uses, slow push and drift included
  const depth = num(el.props?.depth, DEFAULT_DEPTH[el.type] ?? 0);
  const par = 1 + depth * 0.35;
  const zf = 1 + (cam.zoom - 1) * (1 + depth * 0.6);
  const ox = W / 2 + (cam.x - W / 2) * par, oy = H / 2 + (cam.y - H / 2) * par;
  return { x: (r.x - ox) * zf + W / 2, y: (r.y - oy) * zf + H / 2, w: r.w * zf, h: r.h * zf };
}

/** Where a screen box lands in the element's own (logical) coordinates at time t: the inverse of screenRect. */
export function logicalRect(spec: SceneSpec, tokens: Tokens, el: SceneElement, r: Rect, t: number): Rect {
  if (el.fixed) return r;
  const W = tokens.canvas.width, H = tokens.canvas.height;
  const cam = cameraAt(spec, t, tokens); // the exact camera the renderer uses, slow push and drift included
  const depth = num(el.props?.depth, DEFAULT_DEPTH[el.type] ?? 0);
  const par = 1 + depth * 0.35;
  const zf = 1 + (cam.zoom - 1) * (1 + depth * 0.6);
  const ox = W / 2 + (cam.x - W / 2) * par, oy = H / 2 + (cam.y - H / 2) * par;
  return { x: (r.x - W / 2) / zf + ox, y: (r.y - H / 2) / zf + oy, w: r.w / zf, h: r.h / zf };
}

/** Where an element (or "id.anchor" point) is on screen at time t, camera included: the box a tutor's mark is drawn
 *  around on the paused frame. Logical 1280x720 coordinates; null when the element is unknown or has no box. */
export function elementScreenBox(ctx: Ctx, spec: SceneSpec, ref: string, t: number, o: RenderOptions): Rect | null {
  const env = makeEnv(ctx, spec, o);
  const [id, anchor] = ref.split(".");
  const el = spec.elements.find((e) => e.id === id);
  if (!el) return null;
  let r: Rect | null;
  if (anchor) {
    const pt = env.pointOf(ref);
    r = pt ? { x: pt[0] - 18, y: pt[1] - 18, w: 36, h: 36 } : env.boundsOf(id);
  } else r = env.boundsOf(id);
  return r ? screenRect(spec, o.tokens, el, r, t) : null;
}

/** Camera shots in time order (the order lint messages number them in). */
export function cameraShots(spec: SceneSpec) {
  return (spec.camera ?? []).filter((k) => typeof k.t === "number").sort((a, b) => a.t - b.t);
}

export interface LintIssue {
  id: string;
  message: string;
}

/**
 * Deterministic QA: unknown types, out-of-frame boxes, overlapping text that is
 * on screen at the same time, timing outside the scene, and draw errors.
 */
export function lintScene(ctx: Ctx, spec: SceneSpec, o: RenderOptions): LintIssue[] {
  const issues: LintIssue[] = [];
  const seen = new Set<string>();
  const push = (id: string, message: string) => {
    const k = id + "|" + message;
    if (!seen.has(k)) {
      seen.add(k);
      issues.push({ id, message });
    }
  };
  const env = makeEnv(ctx, spec, { ...o, onWarn: push });
  applyTransitions(spec, o.tokens);
  ensureShots(spec, o.tokens, () => env);
  const W = o.tokens.canvas.width;
  const H = o.tokens.canvas.height;
  const ids = new Set<string>();
  const live: { el: SceneElement; r: Rect; from: number; to: number }[] = [];
  const fixedTexts: { el: SceneElement; r: Rect; from: number; to: number }[] = [];
  for (const el of spec.elements) {
    if (ids.has(el.id)) push(el.id, "duplicate element id");
    ids.add(el.id);
    const comp = COMPONENTS[el.type];
    if (!comp) {
      push(el.id, `unknown component type '${el.type}'`);
      continue;
    }
    if (el.at < 0 || el.at > spec.duration) push(el.id, `starts at ${el.at}s, outside the scene (0–${spec.duration}s)`);
    const dur = elementDur(env, el);
    if (el.at + dur > spec.duration + 0.05) push(el.id, `entrance ends at ${(el.at + dur).toFixed(2)}s, after the scene ends (${spec.duration}s)`);
    const r = env.boundsOf(el.id);
    if (r && el.fixed && TEXTY.has(el.type)) fixedTexts.push({ el, r, from: el.at, to: typeof el.until === "number" ? el.until : spec.duration });
    if (r && !el.fixed && el.type !== "ProgressBar" && el.type !== "RecapCard" && !BACKDROPS.has(el.type)) {
      const m = 8;
      if (r.x < m || r.y < m || r.x + r.w > W - m || r.y + r.h > H - m) push(el.id, `extends outside the frame: box x=${r.x.toFixed(0)} y=${r.y.toFixed(0)} w=${r.w.toFixed(0)} h=${r.h.toFixed(0)} (frame ${W}x${H})`);
      if (TEXTY.has(el.type)) live.push({ el, r, from: el.at, to: typeof el.until === "number" ? el.until : spec.duration });
    }
  }
  // overlap check between text-bearing elements visible at the same time
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      if (a.to <= b.from || b.to <= a.from) continue;
      const ix = Math.max(0, Math.min(a.r.x + a.r.w, b.r.x + b.r.w) - Math.max(a.r.x, b.r.x));
      const iy = Math.max(0, Math.min(a.r.y + a.r.h, b.r.y + b.r.h) - Math.max(a.r.y, b.r.y));
      const area = Math.min(a.r.w * a.r.h, b.r.w * b.r.h) || 1;
      if ((ix * iy) / area > 0.12) push(b.el.id, `overlaps '${a.el.id}' while both are on screen (${Math.max(a.from, b.from).toFixed(1)}–${Math.min(a.to, b.to).toFixed(1)}s)`);
    }
  }
  const pics = pictureRects(env, spec);
  const inter = (a: Rect, b: Rect) =>
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const onPicture = (a: { el: SceneElement; from: number; to: number }, b: PictureBox) =>
    push(a.el.id, `text sits on the illustration '${b.id}' (${Math.max(a.from, b.from).toFixed(1)}–${Math.min(a.to, b.to).toFixed(1)}s); move it into empty space and point at the drawing with a Label`);
  for (const a of live) {
    for (const b of pics) {
      if (a.to <= b.from || b.to <= a.from || b.owner === a.el) continue;
      // a thin stroke through the words is enough to spoil them; a picture's edge may touch a little
      if (inter(a.r, b.r) / (a.r.w * a.r.h || 1) > (b.id.endsWith(".stroke") ? 0.03 : 0.1)) onPicture(a, b);
    }
  }
  // fixed text (a heading pinned to the screen) against pictures as the camera shows them, sampled every half second
  for (const a of fixedTexts) {
    for (const b of pics) {
      const from = Math.max(a.from, b.from), to = Math.min(a.to, b.to);
      for (let t = from; t < to; t += 0.5) {
        if (inter(a.r, screenRect(spec, o.tokens, b.owner, b.r, t)) / (a.r.w * a.r.h || 1) > 0.1) {
          onPicture(a, b);
          break;
        }
      }
    }
  }
  // pinned text against text that moves with the camera
  for (const a of fixedTexts) {
    for (const b of live) {
      const from = Math.max(a.from, b.from), to = Math.min(a.to, b.to);
      for (let t = from; t < to; t += 0.5) {
        const sr = screenRect(spec, o.tokens, b.el, b.r, t);
        if (inter(a.r, sr) / (Math.min(a.r.w * a.r.h, sr.w * sr.h) || 1) > 0.12) {
          push(b.el.id, `overlaps '${a.el.id}' while both are on screen (${t.toFixed(1)}s, as the camera frames it)`);
          break;
        }
      }
    }
  }
  // one sun in the sky: a landscape draws its own unless told not to
  for (const land of spec.elements) {
    if (land.type !== "Landscape" || (land.props?.sun ?? "left") === "none") continue;
    const lto = typeof land.until === "number" ? land.until : spec.duration;
    for (const el of spec.elements) {
      if (el.type !== "Prop" || !["sun", "moon"].includes(el.props?.kind)) continue;
      const eto = typeof el.until === "number" ? el.until : spec.duration;
      if (el.at < lto && land.at < eto) push(land.id, `draws its own sun while '${el.id}' is also a ${el.props.kind}: set the landscape's sun to "none"`);
    }
  }
  // what each camera shot leaves out: text, arrows and anything that appears during the shot must stay in frame
  const shots = cameraShots(spec);
  shots.forEach((k, i) => {
    const end = i + 1 < shots.length ? shots[i + 1].t : spec.duration;
    const settle = Math.min(end, k.t + Math.max(0.2, num(k.dur, 1.6)));
    for (const el of spec.elements) {
      if (el.fixed || BACKDROPS.has(el.type) || el.type === "ProgressBar" || el.type === "RecapCard" || el.type === "FrozenFrame") continue;
      const until = typeof el.until === "number" ? el.until : spec.duration;
      const t0 = Math.max(settle, el.at + Math.min(elementDur(env, el), 1));
      const t1 = Math.min(end, until);
      if (t0 >= t1) continue;
      const must = TEXTY.has(el.type) || CAMERA_MUST_SHOW.has(el.type) || el.at >= k.t - 0.05;
      if (!must) continue;
      const r = env.boundsOf(el.id);
      if (!r) continue;
      for (const t of [t0, (t0 + t1) / 2]) {
        const sr = screenRect(spec, o.tokens, el, r, t);
        const m = 4;
        const vis = inter(sr, { x: m, y: m, w: W - 2 * m, h: H - 2 * m }) / (sr.w * sr.h || 1);
        // a push-in may leave earlier text wholly out of shot, but never half cut; what arrives during the shot must be in it
        const earlier = el.at < k.t - 0.05;
        if (earlier && vis < 0.1) continue;
        if (vis < (TEXTY.has(el.type) ? 0.995 : 0.85)) {
          push(el.id, `cut off by camera shot ${i + 1} at ${t.toFixed(1)}s (zoom ${num(k.zoom, 1).toFixed(2)}): only ${Math.round(vis * 100)}% is in frame${earlier ? " (on screen before the shot)" : ""}`);
          break;
        }
      }
    }
  });
  // direction notes (advisory: the fixer leaves them alone, the style lab and the logs show them)
  if (shots.length) {
    let moving = 0;
    const N = 60;
    for (let i = 0; i < N; i++) if (isMoving(shots, (spec.duration * (i + 0.5)) / N)) moving++;
    if (moving / N > 0.7) push("scene", `direction: the camera moves ${Math.round((moving / N) * 100)}% of the time; leave still rests so the moves land`);
    const starts = shots.map((k) => k.t).filter((t, i, a) => i === 0 || t - a[i - 1] > 0.3);
    if (starts.length >= 4) {
      const gaps = starts.slice(1).map((t, i) => t - starts[i]);
      const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
      const sd = Math.sqrt(gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length);
      if (mean > 0 && sd / mean < 0.15) push("scene", "direction: shots change at an even beat (a metronome); vary the beat lengths");
    }
  }
  for (const el of spec.elements) {
    if (el.type === "Box" && !el.props?.label && el.props?.fill) push(el.id, "direction: an empty box stands in for a real thing; use a set or a library picture");
  }
  // draw a few sample frames to surface draw-time warnings (bad fn, missing targets)
  for (const t of [0.5, spec.duration * 0.33, spec.duration * 0.66, spec.duration - 0.05]) {
    drawScene(ctx, spec, Math.max(0, t), { ...o, onWarn: push });
  }
  return issues;
}

/** Text visible at time t (for the voice tutor's "what is on screen" context). */
export function visibleText(spec: SceneSpec, t: number): string[] {
  const out: string[] = [];
  for (const el of spec.elements) {
    if (t < el.at) continue;
    if (typeof el.until === "number" && t > el.until) continue;
    const p = el.props ?? {};
    for (const k of ["title", "subtitle", "text", "label", "xLabel", "yLabel"]) if (typeof p[k] === "string") out.push(p[k]);
    if (el.type === "Prop" || el.type === "Journey") out.push(`[picture: ${p.kind}]`);
    if (el.type === "Particles" || el.type === "Tube") out.push(`[moving ${p.kind ?? p.flow?.kind ?? "particles"}]`);
    if (el.type === "Landscape") out.push("[landscape: sky, sea, land, mountains]");
    if (el.type === "Nephron") out.push("[diagram: nephron]");
    if (el.type === "Epithelium") out.push("[diagram: epithelial transport, lumen to blood: " + (p.transporters ?? []).map((t: any) => t.label ?? t.kind).join(", ") + "]");
    if (el.type === "Body") out.push(`[diagram: human body${p.highlight ? ", " + p.highlight : ""}]`);
    if (Array.isArray(p.items)) out.push(...p.items.map(String));
    if (p.left?.items) out.push(String(p.left.title ?? ""), ...p.left.items.map(String));
    if (p.right?.items) out.push(String(p.right.title ?? ""), ...p.right.items.map(String));
    if (Array.isArray(p.nodes)) out.push(...p.nodes.map((n: any) => String(n.label ?? "")));
    if (Array.isArray(p.rows)) out.push(...p.rows.map((r: any) => (Array.isArray(r) ? r.join(" | ") : String(r))));
  }
  return out.filter(Boolean);
}
