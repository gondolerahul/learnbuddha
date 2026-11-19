// Materials: how a kit's hand meets its surface. The paint helpers (paint.ts) hand every shape over as explicit
// geometry, and the kit's treatment decides what that geometry becomes: a brush stroke that swells and tapers, a
// chalk line that skips over the board, a pen line that misses its watercolour wash, a hand-cut paper edge, riso
// ink plates printed slightly out of register.
//
// Line boil: hand-drawn animation is traced again for every drawing, so its lines shimmer. Here a kit's geometry is
// nudged by smooth noise that changes with the boil pose, a cycle of a few variants stepped a few times a second
// (like the three traced drawings an animator cycles). Few variants means prop sprites stay cached.
//
// Everything is a pure function of its inputs: no Math.random(), no clocks.
// Recipes adapted in part from opus-js-animations by klsoen (MIT, see NOTICE.md): hand-cut edges pushed along the
// normal by noise, and mixing shades toward the ink or the paper rather than toward black or white.

export type P = [number, number];

/** Integer hash → [0, 1). */
function h3(ix: number, iy: number, s: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul((s | 0) + 1, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth 2D value noise in [-1, 1]. */
export function vnoise(x: number, y: number, s = 0): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = h3(ix, iy, s), b = h3(ix + 1, iy, s), c = h3(ix, iy + 1, s), d = h3(ix + 1, iy + 1, s);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

/** Two octaves: a little grit on a smooth wander. */
export function fnoise(x: number, y: number, s = 0): number {
  return vnoise(x, y, s) * 0.72 + vnoise(x * 2.7 + 13.1, y * 2.7 - 7.3, s + 17) * 0.28;
}

export function circlePts(x: number, y: number, r: number, unitPx: number): P[] {
  const px = Math.abs(r) / Math.max(1e-6, unitPx);
  const n = Math.max(12, Math.min(120, Math.ceil((Math.PI * 2 * px) / 7)));
  const out: P[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
  }
  return out;
}

export function ellipsePts(x: number, y: number, rx: number, ry: number, rot: number, unitPx: number): P[] {
  const px = Math.max(Math.abs(rx), Math.abs(ry)) / Math.max(1e-6, unitPx);
  const n = Math.max(12, Math.min(120, Math.ceil((Math.PI * 2 * px) / 7)));
  const c = Math.cos(rot), s = Math.sin(rot);
  const out: P[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const ex = Math.cos(a) * rx, ey = Math.sin(a) * ry;
    out.push([x + ex * c - ey * s, y + ex * s + ey * c]);
  }
  return out;
}

/** Catmull-Rom spline through points, sampled about every 6 px. */
export function smoothPts(pts: P[], closed: boolean, tension: number, unitPx: number): P[] {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const get = (i: number) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const last = closed ? n : n - 1;
  const out: P[] = [];
  const t3 = tension / 3;
  for (let i = 0; i < last; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const c1: P = [p1[0] + (p2[0] - p0[0]) * t3, p1[1] + (p2[1] - p0[1]) * t3];
    const c2: P = [p2[0] - (p3[0] - p1[0]) * t3, p2[1] - (p3[1] - p1[1]) * t3];
    const segPx = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / Math.max(1e-6, unitPx);
    const steps = Math.max(2, Math.min(40, Math.ceil(segPx / 6)));
    for (let j = 0; j < steps; j++) {
      const t = j / steps, u = 1 - t;
      out.push([
        u * u * u * p1[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p2[0],
        u * u * u * p1[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p2[1],
      ]);
    }
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

/** Points no further apart than `step`, keeping every original vertex (corners stay corners). */
export function resample(pts: P[], closed: boolean, step: number): P[] {
  const n = pts.length;
  if (n < 2 || step <= 0) return pts.slice();
  const out: P[] = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(d / step));
    for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

/** Unit normals at each vertex (averaged across the two neighbouring segments). */
function normals(pts: P[], closed: boolean): P[] {
  const n = pts.length;
  const out: P[] = [];
  for (let i = 0; i < n; i++) {
    const a = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
    const b = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    out.push([-dy, dx]);
  }
  return out;
}

/**
 * Push each vertex along its normal by smooth noise: `amp` and `wave` in local units, `seed` picks the variant.
 * Position-based, so two shapes sharing an edge wobble together.
 */
export function wobble(pts: P[], closed: boolean, amp: number, wave: number, seed: number): P[] {
  if (amp <= 0 || pts.length < 2) return pts;
  const ns = normals(pts, closed);
  const f = 1 / Math.max(1e-6, wave);
  return pts.map((p, i) => {
    const d = fnoise(p[0] * f + 31.7, p[1] * f - 11.3, seed) * amp;
    return [p[0] + ns[i][0] * d, p[1] + ns[i][1] * d] as P;
  });
}

/** Scissor cuts: short straight facets with a slight tremor, and a rare nick. */
export function cutEdge(pts: P[], amp: number, step: number, seed: number): P[] {
  const r = resample(pts, true, step);
  if (r.length < 3) return r;
  const out: P[] = [];
  for (let i = 0; i < r.length; i++) {
    // keep every other point fixed and move the rest: straight facets between them
    if (i % 2 === 0) out.push(r[i]);
    else {
      const a = r[i - 1], b = r[(i + 1) % r.length];
      const nx = -(b[1] - a[1]), ny = b[0] - a[0];
      const l = Math.hypot(nx, ny) || 1;
      const d = (h3(i, 7, seed) * 2 - 1) * amp;
      out.push([r[i][0] + (nx / l) * d, r[i][1] + (ny / l) * d]);
    }
  }
  return out;
}

export function tracePath(ctx: any, pts: P[], closed: boolean) {
  if (!pts.length) return;
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (closed) ctx.closePath();
}

/** Cumulative length along a polyline. */
function lengths(pts: P[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return cum;
}

/**
 * A stroke whose width follows `width(s, len)` (s = 0..1 along the path), drawn as a filled band.
 * Closed paths are opened at their first point and closed again, so the band wraps around.
 */
export function ribbon(ctx: any, pts0: P[], closed: boolean, width: (s: number, len: number) => number) {
  const pts = closed ? [...pts0, pts0[0]] : pts0;
  const n = pts.length;
  if (n < 2) return;
  const cum = lengths(pts);
  const L = cum[n - 1] || 1;
  const ns = normals(pts, false);
  if (closed) {
    // the seam: average the normals of the first and last points
    const a = ns[0], b = ns[n - 1];
    const m: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const l = Math.hypot(m[0], m[1]) || 1;
    ns[0] = ns[n - 1] = [m[0] / l, m[1] / l];
  }
  const left: P[] = [], right: P[] = [];
  for (let i = 0; i < n; i++) {
    const w = Math.max(0, width(cum[i] / L, L)) / 2;
    left.push([pts[i][0] + ns[i][0] * w, pts[i][1] + ns[i][1] * w]);
    right.push([pts[i][0] - ns[i][0] * w, pts[i][1] - ns[i][1] * w]);
  }
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < n; i++) ctx.lineTo(left[i][0], left[i][1]);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fill();
}

/** Parallel hatch lines across a box, clipped by the caller. `gap` and the box in local units. */
export function hatch(ctx: any, box: { x: number; y: number; w: number; h: number }, angle: number, gap: number, offset = 0) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const R = Math.hypot(box.w, box.h) / 2 + gap;
  ctx.beginPath();
  for (let d = -R + (offset % gap); d <= R; d += gap) {
    // a line through (cx, cy) + d·normal, along the direction (c, s)
    const ox = cx - s * d, oy = cy + c * d;
    ctx.moveTo(ox - c * R, oy - s * R);
    ctx.lineTo(ox + c * R, oy + s * R);
  }
  ctx.stroke();
}

export function bbox(pts: P[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0];
    if (p[1] > y1) y1 = p[1];
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ───────────────────────────── riso plates ─────────────────────────────

/** The four drums of a risograph: fluorescent pink, medium blue, yellow, black. */
export const RISO_INKS: Record<string, [number, number, number]> = {
  pink: [255, 72, 176],
  blue: [0, 120, 191],
  yellow: [255, 232, 0],
  black: [32, 30, 34],
};

/**
 * How much of each drum makes an RGB colour when printed on white: a subtractive (CMY) split, with a shared
 * black for the dark part. Approximate on purpose: riso colour is about the plates, not exact matches.
 */
export function risoPlates(rgb: [number, number, number]): Record<string, number> {
  const c = 1 - rgb[0] / 255, m = 1 - rgb[1] / 255, y = 1 - rgb[2] / 255;
  const k = Math.max(0, Math.min(c, m, y) - 0.12) * 0.95;
  const cc = Math.max(0, c - k), mm = Math.max(0, m - k), yy = Math.max(0, y - k);
  // riso blue carries cyan with some magenta; pink is mostly magenta
  const blue = Math.min(1, cc * 1.05);
  const pink = Math.min(1, Math.max(0, mm - blue * 0.25) * 1.08);
  return { blue, pink, yellow: Math.min(1, yy), black: Math.min(1, k * 1.15) };
}

/** Per-plate misregistration for a print (pose): a small offset that changes every print, in px. */
export function misregister(plate: string, pose: number, seed: number, amp: number): P {
  const i = ["pink", "blue", "yellow", "black"].indexOf(plate);
  return [(h3(i, pose, seed) * 2 - 1) * amp, (h3(i + 9, pose, seed + 3) * 2 - 1) * amp];
}
