// Painting helpers for illustrations: kit-aware palette, explicit geometry for every shape, and the kit's material
// (art/material.ts) deciding how that geometry is filled and stroked.
// Props are drawn in a local box ~100 units tall centred on (0,0); `u` converts screen px to local units.
import type { Ctx, Env } from "../types";
import {
  bbox, circlePts, cutEdge, ellipsePts, fnoise, hatch, misregister, resample, ribbon, RISO_INKS, risoPlates, smoothPts,
  tracePath, vnoise, wobble, type P as MP,
} from "./material";

export type P = MP;

/** A kit's hand (tokens.art.material). Lengths are in screen px. */
export interface Material {
  /** line boil: how far lines shimmer between drawings (px), how often a new drawing comes (per s), how many variants */
  boil: number;
  boilFps: number;
  cycle: number;
  /** wavelength of the boil and wobble noise along a line (px) */
  wave: number;
  /** a fixed hand tremor in every shape (px) */
  wobble: number;
  /** brush strokes: how much they swell and taper (0..1), and how much they break into dry-brush streaks (0..1) */
  taper: number;
  dry: number;
  /** cut paper edges (px) */
  cut: number;
  /** watercolour wash edges (px) */
  wet: number;
  /** hatch fills (blueprint, chalk), as alpha */
  hatch: number;
  /** riso plates out of register (px) */
  misreg: number;
}

const NO_MATERIAL: Material = { boil: 0, boilFps: 8, cycle: 3, wave: 36, wobble: 0, taper: 0, dry: 0, cut: 0, wet: 0, hatch: 0, misreg: 0 };

export interface Art {
  ctx: Ctx;
  /** px → local units (1 / scale) */
  u: number;
  cartoon: boolean;
  /** the kit's drawing treatment (see artFor) */
  style: string;
  outline: string;
  lw: number; // outline width in screen px
  c: (name: string) => string;
  /** Mix a colour with white (f > 0) or black (f < 0). */
  tint: (col: string, f: number) => string;
  /** the material, the boil pose (which traced variant), a per-element seed and the paper colour */
  mat: Material;
  pose: number;
  seed: number;
  paper: string;
}

const DEFAULT_PALETTE: Record<string, string> = {
  sky: "#CFE3EE", skyTop: "#A9CCE3", sun: "#F2B33D", sunGlow: "#F8D98A", cloud: "#FBF8F2", cloudShade: "#D9E1E6",
  rainCloud: "#AEB8C2", water: "#6FA8CF", waterDeep: "#3E78A8", waterLight: "#B8D8EC", ice: "#DDEEF6", snow: "#FAFAF7",
  leaf: "#6E9E5A", leafDark: "#4C7A3E", grass: "#8DB86B", trunk: "#8A5A3B", earth: "#B98B5E", soil: "#8E6A48", sand: "#E3CC98",
  rock: "#9A9087", rockDark: "#6F665E", mountain: "#8E9AA6", mountainDark: "#6B7682", fire: "#E8692E", flame: "#F5B53F",
  skin: "#F0C5A0", skinShade: "#D9A27C", blood: "#C8423A", bloodDark: "#8F2A25", vein: "#4D6FA8", tissue: "#EBA9A0",
  tissueDark: "#C9777A", organ: "#D9827E", urine: "#E9C84A", bone: "#F1E8D5", nerve: "#E3B451", fat: "#F4DFA1",
  cell: "#F3D3C8", nucleus: "#8E6FB0", membrane: "#C77D8A", mito: "#E2875A", green: "#79B56A", purple: "#9B7BC4",
  metal: "#A7AFB8", metalDark: "#6E7782", glass: "#DCEBF2", wood: "#B88A5A", gold: "#E2B23C", copper: "#C47A45",
  electric: "#F4D03F", plastic: "#E55B4D", white: "#FFFFFF", black: "#2B2622", pink: "#F1A7B5", orange: "#F0974B",
  yellow: "#F5D34B", teal: "#4FB3A9", brown: "#8A5A3B", grey: "#9AA0A6",
};

export function parseColor(col: string): [number, number, number] | null {
  const s = col.trim();
  let m = /^#?([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = /^#?([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const [r, g, b] = m[1].split("").map((h) => parseInt(h + h, 16));
    return [r, g, b];
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(s);
  if (m) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
  return null;
}

/** Mix a colour with white (f > 0) or black (f < 0). */
export function mix(col: string, f: number): string {
  const rgb = parseColor(col);
  if (!rgb) return col;
  const t = f >= 0 ? 255 : 0;
  const a = Math.min(1, Math.abs(f));
  const [r, g, b] = rgb.map((v) => Math.round(v + (t - v) * a));
  return `rgb(${r},${g},${b})`;
}

/** Mix colour a toward colour b by k (0..1). */
export function mixTo(a: string, b: string, k: number): string {
  const x = parseColor(a), y = parseColor(b);
  if (!x || !y) return a;
  return lerpColor(x, y, Math.max(0, Math.min(1, k)));
}

function lerpColor(a: [number, number, number], b: [number, number, number], k: number) {
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * k)},${Math.round(a[1] + (b[1] - a[1]) * k)},${Math.round(a[2] + (b[2] - a[2]) * k)})`;
}

export function luminance(col: string): number {
  const rgb = parseColor(col);
  if (!rgb) return 0.5;
  return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
}

/** The kit's material, with defaults. */
export function materialOf(tokens: any): Material {
  return { ...NO_MATERIAL, ...((tokens?.art ?? {}).material ?? {}) };
}

/** Which traced variant is showing at time t (line boil steps through `cycle` drawings at `boilFps`). */
export function boilPose(tokens: any, t: number): number {
  const m = materialOf(tokens);
  if (!(m.boil > 0) && !(m.misreg > 0)) return 0;
  const fps = Math.max(1, m.boilFps);
  return Math.floor(t * fps + 1e-6) % Math.max(1, Math.round(m.cycle));
}

/**
 * Drawing treatments (tokens.art.style):
 *   ink        a brush line that swells and tapers, flat washes, a dry-brush edge (Zen ink)
 *   cartoon    a clean thick-and-thin ink line, flat cel colour, friendly faces (Storybook)
 *   flat       flat shapes with no outlines; lines only where there is no fill (Flat explainer)
 *   clean      crisp thin outline, flat fills, no wobble (Clinical cutaway)
 *   chalk      fills scribbled in chalk, lines as broken chalk strokes (Chalkboard)
 *   blueprint  fine white linework, hatched fills (Blueprint)
 *   watercolor washes with wet, pooled edges and a pen line that misses a little (Field notes)
 *   papercut   hand-cut paper shapes with a pale cut rim and a crisp shadow, no ink line (Paper shadowbox)
 *   riso       four ink plates overprinting, each a little out of register (Riso collage)
 *   glow       dark bodies with luminous edges (Night glow)
 *   inkwash, comic   retired kits, kept so old scenes still render
 */
export function artFor(env: Env, scale: number, o: { seed?: number; pose?: number } = {}): Art {
  const tk: any = env.tokens;
  const a = tk.art ?? {};
  const pal = { ...DEFAULT_PALETTE, ...(a.palette ?? {}) };
  const mono = a.mono ? { dark: parseColor(a.mono.dark) ?? [0, 0, 0], light: parseColor(a.mono.light) ?? [255, 255, 255], keep: new Set<string>(a.mono.keep ?? ["accent"]) } : null;
  const raw = (name: string) => {
    if (!name) return pal.black;
    if (name.startsWith("#") || name.startsWith("rgb")) return name;
    return pal[name] ?? tk.colors[name] ?? name;
  };
  // Monochrome styles (blueprint, chalk tints) map every colour onto their two-tone ramp by its lightness,
  // keeping only the named accents.
  const c = (name: string) => {
    const v = raw(name);
    if (!mono || mono.keep.has(name)) return v;
    const rgb = parseColor(v);
    if (!rgb) return v;
    const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    return lerpColor(mono.dark as any, mono.light as any, Math.pow(lum, a.mono.gamma ?? 0.9));
  };
  const style = String(a.style ?? "ink");
  const t = (env as any).t ?? 0;
  return {
    ctx: env.ctx,
    u: 1 / Math.max(0.01, scale),
    cartoon: style === "cartoon" || a.faces === true,
    style,
    outline: c(a.outline ?? tk.colors.ink),
    lw: a.lineWidth ?? 3,
    c,
    tint: (col, f) => mix(c(col), f),
    mat: materialOf(tk),
    pose: o.pose ?? boilPose(tk, t),
    seed: o.seed ?? 0,
    paper: tk.colors.paper,
  };
}

/** Catmull-Rom spline through points as a canvas path. */
export function smooth(ctx: Ctx, pts: P[], closed = true, tension = 0.5) {
  const n = pts.length;
  if (n < 2) return;
  const get = (i: number) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  ctx.moveTo(pts[0][0], pts[0][1]);
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const t = tension / 3;
    ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) * t, p1[1] + (p2[1] - p0[1]) * t, p2[0] - (p3[0] - p1[0]) * t, p2[1] - (p3[1] - p1[1]) * t, p2[0], p2[1]);
  }
  if (closed) ctx.closePath();
}

// ───────────────────────────── geometry through the kit's hand ─────────────────────────────

/** The largest side of a shape, in screen px. */
function extentPx(A: Art, pts: P[]): number {
  const b = bbox(pts);
  return Math.max(b.w, b.h) / Math.max(1e-6, A.u);
}

/** The shape as this kit's hand draws it: cut, wet-edged, trembling, boiling. `pass` varies the static noise. */
function handOf(A: Art, pts: P[], closed: boolean, pass = 0): P[] {
  const m = A.mat;
  const u = A.u;
  let g = pts;
  const needs = (closed && (m.cut > 0 || m.wet > 0)) || m.wobble > 0 || (m.boil > 0 && A.pose >= 0);
  if (!needs) return g;
  g = resample(g, closed, 9 * u);
  if (closed && m.cut > 0) g = cutEdge(g, m.cut * u, 13 * u, A.seed * 31 + 7 + pass);
  if (closed && m.wet > 0) g = wobble(g, closed, m.wet * u, 46 * u, A.seed * 17 + 3 + pass * 101);
  if (m.wobble > 0) g = wobble(g, closed, m.wobble * u, Math.max(8, m.wave * 1.7) * u, A.seed * 13 + 11 + pass * 53);
  if (m.boil > 0) g = wobble(g, closed, m.boil * u, Math.max(6, m.wave) * u, A.seed * 7 + 101 + A.pose * 1013);
  return g;
}

export interface PaintOpts {
  stroke?: boolean;
  lw?: number;
  strokeColor?: string;
  alpha?: number;
}

/** Fill and outline explicit geometry in the kit's treatment. Open paths are only stroked. */
export function paintPts(A: Art, pts0: P[], closed: boolean, fill: string | null, opts: PaintOpts = {}) {
  if (pts0.length < 2) return;
  const { ctx } = A;
  const fc = fill && closed ? A.c(fill) : null;
  const lw = (opts.lw ?? A.lw) * A.u;
  const tiny = extentPx(A, pts0) < 9;
  const g = tiny ? pts0 : handOf(A, pts0, closed);
  ctx.save();
  if (opts.alpha !== undefined) ctx.globalAlpha *= opts.alpha;
  if (fc) fillShape(A, g, pts0, fc, lw, tiny);
  if (opts.stroke !== false) {
    const sc = opts.strokeColor ? A.c(opts.strokeColor) : A.outline;
    strokeShape(A, g, closed, sc, lw, fc, tiny, !!opts.strokeColor);
  }
  ctx.restore();
}

function fillPath(ctx: any, g: P[]) {
  ctx.beginPath();
  tracePath(ctx, g, true);
  ctx.fill();
}

function fillShape(A: Art, g: P[], src: P[], fc: string, lw: number, tiny: boolean) {
  const { ctx } = A;
  const st = A.style;
  const u = A.u;
  ctx.save();
  switch (st) {
    case "papercut": {
      // each paper layer casts a crisp shadow on the one below (an offset, not a blur: frames stay deterministic)
      ctx.save();
      ctx.translate(2.2 * u, 3.6 * u);
      ctx.fillStyle = "rgba(45,28,12,0.26)";
      fillPath(ctx, g);
      ctx.restore();
      ctx.fillStyle = fc;
      fillPath(ctx, g);
      break;
    }
    case "chalk": {
      // a pale layer of chalk, then the scribble that put it there
      ctx.globalAlpha *= 0.28;
      ctx.fillStyle = fc;
      fillPath(ctx, g);
      ctx.globalAlpha /= 0.28;
      if (!tiny) {
        ctx.save();
        ctx.beginPath();
        tracePath(ctx, g, true);
        ctx.clip();
        ctx.strokeStyle = fc;
        ctx.globalAlpha *= Math.max(0.3, A.mat.hatch || 0.55);
        ctx.lineWidth = 1.7 * u;
        ctx.lineCap = "round";
        ctx.setLineDash([7 * u, 2.2 * u, 3 * u, 1.4 * u]);
        ctx.lineDashOffset = (A.pose * 5 + A.seed) * u;
        hatch(ctx, bbox(g), -0.95 + A.pose * 0.06, 5.2 * u, A.pose * 1.7 * u);
        ctx.restore();
      }
      break;
    }
    case "blueprint": {
      ctx.globalAlpha *= 0.14;
      ctx.fillStyle = fc;
      fillPath(ctx, g);
      ctx.globalAlpha /= 0.14;
      if (!tiny && A.mat.hatch > 0) {
        ctx.save();
        ctx.beginPath();
        tracePath(ctx, g, true);
        ctx.clip();
        ctx.strokeStyle = mix(fc, 0.35);
        ctx.globalAlpha *= A.mat.hatch;
        ctx.lineWidth = 0.9 * u;
        hatch(ctx, bbox(g), Math.PI / 4, 7 * u);
        ctx.restore();
      }
      break;
    }
    case "inkwash":
      ctx.globalAlpha *= 0.55;
      ctx.fillStyle = fc;
      fillPath(ctx, g);
      break;
    case "watercolor": {
      // two washes laid one over the other, each with its own wet edge, and pigment pooled at the rim
      ctx.globalAlpha *= 0.46;
      ctx.fillStyle = fc;
      fillPath(ctx, g);
      ctx.globalAlpha = (ctx.globalAlpha / 0.46) * 0.36;
      const g2 = tiny ? g : handOf(A, src, true, 1);
      fillPath(ctx, g2);
      if (!tiny) {
        ctx.globalAlpha = (ctx.globalAlpha / 0.36) * 0.3;
        ctx.strokeStyle = mix(fc, -0.3);
        ctx.lineWidth = lw * 1.6;
        ctx.lineJoin = "round";
        ctx.beginPath();
        tracePath(ctx, g, true);
        ctx.stroke();
      }
      break;
    }
    case "glow":
      ctx.fillStyle = mix(fc, -0.5);
      fillPath(ctx, g);
      break;
    case "riso": {
      const rgb = parseColor(fc) ?? [128, 128, 128];
      if (luminance(fc) > 0.9) {
        // a knockout: no ink here, the paper shows through
        ctx.fillStyle = A.paper;
        fillPath(ctx, g);
        break;
      }
      // The colour as the drums would print it on this paper; the second strongest drum shows as a fringe where it
      // missed the first (the out-of-register edge that makes riso), and every print lands a little differently.
      const plates = risoPlates(rgb);
      const order = ["yellow", "pink", "blue", "black"].filter((n) => plates[n] >= 0.06).sort((a, b) => plates[b] - plates[a]);
      const paperRgb = parseColor(A.paper) ?? [244, 238, 223];
      const printed = paperRgb.map((v, i) => {
        let c = v;
        for (const n of order) c *= 1 - plates[n] + (plates[n] * RISO_INKS[n][i]) / 255;
        return Math.round(c);
      });
      const amp = A.mat.misreg || 1.2;
      if (order.length > 1 && !tiny) {
        const second = order[1];
        const [ox, oy] = misregister(second, A.pose, A.seed, amp * 1.6);
        const ink = RISO_INKS[second];
        ctx.save();
        ctx.translate(ox * u, oy * u);
        ctx.fillStyle = `rgba(${ink[0]},${ink[1]},${ink[2]},${Math.min(0.9, plates[second] * 1.2 + 0.15).toFixed(3)})`;
        fillPath(ctx, g);
        ctx.restore();
      }
      const [mx, my] = misregister(order[0] ?? "black", A.pose, A.seed, amp);
      ctx.translate(mx * u, my * u);
      ctx.fillStyle = `rgb(${printed[0]},${printed[1]},${printed[2]})`;
      fillPath(ctx, g);
      break;
    }
    case "ink": {
      // a flat wash, then a thinner second wash a little off the first, like ink that was laid down twice
      ctx.fillStyle = fc;
      fillPath(ctx, g);
      if (!tiny && A.mat.wet > 0) {
        ctx.globalAlpha *= 0.14;
        ctx.fillStyle = mix(fc, -0.25);
        fillPath(ctx, handOf(A, src, true, 2));
      }
      break;
    }
    default:
      ctx.fillStyle = fc;
      fillPath(ctx, g);
  }
  ctx.restore();
}

/** Width along a brush stroke: swells from the attack, tapers in the tail, with pressure noise. */
function brushWidth(A: Art, lw: number, closed: boolean, taper: number, floor: number) {
  const u = A.u;
  const seed = A.seed * 3 + 19;
  return (s: number, L: number) => {
    const press = 1 + 0.26 * vnoise((s * L) / (34 * u), 0.5, seed + A.pose * 7);
    if (closed) return lw * (1 - taper * 0.35 + taper * 0.35 * (press - 0.74) * 1.9);
    const sw = Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.06 + 0.02)), 0.55);
    return lw * press * (floor + (1 - floor) * (1 - taper + taper * sw));
  };
}

function strokePath(ctx: any, g: P[], closed: boolean) {
  ctx.beginPath();
  tracePath(ctx, g, closed);
  ctx.stroke();
}

/** Offset a polyline along its normals by d (local units). */
function offsetPts(g: P[], closed: boolean, d: number): P[] {
  const n = g.length;
  return g.map((p, i) => {
    const a = closed ? g[(i - 1 + n) % n] : g[Math.max(0, i - 1)];
    const b = closed ? g[(i + 1) % n] : g[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [p[0] - (dy / l) * d, p[1] + (dx / l) * d] as P;
  });
}

function strokeShape(A: Art, g: P[], closed: boolean, sc: string, lw: number, fc: string | null, tiny: boolean, explicitColor: boolean) {
  const { ctx } = A;
  const u = A.u;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = sc;
  ctx.fillStyle = sc;
  ctx.lineWidth = lw;
  switch (A.style) {
    case "papercut":
      // no ink line: the pale rim of a cut edge, catching the light on its upper side (lines without a fill keep their stroke)
      if (fc) {
        ctx.strokeStyle = mix(fc, 0.55);
        ctx.globalAlpha *= 0.8;
        ctx.lineWidth = lw * 0.5;
        ctx.translate(-0.5 * u, -0.6 * u);
      }
      strokePath(ctx, g, closed);
      break;
    case "flat":
      // flat shapes have no outline; a line on its own is drawn crisp with round ends
      if (fc && !explicitColor) break;
      strokePath(ctx, g, closed);
      break;
    case "glow": {
      const edge = fc && !explicitColor ? mix(fc, 0.45) : sc;
      ctx.strokeStyle = edge;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha *= 0.16;
      ctx.lineWidth = lw * 3.6;
      strokePath(ctx, g, closed);
      ctx.restore();
      ctx.lineWidth = lw * 0.9;
      strokePath(ctx, g, closed);
      break;
    }
    case "chalk": {
      ctx.setLineDash([lw * 4.2, lw * 0.7, lw * 2.4, lw * 0.5]);
      ctx.lineDashOffset = (A.pose * 3.1 + A.seed) * lw;
      ctx.lineWidth = lw * 0.95;
      strokePath(ctx, g, closed);
      ctx.globalAlpha *= 0.45;
      ctx.setLineDash([lw * 2.6, lw * 1.1]);
      ctx.lineDashOffset = lw * 1.3;
      ctx.translate(0.6 * u, 0.8 * u);
      ctx.lineWidth = lw * 0.65;
      strokePath(ctx, g, closed);
      ctx.globalAlpha *= 0.7;
      ctx.translate(-1.1 * u, -0.5 * u);
      ctx.lineWidth = lw * 0.35;
      ctx.setLineDash([lw * 1.4, lw * 2.2]);
      strokePath(ctx, g, closed);
      break;
    }
    case "blueprint":
      ctx.lineWidth = lw * 0.7;
      strokePath(ctx, g, closed);
      break;
    case "clean":
      ctx.lineWidth = lw * 0.8;
      strokePath(ctx, g, closed);
      break;
    case "comic":
      ctx.lineWidth = lw * 1.5;
      strokePath(ctx, g, closed);
      break;
    case "watercolor": {
      // the pen line misses the wash a little and lifts off the paper now and then
      ctx.translate(1.4 * u, -1.0 * u);
      ctx.globalAlpha *= 0.85;
      ctx.lineWidth = lw * 0.7;
      if (!tiny) {
        const run = (30 + 26 * Math.abs(fnoise(A.seed * 0.37, 1.3, 5))) * u;
        ctx.setLineDash([run, 2.4 * u, run * 0.6, 1.6 * u]);
        ctx.lineDashOffset = A.seed * 3.7 * u;
      }
      strokePath(ctx, g, closed);
      break;
    }
    case "inkwash":
      ctx.globalAlpha *= 0.9;
      ctx.lineWidth = lw * 1.3;
      strokePath(ctx, g, closed);
      ctx.globalAlpha *= 0.35;
      ctx.translate(1.1 * u, 1.3 * u);
      ctx.lineWidth = lw * 0.5;
      strokePath(ctx, g, closed);
      break;
    case "riso": {
      // line work prints from one drum: black, or the colour's strongest plate when the line is coloured
      const rgb = parseColor(sc) ?? [30, 30, 30];
      const plates = risoPlates(rgb);
      let best = "black", bd = plates.black;
      for (const k of ["pink", "blue", "yellow"]) if (plates[k] > bd + 0.08) { best = k; bd = plates[k]; }
      const ink = explicitColor ? (parseColor(sc) ?? RISO_INKS[best]) : RISO_INKS[best];
      const [ox, oy] = misregister(best, A.pose, A.seed, A.mat.misreg || 1.2);
      ctx.translate(ox * u, oy * u);
      ctx.strokeStyle = `rgba(${ink[0]},${ink[1]},${ink[2]},${Math.min(1, 0.55 + bd).toFixed(3)})`;
      ctx.lineWidth = lw * 1.05;
      strokePath(ctx, g, closed);
      break;
    }
    case "cartoon":
    case "ink": {
      const px = lw / Math.max(1e-6, u);
      if (tiny || px < 1.3 || A.mat.taper <= 0) {
        strokePath(ctx, g, closed);
        if (A.style === "ink") {
          ctx.globalAlpha *= 0.3;
          ctx.translate(0.7 * u, 0.9 * u);
          ctx.lineWidth = lw * 0.5;
          strokePath(ctx, g, closed);
        }
        break;
      }
      const floor = A.style === "cartoon" ? 0.5 : 0.14;
      ribbon(ctx, g, closed, brushWidth(A, lw, closed, A.mat.taper, floor));
      if (A.style === "cartoon") {
        // round, inked ends
        if (!closed) {
          for (const p of [g[0], g[g.length - 1]]) {
            ctx.beginPath();
            ctx.arc(p[0], p[1], lw * floor * 0.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        break;
      }
      // dry brush: the bristles part toward the end of a stroke and let the paper through
      if (A.mat.dry > 0 && !closed && g.length > 4) {
        const L = g.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - g[i - 1][0], p[1] - g[i - 1][1]) : 0), 0) / u;
        if (L > 36) {
          ctx.strokeStyle = A.paper;
          ctx.globalAlpha *= 0.55 * A.mat.dry;
          ctx.lineWidth = Math.max(0.6 * u, lw * 0.11);
          ctx.lineCap = "butt";
          const tail = g.slice(Math.floor(g.length * 0.55));
          for (const [k, d] of [[0, 0.2], [1, -0.17], [2, 0.05]] as const) {
            ctx.setLineDash([(5 + k * 3) * u, (7 + k * 2) * u]);
            ctx.lineDashOffset = (A.seed + k * 4) * u;
            strokePath(ctx, offsetPts(tail, false, lw * d), false);
          }
        }
      }
      break;
    }
    default:
      strokePath(ctx, g, closed);
      ctx.globalAlpha *= 0.3;
      ctx.translate(0.7 * u, 0.9 * u);
      ctx.lineWidth = lw * 0.5;
      strokePath(ctx, g, closed);
  }
  ctx.restore();
}

/** Fill and outline the current canvas path (for code that builds its own path) in a simplified kit treatment. */
export function paint(A: Art, fill: string | null, opts: PaintOpts = {}) {
  const { ctx } = A;
  const st = A.style;
  const fc = fill ? A.c(fill) : null;
  const lw = (opts.lw ?? A.lw) * A.u;
  ctx.save();
  if (opts.alpha !== undefined) ctx.globalAlpha *= opts.alpha;
  if (fc) {
    ctx.save();
    if (st === "papercut") {
      ctx.save();
      ctx.translate(2.2 * A.u, 3.6 * A.u);
      ctx.fillStyle = "rgba(45,28,12,0.26)";
      ctx.fill();
      ctx.restore();
    }
    if (st === "chalk") ctx.globalAlpha *= 0.45;
    else if (st === "blueprint") ctx.globalAlpha *= 0.16;
    else if (st === "inkwash") ctx.globalAlpha *= 0.55;
    else if (st === "watercolor") ctx.globalAlpha *= 0.72;
    else if (st === "riso") ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = st === "glow" ? mix(fc, -0.5) : fc;
    ctx.fill();
    ctx.restore();
  }
  if (opts.stroke !== false && !(st === "flat" && fc && !opts.strokeColor)) {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const sc = opts.strokeColor ? A.c(opts.strokeColor) : A.outline;
    ctx.strokeStyle = st === "papercut" && fc ? mix(fc, 0.55) : sc;
    ctx.lineWidth = st === "papercut" && fc ? lw * 0.5 : st === "clean" || st === "blueprint" ? lw * 0.75 : lw;
    if (st === "chalk") ctx.setLineDash([lw * 4.2, lw * 0.7, lw * 2.4, lw * 0.5]);
    if (st === "riso") ctx.globalCompositeOperation = "multiply";
    ctx.stroke();
  }
  ctx.restore();
}

export function circle(A: Art, x: number, y: number, r: number, fill: string | null, opts: PaintOpts = {}) {
  paintPts(A, circlePts(x, y, Math.max(0.01, r), A.u), true, fill, opts);
}

export function ellipse(A: Art, x: number, y: number, rx: number, ry: number, fill: string | null, rot = 0, opts: PaintOpts = {}) {
  paintPts(A, ellipsePts(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, A.u), true, fill, opts);
}

export function shape(A: Art, pts: P[], fill: string | null, opts: PaintOpts & { closed?: boolean; tension?: number } = {}) {
  const closed = opts.closed !== false;
  paintPts(A, smoothPts(pts, closed, opts.tension ?? 0.5, A.u), closed, closed ? fill : null, opts);
}

export function poly(A: Art, pts: P[], fill: string | null, opts: PaintOpts & { closed?: boolean } = {}) {
  const closed = opts.closed !== false;
  paintPts(A, pts, closed, closed ? fill : null, opts);
}

/** A line through points (smoothed when there are three or more), in the kit's line treatment. */
export function line(A: Art, pts: P[], col?: string, lw?: number, alpha = 1) {
  if (pts.length < 2) return;
  const g = pts.length >= 3 ? smoothPts(pts, false, 0.5, A.u) : pts;
  const { ctx } = A;
  ctx.save();
  ctx.globalAlpha *= alpha;
  const w = (lw ?? A.lw) * A.u;
  const tiny = extentPx(A, g) < 9;
  const h = tiny ? g : handOf(A, g, false);
  // glow lines get their halo even when they stand alone
  strokeShape(A, h, false, col ? A.c(col) : A.outline, w, null, tiny, !!col);
  ctx.restore();
}

/** A blob: a circle-ish closed shape with n lobes of relative amplitude `amp`, rotating phase `ph`. */
export function blobPts(cx: number, cy: number, rx: number, ry: number, n = 8, amp = 0.08, ph = 0, seed = 1): P[] {
  const pts: P[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const w = 1 + amp * Math.sin(a * 3 + ph + seed) + amp * 0.6 * Math.cos(a * 5 - ph * 0.7 + seed * 2);
    pts.push([cx + Math.cos(a) * rx * w, cy + Math.sin(a) * ry * w]);
  }
  return pts;
}

/** Friendly cartoon face (only drawn in the cartoon style unless forced). Blinks deterministically. */
export function face(A: Art, x: number, y: number, s: number, t: number, opts: { force?: boolean; mood?: string; seed?: number; talk?: number } = {}) {
  if (!A.cartoon && !opts.force) return;
  const { ctx } = A;
  const blinkPhase = (t + (opts.seed ?? 0) * 0.77) % 3.7;
  const blink = blinkPhase < 0.12 ? 0.15 : 1;
  ctx.save();
  if (A.style === "riso") ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = A.c("black");
  for (const dx of [-0.35, 0.35]) {
    ctx.beginPath();
    ctx.ellipse(x + dx * s, y - 0.1 * s, 0.11 * s, 0.15 * s * blink, 0, 0, Math.PI * 2);
    ctx.fill();
    if (blink > 0.5 && A.style !== "riso") {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(x + dx * s + 0.035 * s, y - 0.16 * s, 0.04 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = A.c("black");
    }
  }
  // cheeks
  ctx.globalAlpha *= 0.35;
  ctx.fillStyle = A.c("pink");
  for (const dx of [-0.55, 0.55]) {
    ctx.beginPath();
    ctx.ellipse(x + dx * s, y + 0.12 * s, 0.12 * s, 0.07 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.save();
  if (A.style === "riso") ctx.globalCompositeOperation = "multiply";
  ctx.strokeStyle = A.c("black");
  ctx.lineWidth = Math.max(0.6, 0.07 * s);
  ctx.lineCap = "round";
  const talk = opts.talk ?? 0;
  if (talk > 0.05) {
    ctx.fillStyle = A.c("#7A2E2A");
    ctx.beginPath();
    ctx.ellipse(x, y + 0.2 * s, 0.14 * s, 0.05 * s + 0.1 * s * talk, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (opts.mood === "sad") {
    ctx.beginPath();
    ctx.arc(x, y + 0.38 * s, 0.18 * s, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  } else if (opts.mood === "wow") {
    ctx.beginPath();
    ctx.arc(x, y + 0.22 * s, 0.09 * s, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(x, y + 0.05 * s, 0.2 * s, Math.PI * 0.2, Math.PI * 0.8);
    ctx.stroke();
  }
  ctx.restore();
}

/** Gentle shading highlight for roundness. */
export function gloss(A: Art, x: number, y: number, rx: number, ry: number, alpha = 0.35) {
  const { ctx } = A;
  if (A.style === "riso" || A.style === "papercut" || A.style === "chalk" || A.style === "blueprint") return;
  ctx.save();
  ctx.globalAlpha *= alpha * (A.style === "flat" ? 0.6 : 1);
  ctx.fillStyle = A.style === "glow" ? "rgba(220,235,255,1)" : "#fff";
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * A stroke in screen space with the kit's hand (arrows, underlines, axes): used by ink.ts, which has a canvas but no
 * Art. `seed` keeps one mark's tremor stable while it is drawn on.
 */
export function kitStroke(ctx: Ctx, tokens: any, t: number, pts: P[], colorStr: string, width: number, seed: number) {
  const a = tokens?.art ?? {};
  const A: Art = {
    ctx, u: 1, cartoon: false, style: String(a.style ?? "ink"), outline: colorStr, lw: width,
    c: (n: string) => n, tint: (col: string, f: number) => mix(col, f), mat: materialOf(tokens), pose: boilPose(tokens, t), seed,
    paper: tokens?.colors?.paper ?? "#fff",
  };
  const tiny = extentPx(A, pts) < 9;
  const h = tiny ? pts : handOf(A, pts, false);
  strokeShape(A, h, false, colorStr, width, null, tiny, true);
}

/** A native-path helper some components still use. */
export function pathOf(ctx: Ctx, pts: P[], closed: boolean) {
  ctx.beginPath();
  tracePath(ctx, pts, closed);
}

export { circlePts, ellipsePts, smoothPts, resample, wobble as wobblePts };
