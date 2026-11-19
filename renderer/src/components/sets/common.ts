// Shared machinery for sets: whole subjects drawn by the renderer (a synapse, a cell, a solar system…) that the scene
// writer directs by naming stages on the words that call for them. A set has its own local coordinates centred on
// (0, 0); `x`, `y` and `scale` place it in the frame.
//
// Common props of every set:
//   x, y, scale    where it sits and how big it is
//   stages         [{ name, at }]: what happens when (each set documents its stage names); stages accumulate
//   labels         [{ part, text?, at }]: built-in labels with leader lines, placed in the set's own free space
//   highlight      a part name drawn in the accent colour (with highlightAt)
import type { Env, Phase, Rect, SceneElement } from "../../types";
import { clamp, num } from "../../util";
import { Label } from "../art";

export type P = [number, number];

export interface Frame {
  x: number;
  y: number;
  s: number;
}

export function frameOf(p: any, dx = 640, dy = 380): Frame {
  return { x: num(p.x, dx), y: num(p.y, dy), s: Math.max(0.2, Math.min(3, num(p.scale, 1))) };
}

export function world(f: Frame, q: P): P {
  return [f.x + q[0] * f.s, f.y + q[1] * f.s];
}

export function rectOf(f: Frame, w: number, h: number): Rect {
  return { x: f.x - (w / 2) * f.s, y: f.y - (h / 2) * f.s, w: w * f.s, h: h * f.s };
}

/** Seconds since the named stage began (−Infinity before it, or when it is never cued). */
export function since(p: any, name: string, absT: number): number {
  const st = Array.isArray(p.stages) ? p.stages : [];
  let best = -Infinity;
  for (const s of st) {
    if (String(s?.name) !== name || typeof s?.at !== "number") continue;
    if (absT >= s.at) best = Math.max(best, absT - s.at);
  }
  return best;
}

/** 0 → 1 over `dur` seconds after the stage begins, eased. */
export function stageK(p: any, name: string, absT: number, dur = 1): number {
  const s = since(p, name, absT);
  if (!Number.isFinite(s)) return 0;
  const k = clamp(s / Math.max(0.01, dur));
  return k * k * (3 - 2 * k);
}

export function hasStage(p: any, name: string): boolean {
  return Array.isArray(p.stages) && p.stages.some((s: any) => String(s?.name) === name);
}

/** Anchors in world coordinates from local ones. */
export function anchorsOf(f: Frame, local: Record<string, P>): Record<string, P> {
  const out: Record<string, P> = {};
  for (const [k, v] of Object.entries(local)) out[k] = world(f, v);
  return out;
}

/**
 * Built-in labels: each names a part; the set says where that part is (`at`) and where its label sits (`label`),
 * both in local units. Drawn with the kit's label treatment (Label component).
 */
export function drawSetLabels(
  env: Env,
  p: any,
  f: Frame,
  absT: number,
  alpha: number,
  places: Record<string, { at: P; label: P; text: string }>,
  el: SceneElement,
) {
  const list = Array.isArray(p.labels) ? p.labels : [];
  for (let i = 0; i < list.length; i++) {
    const L = list[i];
    const place = places[String(L?.part)];
    if (!place) {
      env.warn(el.id, `no part '${L?.part}' to label; parts: ${Object.keys(places).join(", ")}`);
      continue;
    }
    const at = typeof L.at === "number" ? L.at : el.at + 0.8 + i * 0.5;
    if (absT < at) continue;
    const until = typeof L.until === "number" ? L.until : Infinity;
    if (absT > until + 0.35) continue;
    const local = absT - at;
    const fadeOut = absT > until ? 1 - clamp((absT - until) / 0.35) : 1;
    const [lx, ly] = world(f, place.label);
    const target = world(f, place.at);
    const props = { text: String(L.text ?? place.text), x: lx, y: ly, target, size: L.size ?? "sm", maxWidth: 220 };
    // a label the camera would crop bows out until the shot shows it whole again
    const vis = visibleShare(env, el, Label.bounds(env, props, el));
    const ph: Phase = { local, k: clamp(local / 0.9), dur: 0.9, alpha: alpha * fadeOut * clamp((vis - 0.96) / 0.04) };
    if (ph.alpha > 0.01) Label.draw(env, props, ph, { ...el, id: `${el.id}.label${i}` });
  }
}

/** Rects of a set's labels shown between t0 and t1 (for lint and the camera). */
export function setLabelRects(env: Env, p: any, f: Frame, places: Record<string, { at: P; label: P; text: string }>, el: SceneElement, t0 = -Infinity, t1 = Infinity): Rect[] {
  const list = Array.isArray(p.labels) ? p.labels : [];
  const out: Rect[] = [];
  for (const L of list) {
    const at = typeof L?.at === "number" ? L.at : el.at;
    const until = typeof L?.until === "number" ? L.until : Infinity;
    if (at > t1 || until < t0) continue;
    const place = places[String(L?.part)];
    if (!place) continue;
    const [lx, ly] = world(f, place.label);
    const r = Label.bounds(env, { text: String(L.text ?? place.text), x: lx, y: ly, size: L.size ?? "sm", maxWidth: 220 }, el);
    if (r) out.push(r);
  }
  return out;
}

/** A pulse of light travelling along a polyline (an action potential, a signal), drawn as a soft bright bead. */
export function pointAlong(pts: P[], s: number): P {
  if (pts.length < 2) return pts[0] ?? [0, 0];
  const segs: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    segs.push(d);
    total += d;
  }
  let d = clamp(s) * total;
  for (let i = 0; i < segs.length; i++) {
    if (d <= segs[i] || i === segs.length - 1) {
      const f = segs[i] ? Math.min(1, d / segs[i]) : 0;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
    }
    d -= segs[i];
  }
  return pts[pts.length - 1];
}

/** A small, deterministic pseudo-random number for item i. */
export function h1(i: number, salt = 0): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** How much of a box (logical coordinates, the element's depth plane) is inside the frame under the current camera. */
export function visibleShare(env: Env, el: SceneElement, r: Rect | null): number {
  const cam = (env as any).cam;
  if (!r || !cam) return 1;
  const W = env.tokens.canvas.width, H = env.tokens.canvas.height;
  const depth = num(el.props?.depth, 0);
  const par = 1 + depth * 0.35;
  const zf = 1 + (cam.zoom - 1) * (1 + depth * 0.6);
  const ox = W / 2 + (cam.x - W / 2) * par, oy = H / 2 + (cam.y - H / 2) * par;
  const x0 = (r.x - ox) * zf + W / 2, y0 = (r.y - oy) * zf + H / 2, w = r.w * zf, h = r.h * zf;
  const m = 6;
  const ix = Math.max(0, Math.min(x0 + w, W - m) - Math.max(x0, m));
  const iy = Math.max(0, Math.min(y0 + h, H - m) - Math.max(y0, m));
  return (ix * iy) / Math.max(1, w * h);
}
