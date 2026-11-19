// The illustration library: ~50 hand-drawn props, each with a gentle built-in idle animation.
// Every prop draws in a local box 100 units tall centred on (0,0) (width = 100 × aspect).
import type { Art, P } from "./paint";
import { blobPts, circle, ellipse, face, gloss, line, poly, shape } from "./paint";

export interface PropOpts {
  t: number; // seconds since the element appeared (drives idle loops)
  state: number; // 0..1 prop-specific (fill level, glow, growth, open…)
  color?: string; // optional main colour override
  talk?: number; // 0..1 mouth openness (cartoon faces)
  mood?: string;
  seed: number;
}

export interface PropDef {
  aspect: number;
  group: "nature" | "body" | "science" | "everyday";
  /** Named points in local units, for flows and labels (e.g. "top", "outlet"). */
  anchors?: Record<string, P>;
  draw: (A: Art, o: PropOpts) => void;
}

const TAU = Math.PI * 2;
const sin = Math.sin;
const cos = Math.cos;

function rays(A: Art, n: number, r0: number, r1: number, rot: number, col: string, lw: number) {
  const pts: P[][] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU;
    pts.push([[cos(a) * r0, sin(a) * r0], [cos(a) * r1, sin(a) * r1]]);
  }
  for (const p of pts) line(A, p, col, lw);
}

/** A cloud as a union of circles: thick outline pass first, then fills cover the inner strokes. */
function puffs(A: Art, cs: [number, number, number][], fill: string, shade: string) {
  const { ctx } = A;
  ctx.save();
  const lined = !["papercut", "flat", "riso", "watercolor"].includes(A.style);
  if (lined) {
    // the outline of the union: every puff outlined wide first, then the fills cover the inner strokes
    for (const [x, y, r] of cs) circle(A, x, y, r, null, { lw: A.lw * 2 });
  }
  // papercut puffs cast their own crisp shadows as they are filled (paintPts)
  for (const [x, y, r] of cs) circle(A, x, y, r, fill, { stroke: false });
  ellipse(A, 0, 22, 58, 9, shade, 0, { stroke: false, alpha: 0.55 });
  ctx.restore();
}

function cloudCircles(t: number, seed: number): [number, number, number][] {
  const w = (i: number) => 1 + 0.03 * sin(t * 0.9 + seed + i);
  return [[-50, 10, 22 * w(1)], [-24, -8, 30 * w(2)], [12, -20, 34 * w(3)], [44, -2, 26 * w(4)], [62, 14, 16 * w(5)], [0, 12, 28], [-34, 18, 18], [34, 16, 20]];
}

/** Tube-like stroke: outline pass, then the coloured core. */
function tube(A: Art, pts: P[], col: string, w: number) {
  line(A, pts, undefined, w + A.lw * 2);
  line(A, pts, col, w);
}

function cloudPts(w: number, h: number, t: number, seed: number): P[] {
  const pts: P[] = [];
  const bumps = [[-0.42, 0.05, 0.3], [-0.2, -0.28, 0.36], [0.12, -0.38, 0.4], [0.38, -0.12, 0.32], [0.45, 0.15, 0.24]];
  // top bumps as arcs sampled, flat-ish bottom
  for (const [bx, by, br] of bumps) {
    for (let i = 0; i <= 6; i++) {
      const a = Math.PI + (i / 6) * Math.PI * 1.05 - 0.1;
      const wob = 1 + 0.03 * sin(t * 0.9 + seed + bx * 7);
      pts.push([bx * w + cos(a) * br * h * wob, by * h + sin(a) * br * h * wob]);
    }
  }
  pts.push([0.42 * w, 0.32 * h], [0, 0.36 * h], [-0.42 * w, 0.32 * h]);
  return pts;
}

export const PROPS: Record<string, PropDef> = {
  // ───────────── nature / earth ─────────────
  sun: {
    aspect: 1, group: "nature", anchors: { center: [0, 0], bottom: [0, 32] },
    draw: (A, o) => {
      const rot = o.t * 0.25;
      const glow = 1 + 0.06 * sin(o.t * 2);
      const g = A.ctx.createRadialGradient(0, 0, 20, 0, 0, 50 * glow);
      g.addColorStop(0, A.c("sunGlow"));
      g.addColorStop(1, "rgba(255,240,180,0)");
      A.ctx.fillStyle = g;
      A.ctx.beginPath();
      A.ctx.arc(0, 0, 50 * glow, 0, TAU);
      A.ctx.fill();
      rays(A, 12, 34, 47 + 2 * sin(o.t * 3), rot, o.color ?? "sun", 4);
      circle(A, 0, 0, 28, o.color ?? "sun");
      gloss(A, -9, -10, 8, 5);
      face(A, 0, 2, 20, o.t, { seed: o.seed, talk: o.talk, mood: o.mood });
    },
  },
  cloud: {
    aspect: 1.7, group: "nature", anchors: { center: [0, 0], bottom: [0, 30], top: [0, -38] },
    draw: (A, o) => {
      const s = 0.6 + 0.4 * (o.state || 1);
      A.ctx.save();
      A.ctx.scale(s, s);
      const dx = sin(o.t * 0.4 + o.seed) * 3;
      A.ctx.translate(dx, 0);
      puffs(A, cloudCircles(o.t, o.seed), o.color ?? "cloud", "cloudShade");
      face(A, 0, 4, 18, o.t, { seed: o.seed, talk: o.talk, mood: o.mood });
      A.ctx.restore();
    },
  },
  raincloud: {
    aspect: 1.7, group: "nature", anchors: { center: [0, -8], bottom: [0, 22] },
    draw: (A, o) => {
      const dx = sin(o.t * 0.4 + o.seed) * 3;
      A.ctx.save();
      A.ctx.translate(dx, -8);
      puffs(A, cloudCircles(o.t, o.seed), o.color ?? "rainCloud", "#8C97A3");
      face(A, 0, 4, 18, o.t, { seed: o.seed, talk: o.talk, mood: o.mood ?? "wow" });
      A.ctx.restore();
    },
  },
  raindrop: {
    aspect: 0.7, group: "nature", anchors: { center: [0, 8], top: [0, -45] },
    draw: (A, o) => {
      const sq = 1 + 0.04 * sin(o.t * 5);
      A.ctx.save();
      A.ctx.scale(1 / sq, sq);
      shape(A, [[0, -46], [16, -12], [26, 12], [18, 34], [0, 42], [-18, 34], [-26, 12], [-16, -12]], o.color ?? "water");
      gloss(A, -9, 8, 5, 9, 0.5);
      face(A, 0, 16, 16, o.t, { seed: o.seed, talk: o.talk, mood: o.mood });
      A.ctx.restore();
    },
  },
  snowflake: {
    aspect: 1, group: "nature",
    draw: (A, o) => {
      A.ctx.save();
      A.ctx.rotate(o.t * 0.4);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        const x = cos(a), y = sin(a);
        line(A, [[0, 0], [x * 44, y * 44]], o.color ?? "waterDeep", 4);
        for (const r of [22, 34]) {
          const bx = x * r, by = y * r;
          const a1 = a + 0.7, a2 = a - 0.7;
          line(A, [[bx, by], [bx + cos(a1) * 10, by + sin(a1) * 10]], o.color ?? "waterDeep", 3);
          line(A, [[bx, by], [bx + cos(a2) * 10, by + sin(a2) * 10]], o.color ?? "waterDeep", 3);
        }
      }
      A.ctx.restore();
    },
  },
  lightning: {
    aspect: 0.6, group: "nature",
    draw: (A, o) => {
      const flash = (o.t % 2.2) < 0.25 ? 1 : 0.75;
      poly(A, [[6, -50], [-22, 4], [-2, 4], [-12, 50], [24, -10], [4, -10], [16, -50]], o.color ?? "electric", { alpha: flash });
    },
  },
  mountain: {
    aspect: 1.6, group: "nature", anchors: { top: [-10, -44], base: [0, 46], left: [-70, 40], right: [74, 40] },
    draw: (A, o) => {
      poly(A, [[-80, 48], [-10, -46], [30, 4], [48, -20], [82, 48]], o.color ?? "mountain");
      poly(A, [[-10, -46], [10, 48], [-80, 48]], "mountainDark", { stroke: false, alpha: 0.25 });
      poly(A, [[-10, -46], [8, -22], [-2, -26], [-12, -18], [-22, -26], [-28, -22]], "snow");
      poly(A, [[48, -20], [57, -6], [50, -8], [42, -6]], "snow");
    },
  },
  tree: {
    aspect: 0.8, group: "nature", anchors: { top: [0, -46], roots: [0, 48], leaves: [0, -20] },
    draw: (A, o) => {
      const sway = sin(o.t * 1.1 + o.seed) * 2.5;
      poly(A, [[-6, 48], [-5, 4], [5, 4], [7, 48]], "trunk");
      A.ctx.save();
      A.ctx.translate(sway, 0);
      shape(A, blobPts(0, -16, 36, 32, 9, 0.1, o.seed), o.color ?? "leaf");
      shape(A, blobPts(-10, -24, 16, 12, 7, 0.1, o.seed + 1), "leafDark", { stroke: false, alpha: 0.35 });
      A.ctx.restore();
    },
  },
  pine: {
    aspect: 0.6, group: "nature",
    draw: (A, o) => {
      const sway = sin(o.t + o.seed) * 1.5;
      poly(A, [[-4, 48], [-4, 30], [4, 30], [4, 48]], "trunk");
      for (const [y, w] of [[30, 28], [8, 23], [-14, 18]] as const) poly(A, [[-w + sway, y], [sway * 1.5, y - 34], [w + sway, y]], o.color ?? "leafDark");
    },
  },
  plant: {
    aspect: 0.8, group: "nature", anchors: { leaves: [0, -24], roots: [0, 36], soil: [0, 12] },
    draw: (A, o) => {
      const g = o.state || 1;
      const sway = sin(o.t * 1.3 + o.seed) * 2;
      A.ctx.fillStyle = A.c("soil");
      poly(A, [[-40, 10], [40, 10], [40, 50], [-40, 50]], "soil", { alpha: 0.6 });
      for (const [x, d] of [[0, 1], [-14, -1], [12, 1]] as const) line(A, [[x * 0.2, 12], [x, 26], [x + d * 6, 40]], "trunk", 2.5);
      line(A, [[0, 12], [sway * 0.5, -10 * g], [sway, -40 * g]], "leafDark", 4);
      for (const [y, s] of [[-12, 1], [-26, -1], [-36, 1]] as const) {
        if (-y / 40 > g + 0.05) continue;
        shape(A, [[sway * 0.6, y * g], [s * 22 + sway, (y - 12) * g], [s * 30 + sway, (y - 4) * g], [s * 14 + sway, y * g + 4]], o.color ?? "leaf");
      }
    },
  },
  flower: {
    aspect: 0.7, group: "nature", anchors: { bloom: [0, -26] },
    draw: (A, o) => {
      const sway = sin(o.t * 1.2 + o.seed) * 2;
      line(A, [[0, 48], [sway * 0.5, 10], [sway, -26]], "leafDark", 4);
      shape(A, [[0, 20], [18, 6], [24, 14], [8, 26]], "leaf");
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + o.t * 0.1;
        ellipse(A, sway + cos(a) * 13, -26 + sin(a) * 13, 11, 7, o.color ?? "pink", a);
      }
      circle(A, sway, -26, 8, "yellow");
    },
  },
  rock: {
    aspect: 1.4, group: "nature",
    draw: (A, o) => {
      shape(A, [[-60, 40], [-50, 0], [-20, -28], [20, -30], [55, 0], [64, 40]], o.color ?? "rock", { tension: 0.3 });
      shape(A, [[-30, 10], [-10, -10], [10, 0]], "rockDark", { closed: false });
    },
  },
  sea: {
    aspect: 2.4, group: "nature", anchors: { surface: [0, -26], center: [0, 10], left: [-100, -20], right: [100, -20] },
    draw: (A, o) => {
      const w = 120;
      const wave = (y: number, amp: number, ph: number): P[] => {
        const pts: P[] = [];
        for (let x = -w; x <= w; x += 8) pts.push([x, y + sin(x * 0.06 + o.t * 1.6 + ph) * amp]);
        return pts;
      };
      const top = wave(-28, 4, 0);
      poly(A, [...top, [w, 50], [-w, 50]], o.color ?? "water", { stroke: false });
      poly(A, [...wave(0, 3, 1.3), [w, 50], [-w, 50]], "waterDeep", { stroke: false, alpha: 0.45 });
      line(A, top, undefined, 3);
      line(A, wave(-12, 2.5, 2.4).slice(4, 14), "waterLight", 3, 0.9);
      line(A, wave(-6, 2.5, 3.7).slice(18, 28), "waterLight", 3, 0.9);
    },
  },
  river: {
    aspect: 2.2, group: "nature", anchors: { source: [-100, -20], mouth: [100, 20] },
    draw: (A, o) => {
      const path: P[] = [[-104, -22], [-50, -10], [0, 4], [50, 6], [104, 22]];
      line(A, path, o.color ?? "water", 22);
      line(A, path, undefined, 1.5, 0.5);
      // flowing glints
      for (let i = 0; i < 6; i++) {
        const s = ((o.t * 0.18 + i / 6) % 1);
        const x = -100 + s * 200;
        const y = -22 + s * 44 + sin(s * 6) * 3;
        line(A, [[x - 7, y], [x + 7, y + 1]], "waterLight", 3, 1 - Math.abs(s - 0.5) * 1.6);
      }
    },
  },
  fish: {
    aspect: 1.6, group: "nature",
    draw: (A, o) => {
      const sw = sin(o.t * 6 + o.seed) * 6;
      poly(A, [[34, 0], [58, -18 + sw * 0.3], [58, 18 + sw * 0.3]], o.color ?? "orange");
      shape(A, [[-50, 0], [-20, -24], [20, -20], [38, 0], [20, 20], [-20, 24]], o.color ?? "orange");
      circle(A, -30, -4, 4, "black", { stroke: false });
      line(A, [[0, -16], [6, 0], [0, 16]], undefined, 2, 0.6);
    },
  },
  bird: {
    aspect: 1.6, group: "nature",
    draw: (A, o) => {
      const f = sin(o.t * 7 + o.seed);
      line(A, [[-60, 4 - f * 18], [-30, -16 - f * 6], [0, 6]], o.color ?? "black", 5);
      line(A, [[60, 4 - f * 18], [30, -16 - f * 6], [0, 6]], o.color ?? "black", 5);
    },
  },
  steam: {
    aspect: 0.8, group: "nature", anchors: { base: [0, 46], top: [0, -46] },
    draw: (A, o) => {
      for (let i = 0; i < 3; i++) {
        const pts: P[] = [];
        const ph = o.t * 2 + i * 2.1;
        for (let y = 46; y >= -46; y -= 6) pts.push([(i - 1) * 16 + sin(y * 0.09 + ph) * 8, y]);
        line(A, pts, o.color ?? "waterLight", 5, 0.75);
      }
    },
  },
  moon: {
    aspect: 1, group: "nature",
    draw: (A, o) => {
      A.ctx.save();
      A.ctx.beginPath();
      A.ctx.arc(0, 0, 40, 0, TAU);
      A.ctx.arc(18, -10, 34, 0, TAU, true);
      A.ctx.fillStyle = A.c(o.color ?? "#EFE6C8");
      A.ctx.fill("evenodd");
      A.ctx.restore();
      A.ctx.beginPath();
      A.ctx.arc(0, 0, 40, 0.9, 5.2);
      A.ctx.strokeStyle = A.outline;
      A.ctx.lineWidth = A.lw * A.u;
      A.ctx.stroke();
    },
  },
  star: {
    aspect: 1, group: "nature",
    draw: (A, o) => {
      const s = 1 + 0.12 * sin(o.t * 3 + o.seed);
      const pts: P[] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * TAU;
        const r = (i % 2 ? 18 : 44) * s;
        pts.push([cos(a) * r, sin(a) * r]);
      }
      poly(A, pts, o.color ?? "yellow");
    },
  },
  earth: {
    aspect: 1, group: "nature", anchors: { center: [0, 0], north: [0, -44], south: [0, 44] },
    draw: (A, o) => {
      circle(A, 0, 0, 44, o.color ?? "water");
      A.ctx.save();
      A.ctx.beginPath();
      A.ctx.arc(0, 0, 44, 0, TAU);
      A.ctx.clip();
      const sh = ((o.t * 6) % 120) - 60;
      for (const dx of [sh, sh + 120, sh - 120]) {
        shape(A, [[dx - 30, -20], [dx - 10, -34], [dx + 6, -16], [dx - 4, 6], [dx - 22, 2]], "green");
        shape(A, [[dx + 14, 10], [dx + 30, 4], [dx + 34, 24], [dx + 18, 32]], "green");
      }
      A.ctx.restore();
      circle(A, 0, 0, 44, null);
      gloss(A, -16, -18, 12, 7, 0.3);
    },
  },
  house: {
    aspect: 1, group: "everyday",
    draw: (A, o) => {
      poly(A, [[-36, -4], [36, -4], [36, 46], [-36, 46]], o.color ?? "#F3E3C3");
      poly(A, [[-46, -2], [0, -44], [46, -2]], "plastic");
      poly(A, [[-10, 46], [-10, 16], [10, 16], [10, 46]], "wood");
      poly(A, [[16, 4], [30, 4], [30, 18], [16, 18]], "glass");
    },
  },
  thermometer: {
    aspect: 0.4, group: "science", anchors: { bulb: [0, 36], top: [0, -46] },
    draw: (A, o) => {
      const lvl = o.state || 0.5;
      shape(A, [[-8, -46], [8, -46], [8, 26], [-8, 26]], "white", { tension: 0.1 });
      circle(A, 0, 36, 13, o.color ?? "blood");
      poly(A, [[-4, 30], [4, 30], [4, 26 - lvl * 68], [-4, 26 - lvl * 68]], o.color ?? "blood", { stroke: false });
      for (let y = -38; y < 24; y += 10) line(A, [[8, y], [14, y]], undefined, 1.5);
    },
  },
  ice: {
    aspect: 1, group: "science",
    draw: (A, o) => {
      const melt = o.state || 0;
      A.ctx.save();
      A.ctx.scale(1, 1 - melt * 0.5);
      poly(A, [[-34, -30], [26, -36], [36, 28], [-28, 34]], o.color ?? "ice");
      poly(A, [[-34, -30], [26, -36], [18, -26], [-24, -20]], "white", { stroke: false, alpha: 0.6 });
      A.ctx.restore();
      if (melt > 0) ellipse(A, 0, 44, 30 + melt * 20, 5, "water", 0, { alpha: 0.7 });
    },
  },
  volcano: {
    aspect: 1.5, group: "nature", anchors: { crater: [0, -30] },
    draw: (A, o) => {
      for (let i = 0; i < 3; i++) {
        const s = (o.t * 0.5 + i / 3) % 1;
        circle(A, sin(i * 2 + o.t) * 10 * s, -36 - s * 40, 8 + s * 14, "rockDark", { stroke: false, alpha: 0.4 * (1 - s) });
      }
      poly(A, [[-75, 48], [-14, -30], [14, -30], [75, 48]], o.color ?? "rockDark");
      shape(A, [[-14, -30], [-4, -10], [6, 4], [2, 20], [14, -30]], "fire", { tension: 0.2 });
    },
  },

  // ───────────── body / biology ─────────────
  kidney: {
    aspect: 0.75, group: "body", anchors: { center: [-4, 0], hilum: [16, 2], artery: [26, -8], vein: [26, 4], ureter: [22, 40], cortex: [-30, -10], medulla: [-10, 0] },
    draw: (A, o) => {
      const pts: P[] = [[-4, -46], [24, -38], [32, -16], [16, -2], [32, 16], [24, 40], [-4, 46], [-30, 30], [-36, 0], [-30, -30]];
      shape(A, pts, o.color ?? "organ");
      shape(A, [[-8, -34], [12, -28], [10, -10], [2, 0], [10, 12], [12, 28], [-8, 34], [-22, 22], [-24, 0], [-22, -22]], "tissueDark", { stroke: false, alpha: 0.45 });
      for (const [y, r] of [[-20, 0.3], [0, 0], [20, -0.3]] as const) poly(A, [[-18, y - 6], [-2, y + r * 8], [-18, y + 6]], "bloodDark", { stroke: false, alpha: 0.3 });
      shape(A, [[6, -10], [18, -4], [18, 8], [6, 12], [0, 2]], "urine", { alpha: 0.85 });
      line(A, [[16, -8], [42, -12]], "blood", 7);
      line(A, [[16, 4], [42, 6]], "vein", 7);
      line(A, [[14, 10], [20, 30], [22, 50]], "urine", 6);
      gloss(A, -18, -26, 6, 10, 0.25);
      face(A, -12, 0, 14, o.t, { seed: o.seed, talk: o.talk, mood: o.mood });
    },
  },
  heart: {
    aspect: 1, group: "body", anchors: { center: [0, 4], aorta: [6, -44], left: [14, 6], right: [-14, 6] },
    draw: (A, o) => {
      const beat = 1 + 0.08 * Math.max(0, sin(o.t * 7.5)) * (sin(o.t * 7.5) > 0.6 ? 1 : 0.4);
      A.ctx.save();
      A.ctx.scale(beat, beat);
      line(A, [[6, -24], [6, -40], [22, -46]], "blood", 9);
      line(A, [[-8, -22], [-12, -44]], "vein", 8);
      const pts: P[] = [[0, -18], [16, -34], [36, -26], [40, -4], [26, 20], [0, 42], [-26, 20], [-40, -4], [-36, -26], [-16, -34]];
      shape(A, pts, o.color ?? "blood");
      line(A, [[0, -16], [4, 10], [0, 34]], "bloodDark", 2.5, 0.6);
      gloss(A, -22, -16, 8, 6, 0.3);
      face(A, 0, 4, 16, o.t, { seed: o.seed, talk: o.talk, mood: o.mood });
      A.ctx.restore();
    },
  },
  lungs: {
    aspect: 1.1, group: "body", anchors: { trachea: [0, -46], left: [-26, 10], right: [26, 10] },
    draw: (A, o) => {
      const br = 1 + 0.06 * sin(o.t * 1.6);
      line(A, [[0, -48], [0, -18]], "tissueDark", 8);
      line(A, [[0, -20], [-14, -8]], "tissueDark", 6);
      line(A, [[0, -20], [14, -8]], "tissueDark", 6);
      for (const s of [-1, 1]) {
        A.ctx.save();
        A.ctx.translate(s * 26, 10);
        A.ctx.scale(br, br);
        shape(A, [[s * -12, -36], [s * 8, -40], [s * 22, -20], [s * 24, 24], [s * 6, 40], [s * -16, 36], [s * -14, 0]].map(([x, y]) => [x, y] as P), o.color ?? "tissue");
        for (const [x, y] of [[0, -10], [4, 10], [-4, 22]]) line(A, [[s * -10, y - 4], [s * x, y], [s * (x + 10), y + 6]], "tissueDark", 2, 0.6);
        A.ctx.restore();
      }
    },
  },
  brain: {
    aspect: 1.25, group: "body", anchors: { center: [0, -4], front: [-50, -6], back: [48, 0], stem: [16, 44] },
    draw: (A, o) => {
      line(A, [[12, 22], [16, 46]], "tissueDark", 10);
      shape(A, blobPts(0, -4, 56, 36, 14, 0.06, 2), o.color ?? "pink");
      for (const pts of [[[-36, -14], [-20, -24], [-6, -12], [8, -26], [24, -14], [38, -20]], [[-40, 6], [-22, -2], [-8, 10], [10, -2], [28, 8], [44, 2]], [[-26, 22], [-10, 16], [6, 24]]] as P[][]) line(A, pts, "tissueDark", 2.5, 0.8);
      line(A, [[0, -40], [2, -20], [-2, 0]], "tissueDark", 2.5, 0.7);
      const pulse = (o.t * 1.3) % 1;
      circle(A, -20 + pulse * 40, -10, 4, "electric", { stroke: false, alpha: 1 - pulse });
    },
  },
  stomach: {
    aspect: 0.9, group: "body", anchors: { top: [-16, -44], exit: [30, 30] },
    draw: (A, o) => {
      const sq = 1 + 0.04 * sin(o.t * 2);
      A.ctx.save();
      A.ctx.scale(sq, 1 / sq);
      line(A, [[-16, -48], [-14, -30]], "tissueDark", 10);
      shape(A, [[-14, -32], [10, -36], [30, -14], [26, 20], [6, 36], [-24, 30], [-36, 6], [-24, -10], [-24, -26]], o.color ?? "tissue");
      line(A, [[26, 22], [40, 30], [44, 44]], "tissueDark", 9);
      line(A, [[-16, 0], [0, 14], [16, 6]], "tissueDark", 2, 0.6);
      A.ctx.restore();
    },
  },
  bladder: {
    aspect: 0.9, group: "body", anchors: { inletLeft: [-24, -36], inletRight: [24, -36], outlet: [0, 46], center: [0, 4] },
    draw: (A, o) => {
      const lvl = o.state || 0.5;
      line(A, [[-34, -50], [-22, -30]], "urine", 5);
      line(A, [[34, -50], [22, -30]], "urine", 5);
      const pts: P[] = [[0, -34], [28, -24], [36, 6], [20, 34], [0, 40], [-20, 34], [-36, 6], [-28, -24]];
      shape(A, pts, o.color ?? "tissue");
      A.ctx.save();
      A.ctx.beginPath();
      A.ctx.ellipse(0, 4, 30, 32, 0, 0, TAU);
      A.ctx.clip();
      const y = 36 - lvl * 66;
      poly(A, [[-40, y + sin(o.t * 2) * 1.5], [40, y - sin(o.t * 2) * 1.5], [40, 50], [-40, 50]], "urine", { stroke: false, alpha: 0.85 });
      A.ctx.restore();
      line(A, [[0, 40], [0, 50]], "tissueDark", 6);
    },
  },
  intestine: {
    aspect: 1, group: "body", anchors: { start: [-22, -18], end: [10, 46] },
    draw: (A, o) => {
      const sq = sin(o.t * 1.5) * 1.2;
      tube(A, [[-30, 42], [-38, 0], [-36, -32], [0, -40], [36, -32], [38, 0], [32, 38], [10, 46]], "#D99A7E", 13);
      tube(A, [[-22, -18], [20, -18 + sq], [22, -6], [-20, -4 - sq], [-22, 8], [20, 10 + sq], [20, 22], [-18, 24 - sq], [-16, 32], [14, 32]], o.color ?? "tissue", 9);
    },
  },
  liver: {
    aspect: 1.5, group: "body", anchors: { center: [0, 0] },
    draw: (A, o) => {
      shape(A, [[-70, -14], [-20, -36], [40, -34], [72, -20], [60, -4], [10, 22], [-40, 34], [-70, 20]], o.color ?? "#A2483A", { tension: 0.4 });
      line(A, [[-6, -34], [2, -6], [-8, 24]], "#7A3026", 2.5, 0.6);
      gloss(A, -36, -14, 14, 6, 0.25);
    },
  },
  rbc: {
    aspect: 1, group: "body",
    draw: (A, o) => {
      const r = o.t * 0.8 + o.seed;
      ellipse(A, 0, 0, 44, 36 + 6 * sin(r), o.color ?? "blood", r * 0.2);
      ellipse(A, 0, 0, 20, 14 + 3 * sin(r), "bloodDark", r * 0.2, { stroke: false, alpha: 0.45 });
      face(A, 0, 0, 22, o.t, { seed: o.seed, talk: o.talk, mood: o.mood });
    },
  },
  wbc: {
    aspect: 1, group: "body",
    draw: (A, o) => {
      shape(A, blobPts(0, 0, 44, 42, 12, 0.08, o.t * 1.2, o.seed), o.color ?? "#F4F0F5");
      shape(A, blobPts(6, 4, 18, 14, 8, 0.2, 1, o.seed), "purple", { alpha: 0.8 });
      face(A, -4, -12, 18, o.t, { seed: o.seed, talk: o.talk, mood: o.mood });
    },
  },
  platelet: {
    aspect: 1.3, group: "body",
    draw: (A, o) => shape(A, blobPts(0, 0, 48, 26, 7, 0.18, o.t, o.seed), o.color ?? "#E9B6C6"),
  },
  cell: {
    aspect: 1.25, group: "body", anchors: { membrane: [-58, 0], nucleus: [-6, -4], mitochondrion: [34, 18], er: [20, -24], cytoplasm: [-30, 22] },
    draw: (A, o) => {
      shape(A, blobPts(0, 0, 60, 46, 12, 0.04, o.t * 0.6, o.seed), o.color ?? "cell", { lw: A.lw * 1.3 });
      shape(A, blobPts(0, 0, 60, 46, 12, 0.04, o.t * 0.6, o.seed), null, { strokeColor: "membrane", lw: A.lw * 0.8 });
      circle(A, -6, -4, 17, "nucleus");
      circle(A, -2, -6, 6, "#5E4683", { stroke: false });
      A.ctx.save();
      A.ctx.translate(34, 18);
      A.ctx.rotate(0.4 + sin(o.t) * 0.08);
      ellipse(A, 0, 0, 14, 7, "mito");
      line(A, [[-9, 0], [-5, -4], [-1, 4], [3, -4], [7, 3]], "#A3502E", 1.5);
      A.ctx.restore();
      for (let i = 0; i < 3; i++) line(A, [[10, -30 + i * 6], [20, -34 + i * 6], [30, -28 + i * 6]], "purple", 2, 0.7);
      for (let i = 0; i < 7; i++) circle(A, -40 + ((i * 37) % 80), 20 - ((i * 23) % 40) + sin(o.t + i) * 2, 2.2, "purple", { stroke: false, alpha: 0.6 });
    },
  },
  bacterium: {
    aspect: 1.6, group: "body",
    draw: (A, o) => {
      const w = sin(o.t * 4 + o.seed);
      line(A, [[40, 0], [52, -6 + w * 6], [62, 4 - w * 6], [72, -2]], undefined, 2.5);
      shape(A, [[-46, -16], [36, -18], [46, 0], [36, 18], [-46, 16], [-54, 0]], o.color ?? "green");
      for (const x of [-26, -6, 14]) circle(A, x, sin(x + o.t) * 4, 4, "leafDark", { stroke: false, alpha: 0.6 });
      face(A, -10, 0, 12, o.t, { seed: o.seed, talk: o.talk, mood: o.mood ?? "sad" });
    },
  },
  virus: {
    aspect: 1, group: "body",
    draw: (A, o) => {
      const rot = o.t * 0.5;
      for (let i = 0; i < 10; i++) {
        const a = rot + (i / 10) * TAU;
        line(A, [[cos(a) * 26, sin(a) * 26], [cos(a) * 40, sin(a) * 40]], undefined, 3);
        circle(A, cos(a) * 42, sin(a) * 42, 5, o.color ?? "purple");
      }
      circle(A, 0, 0, 28, o.color ?? "purple");
      face(A, 0, 0, 16, o.t, { seed: o.seed, talk: o.talk, mood: o.mood ?? "sad" });
    },
  },
  neuron: {
    aspect: 2, group: "body", anchors: { body: [-60, 0], axonEnd: [92, 0] },
    draw: (A, o) => {
      for (let i = 0; i < 6; i++) {
        const a = Math.PI * 0.5 + (i / 5) * Math.PI;
        line(A, [[-60, 0], [-60 + cos(a) * 26, sin(a) * 26], [-60 + cos(a + 0.3) * 40, sin(a + 0.3) * 40]], o.color ?? "nerve", 4);
      }
      line(A, [[-50, 0], [92, 0]], o.color ?? "nerve", 6);
      for (let x = -30; x < 80; x += 26) ellipse(A, x + 10, 0, 10, 6, "white", 0);
      for (const a of [-0.6, 0, 0.6]) line(A, [[92, 0], [92 + cos(a) * 14, sin(a) * 14]], o.color ?? "nerve", 4);
      circle(A, -60, 0, 18, o.color ?? "nerve");
      circle(A, -60, 0, 7, "nucleus", { stroke: false });
      const s = (o.t * 0.7) % 1;
      circle(A, -50 + s * 142, 0, 6, "electric", { stroke: false, alpha: 0.95 });
    },
  },
  dna: {
    aspect: 0.6, group: "body",
    draw: (A, o) => {
      const ph = o.t * 1.5;
      for (let i = 0; i <= 16; i++) {
        const y = -46 + i * 5.75;
        const a = ph + i * 0.55;
        const x1 = sin(a) * 22, x2 = -sin(a) * 22;
        if (i % 2 === 0) line(A, [[x1, y], [x2, y]], i % 4 ? "orange" : "teal", 3, 0.8);
      }
      for (const s of [1, -1]) {
        const pts: P[] = [];
        for (let i = 0; i <= 32; i++) pts.push([s * sin(ph + i * 0.275) * 22, -46 + i * 2.875]);
        line(A, pts, s > 0 ? "indigo" : "blood", 4);
      }
    },
  },
  bone: {
    aspect: 2.2, group: "body",
    draw: (A, o) => {
      shape(A, [[-80, -14], [-96, -24], [-104, -6], [-96, 12], [-80, 8], [80, 8], [96, 14], [104, -4], [96, -24], [80, -14]], o.color ?? "bone", { tension: 0.4 });
    },
  },
  eye: {
    aspect: 1.6, group: "body",
    draw: (A, o) => {
      const look = sin(o.t * 0.8) * 8;
      shape(A, [[-60, 0], [0, -30], [60, 0], [0, 30]], "white", { tension: 0.6 });
      circle(A, look, 0, 20, o.color ?? "teal");
      circle(A, look, 0, 9, "black", { stroke: false });
      gloss(A, look - 6, -6, 4, 3, 0.8);
    },
  },
  tooth: {
    aspect: 0.8, group: "body",
    draw: (A, o) => {
      shape(A, [[-30, -30], [-14, -40], [0, -32], [14, -40], [30, -30], [28, 0], [16, 44], [6, 10], [-6, 10], [-16, 44], [-28, 0]], o.color ?? "white", { tension: 0.4 });
      face(A, 0, -14, 14, o.t, { seed: o.seed, talk: o.talk, mood: o.mood });
    },
  },

  // ───────────── science ─────────────
  atom: {
    aspect: 1, group: "science", anchors: { nucleus: [0, 0] },
    draw: (A, o) => {
      for (let i = 0; i < 3; i++) {
        const rot = (i / 3) * Math.PI;
        ellipse(A, 0, 0, 44, 15, null, rot, { lw: 2 });
        const a = o.t * (1.6 + i * 0.4) + i * 2;
        const ex = cos(a) * 44, ey = sin(a) * 15;
        circle(A, ex * cos(rot) - ey * sin(rot), ex * sin(rot) + ey * cos(rot), 5, o.color ?? "indigo");
      }
      circle(A, -4, -3, 7, "blood");
      circle(A, 4, 2, 7, "metal");
      circle(A, 2, -6, 6, "blood");
    },
  },
  water_molecule: {
    aspect: 1.3, group: "science",
    draw: (A, o) => {
      const v = sin(o.t * 4 + o.seed) * 2;
      line(A, [[0, -6], [-28, 18 + v]], undefined, 4);
      line(A, [[0, -6], [28, 18 - v]], undefined, 4);
      circle(A, -30, 20 + v, 14, "white");
      circle(A, 30, 20 - v, 14, "white");
      circle(A, 0, -8, 24, o.color ?? "blood");
      gloss(A, -8, -16, 6, 4);
    },
  },
  beaker: {
    aspect: 0.85, group: "science", anchors: { top: [0, -44], liquid: [0, 20] },
    draw: (A, o) => {
      const lvl = o.state || 0.55;
      const y = 44 - lvl * 80;
      poly(A, [[-30, y + sin(o.t * 2) * 1.2], [30, y - sin(o.t * 2) * 1.2], [30, 44], [-30, 44]], o.color ?? "water", { stroke: false, alpha: 0.75 });
      for (let i = 0; i < 3; i++) {
        const s = (o.t * 0.5 + i / 3) % 1;
        circle(A, -14 + i * 14, 40 - s * (40 - y), 2.5, "white", { lw: 1, alpha: 1 - s * 0.5 });
      }
      poly(A, [[-36, -44], [-30, -40], [-30, 44], [30, 44], [30, -40], [36, -44]], null, { closed: false });
      for (let yy = -20; yy < 40; yy += 15) line(A, [[18, yy], [30, yy]], undefined, 1.5, 0.6);
    },
  },
  flask: {
    aspect: 0.85, group: "science", anchors: { top: [0, -46] },
    draw: (A, o) => {
      const pts: P[] = [[-8, -46], [-8, -14], [-38, 40], [38, 40], [8, -14], [8, -46]];
      A.ctx.save();
      A.ctx.beginPath();
      A.ctx.moveTo(-38, 40);
      for (const p of pts.slice(3)) A.ctx.lineTo(p[0], p[1]);
      A.ctx.lineTo(-8, -46);
      A.ctx.lineTo(-8, -14);
      A.ctx.closePath();
      A.ctx.clip();
      poly(A, [[-40, 10 + sin(o.t * 2) * 1.5], [40, 10 - sin(o.t * 2) * 1.5], [40, 44], [-40, 44]], o.color ?? "green", { stroke: false, alpha: 0.8 });
      A.ctx.restore();
      poly(A, pts, null, { closed: false });
      line(A, [[-38, 40], [38, 40]]);
    },
  },
  flame: {
    aspect: 0.7, group: "science", anchors: { tip: [0, -44], base: [0, 40] },
    draw: (A, o) => {
      const f = sin(o.t * 9 + o.seed) * 3, g = sin(o.t * 13) * 2;
      shape(A, [[0, -46 + g], [18 + f, -6], [24, 20], [12, 40], [-12, 40], [-24, 20], [-16 + f, -10]], o.color ?? "fire");
      shape(A, [[0, -18 + g], [10 + f * 0.5, 6], [10, 28], [-10, 28], [-10, 8]], "flame", { stroke: false });
    },
  },
  magnet: {
    aspect: 1, group: "science", anchors: { north: [-24, 40], south: [24, 40] },
    draw: (A, o) => {
      A.ctx.beginPath();
      A.ctx.arc(0, -6, 38, Math.PI, 0);
      A.ctx.lineTo(38, 40);
      A.ctx.lineTo(14, 40);
      A.ctx.lineTo(14, -6);
      A.ctx.arc(0, -6, 14, 0, Math.PI, true);
      A.ctx.lineTo(-14, 40);
      A.ctx.lineTo(-38, 40);
      A.ctx.closePath();
      A.ctx.fillStyle = A.c(o.color ?? "blood");
      A.ctx.fill();
      poly(A, [[-38, 24], [-14, 24], [-14, 40], [-38, 40]], "white", { stroke: false });
      poly(A, [[14, 24], [38, 24], [38, 40], [14, 40]], "white", { stroke: false });
      A.ctx.beginPath();
      A.ctx.arc(0, -6, 38, Math.PI, 0);
      A.ctx.lineTo(38, 40);
      A.ctx.lineTo(14, 40);
      A.ctx.lineTo(14, -6);
      A.ctx.arc(0, -6, 14, 0, Math.PI, true);
      A.ctx.lineTo(-14, 40);
      A.ctx.lineTo(-38, 40);
      A.ctx.closePath();
      A.ctx.strokeStyle = A.outline;
      A.ctx.lineWidth = A.lw * A.u;
      A.ctx.stroke();
    },
  },
  battery: {
    aspect: 0.55, group: "science", anchors: { plus: [0, -46], minus: [0, 44] },
    draw: (A, o) => {
      poly(A, [[-8, -46], [8, -46], [8, -38], [-8, -38]], "metal");
      poly(A, [[-22, -38], [22, -38], [22, 44], [-22, 44]], o.color ?? "#3C3C3C");
      poly(A, [[-22, -38], [22, -38], [22, -8], [-22, -8]], "gold", { stroke: false });
      line(A, [[-6, -24], [6, -24]], "black", 3);
      line(A, [[0, -30], [0, -18]], "black", 3);
    },
  },
  bulb: {
    aspect: 0.7, group: "science", anchors: { base: [0, 46] },
    draw: (A, o) => {
      const on = o.state ?? 0;
      if (on > 0) circle(A, 0, -10, 42 + 3 * sin(o.t * 5), "electric", { stroke: false, alpha: 0.35 * on });
      circle(A, 0, -12, 28, on > 0 ? "yellow" : "glass");
      line(A, [[-6, 12], [-6, -8], [0, -16], [6, -8], [6, 12]], undefined, 2);
      poly(A, [[-14, 14], [14, 14], [12, 38], [-12, 38]], "metal");
      for (const y of [22, 30]) line(A, [[-13, y], [13, y]], undefined, 1.5);
    },
  },
  gear: {
    aspect: 1, group: "science",
    draw: (A, o) => {
      const rot = o.t * (o.state ? o.state * 3 : 1);
      const pts: P[] = [];
      for (let i = 0; i < 40; i++) {
        const a = rot + (i / 40) * TAU;
        const r = i % 4 < 2 ? 44 : 34;
        pts.push([cos(a) * r, sin(a) * r]);
      }
      poly(A, pts, o.color ?? "metal");
      circle(A, 0, 0, 12, "white");
    },
  },
  ball: {
    aspect: 1, group: "everyday",
    draw: (A, o) => {
      circle(A, 0, 0, 40, o.color ?? "plastic");
      gloss(A, -14, -16, 12, 8, 0.45);
    },
  },
  rocket: {
    aspect: 0.6, group: "science", anchors: { nose: [0, -48], exhaust: [0, 48] },
    draw: (A, o) => {
      const f = sin(o.t * 14) * 4;
      shape(A, [[0, 36], [10, 48 + f], [0, 60 + f * 1.5], [-10, 48 + f]], "fire");
      poly(A, [[-14, 18], [-30, 40], [-14, 36]], "plastic");
      poly(A, [[14, 18], [30, 40], [14, 36]], "plastic");
      shape(A, [[0, -50], [16, -20], [16, 36], [-16, 36], [-16, -20]], o.color ?? "white", { tension: 0.3 });
      circle(A, 0, -6, 8, "glass");
    },
  },
  planet: {
    aspect: 1.5, group: "science",
    draw: (A, o) => {
      circle(A, 0, 0, 34, o.color ?? "orange");
      ellipse(A, 0, 0, 66, 14, null, -0.3, { lw: 4 });
      line(A, [[-24, -10], [24, -14]], "#D07A3A", 4, 0.6);
    },
  },
  clock: {
    aspect: 1, group: "everyday",
    draw: (A, o) => {
      circle(A, 0, 0, 42, o.color ?? "white");
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        line(A, [[cos(a) * 34, sin(a) * 34], [cos(a) * 40, sin(a) * 40]], undefined, 2);
      }
      const m = o.t * 0.8, h = o.t * 0.07;
      line(A, [[0, 0], [sin(h) * 20, -cos(h) * 20]], undefined, 5);
      line(A, [[0, 0], [sin(m) * 32, -cos(m) * 32]], "accent", 3);
    },
  },

  // ───────────── everyday ─────────────
  apple: {
    aspect: 0.9, group: "everyday",
    draw: (A, o) => {
      line(A, [[0, -30], [4, -44]], "trunk", 4);
      shape(A, [[6, -40], [24, -46], [16, -34]], "leaf");
      shape(A, [[0, -28], [24, -34], [40, -10], [32, 26], [12, 40], [0, 34], [-12, 40], [-32, 26], [-40, -10], [-24, -34]], o.color ?? "plastic");
      gloss(A, -18, -14, 6, 10, 0.35);
    },
  },
  book: {
    aspect: 1.4, group: "everyday",
    draw: (A, o) => {
      poly(A, [[-64, -30], [0, -24], [0, 40], [-64, 34]], "white");
      poly(A, [[64, -30], [0, -24], [0, 40], [64, 34]], "white");
      for (let i = 0; i < 4; i++) {
        line(A, [[-54, -14 + i * 12], [-10, -10 + i * 12]], undefined, 1.5, 0.5);
        line(A, [[10, -10 + i * 12], [54, -14 + i * 12]], undefined, 1.5, 0.5);
      }
      poly(A, [[-66, 34], [0, 40], [66, 34], [66, 40], [0, 46], [-66, 40]], o.color ?? "indigo");
    },
  },
  coin: {
    aspect: 1, group: "everyday",
    draw: (A, o) => {
      const sq = Math.abs(cos(o.t * 1.5));
      ellipse(A, 0, 0, 40 * Math.max(0.15, sq), 40, o.color ?? "gold");
      if (sq > 0.5) ellipse(A, 0, 0, 28 * sq, 28, null, 0, { lw: 2 });
    },
  },
  car: {
    aspect: 1.8, group: "everyday",
    draw: (A, o) => {
      const b = sin(o.t * 10) * 1;
      shape(A, [[-80, 16 + b], [-76, -8 + b], [-40, -12 + b], [-24, -36 + b], [30, -36 + b], [48, -12 + b], [80, -6 + b], [82, 16 + b]], o.color ?? "plastic", { tension: 0.2 });
      poly(A, [[-18, -30 + b], [2, -30 + b], [2, -14 + b], [-30, -14 + b]], "glass");
      poly(A, [[8, -30 + b], [26, -30 + b], [38, -14 + b], [8, -14 + b]], "glass");
      for (const x of [-46, 50]) {
        circle(A, x, 18, 16, "black");
        circle(A, x, 18, 6, "metal");
        line(A, [[x, 18], [x + cos(o.t * 8) * 12, 18 + sin(o.t * 8) * 12]], "white", 2);
      }
    },
  },
  person: {
    aspect: 0.55, group: "everyday", anchors: { head: [0, -36], hand: [22, 0], feet: [0, 48] },
    draw: (A, o) => {
      const sw = sin(o.t * 2 + o.seed) * 4;
      line(A, [[0, -16], [0, 18]], o.color ?? "indigo", 14);
      line(A, [[0, 18], [-8, 48]], "black", 7);
      line(A, [[0, 18], [8, 48]], "black", 7);
      line(A, [[0, -10], [-18, 8 + sw]], "skin", 6);
      line(A, [[0, -10], [20, 2 - sw]], "skin", 6);
      circle(A, 0, -34, 14, "skin");
      face(A, 0, -32, 10, o.t, { seed: o.seed, talk: o.talk, mood: o.mood, force: true });
    },
  },
};

export const PROP_KINDS = Object.keys(PROPS);
