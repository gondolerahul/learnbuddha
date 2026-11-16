// The motion engine: everything that moves reads time through these helpers, so nothing moves linearly,
// nothing pops, and every frame stays a pure function of t.
//
// Adapted from two MIT-licensed projects (see NOTICE.md at the repository root):
//   · cinecode by sarpstar (MIT): spring, back, anticipate, stagger, arc, and the motion rules in SKILL.md
//     (https://github.com/sarpstar/cinecode, references/motion.md §5 and §8).
//   · rossark-motion-skill by rossark0 (MIT): the cubic-bezier curves, track, flow (a monotone cubic through key
//     poses), seg, wave, loop, bell and seeded (https://github.com/rossark0/rossark-motion-skill,
//     templates/react-native/motion.ts).

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** A CSS-style cubic bezier easing (x1,y1,x2,y2), solved for x by Newton iterations with a bisection fallback. */
export function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    x = clamp01(x);
    let t = x;
    for (let i = 0; i < 6; i++) {
      const e = sx(t) - x;
      const d = dx(t);
      if (Math.abs(e) < 1e-5) return sy(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 24; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-5) break;
      if (v < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

/** Things that travel (rossark): a strong, calm in-out. */
export const EASE_IN_OUT = bezier(0.77, 0, 0.175, 1);
/** Things that open or arrive: fast start, soft landing. */
export const EASE_OUT = bezier(0.23, 1, 0.32, 1);
/** Only for things leaving or falling away. */
export const EASE_IN = bezier(0.55, 0, 1, 0.45);
/** Camera "inertia" (cinecode): 35% linear + 65% smoothstep — moving at the first frame, still moving at the last. */
export const inertia = (k: number) => {
  k = clamp01(k);
  return 0.35 * k + 0.65 * k * k * (3 - 2 * k);
};

/** 0..1 progress of a move that starts at `start` and lasts `dur`. */
export const at = (t: number, start: number, dur: number) => clamp01((t - start) / Math.max(1e-6, dur));

/** Ease-out with overshoot: s 1 ≈ 4%, 1.7 ≈ 10%, 2.2 ≈ 15%. */
export const back = (k: number, s = 1.7) => {
  k = clamp01(k);
  return 1 + (s + 1) * (k - 1) ** 3 + s * (k - 1) ** 2;
};

/** Wind back by `amount`, then release (anticipation before a move). */
export const anticipate = (k: number, amount = 0.15, share = 0.25) => {
  k = clamp01(k);
  return k < share ? (-amount * (1 - Math.cos((Math.PI * k) / share))) / 2 : -amount + (1 + amount) * (1 - (1 - (k - share) / (1 - share)) ** 3);
};

/** A damped spring's position `tau` seconds after release. zeta: 1 firm · 0.8 soft · 0.7 lively · 0.5 bouncy · 0.4 elastic. f in Hz. */
export function spring(tau: number, zeta = 0.7, f = 2): number {
  if (tau <= 0) return 0;
  const w = 2 * Math.PI * f;
  if (zeta >= 1) return 1 - Math.exp(-w * tau) * (1 + w * tau);
  const wd = w * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * w * tau) * (Math.cos(wd * tau) + ((zeta * w) / wd) * Math.sin(wd * tau));
}

/** How long a spring takes to settle (seconds). */
export const springSettle = (zeta = 0.7, f = 2) => 0.64 / (Math.max(0.2, zeta) * f);

/** Named spring tones (cinecode motion.md §5). */
export const SPRINGS: Record<string, { zeta: number; f: number }> = {
  firm: { zeta: 1.0, f: 2 },
  soft: { zeta: 0.8, f: 2 },
  lively: { zeta: 0.7, f: 2.2 },
  bouncy: { zeta: 0.5, f: 2.2 },
  elastic: { zeta: 0.4, f: 2 },
};

/** Start delay of item i of n spread over `spread` seconds. order: seq | reverse | center | random (needs a seeded rand). */
export function stagger(i: number, n: number, spread: number, order = "seq", rand?: () => number): number {
  if (n < 2) return 0;
  const u = i / (n - 1);
  const p = order === "reverse" ? 1 - u : order === "center" ? Math.abs(2 * u - 1) : order === "random" && rand ? rand() : u;
  return p * spread;
}

/** A point on a path from a to b bowed sideways by `bend` × its length (living things travel on arcs). */
export function arc(k: number, ax: number, ay: number, bx: number, by: number, bend = 0.15): [number, number] {
  const dx = bx - ax, dy = by - ay, o = bend * Math.sin(Math.PI * k);
  return [ax + dx * k - dy * o, ay + dy * k + dx * o];
}

/** Keyframes [t (s), value, 'out'?]: stops at each key (one move: a blink, a lid). */
export type Key = readonly [number, number, ("out" | "in")?];
export function track(t: number, keys: readonly Key[]): number {
  if (!keys.length) return 0;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const k1 = keys[i];
    if (t <= k1[0]) {
      const k0 = keys[i - 1];
      const span = k1[0] - k0[0];
      const p = span > 0 ? (t - k0[0]) / span : 1;
      const e = k1[2] === "out" ? EASE_OUT(p) : k1[2] === "in" ? EASE_IN(p) : EASE_IN_OUT(p);
      return k0[1] + (k1[1] - k0[1]) * e;
    }
  }
  return keys[keys.length - 1][1];
}

/** A smooth path through key poses with continuous speed and no overshoot (monotone cubic): for acting. */
export function flow(t: number, k: readonly (readonly [number, number])[]): number {
  const n = k.length;
  if (!n) return 0;
  if (t <= k[0][0]) return k[0][1];
  if (t >= k[n - 1][0]) return k[n - 1][1];
  let i = 0;
  while (k[i + 1][0] < t) i++;
  const slope = (j: number) => (k[j + 1][1] - k[j][1]) / Math.max(1e-6, k[j + 1][0] - k[j][0]);
  const tangent = (j: number) => {
    if (j === 0 || j === n - 1) return 0;
    const a = slope(j - 1), b = slope(j);
    if (a * b <= 0) return 0;
    const h0 = k[j][0] - k[j - 1][0], h1 = k[j + 1][0] - k[j][0];
    const w0 = 2 * h1 + h0, w1 = h1 + 2 * h0;
    return (w0 + w1) / (w0 / a + w1 / b);
  };
  const h = k[i + 1][0] - k[i][0];
  const s = (t - k[i][0]) / h, s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * k[i][1] + (s3 - 2 * s2 + s) * h * tangent(i) + (-2 * s3 + 3 * s2) * k[i + 1][1] + (s3 - s2) * h * tangent(i + 1);
}

/** 0 → 1 inside the window [a, b], eased; 0 before, 1 after. One beat of an action. */
export const seg = (t: number, a: number, b: number, curve: "out" | "inOut" = "out") => {
  if (t <= a) return 0;
  if (t >= b) return 1;
  const p = (t - a) / (b - a);
  return curve === "out" ? EASE_OUT(p) : EASE_IN_OUT(p);
};

/** −1..1 sine for sway and breathing; `phase` 0..1 offsets one item from the next. */
export const wave = (t: number, period: number, phase = 0) => Math.sin((t / period + phase) * Math.PI * 2);
/** 0..1 progress through a loop (drift, falling). */
export const loop = (t: number, period: number, phase = 0) => {
  const p = (t / period + phase) % 1;
  return p < 0 ? p + 1 : p;
};
/** 0 at both ends, 1 in the middle: fade in and out. */
export const bell = (p: number) => Math.sin(Math.PI * clamp01(p));
/** A stable pseudo-random number in [0,1) for item i. */
export const seeded = (i: number, salt = 0) => {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Low-frequency 1D value noise (smooth, seeded): for handheld drift and organic wobble. */
export function smoothNoise(t: number, seed = 0): number {
  const i = Math.floor(t);
  const f = t - i;
  const a = seeded(i, seed) * 2 - 1, b = seeded(i + 1, seed) * 2 - 1;
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}
