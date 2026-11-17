// Illustration & motion components: Prop, Particles, Tube, Journey, Label, Guide, and the scene systems
// Landscape, Nephron and Body. All motion is a pure function of time (deterministic).
import type { Component, Env, Rect, SceneElement } from "../types";
import { artFor, circle, ellipse, face, gloss, line, mix, poly, shape, smooth, type Art, type P } from "../art/paint";
import { PROPS } from "../art/props";
import { applyTexture } from "../art/texture";
import { drawText, layoutText } from "../text";
import { clamp, color, ease, hash, lerp, num, rng } from "../util";
import { bell, EASE_IN_OUT, EASE_OUT, flow, loop, seeded, smoothNoise, spring, SPRINGS, wave } from "../motion";

const TAU = Math.PI * 2;

// ───────────────────────────── geometry ─────────────────────────────

export function catmull(pts: P[], segs = 14): P[] {
  if (pts.length < 3) return pts;
  const out: P[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let j = 0; j < segs; j++) {
      const t = j / segs, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function quad(a: P, b: P, curve: number, n = 32): P[] {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const cx = mx + (-dy / len) * curve * len * 0.5, cy = my + (dx / len) * curve * len * 0.5;
  const out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * cx + t * t * b[0], u * u * a[1] + 2 * u * t * cy + t * t * b[1]]);
  }
  return out;
}

export class Track {
  pts: P[];
  cum: number[];
  len: number;
  constructor(pts: P[]) {
    this.pts = pts.length ? pts : [[0, 0]];
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(this.pts[i][0] - this.pts[i - 1][0], this.pts[i][1] - this.pts[i - 1][1]));
    this.len = this.cum[this.cum.length - 1] || 1;
  }
  /** Point and tangent angle at fraction s of the length. */
  at(s: number): { p: P; a: number } {
    const d = clamp(s) * this.len;
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < d) i++;
    const a = this.pts[i - 1], b = this.pts[i] ?? a;
    const seg = this.cum[i] - this.cum[i - 1] || 1;
    const f = (d - this.cum[i - 1]) / seg;
    return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], a: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  }
  upTo(s: number): P[] {
    const d = clamp(s) * this.len;
    const out: P[] = [];
    for (let i = 0; i < this.pts.length; i++) {
      if (this.cum[i] <= d) out.push(this.pts[i]);
      else {
        out.push(this.at(s).p);
        break;
      }
    }
    return out;
  }
  bbox(pad = 0): Rect {
    const xs = this.pts.map((p) => p[0]), ys = this.pts.map((p) => p[1]);
    const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
    return { x, y, w: Math.max(...xs) - x + pad, h: Math.max(...ys) - y + pad };
  }
}

/** Points may be [x,y], "elementId" (its centre) or "elementId.anchor". */
export function resolvePath(env: Env, p: any, id: string): Track | null {
  const raw: any[] = Array.isArray(p.path) ? p.path : [p.from, p.to].filter((v) => v !== undefined);
  const pts: P[] = [];
  for (const v of raw) {
    const q = env.pointOf(v);
    if (q) pts.push(q);
    else env.warn(id, `path point ${JSON.stringify(v)} not found`);
  }
  if (pts.length < 2) return null;
  if (pts.length === 2) return new Track(quad(pts[0], pts[1], num(p.curve, 0)));
  return new Track(catmull(pts));
}

// ───────────────────────────── props ─────────────────────────────

function cartoonDefault(env: Env) {
  return (env.tokens as any).art?.style === "cartoon";
}

/** Speaking (mouth) amount at absolute time t, from narration sentence spans. */
export function talkAt(env: Env, t: number): number {
  const sp: [number, number][] = (env.spec as any).speech ?? [];
  for (const [a, b] of sp) if (t >= a && t <= b - 0.1) return 0.35 + 0.65 * Math.abs(Math.sin(t * 17)) * (0.6 + 0.4 * Math.sin(t * 5.3));
  return 0;
}

/** Light sources and things drawn as light: never shaded, they glow instead. */
const EMISSIVE = new Set(["sun", "star", "flame", "lightning", "moon", "bulb", "steam"]);
/** Things that stand on something: they get a soft contact shadow. */
const GROUNDED = new Set(["tree", "pine", "plant", "flower", "rock", "house", "person", "beaker", "flask", "battery", "bulb", "apple", "book", "car", "ball", "thermometer", "magnet", "volcano", "rocket", "clock"]);

/** Where the key light comes from, as a unit vector pointing FROM the light (default: upper left). */
export function lightDir(env: Env): [number, number] {
  const sp: any = env.spec;
  const from = sp.light?.from ?? (() => {
    const land = sp.elements?.find((e: any) => e.type === "Landscape");
    if (land) return (land.props?.sun ?? (land.props?.sea === "right" ? "right" : "left")) === "right" ? "upper-right" : "upper-left";
    return "upper-left";
  })();
  const v: Record<string, [number, number]> = {
    "upper-left": [0.62, 0.78], "upper-right": [-0.62, 0.78], left: [1, 0.15], right: [-1, 0.15], top: [0, 1], front: [0.2, 0.5],
  };
  return v[from] ?? v["upper-left"];
}

// Lit props are kept as sprites and reused while nothing about them changes. Building one (draw → light → texture
// on its own layer) is most of a frame's cost, and most props look the same for many frames in a row. Their idle
// loops step PROP_ANIM_FPS times a second ("on twos" at 24 fps, as in hand animation); entrances, motion and the
// camera stay smooth because they act where the sprite is placed, not inside it. A sprite is a pure function of its
// key, so frames stay identical across render threads. Props bigger than SPRITE_MAX px are drawn unlit.
export const PROP_ANIM_FPS = 12;
const SPRITE_MAX = 1536;
const SPRITE_BUDGET = 24_000_000; // pixels kept per render thread (about 96 MB)
const spriteCaches = new WeakMap<object, { map: Map<string, any>; px: number }>();

function spriteCache(env: Env) {
  let cache = spriteCaches.get(env.tokens as object);
  if (!cache) spriteCaches.set(env.tokens as object, (cache = { map: new Map(), px: 0 }));
  return cache;
}

function cachedSprite(env: Env, key: string, w: number, h: number, build: (g: any) => void): any | null {
  if (w > SPRITE_MAX || h > SPRITE_MAX) return null;
  const cache = spriteCache(env);
  const hit = cache.map.get(key);
  if (hit) {
    cache.map.delete(key); // most recently used goes last
    cache.map.set(key, hit);
    return hit;
  }
  const c = env.makeCanvas(w, h);
  build(c.getContext("2d"));
  cache.map.set(key, c);
  cache.px += w * h;
  for (const [k, old] of cache.map) {
    if (cache.px <= SPRITE_BUDGET) break;
    cache.map.delete(k);
    cache.px -= old.width * old.height;
  }
  return c;
}


export function drawProp(env: Env, kind: string, x: number, y: number, size: number, o: { t: number; state?: number; color?: string; flip?: boolean; rotate?: number; alpha?: number; seed?: number; face?: boolean; talk?: number; mood?: string; scaleX?: number; scaleY?: number; flat?: boolean; grounded?: boolean }) {
  const def = PROPS[kind];
  if (!def) return false;
  const { ctx } = env;
  const art: any = (env.tokens as any).art ?? {};
  const lit = !o.flat && size >= 40 && art.light !== false;
  if (lit) {
    // A sprite must look exactly as its key says, whichever frame (or render thread) builds it first, so it is drawn
    // with the same rounded values the key uses.
    size = Math.round(size); // whole-pixel sizes, so a sprite is reused while a prop holds still
    const snap = (v: number | undefined, step: number) => (v === undefined ? undefined : Math.round(v / step) * step);
    o = { ...o, state: snap(o.state, 0.01), talk: snap(o.talk, 0.05), rotate: snap(o.rotate, 0.002), scaleX: snap(o.scaleX, 0.005), scaleY: snap(o.scaleY, 0.005) };
  }
  const s = size / 100;
  const tq = Math.floor(o.t * PROP_ANIM_FPS + 1e-6) / PROP_ANIM_FPS;
  const drawInto = (g: any) => {
    const A = artFor({ ...env, ctx: g } as Env, s);
    if (o.face === false) A.cartoon = false;
    g.save();
    if (o.rotate) g.rotate(o.rotate);
    g.scale(s * (o.flip ? -1 : 1) * (o.scaleX ?? 1), s * (o.scaleY ?? 1));
    def.draw(A, { t: lit ? tq : o.t, state: o.state ?? 0, color: o.color, seed: o.seed ?? 0, talk: o.talk, mood: o.mood });
    g.restore();
  };
  if (!lit) {
    ctx.save();
    ctx.globalAlpha *= o.alpha ?? 1;
    ctx.translate(x, y);
    drawInto(ctx);
    ctx.restore();
    return true;
  }
  // Draw the prop alone into a layer at device resolution, light it, then place it with its shadows.
  const m = ctx.getTransform();
  const dev = Math.max(0.25, Math.round(Math.hypot(m.a, m.b) * 100) / 100); // rounded like the sprite key
  const bw = size * def.aspect * 1.6 * Math.max(1, Math.abs(o.scaleX ?? 1)), bh = size * 1.7;
  const pw = Math.min(2048, Math.ceil(bw * dev)), ph = Math.min(2048, Math.ceil(bh * dev));
  const emissive = EMISSIVE.has(kind) && !(kind === "bulb" && !(o.state ?? 0));
  const [lx0, ly0] = lightDir(env);
  const lx = Math.round(lx0 * 100) / 100, ly = Math.round(ly0 * 100) / 100;
  const key = [kind, size, pw, ph, dev, tq, o.state ?? 0, o.color ?? "", o.flip ? 1 : 0, o.rotate ?? 0, o.seed ?? 0,
    o.face === false ? 0 : 1, o.talk ?? 0, o.mood ?? "", o.scaleX ?? 1, o.scaleY ?? 1, lx, ly].join("|");
  const c = cachedSprite(env, key, pw, ph, (g) => {
  g.setTransform(dev, 0, 0, dev, (pw / dev / 2) * dev, (ph / dev / 2) * dev);
  drawInto(g);
  if (!emissive) {
    // key light: warm on the lit side, cool shade on the far side, only on the prop's own pixels
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-atop";
    const cx = pw / 2, cy = ph / 2, r = Math.max(pw, ph) * 0.32;
    const grad = g.createLinearGradient(cx - lx * r, cy - ly * r, cx + lx * r, cy + ly * r);
    const k = num(art.lightStrength, 0.22);
    const lc = String(art.lightColor ?? "255,246,222"), sc = String(art.shadeColor ?? "30,36,64");
    if (art.lightHard) {
      // cel shading: one hard terminator between the lit and the shaded side
      grad.addColorStop(0, `rgba(${lc},${k * 0.6})`);
      grad.addColorStop(0.5, `rgba(${lc},0)`);
      grad.addColorStop(0.5, `rgba(${sc},${k})`);
      grad.addColorStop(1, `rgba(${sc},${k})`);
    } else {
      grad.addColorStop(0, `rgba(${lc},${k + 0.06})`);
      grad.addColorStop(0.45, `rgba(${lc},0)`);
      grad.addColorStop(0.62, `rgba(${sc},0)`);
      grad.addColorStop(1, `rgba(${sc},${k})`);
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, pw, ph);
    g.globalCompositeOperation = "source-over";
  }
  applyTexture(env, g, pw, ph, art.texture, num(art.textureStrength, 1));
  });
  if (!c) {
    ctx.save();
    ctx.globalAlpha *= o.alpha ?? 1;
    ctx.translate(x, y);
    drawInto(ctx);
    ctx.restore();
    return true;
  }
  ctx.save();
  ctx.globalAlpha *= o.alpha ?? 1;
  ctx.translate(x, y);
  const grounded = o.grounded ?? GROUNDED.has(kind);
  if (grounded) {
    // contact shadow: a soft oval on the ground, pushed away from the light
    ctx.save();
    ctx.globalAlpha *= num(art.contact, 0.28);
    ctx.filter = `blur(${(size * 0.05 * dev).toFixed(1)}px)`;
    ctx.fillStyle = "rgba(40,30,20,1)";
    ctx.beginPath();
    ctx.ellipse(lx * size * 0.08, size * 0.48 * (o.scaleY ?? 1), size * def.aspect * 0.42, size * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (!emissive && num(art.shadow, 0.14) > 0) {
    // lift shadow (device px, so it is the same at every camera zoom), cast away from the light
    ctx.shadowColor = `rgba(40,30,20,${num(art.shadow, 0.14)})`;
    ctx.shadowBlur = size * 0.09 * dev;
    ctx.shadowOffsetX = lx * size * 0.035 * dev;
    ctx.shadowOffsetY = ly * size * 0.035 * dev;
  }
  if (emissive && art.glow !== false) {
    // a soft halo behind light sources (a gradient, not a shadow blur: Skia caches blurred shadows across frames,
    // which made frames depend on what was drawn before them)
    const halo = ctx.createRadialGradient(0, 0, size * 0.15, 0, 0, size * 0.8);
    halo.addColorStop(0, "rgba(255,214,120,0.35)");
    halo.addColorStop(1, "rgba(255,214,120,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(-size * 0.8, -size * 0.8, size * 1.6, size * 1.6);
  }
  ctx.drawImage(c, 0, 0, pw, ph, -pw / dev / 2, -ph / dev / 2, pw / dev, ph / dev);
  ctx.restore();
  // No forced flush is needed: a sprite is never drawn into again after it is built.
  return true;
}

function stateAt(p: any, absT: number): number {
  const base = num(p.state, 0);
  const keys: { at: number; v: number }[] = Array.isArray(p.stateKeys) ? p.stateKeys.filter((k: any) => typeof k?.at === "number") : [];
  if (!keys.length) return base;
  let v = base, from = base, prevAt = -Infinity;
  for (const k of keys.sort((a, b) => a.at - b.at)) {
    const d = num((k as any).dur, 1.5);
    if (absT >= k.at) {
      v = lerp(from, num(k.v, from), ease.inOut(clamp((absT - k.at) / d)));
      from = num(k.v, from);
      prevAt = k.at;
    }
  }
  void prevAt;
  return v;
}

/** Entrances settle on a spring in the kit's tone (soft for calm kits, lively/bouncy for Storybook). */
function entranceXf(env: Env, kind: string, local: number, k: number): { s: number; dy: number; a: number; sy: number } {
  const tone = SPRINGS[String((env.tokens.motion as any).spring ?? "soft")] ?? SPRINGS.soft;
  const sp = spring(local, tone.zeta, tone.f);
  const e = clamp(k);
  switch (kind) {
    case "fade": return { s: 1, dy: 0, a: ease.out(e), sy: 1 };
    case "grow": return { s: 1, dy: 0, a: clamp(local * 5), sy: Math.max(0.01, sp) };
    case "drop": return { s: 1, dy: -(1 - spring(local, Math.max(0.35, tone.zeta - 0.25), tone.f)) * 180, a: clamp(local * 4), sy: 1 };
    case "rise": return { s: 1, dy: (1 - sp) * 120, a: clamp(local * 4), sy: 1 };
    case "none": return { s: 1, dy: 0, a: 1, sy: 1 };
    default: return { s: Math.max(0.01, 0.6 + 0.4 * sp), dy: (1 - sp) * 14, a: clamp(local * 5), sy: 1 };
  }
}

function labelBlock(env: Env, text: string, x: number, y: number, size: any = "sm", maxWidth = 260) {
  return layoutText(env, { text, x, y, size, align: "center", maxWidth, maxLines: 2 });
}

/** A label for a point on a path: by default its bottom edge sits `gap` px above the path, so wrapped lines never land on it. */
function pathLabel(env: Env, p: any, lp: P, gap: number) {
  const x = lp[0] + num(p.labelDx, 0);
  if (typeof p.labelDy === "number") return labelBlock(env, p.label, x, lp[1] + p.labelDy, "sm", 240);
  const probe = labelBlock(env, p.label, x, 0, "sm", 240);
  return labelBlock(env, p.label, x, lp[1] - gap - probe.rect.h, "sm", 240);
}

function propRect(p: any): Rect {
  const def = PROPS[p.kind];
  const h = num(p.size, 160);
  const w = h * (def?.aspect ?? 1);
  return { x: num(p.x, 640) - w / 2, y: num(p.y, 360) - h / 2, w, h };
}

export const Prop: Component = {
  inDur: (_env, p) => (p.entrance === "none" ? 0.05 : 0.7),
  bounds: (env, p) => {
    const r = propRect(p);
    if (typeof p.label === "string" && p.label) {
      const b = labelBlock(env, p.label, r.x + r.w / 2, r.y + r.h + 8);
      return { x: Math.min(r.x, b.rect.x), y: r.y, w: Math.max(r.w, b.rect.w), h: r.h + 8 + b.rect.h };
    }
    return r;
  },
  anchors: (env, p) => {
    const def = PROPS[p.kind];
    const r = propRect(p);
    const s = num(p.size, 160) / 100;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const out: Record<string, P> = { center: [cx, cy], top: [cx, r.y], bottom: [cx, r.y + r.h], left: [r.x, cy], right: [r.x + r.w, cy] };
    for (const [k, v] of Object.entries(def?.anchors ?? {})) out[k] = [cx + v[0] * s * (p.flip ? -1 : 1), cy + v[1] * s];
    return out;
  },
  draw: (env, p, ph, el) => {
    const r = propRect(p);
    const absT = el.at + ph.local;
    const x = r.x + r.w / 2, y = r.y + r.h / 2;
    const xf = entranceXf(env, p.entrance ?? "pop", ph.local, ph.k);
    const talk = p.talk ? talkAt(env, absT) : 0;
    const ok = drawProp(env, p.kind, x, y + xf.dy + (xf.sy !== 1 ? (r.h / 2) * (1 - xf.sy) : 0), num(p.size, 160) * xf.s, {
      t: ph.local, state: stateAt(p, absT), color: p.color, flip: !!p.flip, rotate: num(p.rotate, 0) * (Math.PI / 180),
      alpha: ph.alpha * xf.a, seed: hash(el.id) % 97, face: p.face ?? cartoonDefault(env), talk, mood: p.mood, scaleY: xf.sy,
    });
    if (!ok) env.warn(el.id, `unknown prop kind '${p.kind}'`);
    if (typeof p.label === "string" && p.label) {
      const b = labelBlock(env, p.label, x, r.y + r.h + 8);
      drawText(env, b, "center", clamp((ph.k - 0.4) / 0.6), p.labelColor ?? "ink", ph.alpha);
    }
  },
};

// ───────────────────────────── particles ─────────────────────────────

export function drawParticle(env: Env, kind: string, x: number, y: number, size: number, ang: number, t: number, seed: number, col?: string, alpha = 1) {
  const { ctx } = env;
  const A = artFor(env, 1);
  A.lw = Math.max(1.2, Math.min(A.lw, size * 0.14));
  const c = (name: string) => A.c(col ?? name);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  const r = size / 2;
  switch (kind) {
    case "dot": circle(A, 0, 0, r, c("accent"), { stroke: false }); break;
    case "drop": {
      ctx.rotate(ang - Math.PI / 2);
      shape(A, [[0, r * 1.3], [r * 0.6, -r * 0.1], [r * 0.7, -r * 0.6], [0, -r * 1.05], [-r * 0.7, -r * 0.6], [-r * 0.6, -r * 0.1]], c("water"), { lw: A.lw * 0.7 });
      break;
    }
    case "vapor": {
      ctx.globalAlpha *= 0.55;
      circle(A, 0, 0, r, c("waterLight"), { stroke: false });
      circle(A, r * 0.5, -r * 0.4, r * 0.7, c("white"), { stroke: false });
      break;
    }
    case "bubble": circle(A, 0, 0, r, null, { lw: 1.5, strokeColor: c("waterDeep") }); gloss(A, -r * 0.3, -r * 0.3, r * 0.25, r * 0.18, 0.9); break;
    case "snow": for (let i = 0; i < 3; i++) line(A, [[Math.cos(i) * -r, Math.sin(i) * -r], [Math.cos(i) * r, Math.sin(i) * r]], c("white"), 2); break;
    case "spark": {
      const pts: P[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + t * 3;
        const rr = i % 2 ? r * 0.35 : r;
        pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      poly(A, pts, c("electric"), { stroke: false });
      break;
    }
    case "arrow": ctx.rotate(ang); line(A, [[-r * 0.6, -r * 0.7], [r * 0.5, 0], [-r * 0.6, r * 0.7]], c("accent"), Math.max(2, size * 0.18)); break;
    case "rbc": ctx.rotate(ang); ellipse(A, 0, 0, r, r * 0.72, c("blood"), 0, { lw: A.lw * 0.6 }); ellipse(A, 0, 0, r * 0.45, r * 0.3, "bloodDark", 0, { stroke: false, alpha: 0.4 }); break;
    case "wbc": shape(A, [[-r, 0], [-r * 0.5, -r], [r * 0.6, -r * 0.8], [r, 0], [r * 0.5, r * 0.9], [-r * 0.6, r * 0.8]], c("#F4F0F5"), { lw: A.lw * 0.6 }); circle(A, 0, 0, r * 0.4, "purple", { stroke: false }); break;
    case "water": circle(A, 0, 0, r, c("water"), { lw: A.lw * 0.6 }); break;
    case "molecule": circle(A, -r * 0.4, 0, r * 0.55, c("blood"), { lw: 1 }); circle(A, r * 0.45, 0, r * 0.45, c("white"), { lw: 1 }); break;
    case "oxygen": circle(A, -r * 0.42, 0, r * 0.5, c("blood"), { lw: 1 }); circle(A, r * 0.42, 0, r * 0.5, c("blood"), { lw: 1 }); break;
    case "co2": circle(A, -r * 0.7, 0, r * 0.38, "blood", { lw: 1 }); circle(A, r * 0.7, 0, r * 0.38, "blood", { lw: 1 }); circle(A, 0, 0, r * 0.5, c("grey"), { lw: 1 }); break;
    case "glucose": {
      const pts: P[] = [];
      for (let i = 0; i < 6; i++) pts.push([Math.cos((i / 6) * TAU) * r, Math.sin((i / 6) * TAU) * r]);
      poly(A, pts, c("yellow"), { lw: 1.2 });
      break;
    }
    case "salt": poly(A, [[-r * 0.7, -r * 0.7], [r * 0.7, -r * 0.7], [r * 0.7, r * 0.7], [-r * 0.7, r * 0.7]], c("white"), { lw: 1.2 }); break;
    case "urea": poly(A, [[0, -r], [r, r * 0.8], [-r, r * 0.8]], c("urine"), { lw: 1.2 }); break;
    case "ion": circle(A, 0, 0, r, c("yellow"), { lw: 1.2 }); line(A, [[-r * 0.5, 0], [r * 0.5, 0]], "black", 1.5); line(A, [[0, -r * 0.5], [0, r * 0.5]], "black", 1.5); break;
    case "electron": circle(A, 0, 0, r * 0.7, c("indigo"), { stroke: false }); line(A, [[-r * 0.35, 0], [r * 0.35, 0]], "white", 1.5); break;
    case "photon": case "heat": {
      ctx.rotate(ang);
      const pts: P[] = [];
      for (let i = 0; i <= 10; i++) pts.push([-r * 1.4 + (i / 10) * r * 2.8, Math.sin(i * 1.4 + t * 8) * r * 0.4]);
      line(A, pts, c(kind === "heat" ? "fire" : "electric"), Math.max(2, size * 0.16));
      break;
    }
    case "leaf": ctx.rotate(t * 2 + seed); shape(A, [[-r, 0], [0, -r * 0.5], [r, 0], [0, r * 0.5]], c("leaf"), { lw: 1 }); break;
    case "nutrient": circle(A, 0, 0, r * 0.7, c("green"), { lw: 1 }); break;
    default:
      if (PROPS[kind]) {
        ctx.restore();
        drawProp(env, kind, x, y, size, { t: t + seed, color: col, alpha, seed, face: false });
        return;
      }
      circle(A, 0, 0, r, c("accent"), { stroke: false });
  }
  ctx.restore();
}

function particlePos(tr: Track, i: number, n: number, local: number, speed: number, seed: number, spread: number, wiggle: number) {
  const r = rng(seed * 131 + i * 7919);
  const jit = r();
  const lat = (r() * 2 - 1) * spread;
  const per = tr.len / Math.max(1, speed);
  const raw = local / per - (i + jit * 0.6) / n;
  if (raw < 0) return null;
  const s = raw - Math.floor(raw);
  const { p, a } = tr.at(s);
  const w = Math.sin(local * 2.2 + i * 1.7) * wiggle;
  const nx = -Math.sin(a), ny = Math.cos(a);
  return { x: p[0] + nx * (lat + w), y: p[1] + ny * (lat + w), a, s, r };
}

export const Particles: Component = {
  inDur: () => 0.6,
  bounds: (env, p, el) => resolvePath(env, p, el.id)?.bbox(num(p.spread, 0) + num(p.size, 14)) ?? null,
  draw: (env, p, ph, el) => {
    const tr = resolvePath(env, p, el.id);
    if (!tr) return;
    const kind = String(p.kind ?? "dot");
    const n = Math.round(clamp(num(p.count, 12), 1, 80));
    const speed = num(p.speed, 90);
    const size = num(p.size, 14);
    const spread = num(p.spread, 0);
    const seed = hash(el.id) % 1000;
    const showPath = p.showPath ?? "none";
    if (showPath !== "none") {
      const { ctx } = env;
      ctx.save();
      ctx.globalAlpha *= ph.alpha * (showPath === "dashed" ? 0.45 : 0.6);
      ctx.strokeStyle = color(env.tokens, p.pathColor ?? "muted");
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      if (showPath === "dashed") ctx.setLineDash([8, 10]);
      const pts = tr.upTo(ease.inOut(ph.k));
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const q of pts.slice(1)) ctx.lineTo(q[0], q[1]);
      ctx.stroke();
      ctx.restore();
    }
    for (let i = 0; i < n; i++) {
      const q = particlePos(tr, i, n, ph.local * (p.reverse ? 1 : 1), speed, seed, spread, num(p.wiggle, kind === "vapor" ? 6 : 0));
      if (!q) continue;
      const s = p.reverse ? 1 - q.s : q.s;
      const pos = p.reverse ? tr.at(s) : null;
      const x = pos ? pos.p[0] : q.x, y = pos ? pos.p[1] : q.y;
      const fade = p.fade === false ? 1 : Math.min(1, s / 0.08, (1 - s) / 0.1);
      const grow = kind === "vapor" ? 0.6 + 0.8 * s : 0.85 + 0.3 * q.r();
      drawParticle(env, kind, x, y, size * grow, pos ? pos.a + Math.PI : q.a, ph.local, seed + i, p.color, ph.alpha * clamp(fade));
    }
    if (typeof p.label === "string" && p.label) {
      const { p: lp } = tr.at(num(p.labelAt, 0.5));
      const b = pathLabel(env, p, lp, num(p.size, 14) + num(p.spread, 0) + 8);
      drawText(env, b, "center", clamp((ph.local - 0.3) / 0.8), p.labelColor ?? "ink", ph.alpha);
    }
  },
};

// ───────────────────────────── tube ─────────────────────────────

export const Tube: Component = {
  inDur: (_e, p) => num(p.drawDur, 1.2),
  bounds: (env, p, el) => resolvePath(env, p, el.id)?.bbox(num(p.width, 28) / 2) ?? null,
  parts: (env, p, el) => {
    const tr = resolvePath(env, p, el.id);
    if (!tr) return [];
    const w = num(p.width, 28);
    const n = Math.max(2, Math.ceil(tr.len / Math.max(12, w)));
    const out: { name: string; rect: Rect }[] = [];
    for (let i = 0; i <= n; i++) {
      const [x, y] = tr.at(i / n).p;
      out.push({ name: "stroke", rect: { x: x - w / 2, y: y - w / 2, w, h: w } });
    }
    return out;
  },
  anchors: (env, p, el): Record<string, P> => {
    const tr = resolvePath(env, p, el.id);
    if (!tr) return {};
    return { start: tr.at(0).p, middle: tr.at(0.5).p, end: tr.at(1).p, q1: tr.at(0.25).p, q3: tr.at(0.75).p };
  },
  draw: (env, p, ph, el) => {
    const tr = resolvePath(env, p, el.id);
    if (!tr) return;
    const { ctx } = env;
    const A = artFor(env, 1);
    const w = num(p.width, 28);
    const pts = tr.upTo(ease.inOut(ph.k));
    if (pts.length < 2) return;
    ctx.save();
    ctx.globalAlpha *= ph.alpha;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const q of pts.slice(1)) ctx.lineTo(q[0], q[1]);
    };
    path();
    ctx.strokeStyle = A.c(p.wall ?? "ink");
    ctx.lineWidth = w + A.lw * 2;
    ctx.stroke();
    path();
    ctx.strokeStyle = A.c(p.color ?? "blood");
    ctx.lineWidth = w;
    ctx.stroke();
    path();
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = w * 0.25;
    ctx.translate(-w * 0.18, -w * 0.18);
    ctx.stroke();
    ctx.restore();
    const f = p.flow;
    if (f && ph.k >= 1) {
      const kind = String(f.kind ?? "dot");
      const n = Math.round(clamp(num(f.count, Math.round(tr.len / 40)), 1, 80));
      const size = num(f.size, w * 0.55);
      const seed = hash(el.id) % 1000;
      const local = ph.local - ph.dur;
      for (let i = 0; i < n; i++) {
        const q = particlePos(tr, i, n, local + tr.len / num(f.speed, 80), num(f.speed, 80), seed, w * 0.18, 0);
        if (!q) continue;
        drawParticle(env, kind, q.x, q.y, size, q.a, local, seed + i, f.color, ph.alpha);
      }
    }
    if (typeof p.label === "string" && p.label) {
      const { p: lp } = tr.at(num(p.labelAt, 0.5));
      const b = pathLabel(env, p, lp, w / 2 + 12);
      drawText(env, b, "center", clamp((ph.local - ph.dur * 0.6) / 0.8), p.labelColor ?? "ink", ph.alpha);
    }
  },
};

// ───────────────────────────── journey ─────────────────────────────

export const Journey: Component = {
  inDur: () => 0.4,
  bounds: (env, p, el) => resolvePath(env, p, el.id)?.bbox(num(p.size, 70) / 2) ?? null,
  draw: (env, p, ph, el) => {
    const tr = resolvePath(env, p, el.id);
    if (!tr) return;
    const travel = Math.max(0.5, num(p.travel, 4));
    const raw = ph.local / travel;
    const s = p.loop ? raw % 1 : ease.inOut(clamp(raw));
    const { p: pos, a } = tr.at(s);
    if (p.trail) {
      const { ctx } = env;
      ctx.save();
      ctx.globalAlpha *= ph.alpha * 0.5;
      ctx.setLineDash([6, 10]);
      ctx.strokeStyle = color(env.tokens, p.trailColor ?? "muted");
      ctx.lineWidth = 3;
      const pts = tr.upTo(s);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const q of pts.slice(1)) ctx.lineTo(q[0], q[1]);
      ctx.stroke();
      ctx.restore();
    }
    const bob = Math.sin(ph.local * 4) * num(p.bob, 3);
    const kind = String(p.kind ?? "raindrop");
    const size = num(p.size, 70);
    const absT = el.at + ph.local;
    if (!drawProp(env, kind, pos[0], pos[1] + bob, size, {
      t: ph.local, color: p.color, rotate: p.rotateAlong ? a : 0, alpha: ph.alpha * clamp(ph.k * 2), seed: hash(el.id) % 97,
      face: p.face ?? cartoonDefault(env), talk: p.talk ? talkAt(env, absT) : 0, mood: p.mood, state: num(p.state, 0),
    })) drawParticle(env, kind, pos[0], pos[1] + bob, size, a, ph.local, 3, p.color, ph.alpha);
    if (typeof p.label === "string" && p.label) {
      const b = labelBlock(env, p.label, pos[0], pos[1] + size / 2 + 8, "sm", 220);
      drawText(env, b, "center", 1, p.labelColor ?? "ink", ph.alpha);
    }
  },
};

// ───────────────────────────── label with leader line ─────────────────────────────

export const Label: Component = {
  inDur: () => 0.9,
  bounds: (env, p) => labelBlock(env, String(p.text ?? ""), num(p.x, 640), num(p.y, 360), p.size ?? "sm", num(p.maxWidth, 240)).rect,
  draw: (env, p, ph, el) => {
    const b = labelBlock(env, String(p.text ?? ""), num(p.x, 640), num(p.y, 360), p.size ?? "sm", num(p.maxWidth, 240));
    const tgt = env.pointOf(p.target);
    const { ctx } = env;
    const col = color(env.tokens, p.color ?? "inkSoft");
    if (tgt) {
      const r = b.rect;
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      // leave the label from the side facing the target
      const from: P = Math.abs(tgt[0] - cx) / (r.w / 2 + 1) > Math.abs(tgt[1] - cy) / (r.h / 2 + 1)
        ? [tgt[0] > cx ? r.x + r.w + 6 : r.x - 6, cy]
        : [cx, tgt[1] > cy ? r.y + r.h + 4 : r.y - 4];
      const k = ease.inOut(clamp(ph.k / 0.55));
      ctx.save();
      ctx.globalAlpha *= ph.alpha;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(from[0], from[1]);
      ctx.lineTo(lerp(from[0], tgt[0], k), lerp(from[1], tgt[1], k));
      ctx.stroke();
      if (p.dot !== false && k >= 1) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(tgt[0], tgt[1], 4.5, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    } else if (p.target !== undefined) env.warn(el.id, `label target ${JSON.stringify(p.target)} not found`);
    drawText(env, b, "center", clamp((ph.k - 0.35) / 0.65), p.textColor ?? "ink", ph.alpha);
  },
};

// ───────────────────────────── guide character ─────────────────────────────
// Buddy acts the way rossark-motion-skill (MIT) describes a living character: poses flow into each other and never
// stop dead (`flow`), every channel carries a small idle layer, the head lags the body (follow-through by delay),
// arms are two segments with an elbow, left and right never mirror, he blinks every 3–4 s (close 110 ms,
// hold 40 ms, open 190 ms) and on every pose change, his eyes and face turn toward what he points at, and a
// cheer is a hop that squashes on landing while keeping its volume.

interface GPose { lean: number; armL: [number, number]; armR: [number, number]; tilt: number; hop: number }
const GPOSES: Record<string, GPose> = {
  idle: { lean: 0, armL: [18, 22], armR: [14, -18], tilt: 0, hop: 0 },
  wave: { lean: -3, armL: [20, 26], armR: [138, 42], tilt: -4, hop: 0 },
  point: { lean: 4, armL: [16, 24], armR: [90, 6], tilt: 3, hop: 0 },
  think: { lean: 2, armL: [34, -96], armR: [148, 118], tilt: 7, hop: 0 },
  cheer: { lean: 0, armL: [150, 12], armR: [156, -8], tilt: 0, hop: 1 },
};

function poseKeys(p: any, start: number): { at: number; pose: string }[] {
  const keys = [{ at: start, pose: String(p.pose ?? "idle") }];
  if (Array.isArray(p.poses)) for (const k of [...p.poses].filter((k: any) => typeof k?.at === "number").sort((a: any, b: any) => a.at - b.at)) keys.push({ at: k.at, pose: String(k.pose ?? "idle") });
  return keys;
}

function poseAt(p: any, absT: number): string {
  let pose = String(p.pose ?? "idle");
  for (const k of poseKeys(p, -1e9)) if (absT >= k.at) pose = k.pose;
  return pose;
}

/** One channel through the pose changes: each change flows over 0.45 s, never stopping at a key. */
function channel(keys: { at: number; pose: string }[], t: number, get: (g: GPose) => number): number {
  const pts: [number, number][] = [];
  let prev = get(GPOSES[keys[0].pose] ?? GPOSES.idle);
  pts.push([keys[0].at - 1, prev]);
  for (const k of keys.slice(1)) {
    const v = get(GPOSES[k.pose] ?? GPOSES.idle);
    pts.push([k.at, prev], [k.at + 0.45, v]);
    prev = v;
  }
  return flow(t, pts);
}

function blinkAt(t: number, changes: number[]): number {
  // seeded blinks every 3–4 s, plus one on each pose change
  const lid = (t0: number) => {
    const d = t - t0;
    if (d < 0 || d > 0.34) return 0;
    if (d < 0.11) return EASE_IN_OUT(d / 0.11);
    if (d < 0.15) return 1;
    return 1 - EASE_OUT((d - 0.15) / 0.19);
  };
  let v = 0;
  let b = 0.9;
  for (let i = 0; b < t + 1; i++) {
    v = Math.max(v, lid(b));
    b += 3 + seeded(i, 7) * 1.1;
  }
  for (const c of changes) v = Math.max(v, lid(c + 0.04));
  return v;
}

export const Guide: Component = {
  inDur: () => 0.9,
  bounds: (_env, p) => {
    const h = num(p.size, 190);
    return { x: num(p.x, 1100) - h * 0.45, y: num(p.y, 520) - h * 0.55, w: h * 0.9, h: h * 1.05 };
  },
  anchors: (_env, p) => {
    const h = num(p.size, 190);
    return { head: [num(p.x, 1100), num(p.y, 520) - h * 0.2], hand: [num(p.x, 1100) - h * 0.45, num(p.y, 520) - h * 0.05] };
  },
  draw: (env, p, ph, el) => {
    const absT = el.at + ph.local;
    const t = ph.local;
    const h = num(p.size, 190);
    const x0 = num(p.x, 1100), y0 = num(p.y, 520);
    const U = h / 100;
    const keys = poseKeys(p, el.at);
    const pose = poseAt(p, absT);
    const A = artFor(env, U);
    A.cartoon = true;
    const { ctx } = env;
    const body = p.color ?? "teal";
    const limb = mix(A.c(body), -0.16);
    const target = p.pointAt !== undefined ? env.pointOf(p.pointAt) : null;
    const lookP = p.lookAt !== undefined ? env.pointOf(p.lookAt) : target;
    // ── channels: key pose (flow) + idle waves + follow-through ──
    const lean = channel(keys, absT, (g) => g.lean) + 1.5 * wave(absT, 4.5);
    const leanLate = channel(keys, absT - 0.11, (g) => g.lean) + 1.5 * wave(absT - 0.11, 4.5);
    const tilt = channel(keys, absT, (g) => g.tilt) + 2 * wave(absT, 4.2, 0.3) - 0.45 * leanLate;
    const breathe = 0.015 * wave(absT, 2.6);
    const hopOn = channel(keys, absT, (g) => g.hop);
    // a cheer: hops on a 0.9 s cycle: crouch, leap (parabola), squash on landing
    let lift = 0, sy = 1 + breathe;
    if (hopOn > 0.01) {
      const c = loop(absT, 0.9);
      if (c < 0.12) sy -= 0.08 * bell(c / 0.12) * hopOn;
      else if (c < 0.72) {
        const k = (c - 0.12) / 0.6;
        lift = 26 * 4 * k * (1 - k) * hopOn;
        sy += 0.06 * (1 - Math.abs(2 * k - 1)) * hopOn;
      } else sy -= 0.16 * bell((c - 0.72) / 0.28) * hopOn;
    }
    // float-in entrance: rise from below on a soft spring, squash a little as it settles
    const enter = spring(t, 0.6, 1.8);
    const enterY = (1 - enter) * 70;
    if (t < 0.9) sy *= 1 - 0.06 * Math.max(0, Math.sin(Math.PI * clamp((t - 0.35) / 0.55)));
    const sx = 1 / Math.pow(Math.max(0.5, sy), 0.6); // keep the volume
    // arm angles (degrees): a = shoulder outward from hanging, e = elbow bend; never mirrored
    const arm = (side: "L" | "R", ph0: number): [number, number] => {
      let a = channel(keys, absT, (g) => (side === "L" ? g.armL[0] : g.armR[0])) + 4 * wave(absT, 3.0, ph0) + 2 * wave(absT, 1.8, ph0 + 0.3);
      let e = channel(keys, absT, (g) => (side === "L" ? g.armL[1] : g.armR[1])) + 5 * wave(absT, 2.25, ph0 + 0.6);
      e += 0.45 * (channel(keys, absT - 0.09, (g) => (side === "L" ? g.armL[0] : g.armR[0])) - channel(keys, absT, (g) => (side === "L" ? g.armL[0] : g.armR[0])));
      if (side === "R" && pose === "wave") e += 22 * wave(absT, 0.75);
      return [a, e];
    };
    let armL = arm("L", 0.1), armR = arm("R", 0.55);
    if (pose === "point" && target) {
      // aim the pointing arm at the target (in the character's own frame)
      const gx = (target[0] - x0) / U, gy = (target[1] - (y0 - lift * U)) / U;
      const side = gx < 0 ? "L" : "R";
      const ang = (Math.atan2(gx * (side === "L" ? -1 : 1), gy) * 180) / Math.PI; // 0 = hanging, 90 = sideways, 180 = up
      const blend = clamp((absT - (keys.filter((k) => k.pose === "point").pop()?.at ?? 0)) / 0.45);
      const aimed: [number, number] = [ang, 4];
      if (side === "L") armL = [lerp(armL[0], aimed[0], blend), lerp(armL[1], aimed[1], blend)];
      else armR = [lerp(armR[0], aimed[0], blend), lerp(armR[1], aimed[1], blend)];
    }
    // gaze and face turn (2.5D): pupils lead, the face slides toward the look, the outline stays
    let lx = 0, ly = 0;
    if (lookP) {
      const gx = lookP[0] - x0, gy = lookP[1] - (y0 - h * 0.05);
      const d = Math.hypot(gx, gy) || 1;
      lx = (gx / d) * 5;
      ly = (gy / d) * 3;
    }
    lx += 1.2 * smoothNoise(absT * 0.7, 5);
    const changes = keys.slice(1).map((k) => k.at);
    const lid = blinkAt(absT, changes);

    ctx.save();
    ctx.globalAlpha *= ph.alpha * clamp(t * 4);
    ctx.translate(x0, y0 + enterY);
    // shadow on the floor, shrinking as he rises
    ctx.save();
    ctx.globalAlpha *= 0.22 * (1 - lift / 60);
    ctx.fillStyle = "rgba(30,20,10,1)";
    ctx.filter = `blur(${(3 * U).toFixed(1)}px)`;
    ctx.beginPath();
    ctx.ellipse(0, 48 * U, 34 * U * (1 - lift / 90), 6 * U, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.translate(0, -lift * U);
    ctx.scale(U, U);
    ctx.translate(0, 46);
    ctx.scale(sx, sy);
    ctx.rotate((lean * Math.PI) / 180);
    ctx.translate(0, -46);
    const drawArm = (side: -1 | 1, [a, e]: [number, number]) => {
      const sxp = side * 28, syp = 4;
      const ar = (a * Math.PI) / 180, er = ((a + e) * Math.PI) / 180;
      const ex = sxp + side * Math.sin(ar) * 20, ey = syp + Math.cos(ar) * 20;
      const hx = ex + side * Math.sin(er) * 19, hy = ey + Math.cos(er) * 19;
      line(A, [[sxp, syp], [ex, ey], [hx, hy]], undefined, 9 + A.lw * 1.6);
      line(A, [[sxp, syp], [ex, ey], [hx, hy]], limb, 9);
      circle(A, hx, hy, 6.5, limb, { lw: A.lw * 0.7 });
    };
    // feet (the one carrying less weight lifts a touch)
    ellipse(A, -13 - lean * 0.2, 44, 11, 6, mix(A.c(body), -0.25));
    ellipse(A, 14 - lean * 0.2, 44 - Math.max(0, lean) * 0.4, 11, 6, mix(A.c(body), -0.25));
    // arms that hang go behind the body; raised arms come in front
    const front = (a: number) => a > 70;
    if (!front(armL[0])) drawArm(-1, armL);
    if (!front(armR[0])) drawArm(1, armR);
    shape(A, [[0, -46], [22, -30], [36, -2], [34, 26], [18, 42], [-18, 42], [-34, 26], [-36, -2], [-22, -30]], body);
    gloss(A, -16, -18, 7, 11, 0.4);
    if (front(armL[0])) drawArm(-1, armL);
    if (front(armR[0])) drawArm(1, armR);
    // face (head tilt applied around the neck)
    ctx.save();
    ctx.translate(0, 10);
    ctx.rotate((tilt * Math.PI) / 180);
    ctx.translate(0, -10);
    face(A, lx, 2 + ly, 26, absT, { force: true, seed: 3, talk: p.talk === false ? 0 : talkAt(env, absT), mood: pose === "think" ? "wow" : undefined });
    if (lid > 0.02) {
      // eyelids in body colour over the eyes (the face's own blink is replaced by this timed one)
      ctx.fillStyle = A.c(body);
      for (const dx of [-0.35, 0.35]) {
        ctx.beginPath();
        ctx.rect(lx + dx * 26 - 4.2, 2 + ly - 0.1 * 26 - 5.5, 8.4, 11 * lid);
        ctx.fill();
      }
    }
    if (pose === "think") for (const [i, r] of [[0, 3], [1, 5], [2, 9]] as const) circle(A, 34 + i * 10, -40 - i * 12 + 2 * wave(absT, 1.6, i * 0.2), r, "white", { lw: A.lw * 0.6 });
    ctx.restore();
    ctx.restore();
  },
};

// ───────────────────────────── Landscape (water cycle, weather, geography) ─────────────────────────────
// Built like a lit set, back to front: sky with a sun-side glow, light shafts, a far cloud bank and ridges that
// fade into the air (aerial perspective), lit mountains, a ground lit from the sun's side with grass texture,
// a river with a sheen, a sea that deepens with distance and sparkles on the sun's side, foreground grass that
// frames the bottom edge, and pollen drifting in the light. Every part is a pure function of time.

function landscapeLayout(p: any) {
  const H = num(p.horizon, 470);
  const seaSide = p.sea ?? "left";
  const mtSide = p.mountains ?? (seaSide === "left" ? "right" : "left");
  const sunSide = p.sun ?? (seaSide === "left" ? "left" : "right");
  const seaX0 = seaSide === "left" ? 0 : seaSide === "right" ? 760 : -1;
  const seaX1 = seaSide === "left" ? 520 : seaSide === "right" ? 1280 : -1;
  const mtX = mtSide === "right" ? 1020 : mtSide === "left" ? 260 : -1;
  const sunX = sunSide === "left" ? 170 : sunSide === "right" ? 1110 : -1;
  return { H, seaSide, mtSide, sunSide, seaX0, seaX1, mtX, sunX };
}

/** Where the landscape's trees stand: [x, size] each (shared by draw and parts). */
function landscapeTrees(p: any, id: string): [number, number][] {
  const L = landscapeLayout(p);
  const n = Math.round(clamp(num(p.trees, 3), 0, 8));
  const r = rng(hash(id + "trees"));
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const span0 = L.seaSide === "left" ? L.seaX1 + 60 : 80;
    const span1 = L.mtX >= 0 ? (L.mtSide === "right" ? L.mtX - 160 : L.mtX + 160) : 1200;
    const x = lerp(Math.min(span0, span1), Math.max(span0, span1), (i + 0.5) / n) + (r() - 0.5) * 40;
    out.push([x, 90 + r() * 30]);
  }
  return out;
}

function ridge(y: number, amp: number, seed: number, step = 40): P[] {
  const pts: P[] = [];
  for (let x = -40; x <= 1320; x += step) {
    pts.push([x, y - amp * (0.55 + 0.45 * Math.sin(x * 0.006 + seed) * Math.sin(x * 0.013 + seed * 2.3)) - amp * 0.25 * Math.sin(x * 0.03 + seed * 5)]);
  }
  return pts;
}

export const Landscape: Component = {
  inDur: () => 1.6,
  bounds: () => ({ x: 0, y: 0, w: 1280, h: 720 }),
  anchors: (_env, p) => {
    const L = landscapeLayout(p);
    const seaMid = (L.seaX0 + L.seaX1) / 2;
    const out: Record<string, P> = { sky: [640, 120], land: [L.seaSide === "left" ? 820 : 460, L.H + 80], ground: [640, L.H + 40] };
    if (L.sunX >= 0) out.sun = [L.sunX, 120];
    if (L.seaX0 >= 0) {
      out.sea = [seaMid, L.H + 90];
      out.seaSurface = [seaMid, L.H + 6];
    }
    if (L.mtX >= 0) {
      out.mountain = [L.mtX, L.H - 230];
      out.mountainSide = [L.mtX + (L.mtSide === "right" ? -110 : 110), L.H - 90];
    }
    if (p.river !== false && L.seaX0 >= 0 && L.mtX >= 0) {
      out.river = [(L.mtX + (L.seaSide === "left" ? L.seaX1 : L.seaX0)) / 2, L.H + 70];
      out.riverMouth = [L.seaSide === "left" ? L.seaX1 : L.seaX0, L.H + 40];
    }
    out.cloudLeft = [300, 110];
    out.cloudRight = [940, 110];
    out.cloud = [640, 100];
    return out;
  },
  parts: (_env, p, el) => {
    const L = landscapeLayout(p);
    const out: { name: string; rect: Rect }[] = [];
    if (L.sunX >= 0) out.push({ name: p.time === "night" ? "moon" : "sun", rect: { x: L.sunX - 62, y: 58, w: 124, h: 124 } });
    for (const [x, s] of landscapeTrees(p, el.id)) out.push({ name: "tree", rect: { x: x - s * 0.32, y: L.H - 30 - s * 0.45, w: s * 0.64, h: s * 0.9 } });
    // optional sky clouds (they sway ±16 px; see the draw below)
    const nClouds = Math.round(clamp(num(p.clouds, 0), 0, 4));
    for (let i = 0; i < nClouds; i++) {
      const x = nClouds === 1 ? 640 : 300 + i * (680 / Math.max(1, nClouds - 1 || 1));
      const y = 100 + (i % 2) * 30;
      out.push({ name: "cloud", rect: { x: x - 55 - 16, y: y - 34, w: 110 + 32, h: 68 } });
    }
    return out;
  },
  draw: (env, p, ph, el) => {
    paintLandscape(env, p, ph, el);
  },
};

function landscapeLayers(env0: Env, p: any, el: SceneElement, gc: any, t: number, k: number, alphaIn: number, parts: Set<string>) {
    const env = { ...env0, ctx: gc } as Env;
    const ctx = gc;
    const ph = { alpha: alphaIn };
    const L = landscapeLayout(p);
    const A = artFor(env, 1);
    const on = (part: string) => parts.has(part);
    const LA = num(((env.tokens as any).art ?? {}).landAlpha, 1); // how strongly the land, sea and sky are painted
    const time = p.time ?? "day";
    const night = time === "night", dusk = time === "dusk";
    const sunX = L.sunX >= 0 ? L.sunX : 640, sunY = 120;
    ctx.save();
    ctx.globalAlpha *= ph.alpha;

    // ── sky: zenith → horizon, warmer toward the sun ──
    const skyA = clamp(k / 0.35);
    ctx.save();
    ctx.globalAlpha *= skyA * LA;
    if (on("sky")) {
    const g = ctx.createLinearGradient(0, 0, 0, L.H + 10);
    if (night) { g.addColorStop(0, "#1C2442"); g.addColorStop(0.7, "#36406A"); g.addColorStop(1, "#5A6488"); }
    else if (dusk) { g.addColorStop(0, "#4E5C94"); g.addColorStop(0.55, "#E39A7A"); g.addColorStop(1, "#F8D3A0"); }
    else { g.addColorStop(0, mix(A.c("skyTop"), -0.12)); g.addColorStop(0.55, A.c("skyTop")); g.addColorStop(1, mix(A.c("sky"), 0.35)); }
    ctx.fillStyle = g;
    ctx.fillRect(-60, -60, 1400, L.H + 70);
    // sun-side glow on the sky
    const glow = ctx.createRadialGradient(sunX, sunY + 40, 10, sunX, sunY + 40, 620);
    glow.addColorStop(0, night ? "rgba(200,210,255,0.25)" : "rgba(255,236,190,0.55)");
    glow.addColorStop(0.45, night ? "rgba(200,210,255,0.06)" : "rgba(255,226,170,0.16)");
    glow.addColorStop(1, "rgba(255,226,170,0)");
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = glow;
    ctx.fillRect(-60, -60, 1400, L.H + 70);
    }
    // light shafts from the sun, turning very slowly
    ctx.globalCompositeOperation = "screen";
    if (on("rays") && L.sunX >= 0 && !night && p.rays !== false) {
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + t * 0.025 + 0.2;
        const spread = 0.06 + 0.03 * Math.sin(i * 2.7);
        const len = 900;
        ctx.globalAlpha = skyA * ph.alpha * (0.06 + 0.035 * Math.sin(t * 0.4 + i));
        ctx.fillStyle = "rgba(255,244,214,1)";
        ctx.beginPath();
        ctx.moveTo(sunX, sunY);
        ctx.lineTo(sunX + Math.cos(a - spread) * len, sunY + Math.sin(a - spread) * len);
        ctx.lineTo(sunX + Math.cos(a + spread) * len, sunY + Math.sin(a + spread) * len);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();

    // ── far cloud bank and ridges, faded into the air ──
    const farK = clamp((k - 0.15) / 0.35);
    if (farK > 0 && on("far")) {
      ctx.save();
      ctx.globalAlpha *= farK * LA;
      const haze = mix(A.c("sky"), 0.25);
      ctx.save();
      if (p.farClouds === false) ctx.globalAlpha = 0;
      ctx.filter = "blur(6px)";
      ctx.globalAlpha *= 0.55;
      ctx.fillStyle = "#FFFFFF";
      for (let i = 0; i < 7; i++) {
        const cx = ((i * 211 + t * 3) % 1500) - 100;
        ctx.beginPath();
        ctx.ellipse(cx, L.H - 150 + Math.sin(i * 1.7) * 18, 120 + (i % 3) * 40, 26 + (i % 2) * 10, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      const far = ridge(L.H - 70, 70, 3.1);
      poly(A, [...far, [1320, L.H + 20], [-40, L.H + 20]], mix(A.c("mountain"), 0.55), { stroke: false, alpha: 0.55 });
      const near = ridge(L.H - 28, 46, 7.4, 30);
      poly(A, [...near, [1320, L.H + 20], [-40, L.H + 20]], mix(A.c(p.ground === "snow" ? "snow" : "leafDark"), 0.45), { stroke: false, alpha: 0.6 });
      // horizon haze
      const hz = ctx.createLinearGradient(0, L.H - 120, 0, L.H + 20);
      hz.addColorStop(0, "rgba(255,255,255,0)");
      hz.addColorStop(1, haze);
      ctx.globalAlpha *= 0.55;
      ctx.fillStyle = hz;
      ctx.fillRect(-60, L.H - 120, 1400, 140);
      ctx.restore();
    }

    // ── sun / moon ──
    if (on("sun") && L.sunX >= 0) drawProp(env, night ? "moon" : "sun", L.sunX, 120 + (1 - ease.out(clamp((k - 0.2) / 0.4))) * 60, 150, { t, alpha: clamp((k - 0.2) / 0.3), face: A.cartoon && p.faces !== false, seed: 1, talk: 0 });

    // ── mountains (lit by the sun's side) ──
    const mk = clamp((k - 0.3) / 0.35);
    if (on("mountains") && L.mtX >= 0 && mk > 0) {
      const s = ease.out(mk);
      ctx.save();
      ctx.translate(0, (1 - s) * 80);
      ctx.globalAlpha *= mk;
      drawProp(env, "mountain", L.mtX + (L.mtSide === "right" ? 70 : -70), L.H - 110, 220, { t, flip: L.mtSide === "left", color: mix(A.c("mountainDark"), 0.18), seed: 2 });
      drawProp(env, "mountain", L.mtX, L.H - 140, 300, { t, flip: L.mtSide === "left", seed: 3 });
      ctx.restore();
    }

    // ── ground: lit from the sun's side, darker toward the viewer, grass texture ──
    const gk = clamp((k - 0.15) / 0.35);
    const ground = p.ground ?? "grass";
    const gcol = A.c(ground === "sand" || ground === "desert" ? "sand" : ground === "snow" ? "snow" : "grass");
    if (on("ground")) {
    ctx.save();
    ctx.globalAlpha *= gk * Math.max(LA, 0.5);
    ctx.translate(0, (1 - ease.out(gk)) * 40);
    const groundPts: P[] = [];
    for (let x = -60; x <= 1340; x += 40) groundPts.push([x, L.H + Math.sin(x * 0.012 + 1) * 8]);
    const gg = ctx.createLinearGradient(0, L.H, 0, 730);
    gg.addColorStop(0, mix(gcol, 0.22));
    gg.addColorStop(0.35, gcol);
    gg.addColorStop(1, mix(gcol, -0.2));
    ctx.beginPath();
    ctx.moveTo(groundPts[0][0], groundPts[0][1]);
    for (const q of groundPts.slice(1)) ctx.lineTo(q[0], q[1]);
    ctx.lineTo(1340, 760);
    ctx.lineTo(-60, 760);
    ctx.closePath();
    ctx.fillStyle = gg;
    ctx.fill();
    // warm light falling across the ground from the sun's side
    const sl = ctx.createLinearGradient(sunX, L.H, sunX > 640 ? sunX - 1100 : sunX + 1100, L.H + 200);
    sl.addColorStop(0, "rgba(255,236,180,0.22)");
    sl.addColorStop(1, "rgba(255,236,180,0)");
    ctx.fillStyle = sl;
    ctx.fill();
    line(A, groundPts, undefined, 3);
    if (ground === "grass") {
      const rr = rng(hash(el.id + "blades"));
      ctx.strokeStyle = mix(gcol, -0.28);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      for (let i = 0; i < 140; i++) {
        const x = rr() * 1300 - 10, y = L.H + 20 + rr() ** 1.6 * 240;
        const h = 6 + (y - L.H) * 0.045;
        const sway = Math.sin(t * 1.3 + x * 0.02) * 2;
        ctx.globalAlpha = gk * ph.alpha * (0.35 + 0.3 * rr());
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + sway * 0.5, y - h * 0.6, x + sway, y - h);
        ctx.stroke();
      }
    }
    ctx.restore();
    }

    // ── river: water with a moving sheen ──
    if ((on("river") || on("riverGlints")) && p.river !== false && L.seaX0 >= 0 && L.mtX >= 0) {
      const rk = clamp((k - 0.5) / 0.4);
      const end: P = [L.seaSide === "left" ? L.seaX1 - 20 : L.seaX0 + 20, L.H + 46];
      const start: P = [L.mtX + (L.mtSide === "right" ? -80 : 80), L.H - 4];
      const tr = new Track(catmull([start, [lerp(start[0], end[0], 0.35), L.H + 70], [lerp(start[0], end[0], 0.7), L.H + 30], end]));
      const pts = tr.upTo(ease.inOut(rk));
      if (pts.length > 1) {
        if (on("river")) {
          line(A, pts, undefined, 26 + A.lw * 2);
          line(A, pts, "waterDeep", 26);
          line(A, pts, "water", 18);
          line(A, pts.map(([x, y]) => [x - 3, y - 4] as P), "waterLight", 4, 0.55);
        }
        for (let i = 0; i < 10 && rk >= 1 && on("riverGlints"); i++) {
          const s = (t * 0.12 + i / 10) % 1;
          const q = tr.at(s);
          line(A, [[q.p[0] - 9, q.p[1] - 2], [q.p[0] + 9, q.p[1] + 1]], "white", 3, 0.8 * Math.sin(s * Math.PI));
        }
      }
    }

    // ── trees ──
    const trees = on("trees") ? landscapeTrees(p, el.id) : [];
    trees.forEach(([x, s], i) => {
      const tk = clamp((k - 0.55 - i * 0.04) / 0.3);
      if (tk <= 0) return;
      drawProp(env, i % 3 === 1 ? "pine" : "tree", x, L.H - 30, s, { t, alpha: tk, seed: i, scaleY: ease.outBack(tk) });
    });

    // ── sea: deepens with distance from the shore, sparkles on the sun's side, foam laps the beach ──
    if (on("sea") && L.seaX0 >= 0) {
      const sk = clamp((k - 0.35) / 0.4);
      const left = L.seaSide === "left";
      const x0 = left ? -60 : L.seaX0 + 60, x1 = left ? L.seaX1 - 60 : 1340;
      const shoreTop = left ? x1 + 60 : x0 - 60;
      const shoreBot = left ? x1 - 150 : x0 + 150;
      ctx.save();
      ctx.globalAlpha *= sk * Math.max(LA, 0.5);
      poly(A, left ? [[shoreTop + 46, L.H + 4], [shoreBot + 70, 760], [shoreBot - 20, 760], [shoreTop - 20, L.H + 8]] : [[shoreTop - 46, L.H + 4], [shoreBot - 70, 760], [shoreBot + 20, 760], [shoreTop + 20, L.H + 8]], "sand", { stroke: false });
      const pts: P[] = [];
      for (let x = x0; x <= x1; x += 10) pts.push([x, L.H + 2 + Math.sin(x * 0.05 + t * 1.6) * 3]);
      const lap = Math.sin(t * 1.3) * 6;
      const outline: P[] = left ? [...pts, [shoreTop + lap, L.H + 12], [shoreBot + lap * 0.5, 760], [-60, 760]] : [[shoreTop + lap, L.H + 12], ...pts, [1340, 760], [shoreBot + lap * 0.5, 760]];
      const sg = ctx.createLinearGradient(0, L.H, 0, 730);
      sg.addColorStop(0, mix(A.c("water"), 0.3));
      sg.addColorStop(0.25, A.c("water"));
      sg.addColorStop(1, A.c("waterDeep"));
      ctx.beginPath();
      ctx.moveTo(outline[0][0], outline[0][1]);
      for (const q of outline.slice(1)) ctx.lineTo(q[0], q[1]);
      ctx.closePath();
      ctx.fillStyle = sg;
      ctx.fill();
      line(A, left ? [...pts, [shoreTop + lap, L.H + 12]] : [[shoreTop + lap, L.H + 12], ...pts], undefined, 3);
      line(A, [[shoreTop + lap, L.H + 12], [shoreBot + lap * 0.5, 760]], "white", 5, 0.75);
      // rolling wave crests
      for (let i = 0; i < 6; i++) {
        const wx = Math.min(x0, x1) + 40 + ((i * 97 + t * 14) % Math.max(1, Math.abs(x1 - x0) - 200));
        const wy = L.H + 36 + (i % 3) * 52 + (i % 2) * 14;
        line(A, [[wx - 16, wy], [wx - 5, wy - 4], [wx + 6, wy], [wx + 18, wy - 4]], "waterLight", 3, 0.85);
      }
      // sun glints: bright dashes that twinkle on the side nearer the sun
      if (!night) {
        const gr = rng(hash(el.id + "glint"));
        ctx.globalCompositeOperation = "screen";
        for (let i = 0; i < 26; i++) {
          const gx = lerp(Math.min(x0, x1), Math.max(x0, x1), gr());
          const gy = L.H + 8 + gr() ** 1.8 * 200;
          const near = 1 - Math.min(1, Math.abs(gx - sunX) / 700);
          const tw = Math.max(0, Math.sin(t * (2 + gr() * 3) + i * 1.9));
          ctx.globalAlpha = sk * ph.alpha * near * tw * 0.9;
          ctx.fillStyle = "#FFF6D8";
          ctx.fillRect(gx - 6 * (1 - gy / 800), gy, 12 * (1 - gy / 800) + 2, 2);
        }
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.restore();
    }

    // ── clouds (scene clouds are Props; these are optional extras) ──
    const nClouds = on("clouds") ? Math.round(clamp(num(p.clouds, 0), 0, 4)) : 0;
    for (let i = 0; i < nClouds; i++) {
      const ck = clamp((k - 0.6) / 0.3);
      const x = 300 + i * (680 / Math.max(1, nClouds - 1 || 1)) + Math.sin(t * 0.2 + i) * 16;
      drawProp(env, "cloud", nClouds === 1 ? 640 : x, 100 + (i % 2) * 30, 110, { t, alpha: ck, seed: 10 + i, face: false });
    }

    // ── foreground grass framing the bottom edge, and pollen drifting in the light ──
    if (on("fg") && p.foreground !== false && ground === "grass") {
      const fk = clamp((k - 0.7) / 0.3);
      ctx.save();
      ctx.globalAlpha *= fk;
      ctx.filter = "blur(2.5px)"; // foreground, out of focus
      for (const [cx, dir] of [[40, 1], [1240, -1]] as const) {
        const fr = rng(hash(el.id + "fg" + cx));
        for (let i = 0; i < 16; i++) {
          const bx = cx + dir * fr() * 150;
          const h = 70 + fr() * 90;
          const sway = Math.sin(t * 1.1 + i) * 6;
          ctx.fillStyle = mix(A.c("leafDark"), -0.25 + fr() * 0.15);
          ctx.beginPath();
          ctx.moveTo(bx - 6, 740);
          ctx.quadraticCurveTo(bx + sway * 0.4 + dir * 6, 740 - h * 0.6, bx + sway + dir * 14, 740 - h);
          ctx.quadraticCurveTo(bx + sway * 0.4 + dir * 10, 740 - h * 0.5, bx + 7, 740);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
    }
    if (on("pollen") && !night && p.pollen !== false) {
      const pr = rng(hash(el.id + "pollen"));
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (let i = 0; i < 18; i++) {
        const px0 = pr() * 1280, py0 = pr() * L.H, sp = 4 + pr() * 10;
        const px = (px0 + t * sp + Math.sin(t * 0.7 + i) * 20) % 1300;
        const py = py0 + Math.sin(t * 0.5 + i * 2) * 14;
        ctx.globalAlpha = ph.alpha * clamp((k - 0.8) / 0.2) * (0.25 + 0.35 * Math.sin(t * 1.3 + i) ** 2);
        ctx.fillStyle = "#FFF4CF";
        ctx.beginPath();
        ctx.arc(px, py, 1.6 + pr() * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
}

// After the build-in, the parts that don't change (sky, ridges, mountains, ground, river bed, trees; the light
// shafts; the foreground grass) are painted once into high-resolution layers and blitted through the camera; only
// the living parts (sun, sea, river glints, clouds, pollen) are drawn each frame. ~5× faster, same picture.
const ALL_PARTS = new Set(["sky", "rays", "far", "sun", "mountains", "ground", "river", "riverGlints", "trees", "sea", "clouds", "fg", "pollen"]);
const landCache = new Map<string, { back: any; rays: any; fg: any }>();
const LC = { x: -80, y: -80, w: 1440, h: 880, s: 1.4 };

function paintLandscape(env: Env, p: any, ph: { local: number; k: number; alpha: number }, el: SceneElement) {
  const ctx = env.ctx;
  if (ph.k < 1 || env.depth > 0) {
    landscapeLayers(env, p, el, ctx, ph.local, ph.k, ph.alpha, ALL_PARTS);
    return;
  }
  const key = `${el.id}|${env.tokens.id}|${env.seed}|${JSON.stringify(p)}`;
  let c = landCache.get(key);
  if (!c) {
    const make = (parts: string[]) => {
      const cv = env.makeCanvas(Math.round(LC.w * LC.s), Math.round(LC.h * LC.s));
      const g = cv.getContext("2d");
      g.setTransform(LC.s, 0, 0, LC.s, -LC.x * LC.s, -LC.y * LC.s);
      landscapeLayers(env, p, el, g, 0, 1, 1, new Set(parts));
      const art: any = (env.tokens as any).art ?? {};
      applyTexture(env, g, Math.round(LC.w * LC.s), Math.round(LC.h * LC.s), art.texture, num(art.textureStrength, 1) * 0.8);
      g.getImageData(0, 0, 1, 1);
      return cv;
    };
    c = { back: make(["sky", "rays", "far", "mountains", "ground", "river", "trees"]), rays: null, fg: make(["fg"]) };
    if (landCache.size > 6) landCache.clear();
    landCache.set(key, c);
  }
  const blit = (cv: any, a: number, op = "source-over") => {
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.globalCompositeOperation = op as any;
    ctx.drawImage(cv, LC.x, LC.y, LC.w, LC.h);
    ctx.restore();
  };
  blit(c.back, ph.alpha);
  landscapeLayers(env, p, el, ctx, ph.local, 1, ph.alpha, new Set(["sun", "riverGlints", "sea", "clouds"]));
  blit(c.fg, ph.alpha);
  landscapeLayers(env, p, el, ctx, ph.local, 1, ph.alpha, new Set(["pollen"]));
}

// ───────────────────────────── Nephron (kidney's working unit) ─────────────────────────────

const NEPHRON_PATHS: Record<string, P[]> = {
  afferent: [[-300, -250], [-250, -215], [-212, -190], [-190, -180]],
  efferent: [[-190, -160], [-205, -130], [-230, -100], [-240, -60]],
  pct: [[-148, -165], [-110, -205], [-70, -180], [-60, -140], [-20, -150], [10, -190], [40, -160], [30, -120], [60, -100]],
  descending: [[60, -100], [62, 0], [64, 120], [70, 200]],
  loop: [[70, 200], [95, 232], [120, 200]],
  ascending: [[120, 200], [118, 100], [116, 0], [120, -80]],
  dct: [[120, -80], [150, -130], [190, -110], [180, -60], [215, -40], [240, -80]],
  duct: [[240, -80], [250, -200], [250, -230], [250, -80], [252, 100], [255, 260]],
  capillary: [[-240, -60], [-180, -40], [-60, -60], [20, -70], [92, -60], [96, 60], [98, 180], [96, 230], [92, 60], [90, -60], [160, -20], [210, 10], [290, 20]],
};
// collecting duct drawn from top (beyond the DCT junction) to bottom
NEPHRON_PATHS.duct = [[250, -250], [250, -80], [252, 100], [255, 262]];

const NEPHRON_LABELS: Record<string, { text: string; at: P; label: P }> = {
  glomerulus: { text: "Glomerulus", at: [-170, -170], label: [-300, -120] },
  capsule: { text: "Bowman's capsule", at: [-150, -205], label: [-230, -265] },
  pct: { text: "Proximal tubule", at: [10, -185], label: [-10, -255] },
  descending: { text: "Descending limb", at: [62, 60], label: [-90, 40] },
  loop: { text: "Loop of Henle", at: [95, 232], label: [-40, 225] },
  ascending: { text: "Ascending limb", at: [117, 80], label: [-40, 140] },
  dct: { text: "Distal tubule", at: [190, -110], label: [180, -190] },
  duct: { text: "Collecting duct", at: [252, 120], label: [300, 60] },
  afferent: { text: "Blood in", at: [-280, -238], label: [-300, -205] },
  efferent: { text: "Blood out", at: [-238, -70], label: [-300, -40] },
  capillary: { text: "Capillaries", at: [96, 160], label: [190, 160] },
};

function nephronXf(p: any) {
  const s = num(p.scale, 1);
  const cx = num(p.x, 640), cy = num(p.y, 380);
  return { s, cx, cy, map: (q: P): P => [cx + q[0] * s, cy + q[1] * s] };
}

function flowOn(p: any, kind: string, absT: number): number {
  const fl = Array.isArray(p.flows) ? p.flows : [];
  const f = fl.find((x: any) => x?.kind === kind);
  if (!f) return -1;
  const at = num(f.at, -1e9);
  return absT >= at ? absT - at : -1;
}

export const Nephron: Component = {
  inDur: () => 2.4,
  bounds: (_env, p) => {
    const { s, cx, cy } = nephronXf(p);
    const lab = p.labels ? 90 : 0;
    return { x: cx - (310 + lab) * s, y: cy - 270 * s, w: (310 + 300 + lab * 2) * s, h: 540 * s };
  },
  anchors: (_env, p) => {
    const { map } = nephronXf(p);
    const out: Record<string, P> = {};
    for (const [k, v] of Object.entries(NEPHRON_LABELS)) out[k] = map(v.at);
    out.ductEnd = map([255, 262]);
    out.cortex = map([-200, -240]);
    out.medulla = map([-200, 150]);
    return out;
  },
  draw: (env, p, ph, el) => {
    const { ctx } = env;
    const { s, map } = nephronXf(p);
    const A = artFor(env, 1);
    const absT = el.at + ph.local;
    const k = ph.k;
    const hl: string[] = Array.isArray(p.highlight) ? p.highlight : typeof p.highlight === "string" ? [p.highlight] : [];
    const dimOf = (part: string) => (hl.length && !hl.includes(part) ? 0.35 : 1);
    ctx.save();
    ctx.globalAlpha *= ph.alpha;
    // zones
    if (p.zones !== false) {
      const z0 = map([-310, -270]), z1 = map([310, 30]);
      ctx.save();
      ctx.globalAlpha *= 0.18 * clamp(k / 0.2);
      ctx.fillStyle = A.c("tissue");
      ctx.fillRect(z0[0], z0[1], z1[0] - z0[0], z1[1] - z0[1]);
      ctx.fillStyle = A.c("tissueDark");
      const m1 = map([310, 270]);
      ctx.fillRect(z0[0], z1[1], z1[0] - z0[0], m1[1] - z1[1]);
      ctx.restore();
      const lc = map([-300, 18]), lm = map([-300, 258]);
      ctx.save();
      ctx.globalAlpha *= 0.7 * clamp(k / 0.3);
      ctx.font = `600 ${Math.round(18 * Math.max(0.8, s))}px ${env.tokens.fonts.hand}`;
      ctx.fillStyle = color(env.tokens, "muted");
      ctx.fillText("CORTEX", lc[0] + 8, lc[1]);
      ctx.fillText("MEDULLA", lm[0] + 8, lm[1]);
      ctx.restore();
    }
    const tube = (name: string, col: string, w: number, start: number, dur: number) => {
      const kk = ease.inOut(clamp((k - start) / dur));
      if (kk <= 0) return null;
      const tr = new Track(catmull(NEPHRON_PATHS[name].map(map)));
      const pts = tr.upTo(kk);
      ctx.save();
      ctx.globalAlpha *= dimOf(name);
      line(A, pts, undefined, (w + A.lw * 2) * s);
      line(A, pts, col, w * s);
      if (hl.includes(name)) line(A, pts, "accent", 3, 0.7 + 0.3 * Math.sin(absT * 4));
      ctx.restore();
      return tr;
    };
    // blood side
    const cap = tube("capillary", "blood", 9, 0.55, 0.35);
    const aff = tube("afferent", "blood", 16, 0.0, 0.2);
    const eff = tube("efferent", "blood", 13, 0.25, 0.2);
    // capsule + glomerulus
    const gk = clamp((k - 0.15) / 0.25);
    if (gk > 0) {
      const c = map([-170, -170]);
      ctx.save();
      ctx.globalAlpha *= gk;
      ctx.globalAlpha *= Math.max(dimOf("capsule"), dimOf("glomerulus"));
      ctx.beginPath();
      ctx.arc(c[0], c[1], 46 * s, -Math.PI * 0.15, Math.PI * 1.85 - 0.6);
      ctx.strokeStyle = A.outline;
      ctx.lineWidth = 11 * s + A.lw * 2;
      ctx.stroke();
      ctx.strokeStyle = A.c("cell");
      ctx.lineWidth = 11 * s;
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.globalAlpha *= gk * dimOf("glomerulus");
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU + 0.3;
        const rr = (i % 2 ? 16 : 22) * s;
        circle(A, c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr, 9 * s, "blood", { lw: A.lw * 0.6 });
      }
      circle(A, c[0], c[1], 10 * s, "bloodDark", { lw: A.lw * 0.6 });
      if (hl.includes("glomerulus") || hl.includes("capsule")) {
        ctx.beginPath();
        ctx.arc(c[0], c[1], 58 * s, 0, TAU);
        ctx.strokeStyle = color(env.tokens, "accent");
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 6]);
        ctx.stroke();
      }
      ctx.restore();
    }
    // tubule (filtrate side)
    const pct = tube("pct", "cell", 13, 0.3, 0.2);
    const desc = tube("descending", "cell", 12, 0.45, 0.15);
    const loop = tube("loop", "cell", 12, 0.58, 0.08);
    const asc = tube("ascending", "cell", 14, 0.64, 0.14);
    const dct = tube("dct", "cell", 13, 0.75, 0.12);
    const duct = tube("duct", "urine", 17, 0.8, 0.2);
    ctx.restore();
    if (k < 1) return;
    // flows
    const seed = hash(el.id) % 500;
    const run = (tr: Track | null, kind: string, n: number, speed: number, size: number, local: number, col?: string, alpha = 1) => {
      if (!tr || local < 0) return;
      for (let i = 0; i < n; i++) {
        const q = particlePos(tr, i, n, local + tr.len / speed, speed, seed + n, 0, 0);
        if (q) drawParticle(env, kind, q.x, q.y, size * s, q.a, local, seed + i, col, ph.alpha * alpha);
      }
    };
    const bl = flowOn(p, "blood", absT);
    if (bl >= 0) {
      run(aff, "rbc", 5, 70 * s, 13, bl);
      run(eff, "rbc", 4, 60 * s, 11, bl);
      run(cap, "rbc", 18, 60 * s, 9, bl);
    }
    const fi = flowOn(p, "filtrate", absT);
    if (fi >= 0) {
      for (const [tr, n] of [[pct, 10], [desc, 7], [loop, 3], [asc, 7], [dct, 6]] as const) run(tr, "water", n, 50 * s, 7, fi, undefined, 0.95);
      // filtration: small particles pushed from glomerulus into the capsule
      const c = map([-170, -170]);
      for (let i = 0; i < 8; i++) {
        const ss = ((fi * 0.8 + i / 8) % 1);
        const a = (i / 8) * TAU;
        drawParticle(env, "water", c[0] + Math.cos(a) * (14 + ss * 26) * s, c[1] + Math.sin(a) * (14 + ss * 26) * s, 6 * s, 0, fi, i, undefined, ph.alpha * (1 - ss));
      }
    }
    const re = flowOn(p, "reabsorb", absT);
    if (re >= 0) {
      // water, glucose and salt leave the tubule toward the capillaries
      const spots: [Track | null, number, string][] = [[pct, 0.35, "glucose"], [pct, 0.7, "water"], [desc, 0.5, "water"], [asc, 0.4, "salt"], [dct, 0.5, "salt"]];
      for (const [i, [tr, at, kind]] of spots.entries()) {
        if (!tr) continue;
        const { p: q } = tr.at(at);
        const tgt: P = [q[0] + 28 * s, q[1] + 22 * s];
        for (let j = 0; j < 3; j++) {
          const ss = ((re * 0.7 + j / 3 + i * 0.13) % 1);
          drawParticle(env, kind, lerp(q[0], tgt[0], ss), lerp(q[1], tgt[1], ss), 9 * s, 0, re, i * 3 + j, undefined, ph.alpha * Math.sin(ss * Math.PI));
        }
      }
    }
    const se = flowOn(p, "secrete", absT);
    if (se >= 0 && dct) {
      const { p: q } = dct.at(0.5);
      for (let j = 0; j < 3; j++) {
        const ss = ((se * 0.7 + j / 3) % 1);
        drawParticle(env, "urea", lerp(q[0] + 30 * s, q[0], ss), lerp(q[1] + 30 * s, q[1], ss), 9 * s, 0, se, j, undefined, ph.alpha * Math.sin(ss * Math.PI));
      }
    }
    const ur = flowOn(p, "urine", absT);
    if (ur >= 0) run(duct, "drop", 8, 45 * s, 12, ur, "urine");
    // labels
    const want: string[] = p.labels === true ? Object.keys(NEPHRON_LABELS) : Array.isArray(p.labels) ? p.labels : [];
    for (const name of want) {
      const L = NEPHRON_LABELS[name];
      if (!L) continue;
      const tgt = map(L.at), pos = map(L.label);
      const b = layoutText(env, { text: L.text, x: pos[0], y: pos[1] - 12, size: Math.max(16, 20 * s), align: "center", maxWidth: 180, maxLines: 2 });
      ctx.save();
      ctx.globalAlpha *= ph.alpha * dimOf(name);
      ctx.strokeStyle = color(env.tokens, "inkSoft");
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(pos[0], pos[1] + (tgt[1] > pos[1] ? 14 : -14));
      ctx.lineTo(tgt[0], tgt[1]);
      ctx.stroke();
      ctx.fillStyle = color(env.tokens, "inkSoft");
      ctx.beginPath();
      ctx.arc(tgt[0], tgt[1], 3.5, 0, TAU);
      ctx.fill();
      ctx.restore();
      drawText(env, b, "center", 1, "ink", ph.alpha * dimOf(name));
    }
  },
};

// ───────────────────────────── Body (organs in a figure) ─────────────────────────────

const ORGANS: Record<string, { kind: string; at: P; size: number; flip?: boolean; label: string }> = {
  brain: { kind: "brain", at: [0, -205], size: 52, label: "Brain" },
  lungs: { kind: "lungs", at: [0, -88], size: 92, label: "Lungs" },
  heart: { kind: "heart", at: [10, -78], size: 40, label: "Heart" },
  liver: { kind: "liver", at: [-22, -30], size: 40, label: "Liver" },
  stomach: { kind: "stomach", at: [24, -28], size: 44, label: "Stomach" },
  kidneys: { kind: "kidney", at: [0, 0], size: 34, label: "Kidneys" },
  intestines: { kind: "intestine", at: [0, 38], size: 58, label: "Intestines" },
  bladder: { kind: "bladder", at: [0, 92], size: 32, label: "Bladder" },
};

function bodyXf(p: any) {
  const h = num(p.size, 560);
  const s = h / 560;
  const cx = num(p.x, 640), cy = num(p.y, 380);
  return { s, cx, cy, map: (q: P): P => [cx + q[0] * s, cy + q[1] * s] };
}

export const Body: Component = {
  inDur: () => 1.4,
  bounds: (_env, p) => {
    const { s, cx, cy } = bodyXf(p);
    return { x: cx - 130 * s, y: cy - 280 * s, w: 260 * s, h: 560 * s };
  },
  anchors: (_env, p) => {
    const { map } = bodyXf(p);
    const out: Record<string, P> = { head: map([0, -205]), chest: map([0, -85]), belly: map([0, 20]) };
    for (const [k, v] of Object.entries(ORGANS)) out[k] = map(v.at);
    out.kidneyLeft = map([-34, 0]);
    out.kidneyRight = map([34, 0]);
    return out;
  },
  draw: (env, p, ph, el) => {
    const { ctx } = env;
    const { s, map } = bodyXf(p);
    const A = artFor(env, s);
    const k = ph.k;
    const hl: string[] = Array.isArray(p.highlight) ? p.highlight : typeof p.highlight === "string" ? [p.highlight] : [];
    const show: string[] = Array.isArray(p.organs) ? p.organs : Object.keys(ORGANS);
    ctx.save();
    ctx.globalAlpha *= ph.alpha;
    // silhouette
    const sk = clamp(k / 0.45);
    ctx.save();
    ctx.globalAlpha *= sk;
    const c = map([0, 0]);
    ctx.translate(c[0], c[1]);
    ctx.scale(s, s);
    const skin = p.color ?? "skin";
    const body: P[] = [[-30, -150], [-90, -128], [-112, -60], [-122, 40], [-104, 44], [-86, -40], [-78, 20], [-70, 120], [-58, 270], [-16, 270], [-6, 130], [6, 130], [16, 270], [58, 270], [70, 120], [78, 20], [86, -40], [104, 44], [122, 40], [112, -60], [90, -128], [30, -150]];
    shape(A, body, skin, { tension: 0.35, alpha: p.xray === false ? 1 : 0.85 });
    circle(A, 0, -200, 56, skin);
    line(A, [[0, -146], [0, -150]], undefined, 1);
    if (A.cartoon && !show.includes("brain")) face(A, 0, -196, 34, ph.local, { force: true, seed: 5 });
    ctx.restore();
    // organs
    const ok = clamp((k - 0.4) / 0.6);
    const order = ["lungs", "heart", "liver", "stomach", "kidneys", "intestines", "bladder", "brain"];
    order.forEach((name, i) => {
      if (!show.includes(name)) return;
      const O = ORGANS[name];
      const kk = clamp(ok * order.length - i * 0.6);
      if (kk <= 0) return;
      const dim = hl.length && !hl.includes(name) ? 0.3 : 1;
      const pos = map(O.at);
      const pulse = hl.includes(name) ? 1 + 0.05 * Math.sin(ph.local * 4) : 1;
      const o = { t: ph.local, alpha: kk * dim, face: false, seed: i };
      if (name === "kidneys") {
        drawProp(env, "kidney", pos[0] - 34 * s, pos[1], O.size * s * pulse, { ...o, flip: true });
        drawProp(env, "kidney", pos[0] + 34 * s, pos[1], O.size * s * pulse, o);
      } else drawProp(env, O.kind, pos[0], pos[1], O.size * s * pulse, o);
      if (hl.includes(name)) {
        ctx.save();
        ctx.globalAlpha *= kk;
        ctx.strokeStyle = color(env.tokens, "accent");
        ctx.lineWidth = 3;
        ctx.setLineDash([7, 6]);
        ctx.beginPath();
        ctx.ellipse(pos[0], pos[1], (name === "kidneys" ? 70 : O.size * 0.75) * s, O.size * 0.65 * s, 0, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    });
    // organ labels
    const want: string[] = p.labels === true ? show : Array.isArray(p.labels) ? p.labels : [];
    want.forEach((name, i) => {
      const O = ORGANS[name];
      if (!O) return;
      const tgt = map(O.at);
      const side = i % 2 ? 1 : -1;
      const lx = tgt[0] + side * 170 * s;
      const b = layoutText(env, { text: O.label, x: lx, y: tgt[1] - 14, size: Math.max(18, 22 * s), align: "center", maxWidth: 160, maxLines: 1 });
      ctx.save();
      ctx.globalAlpha *= ph.alpha * clamp((k - 0.8) / 0.2);
      ctx.strokeStyle = color(env.tokens, "inkSoft");
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(side > 0 ? b.rect.x - 4 : b.rect.x + b.rect.w + 4, tgt[1]);
      ctx.lineTo(tgt[0], tgt[1]);
      ctx.stroke();
      ctx.restore();
      drawText(env, b, "center", 1, "ink", ph.alpha * clamp((k - 0.8) / 0.2));
    });
    ctx.restore();
  },
};

export { smooth };
