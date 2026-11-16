// Hand-drawn ink primitives: wobbly strokes that can be partially drawn (0..1).
import type { Ctx, Env } from "./types";
import { clamp, rngFor } from "./util";

export type P = [number, number];

/** Resample a polyline to roughly `step` px spacing and add seeded perpendicular wobble. */
export function wobble(env: Env, key: string, pts: P[], amp?: number, step = 14): P[] {
  const a = amp ?? env.tokens.jitter;
  if (pts.length < 2 || a <= 0) return pts;
  const r = rngFor(env, key);
  const out: P[] = [];
  // low-frequency noise: random control values interpolated
  const ctrl: number[] = [];
  for (let i = 0; i < 8; i++) ctrl.push(r() * 2 - 1);
  const total = polyLength(pts);
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(seg / step));
    const nx = seg ? -(y1 - y0) / seg : 0;
    const ny = seg ? (x1 - x0) / seg : 0;
    for (let j = 0; j < n; j++) {
      const k = j / n;
      const s = total ? (acc + seg * k) / total : 0;
      const ci = s * (ctrl.length - 1);
      const c0 = Math.floor(ci);
      const c1 = Math.min(ctrl.length - 1, c0 + 1);
      const f = ci - c0;
      const off = (ctrl[c0] * (1 - f) + ctrl[c1] * f) * a;
      out.push([x0 + (x1 - x0) * k + nx * off, y0 + (y1 - y0) * k + ny * off]);
    }
    acc += seg;
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function polyLength(pts: P[]) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

/** Points of a polyline truncated at fraction k of its length. */
export function partial(pts: P[], k: number): P[] {
  k = clamp(k);
  if (k >= 1) return pts;
  if (k <= 0 || pts.length < 2) return pts.slice(0, 1);
  const target = polyLength(pts) * k;
  const out: P[] = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc + seg >= target) {
      const f = seg ? (target - acc) / seg : 0;
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]);
      return out;
    }
    acc += seg;
    out.push(pts[i]);
  }
  return out;
}

/** Brush-like stroke: main pass plus a thin, offset dry-brush pass. */
export function inkStroke(ctx: Ctx, pts: P[], colorStr: string, width: number, alpha = 1) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = colorStr;
  ctx.globalAlpha *= alpha;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
  ctx.globalAlpha *= 0.35;
  ctx.lineWidth = Math.max(1, width * 0.45);
  ctx.beginPath();
  ctx.moveTo(pts[0][0] + 0.8, pts[0][1] + 1.1);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] + 0.8, pts[i][1] + 1.1);
  ctx.stroke();
  ctx.restore();
}

export function ellipsePoints(cx: number, cy: number, rx: number, ry: number, turns = 1.08, start = -1.9, n = 72): P[] {
  const pts: P[] = [];
  const total = Math.ceil(n * turns);
  for (let i = 0; i <= total; i++) {
    const a = start + (i / n) * Math.PI * 2;
    // slight spiral so the overshoot doesn't sit exactly on the start
    const s = 1 + 0.035 * (i / total);
    pts.push([cx + Math.cos(a) * rx * s, cy + Math.sin(a) * ry * s]);
  }
  return pts;
}

export function quadPoints(a: P, b: P, curve: number, n = 40): P[] {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const cx = mx + (-dy / len) * curve * len * 0.5;
  const cy = my + (dx / len) * curve * len * 0.5;
  const pts: P[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push([u * u * a[0] + 2 * u * t * cx + t * t * b[0], u * u * a[1] + 2 * u * t * cy + t * t * b[1]]);
  }
  return pts;
}

export function arrowHead(ctx: Ctx, tip: P, from: P, colorStr: string, width: number, size = 16, alpha = 1) {
  const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const a1 = ang + Math.PI * 0.82;
  const a2 = ang - Math.PI * 0.82;
  inkStroke(ctx, [[tip[0] + Math.cos(a1) * size, tip[1] + Math.sin(a1) * size], tip, [tip[0] + Math.cos(a2) * size, tip[1] + Math.sin(a2) * size]], colorStr, width, alpha);
}

export function roughRect(env: Env, key: string, x: number, y: number, w: number, h: number): P[] {
  const o = 3;
  return wobble(env, key, [
    [x - o, y],
    [x + w, y - 1],
    [x + w + 1, y + h],
    [x, y + h + 1],
    [x, y - o * 0.5],
  ], env.tokens.jitter * 0.9, 18);
}
