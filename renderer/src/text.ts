// Text layout (wrap + auto-shrink) and the "write-on" reveal.
import type { Ctx, Env, Rect } from "./types";
import { caseFor, clamp, color, font, fontSize, hash, rng } from "./util";
import { misregister, RISO_INKS } from "./art/material";

export interface TextBlock {
  lines: string[];
  widths: number[];
  px: number;
  lineHeight: number;
  font: string;
  rect: Rect;
  shrunk: boolean;
  /** display (headings, titles), label (labels on pictures) or body */
  role: string;
}

export interface TextOpts {
  text: string;
  x: number;
  y: number; // top of the block
  size?: string | number;
  family?: string; // "hand" | "serif" | "math" | "display" | "label" | "mono"
  weight?: number;
  align?: "left" | "center" | "right";
  maxWidth?: number;
  maxLines?: number;
  /** what the text is for; picks the kit's face, case and reveal (default: display when bold, else body) */
  role?: "display" | "label" | "body";
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
  const key = `${env.tokens.id}|${o.text}|${o.x}|${o.y}|${o.size}|${o.family}|${o.weight}|${o.align}|${o.maxWidth}|${o.maxLines}|${o.role}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { ctx, tokens } = env;
  const role = o.role ?? (o.family === "label" ? "label" : (o.weight ?? 400) >= 600 && (!o.family || o.family === "hand" || o.family === "display") ? "display" : "body");
  const ty: any = (tokens as any).type ?? {};
  const family = o.family ?? (role === "label" && ty.labelFamily ? ty.labelFamily : role === "label" ? "label" : undefined);
  o = { ...o, family, text: caseFor(tokens, role, drawable(String(o.text ?? ""))) };
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
    role,
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

/** Default reveal duration for a string: write-on and typing follow its length; rises, pops and stamps are quick. */
export function writeDur(env: Env, text: string) {
  const m = env.tokens.motion;
  const reveal = ((env.tokens as any).type ?? {}).reveal ?? "write";
  const n = String(text ?? "").length;
  if (reveal === "rise" || reveal === "pop" || reveal === "stamp") return clamp(0.55 + n / 240, 0.55, 1.1);
  return clamp(n / m.charsPerSecond, m.minWrite, m.maxWrite);
}

const chalkFills = new Map<string, any>();

/** A chalky fill for text: the colour with tiny pits where the chalk skipped the board. */
function chalkFill(env: Env, col: string): any {
  const key = `${env.tokens.id}|${col}`;
  let pat = chalkFills.get(key);
  if (pat) return pat;
  const size = 96;
  const c = env.makeCanvas(size, size);
  const g = c.getContext("2d");
  g.fillStyle = col;
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = "destination-out";
  const r = rng(hash("chalktext"));
  for (let i = 0; i < 520; i++) {
    g.globalAlpha = 0.35 + r() * 0.65;
    g.beginPath();
    g.arc(r() * size, r() * size, 0.35 + r() ** 3 * 1.3, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 0.5;
  g.lineWidth = 0.7;
  g.strokeStyle = "#000";
  for (let i = 0; i < 26; i++) {
    const x = r() * size, y = r() * size;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 4 + r() * 9, y + (r() - 0.5) * 2);
    g.stroke();
  }
  pat = env.ctx.createPattern(c, "repeat");
  chalkFills.set(key, pat);
  return pat;
}

/**
 * Draw a text block with the kit's reveal (tokens.type.reveal, or headingReveal for display text):
 *   write  left to right with a pen tip at the writing edge (a chalk stick on the board)
 *   type   character by character with a caret
 *   rise   each line rises into place as it fades in, one after another
 *   pop    each line springs up from a little smaller
 *   stamp  the whole block lands at once, slightly too big, then settles
 * plus the kit's legibility halo (type.halo) and surface (type.texture: chalk, print).
 */
export function drawText(env: Env, b: TextBlock, align: string, k: number, colorName?: string, alpha = 1) {
  const { ctx, tokens } = env;
  if (k <= 0 || alpha <= 0) return;
  const ty: any = (tokens as any).type ?? {};
  const reveal: string = (b.role === "display" ? ty.headingReveal ?? ty.reveal : ty.reveal) ?? "write";
  const col = color(tokens, colorName);
  const fill = ty.texture === "chalk" ? chalkFill(env, col) : col;
  const print = ty.texture === "print" && b.role === "display";
  const halo: string | null = ty.halo ?? null;
  const total = b.widths.reduce((s, w) => s + w, 0) || 1;
  const chars = b.lines.reduce((s, l) => s + l.length, 0) || 1;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = b.font;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.lineJoin = "round";

  const put = (text: string, x: number, y: number) => {
    if (halo) {
      ctx.save();
      ctx.strokeStyle = halo;
      ctx.lineWidth = Math.max(2, b.px * 0.2);
      ctx.strokeText(text, x, y);
      ctx.restore();
    }
    if (print) {
      // the accent drum printed first, a little out of register
      const pose = Math.floor(((env as any).t ?? 0) * 8 + 1e-6) % 3;
      const [ox, oy] = misregister("pink", pose, b.lines.length + Math.round(b.rect.x), 1.6);
      const ink = RISO_INKS.pink;
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = `rgba(${ink[0]},${ink[1]},${ink[2]},0.9)`;
      ctx.fillText(text, x + 2 + ox, y + 1.5 + oy);
      ctx.restore();
    }
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  };

  const n = b.lines.length;
  if (reveal === "stamp") {
    const e = clamp(k * 2.2);
    const s = 1 + 0.28 * Math.pow(1 - e, 3);
    const cx = b.rect.x + b.rect.w / 2, cy = b.rect.y + b.rect.h / 2;
    ctx.globalAlpha *= k > 0.03 ? 1 : 0;
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.rotate(-0.025 * (1 - e));
    ctx.translate(-cx, -cy);
  }
  let budget = total * clamp(k);
  let charBudget = Math.floor(chars * clamp(k) + 1e-6);
  for (let i = 0; i < n; i++) {
    const w = b.widths[i];
    const lx = align === "center" ? b.rect.x + (b.rect.w - w) / 2 : align === "right" ? b.rect.x + b.rect.w - w : b.rect.x;
    const baseline = b.rect.y + b.lineHeight * i + b.px * 1.0;
    if (reveal === "rise" || reveal === "pop") {
      const lk = clamp(k * (1 + (n - 1) * 0.3) - i * 0.3);
      if (lk <= 0) continue;
      ctx.save();
      if (reveal === "rise") {
        const e = 1 - Math.pow(1 - lk, 3);
        ctx.globalAlpha *= e;
        ctx.translate(0, (1 - e) * Math.min(18, b.px * 0.45));
      } else {
        const e = 1 + 2.4 * Math.pow(lk - 1, 3) + 1.4 * Math.pow(lk - 1, 2); // ease-out-back
        const s = 0.8 + 0.2 * e;
        const cx = lx + w / 2, cy = baseline - b.px * 0.35;
        ctx.globalAlpha *= clamp(lk * 3);
        ctx.translate(cx, cy);
        ctx.scale(s, s);
        ctx.translate(-cx, -cy);
      }
      put(b.lines[i], lx, baseline);
      ctx.restore();
      continue;
    }
    if (reveal === "type") {
      if (charBudget <= 0) break;
      const line = b.lines[i];
      const shown = line.slice(0, charBudget);
      put(shown, lx, baseline);
      if (shown.length < line.length && k < 1) {
        const cw = ctx.measureText(shown).width;
        ctx.save();
        ctx.fillStyle = color(tokens, "accent");
        ctx.fillRect(lx + cw + 2, baseline - b.px * 0.8, Math.max(2, b.px * 0.09), b.px * 0.95);
        ctx.restore();
      }
      charBudget -= line.length;
      continue;
    }
    if (reveal === "stamp") {
      put(b.lines[i], lx, baseline);
      continue;
    }
    // write: left to right, line by line
    const show = Math.min(w, budget);
    if (show <= 0) break;
    ctx.save();
    if (show < w) {
      ctx.beginPath();
      ctx.rect(lx - 4, baseline - b.px * 1.2, show + 4, b.lineHeight * 1.25);
      ctx.clip();
    }
    put(b.lines[i], lx, baseline);
    ctx.restore();
    if (show < w && k < 1) {
      const tx = lx + show + 2, tyy = baseline - b.px * 0.3;
      ctx.save();
      if (ty.tip === "chalk") {
        // a stick of chalk at the writing edge
        ctx.translate(tx, tyy);
        ctx.rotate(-0.6);
        ctx.fillStyle = col;
        ctx.fillRect(-2, -b.px * 0.55, Math.max(4, b.px * 0.16), b.px * 0.55);
      } else if (ty.tip !== "none") {
        ctx.beginPath();
        ctx.fillStyle = color(tokens, "accent");
        ctx.arc(tx, tyy, Math.max(2.5, b.px * 0.07), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    budget -= w;
  }
  ctx.restore();
}
