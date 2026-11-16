// Text layout (wrap + auto-shrink) and the "write-on" reveal.
import type { Ctx, Env, Rect } from "./types";
import { clamp, color, font, fontSize } from "./util";

export interface TextBlock {
  lines: string[];
  widths: number[];
  px: number;
  lineHeight: number;
  font: string;
  rect: Rect;
  shrunk: boolean;
}

export interface TextOpts {
  text: string;
  x: number;
  y: number; // top of the block
  size?: string | number;
  family?: string; // "hand" | "serif" | "math"
  weight?: number;
  align?: "left" | "center" | "right";
  maxWidth?: number;
  maxLines?: number;
}

const cache = new Map<string, TextBlock>();

// The bundled fonts have no subscript digits or superscript signs (only ¹ ² ³), which would draw as boxes.
// Rewrite them as readable plain text: H₂O → H2O, Na⁺ → Na+, Cl⁻ → Cl−, Ca²⁺ → Ca²+, 10⁻⁶ → 10^−6.
const SUB = "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎";
const SUB_TO = "0123456789+−=()";
const SUP_KEEP = new Set(["¹", "²", "³"]);
const SUP: Record<string, string> = { "⁰": "0", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "ⁿ": "n", "ⁱ": "i", "⁽": "(", "⁾": ")", "⁼": "=" };
export function drawable(text: string): string {
  if (!/[⁰-₟]/.test(text)) return text;
  let out = "";
  let inSup = false;
  for (const ch of text) {
    const i = SUB.indexOf(ch);
    if (i >= 0) { out += SUB_TO[i]; inSup = false; continue; }
    if (ch === "⁺") { out += "+"; inSup = false; continue; }
    if (ch === "⁻") { out += "−"; continue; }
    if (SUP[ch] !== undefined) { out += (inSup || out.endsWith("−") && out.length > 1 && /[\d)]−$/.test(out) ? "" : "^") + SUP[ch]; inSup = true; continue; }
    inSup = SUP_KEEP.has(ch);
    out += ch;
  }
  return out;
}

export function layoutText(env: Env, o: TextOpts): TextBlock {
  const key = `${env.tokens.id}|${o.text}|${o.x}|${o.y}|${o.size}|${o.family}|${o.weight}|${o.align}|${o.maxWidth}|${o.maxLines}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { ctx, tokens } = env;
  o = { ...o, text: drawable(String(o.text ?? "")) };
  const maxWidth = o.maxWidth ?? tokens.canvas.width - 2 * tokens.margin;
  const maxLines = o.maxLines ?? 4;
  let px = fontSize(tokens, o.size);
  let lines: string[] = [];
  let widths: number[] = [];
  let f = "";
  let shrunk = false;
  const text = String(o.text ?? "");
  for (let attempt = 0; attempt < 8; attempt++) {
    f = font(tokens, o.family, px, o.weight ?? 400);
    ctx.save();
    ctx.font = f;
    ({ lines, widths } = wrap(ctx, text, maxWidth));
    ctx.restore();
    if (lines.length <= maxLines && Math.max(0, ...widths) <= maxWidth + 1) break;
    px *= 0.88;
    shrunk = true;
  }
  const lineHeight = px * 1.28;
  const w = Math.max(0, ...widths);
  const align = o.align ?? "left";
  const x0 = align === "center" ? o.x - w / 2 : align === "right" ? o.x - w : o.x;
  const block: TextBlock = {
    lines,
    widths,
    px,
    lineHeight,
    font: f,
    rect: { x: x0, y: o.y, w, h: lineHeight * lines.length },
    shrunk,
  };
  if (cache.size > 4000) cache.clear();
  cache.set(key, block);
  return block;
}

function wrap(ctx: Ctx, text: string, maxWidth: number) {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    let cur = "";
    for (const w of words) {
      const next = cur ? cur + " " + w : w;
      if (ctx.measureText(next).width <= maxWidth || !cur) cur = next;
      else {
        lines.push(cur);
        cur = w;
      }
    }
    lines.push(cur);
  }
  const widths = lines.map((l) => ctx.measureText(l).width);
  return { lines, widths };
}

/** Default write-on duration for a string. */
export function writeDur(env: Env, text: string) {
  const m = env.tokens.motion;
  return clamp(String(text ?? "").length / m.charsPerSecond, m.minWrite, m.maxWrite);
}

/**
 * Draw a text block revealed left-to-right, line by line, with a pen dot at the
 * writing edge while k < 1.
 */
export function drawText(env: Env, b: TextBlock, align: string, k: number, colorName?: string, alpha = 1) {
  const { ctx, tokens } = env;
  if (k <= 0 || alpha <= 0) return;
  const total = b.widths.reduce((s, w) => s + w, 0) || 1;
  let budget = total * clamp(k);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = b.font;
  ctx.fillStyle = color(tokens, colorName);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  for (let i = 0; i < b.lines.length; i++) {
    const w = b.widths[i];
    const lx = align === "center" ? b.rect.x + (b.rect.w - w) / 2 : align === "right" ? b.rect.x + b.rect.w - w : b.rect.x;
    const baseline = b.rect.y + b.lineHeight * i + b.px * 1.0;
    const show = Math.min(w, budget);
    if (show <= 0) break;
    ctx.save();
    if (show < w) {
      ctx.beginPath();
      ctx.rect(lx - 4, baseline - b.px * 1.2, show + 4, b.lineHeight * 1.25);
      ctx.clip();
    }
    ctx.fillText(b.lines[i], lx, baseline);
    ctx.restore();
    if (show < w && k < 1) {
      ctx.beginPath();
      ctx.fillStyle = color(tokens, "accent");
      ctx.arc(lx + show + 2, baseline - b.px * 0.3, Math.max(2.5, b.px * 0.07), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color(tokens, colorName);
    }
    budget -= w;
  }
  ctx.restore();
}
