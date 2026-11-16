// Painting helpers for illustrations: kit-aware palette, smooth closed shapes, fills with ink outlines.
// Props are drawn in a local box ~100 units tall centred on (0,0); `u` converts screen px to local units.
import type { Ctx, Env } from "../types";

export type P = [number, number];

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

function lerpColor(a: [number, number, number], b: [number, number, number], k: number) {
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * k)},${Math.round(a[1] + (b[1] - a[1]) * k)},${Math.round(a[2] + (b[2] - a[2]) * k)})`;
}

/**
 * Drawing treatments (tokens.art.style):
 *   ink        hand-inked outline with a dry-brush second pass (Zen Board)
 *   cartoon    crisp thick outline, friendly faces (Storybook)
 *   clean      crisp thin outline, flat fills, no wobble (medical/technical schematic)
 *   chalk      fills as soft chalk, outlines as broken chalk strokes (chalkboard)
 *   blueprint  pale washes and fine white linework on blue (blueprint)
 *   watercolor translucent washes with pooled darker edges and a pen line that misses a little (field notes)
 *   papercut   flat paper shapes with a pale cut rim and no ink line (paper cut-out)
 *   inkwash    grey washes and a heavy brush line (ink wash)
 *   comic      thick black line, flat colour (comic panel; cel shade and halftone come from the light pass)
 *   glow       dark bodies with luminous edges (dark cinematic)
 */
export function artFor(env: Env, scale: number): Art {
  const tk: any = env.tokens;
  const a = tk.art ?? {};
  const pal = { ...DEFAULT_PALETTE, ...(a.palette ?? {}) };
  const mono = a.mono ? { dark: parseColor(a.mono.dark) ?? [0, 0, 0], light: parseColor(a.mono.light) ?? [255, 255, 255], keep: new Set<string>(a.mono.keep ?? ["accent"]) } : null;
  const raw = (name: string) => {
    if (!name) return pal.black;
    if (name.startsWith("#") || name.startsWith("rgb")) return name;
    return pal[name] ?? tk.colors[name] ?? name;
  };
  // Monochrome styles (blueprint, ink wash) map every colour onto their two-tone ramp by its lightness,
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
  return {
    ctx: env.ctx,
    u: 1 / Math.max(0.01, scale),
    cartoon: style === "cartoon" || a.faces === true,
    style,
    outline: c(a.outline ?? tk.colors.ink),
    lw: a.lineWidth ?? 3,
    c,
    tint: (col, f) => mix(c(col), f),
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

/** Fill the current path, then outline it, in the kit's drawing treatment. */
export function paint(A: Art, fill: string | null, opts: { stroke?: boolean; lw?: number; strokeColor?: string; alpha?: number } = {}) {
  const { ctx } = A;
  const st = A.style;
  const fc = fill ? A.c(fill) : null;
  const lw = (opts.lw ?? A.lw) * A.u;
  ctx.save();
  if (opts.alpha !== undefined) ctx.globalAlpha *= opts.alpha;
  if (fc) {
    ctx.save();
    if (st === "papercut") {
      // each paper layer casts a crisp shadow on the one below (an offset, not a blur: frames stay deterministic)
      ctx.save();
      ctx.translate(2.5 * A.u, 4 * A.u);
      ctx.fillStyle = "rgba(45,28,12,0.28)";
      ctx.fill();
      ctx.restore();
    }
    if (st === "chalk") ctx.globalAlpha *= 0.62;
    else if (st === "blueprint") ctx.globalAlpha *= 0.16;
    else if (st === "inkwash") ctx.globalAlpha *= 0.55;
    else if (st === "watercolor") ctx.globalAlpha *= 0.72;
    ctx.fillStyle = st === "glow" ? mix(fc, -0.5) : fc;
    ctx.fill();
    if (st === "watercolor") {
      // pigment pools at the edge of a wash
      ctx.globalAlpha = (ctx.globalAlpha / 0.72) * 0.3;
      ctx.strokeStyle = mix(fc, -0.28);
      ctx.lineWidth = lw * 2.2;
      ctx.lineJoin = "round";
      ctx.stroke();
    }
    ctx.restore();
  }
  if (opts.stroke !== false) {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const sc = opts.strokeColor ? A.c(opts.strokeColor) : A.outline;
    ctx.strokeStyle = sc;
    ctx.lineWidth = lw;
    switch (st) {
      case "papercut":
        // no ink line: the pale rim of a cut edge (lines without a fill keep their stroke)
        if (fc) {
          ctx.strokeStyle = mix(fc, 0.5);
          ctx.globalAlpha *= 0.75;
          ctx.lineWidth = lw * 0.55;
        }
        ctx.stroke();
        break;
      case "glow": {
        const edge = fc && !opts.strokeColor ? mix(fc, 0.45) : sc;
        ctx.strokeStyle = edge;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha *= 0.16;
        ctx.lineWidth = lw * 3.6;
        ctx.stroke();
        ctx.restore();
        ctx.lineWidth = lw * 0.9;
        ctx.stroke();
        break;
      }
      case "chalk":
        ctx.setLineDash([lw * 4.2, lw * 0.7, lw * 2.4, lw * 0.5]);
        ctx.stroke();
        ctx.globalAlpha *= 0.45;
        ctx.setLineDash([lw * 2.6, lw * 1.1]);
        ctx.lineDashOffset = lw * 1.3;
        ctx.translate(0.6 * A.u, 0.8 * A.u);
        ctx.lineWidth = lw * 0.65;
        ctx.stroke();
        break;
      case "blueprint":
        ctx.lineWidth = lw * 0.7;
        ctx.stroke();
        break;
      case "clean":
        ctx.lineWidth = lw * 0.8;
        ctx.stroke();
        break;
      case "comic":
        ctx.lineWidth = lw * 1.5;
        ctx.stroke();
        break;
      case "watercolor":
        // the pen line misses the wash a little
        ctx.translate(1.4 * A.u, -1.0 * A.u);
        ctx.globalAlpha *= 0.85;
        ctx.lineWidth = lw * 0.7;
        ctx.stroke();
        break;
      case "inkwash":
        ctx.globalAlpha *= 0.9;
        ctx.lineWidth = lw * 1.3;
        ctx.stroke();
        ctx.globalAlpha *= 0.35;
        ctx.translate(1.1 * A.u, 1.3 * A.u);
        ctx.lineWidth = lw * 0.5;
        ctx.stroke();
        break;
      case "cartoon":
        ctx.stroke();
        break;
      default:
        ctx.stroke();
        ctx.globalAlpha *= 0.3;
        ctx.translate(0.7 * A.u, 0.9 * A.u);
        ctx.lineWidth = lw * 0.5;
        ctx.stroke();
    }
  }
  ctx.restore();
}

export function circle(A: Art, x: number, y: number, r: number, fill: string | null, opts: Parameters<typeof paint>[2] = {}) {
  A.ctx.beginPath();
  A.ctx.arc(x, y, Math.max(0.01, r), 0, Math.PI * 2);
  paint(A, fill, opts);
}

export function ellipse(A: Art, x: number, y: number, rx: number, ry: number, fill: string | null, rot = 0, opts: Parameters<typeof paint>[2] = {}) {
  A.ctx.beginPath();
  A.ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, Math.PI * 2);
  paint(A, fill, opts);
}

export function shape(A: Art, pts: P[], fill: string | null, opts: Parameters<typeof paint>[2] & { closed?: boolean; tension?: number } = {}) {
  A.ctx.beginPath();
  smooth(A.ctx, pts, opts.closed !== false, opts.tension ?? 0.5);
  paint(A, opts.closed === false ? null : fill, opts);
}

export function poly(A: Art, pts: P[], fill: string | null, opts: Parameters<typeof paint>[2] & { closed?: boolean } = {}) {
  const { ctx } = A;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
  if (opts.closed !== false) ctx.closePath();
  paint(A, opts.closed === false ? null : fill, opts);
}

export function line(A: Art, pts: P[], col?: string, lw?: number, alpha = 1) {
  const { ctx } = A;
  if (pts.length < 2) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.beginPath();
  smooth(ctx, pts, false);
  ctx.strokeStyle = col ? A.c(col) : A.outline;
  ctx.lineWidth = (lw ?? A.lw) * A.u;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (A.style === "chalk") {
    const w = ctx.lineWidth;
    ctx.setLineDash([w * 4.2, w * 0.6, w * 2.6, w * 0.45]);
  } else if (A.style === "glow" && (lw ?? A.lw) <= 8) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha *= 0.18;
    ctx.lineWidth *= 3;
    ctx.stroke();
    ctx.restore();
  }
  ctx.stroke();
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
  ctx.fillStyle = A.c("black");
  for (const dx of [-0.35, 0.35]) {
    ctx.beginPath();
    ctx.ellipse(x + dx * s, y - 0.1 * s, 0.11 * s, 0.15 * s * blink, 0, 0, Math.PI * 2);
    ctx.fill();
    if (blink > 0.5) {
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
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
