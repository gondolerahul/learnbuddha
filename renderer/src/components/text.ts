// Text-led components: TitleCard, Heading, Text, EquationWrite, BulletReveal,
// Callout, Counter, Table, RecapCard.
import type { Component, Env } from "../types";
import { drawText, layoutText, writeDur } from "../text";
import { inkStroke, partial, wobble, roughRect, P } from "../ink";
import { clamp, color, ease, font, fontSize, num, rngFor, unionRect } from "../util";

const W = (env: Env) => env.tokens.canvas.width;
const H = (env: Env) => env.tokens.canvas.height;

export const TitleCard: Component = {
  inDur: (env, p) => writeDur(env, p.title) + 0.6,
  bounds: (env, p) => {
    const t = titleBlocks(env, p);
    return unionRect([t.title.rect, t.sub?.rect ?? null]);
  },
  draw: (env, p, ph) => {
    const t = titleBlocks(env, p);
    const wd = writeDur(env, p.title);
    drawText(env, t.title, "center", ease.out(clamp(ph.local / wd)), p.color, ph.alpha);
    const r = t.title.rect;
    const y = r.y + r.h + 14;
    const stroke = wobble(env, "title-ul", [[W(env) / 2 - Math.min(r.w, 520) / 2, y], [W(env) / 2 + Math.min(r.w, 520) / 2, y + 3]], 2.2);
    const k2 = clamp((ph.local - wd * 0.7) / 0.6);
    inkStroke(env.ctx, partial(stroke, ease.inOut(k2)), color(env.tokens, "accent"), env.tokens.stroke.bold, ph.alpha);
    if (t.sub) {
      const k3 = clamp((ph.local - wd - 0.2) / 0.6);
      drawText(env, t.sub, "center", 1, "inkSoft", ph.alpha * ease.out(k3));
    }
  },
};

function titleBlocks(env: Env, p: any) {
  const title = layoutText(env, { text: p.title ?? "", x: W(env) / 2, y: num(p.y, H(env) / 2 - 90), size: p.size ?? "title", weight: 700, align: "center", maxLines: 2, maxWidth: 1000 });
  const sub = p.subtitle
    ? layoutText(env, { text: p.subtitle, x: W(env) / 2, y: title.rect.y + title.rect.h + 40, size: "md", family: "serif", align: "center", maxLines: 2, maxWidth: 900 })
    : null;
  return { title, sub };
}

export const Heading: Component = {
  inDur: (env, p) => writeDur(env, p.text),
  bounds: (env, p) => headingBlock(env, p).rect,
  draw: (env, p, ph) => {
    const b = headingBlock(env, p);
    drawText(env, b, p.align ?? "left", ease.out(ph.k), p.color, ph.alpha);
    if (p.underline !== false) {
      const y = b.rect.y + b.rect.h + 6;
      const pts = wobble(env, "hd-" + p.text, [[b.rect.x, y], [b.rect.x + Math.min(b.rect.w, 360), y + 2]], 1.6);
      inkStroke(env.ctx, partial(pts, ease.inOut(clamp((ph.local - ph.dur * 0.6) / 0.5))), color(env.tokens, "accent"), env.tokens.stroke.base, ph.alpha);
    }
  },
};

function headingBlock(env: Env, p: any) {
  const align = p.align ?? "left";
  const x = num(p.x, align === "center" ? W(env) / 2 : env.tokens.margin);
  return layoutText(env, { text: p.text ?? "", x, y: num(p.y, 44), size: p.size ?? "lg", weight: 700, align, maxLines: 1, maxWidth: num(p.maxWidth, W(env) - 2 * env.tokens.margin) });
}

function textBlock(env: Env, p: any, family?: string) {
  return layoutText(env, {
    text: p.text ?? "",
    x: num(p.x, env.tokens.margin),
    y: num(p.y, 160),
    size: p.size ?? "md",
    family: family ?? p.font ?? "hand",
    weight: p.bold ? 700 : 400,
    align: p.align ?? "left",
    maxWidth: num(p.maxWidth, W(env) - 2 * env.tokens.margin),
    maxLines: num(p.maxLines, 4),
  });
}

export const Text: Component = {
  inDur: (env, p) => writeDur(env, p.text),
  bounds: (env, p) => textBlock(env, p).rect,
  draw: (env, p, ph) => drawText(env, textBlock(env, p), p.align ?? "left", ph.k, p.color, ph.alpha),
};

export const EquationWrite: Component = {
  inDur: (env, p) => writeDur(env, p.text) * 1.3,
  bounds: (env, p) => textBlock(env, { size: "lg", ...p, maxLines: 2 }, "math").rect,
  draw: (env, p, ph) => {
    const b = textBlock(env, { size: "lg", ...p, maxLines: 2 }, "math");
    drawText(env, b, p.align ?? "left", ph.k, p.color, ph.alpha);
  },
};

function bulletLayout(env: Env, p: any) {
  const items: string[] = Array.isArray(p.items) ? p.items.map(String) : [];
  const x = num(p.x, env.tokens.margin + 10);
  let y = num(p.y, 160);
  const gap = num(p.gap, 22);
  const maxWidth = num(p.maxWidth, W(env) - x - env.tokens.margin);
  const blocks = items.map((it) => {
    const b = layoutText(env, { text: it, x: x + 34, y, size: p.size ?? "md", maxWidth: maxWidth - 34, maxLines: 2 });
    y += b.rect.h + gap;
    return b;
  });
  return { blocks, x };
}

export const BulletReveal: Component = {
  inDur: (env, p) => {
    const items: string[] = p.items ?? [];
    return items.reduce((s, it) => s + writeDur(env, it) + 0.25, 0);
  },
  bounds: (env, p) => {
    const { blocks, x } = bulletLayout(env, p);
    const r = unionRect(blocks.map((b) => b.rect));
    return r ? { x, y: r.y, w: r.x + r.w - x, h: r.h } : null;
  },
  draw: (env, p, ph, el) => {
    const { blocks, x } = bulletLayout(env, p);
    const times: number[] | undefined = Array.isArray(p.times) ? p.times : undefined;
    let tAcc = 0;
    blocks.forEach((b, i) => {
      const wd = writeDur(env, b.lines.join(" "));
      // `times` are absolute scene times; otherwise items are staggered.
      const start = times && typeof times[i] === "number" ? times[i] - el.at : tAcc;
      tAcc += wd + 0.25;
      const lt = ph.local - start;
      if (lt <= 0) return;
      const k = clamp(lt / wd);
      const dotK = ease.outBack(clamp(lt / 0.25));
      const cy = b.rect.y + b.px * 0.62;
      env.ctx.save();
      env.ctx.globalAlpha *= ph.alpha;
      env.ctx.fillStyle = color(env.tokens, p.bulletColor ?? "accent");
      env.ctx.beginPath();
      env.ctx.arc(x + 10, cy, 6.5 * dotK, 0, Math.PI * 2);
      env.ctx.fill();
      env.ctx.restore();
      const hl = Array.isArray(p.highlight) && p.highlight.includes(i);
      drawText(env, b, "left", k, hl ? "accent" : p.color, ph.alpha);
    });
  },
};

function calloutLayout(env: Env, p: any) {
  const w = num(p.w, 380);
  const x = num(p.x, W(env) - env.tokens.margin - w);
  const y = num(p.y, 150);
  const pad = 22;
  const b = layoutText(env, { text: p.text ?? "", x: x + pad, y: y + pad + (p.title ? 40 : 0), size: p.size ?? "sm", maxWidth: w - 2 * pad, maxLines: 7 });
  const title = p.title ? layoutText(env, { text: p.title, x: x + pad, y: y + pad - 4, size: "md", weight: 700, maxWidth: w - 2 * pad, maxLines: 1 }) : null;
  const h = Math.max(num(p.h, 0), b.rect.y + b.rect.h - y + pad);
  return { x, y, w, h, b, title };
}

export const Callout: Component = {
  inDur: (env, p) => 0.5 + writeDur(env, p.text) * 0.6,
  bounds: (env, p) => {
    const l = calloutLayout(env, p);
    return { x: l.x, y: l.y, w: l.w, h: l.h };
  },
  draw: (env, p, ph) => {
    const { ctx, tokens } = env;
    const l = calloutLayout(env, p);
    const r = rngFor(env, "callout-" + (p.text ?? ""));
    const tilt = (r() - 0.5) * 0.05;
    const pop = ease.outBack(clamp(ph.local / 0.4));
    ctx.save();
    ctx.globalAlpha *= ph.alpha;
    ctx.translate(l.x + l.w / 2, l.y + l.h / 2);
    ctx.rotate(tilt);
    ctx.scale(0.85 + 0.15 * pop, 0.85 + 0.15 * pop);
    ctx.translate(-(l.x + l.w / 2), -(l.y + l.h / 2));
    ctx.globalAlpha *= clamp(ph.local / 0.25);
    ctx.fillStyle = "rgba(0,0,0,0.08)";
    ctx.fillRect(l.x + 5, l.y + 7, l.w, l.h);
    ctx.fillStyle = color(tokens, p.tone === "accent" ? "accentSoft" : "note");
    ctx.fillRect(l.x, l.y, l.w, l.h);
    ctx.fillStyle = color(tokens, "accent");
    ctx.fillRect(l.x, l.y, 6, l.h);
    if (l.title) drawText(env, l.title, "left", 1, "ink", 1);
    drawText(env, l.b, "left", clamp((ph.local - 0.35) / Math.max(0.1, ph.dur - 0.35)), "ink", 1);
    ctx.restore();
  },
};

export const Counter: Component = {
  inDur: () => 1.6,
  bounds: (env, p) => {
    const px = fontSize(env.tokens, p.size, "xl");
    const s = fmtCounter(p, num(p.to, 0));
    env.ctx.save();
    env.ctx.font = font(env.tokens, p.font ?? "serif", px, 600);
    const w = env.ctx.measureText(s).width;
    env.ctx.restore();
    const x = num(p.x, W(env) / 2);
    const align = p.align ?? "center";
    return { x: align === "center" ? x - w / 2 : align === "right" ? x - w : x, y: num(p.y, 300), w, h: px * 1.2 };
  },
  draw: (env, p, ph, el) => {
    const v = num(p.from, 0) + (num(p.to, 0) - num(p.from, 0)) * ease.inOut(ph.k);
    const r = Counter.bounds(env, p, el)!;
    const px = fontSize(env.tokens, p.size, "xl");
    const ctx = env.ctx;
    ctx.save();
    ctx.globalAlpha *= ph.alpha * clamp(ph.local / 0.2);
    ctx.font = font(env.tokens, p.font ?? "serif", px, 600);
    ctx.fillStyle = color(env.tokens, p.color ?? "ink");
    ctx.textAlign = "left";
    ctx.fillText(fmtCounter(p, v), r.x, r.y + px);
    if (p.label) {
      ctx.font = font(env.tokens, "hand", fontSize(env.tokens, "sm"));
      ctx.fillStyle = color(env.tokens, "muted");
      ctx.fillText(String(p.label), r.x, r.y + px * 1.2 + 30);
    }
    ctx.restore();
  },
};

function fmtCounter(p: any, v: number) {
  const d = num(p.decimals, 0);
  return `${p.prefix ?? ""}${v.toFixed(d)}${p.suffix ?? ""}`;
}

function tableLayout(env: Env, p: any) {
  const rows: string[][] = Array.isArray(p.rows) ? p.rows.map((r: any) => (Array.isArray(r) ? r.map(String) : [String(r)])) : [];
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const x = num(p.x, env.tokens.margin);
  const y = num(p.y, 150);
  const w = num(p.w, Math.min(W(env) - 2 * env.tokens.margin, cols * 240));
  const colW: number[] = Array.isArray(p.colWidths) && p.colWidths.length === cols ? p.colWidths.map((c: number) => (c * w) / p.colWidths.reduce((a: number, b: number) => a + b, 0)) : Array(cols).fill(w / cols);
  const px = fontSize(env.tokens, p.size, "sm");
  const rowH = num(p.rowHeight, px * 2.0);
  return { rows, cols, x, y, w, colW, px, rowH, h: rowH * rows.length };
}

export const Table: Component = {
  inDur: (env, p) => 0.5 + (Array.isArray(p.rows) ? p.rows.length : 1) * 0.45,
  bounds: (env, p) => {
    const l = tableLayout(env, p);
    return { x: l.x, y: l.y, w: l.w, h: l.h };
  },
  draw: (env, p, ph) => {
    const l = tableLayout(env, p);
    const { ctx, tokens } = env;
    const gridK = clamp(ph.local / 0.5);
    for (let i = 0; i <= l.rows.length; i++) {
      const yy = l.y + i * l.rowH;
      const pts = wobble(env, `tbl-h${i}`, [[l.x, yy], [l.x + l.w, yy]], 1);
      inkStroke(ctx, partial(pts, ease.inOut(gridK)), color(tokens, i === 1 && p.header !== false ? "ink" : "grid"), i === 1 && p.header !== false ? tokens.stroke.base : tokens.stroke.thin, ph.alpha);
    }
    l.rows.forEach((row, ri) => {
      const rk = clamp((ph.local - 0.4 - ri * 0.45) / 0.4);
      if (rk <= 0) return;
      let cx = l.x;
      row.forEach((cell, ci) => {
        const b = layoutText(env, { text: cell, x: cx + 14, y: l.y + ri * l.rowH + (l.rowH - l.px * 1.28) / 2, size: l.px, weight: ri === 0 && p.header !== false ? 700 : 400, maxWidth: l.colW[ci] - 24, maxLines: 1 });
        drawText(env, b, "left", 1, ri === 0 && p.header !== false ? "ink" : "inkSoft", ph.alpha * rk);
        cx += l.colW[ci];
      });
    });
  },
};

export const RecapCard: Component = {
  inDur: () => 1.2,
  bounds: (env) => ({ x: 0, y: 0, w: W(env), h: H(env) }),
  draw: (env, p, ph) => {
    const { ctx, tokens } = env;
    ctx.save();
    ctx.globalAlpha *= ph.alpha;
    const label = layoutText(env, { text: p.label ?? "Back to the lesson", x: W(env) / 2, y: 190, size: "sm", align: "center", maxLines: 1 });
    drawText(env, label, "center", clamp(ph.local / 0.4), "muted", 1);
    const title = layoutText(env, { text: p.title ?? "", x: W(env) / 2, y: 250, size: "xl", weight: 700, align: "center", maxLines: 2, maxWidth: 1000 });
    drawText(env, title, "center", ease.out(clamp((ph.local - 0.2) / 0.8)), "ink", 1);
    const y = title.rect.y + title.rect.h + 18;
    const stroke = wobble(env, "recap", [[W(env) / 2 - 200, y], [W(env) / 2 + 200, y + 2]], 2);
    inkStroke(ctx, partial(stroke, ease.inOut(clamp((ph.local - 0.6) / 0.6))), color(tokens, "accent"), tokens.stroke.bold, 1);
    if (p.line) {
      const line = layoutText(env, { text: `“${p.line}”`, x: W(env) / 2, y: y + 50, size: "md", family: "serif", align: "center", maxLines: 3, maxWidth: 940 });
      drawText(env, line, "center", 1, "inkSoft", clamp((ph.local - 0.9) / 0.6));
    }
    ctx.restore();
  },
};

export type { P };
export { roughRect };
