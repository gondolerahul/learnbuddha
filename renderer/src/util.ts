import type { Env, Rect, Tokens } from "./types";

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export const ease = {
  inOut: (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  out: (k: number) => 1 - Math.pow(1 - k, 3),
  in: (k: number) => k * k * k,
  outBack: (k: number) => {
    const c1 = 1.4;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
  },
};

/** FNV-1a string hash → uint32 */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 seeded PRNG */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFor(env: Env, key: string) {
  return rng(hash(`${env.seed}:${key}`));
}

export function color(tokens: Tokens, name: string | undefined, fallback = "ink"): string {
  if (!name) return tokens.colors[fallback];
  if (name.startsWith("#")) return name;
  return tokens.colors[name] ?? tokens.colors[fallback];
}

export function seriesColor(tokens: Tokens, i: number, name?: string) {
  if (name) return color(tokens, name);
  return color(tokens, tokens.series[i % tokens.series.length]);
}

export function fontSize(tokens: Tokens, size: string | number | undefined, fallback = "md") {
  if (typeof size === "number") return size;
  return tokens.sizes[size ?? fallback] ?? tokens.sizes[fallback];
}

/**
 * A canvas font string for a text role. Kits name their faces in tokens.fonts (hand = body and labels by default,
 * serif, display = headings and titles, label, mono) and their weights in tokens.type; heavy text with no family asked
 * for is a heading and takes the display face.
 */
export function font(tokens: Tokens, family: string | undefined, px: number, weight = 400) {
  const f: any = tokens.fonts;
  const ty: any = (tokens as any).type ?? {};
  let fam = f.hand;
  let w = weight;
  if (family === "serif" || family === "math") fam = f.serif;
  else if (family === "mono") fam = f.mono ?? f.hand;
  else if (family === "display" || ((!family || family === "hand") && weight >= 600 && f.display)) {
    fam = f.display ?? f.hand;
    w = ty.displayWeight ?? weight;
  } else if (family === "label") {
    fam = f.label ?? f.hand;
    w = ty.labelWeight ?? weight;
  } else if (weight === 400 && ty.bodyWeight) w = ty.bodyWeight;
  return `${w} ${Math.round(px)}px ${fam}`;
}

/** The kit's letter case for a role ("upper" for display or labels in some kits). */
export function caseFor(tokens: Tokens, role: string | undefined, text: string): string {
  const ty: any = (tokens as any).type ?? {};
  const c = role === "display" ? ty.case : role === "label" ? ty.labelCase : undefined;
  return c === "upper" ? text.toLocaleUpperCase() : text;
}

export function unionRect(rs: (Rect | null)[]): Rect | null {
  const v = rs.filter(Boolean) as Rect[];
  if (!v.length) return null;
  const x0 = Math.min(...v.map((r) => r.x));
  const y0 = Math.min(...v.map((r) => r.y));
  const x1 = Math.max(...v.map((r) => r.x + r.w));
  const y1 = Math.max(...v.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function inflate(r: Rect, d: number): Rect {
  return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d };
}

export function num(v: any, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function pt(v: any, fallback: [number, number]): [number, number] {
  if (Array.isArray(v) && v.length >= 2) return [num(v[0], fallback[0]), num(v[1], fallback[1])];
  return fallback;
}
