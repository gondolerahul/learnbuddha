// Data sets: the devices good explainers use to make numbers land.
//   TokenGrid  a crowd of figures (people, coins, houses, drops…); groups light up in turn ("1 in 12")
//   Bars       bars that grow (or race) to their values with counters ticking up, labels beside them
//   Stamp      a claim stamped onto the frame, which can then be struck through (a reversal)
import type { Component, Env, Rect } from "../../types";
import { drawProp } from "../art";
import { artFor, circle, line, poly, shape, type Art } from "../../art/paint";
import { drawText, layoutText } from "../../text";
import { clamp, color, lerp, num } from "../../util";
import { spring } from "../../motion";
import { P } from "./common";

// ───────────────────────────── TokenGrid ─────────────────────────────

function gridGeom(p: any) {
  const n = Math.max(1, Math.min(400, Math.round(num(p.n, 100))));
  const w = num(p.width, 900), h = num(p.height, 420);
  const cols = Math.max(1, Math.round(num(p.cols, Math.ceil(Math.sqrt(n * (w / h))))));
  const rows = Math.ceil(n / cols);
  const cell = Math.min(w / cols, h / rows);
  const cx = num(p.x, 640), cy = num(p.y, 400);
  const x0 = cx - (cols * cell) / 2 + cell / 2, y0 = cy - (rows * cell) / 2 + cell / 2;
  const at = (i: number): P => [x0 + (i % cols) * cell, y0 + Math.floor(i / cols) * cell];
  return { n, cols, rows, cell, at, box: { x: cx - (cols * cell) / 2, y: cy - (rows * cell) / 2, w: cols * cell, h: rows * cell } as Rect };
}

/** Which group each token belongs to (−1 none), and when it joins. */
function groupsOf(p: any, n: number): { g: number[]; groups: any[] } {
  const groups = Array.isArray(p.groups) ? p.groups : [];
  const g = new Array(n).fill(-1);
  let next = 0;
  groups.forEach((gr: any, gi: number) => {
    const idx: number[] = Array.isArray(gr.indices) ? gr.indices.map((x: any) => Math.round(num(x, -1))) : [];
    if (!idx.length) {
      const c = Math.max(0, Math.round(num(gr.count, 1)));
      for (let i = 0; i < c && next < n; i++) idx.push(next++);
    }
    for (const i of idx) if (i >= 0 && i < n) g[i] = gi;
  });
  return { g, groups };
}

function person(A: Art, x: number, y: number, s: number, col: string, alpha: number) {
  // a friendly block figure: a round-cornered head over a tapered body
  circle(A, x, y - s * 0.22, s * 0.18, col, { lw: 1.6, alpha });
  shape(A, [[x - s * 0.28, y + s * 0.38], [x - s * 0.2, y + s * 0.02], [x, y - s * 0.03], [x + s * 0.2, y + s * 0.02], [x + s * 0.28, y + s * 0.38]], col, { lw: 1.6, alpha, tension: 0.35 });
}

export const TokenGrid: Component = {
  inDur: () => 1.4,
  bounds: (_env, p) => gridGeom(p).box,
  anchors: (_env, p) => {
    const G = gridGeom(p);
    const { g, groups } = groupsOf(p, G.n);
    const out: Record<string, P> = { center: [G.box.x + G.box.w / 2, G.box.y + G.box.h / 2], first: G.at(0), last: G.at(G.n - 1) };
    groups.forEach((_: any, gi: number) => {
      const pts = g.map((v, i) => (v === gi ? G.at(i) : null)).filter(Boolean) as P[];
      if (pts.length) out[`g${gi}`] = [pts.reduce((s, q) => s + q[0], 0) / pts.length, pts.reduce((s, q) => s + q[1], 0) / pts.length];
    });
    if (p.highlight) out.highlight = G.at(Math.max(0, Math.min(G.n - 1, Math.round(num(p.highlight.index, 0)))));
    return out;
  },
  draw: (env, p, ph, el) => {
    const G = gridGeom(p);
    const absT = el.at + ph.local;
    const { ctx, tokens } = env;
    const A = artFor(env, 1, { seed: 101 });
    const { g, groups } = groupsOf(p, G.n);
    const kind = String(p.kind ?? "person");
    const base = String(p.color ?? "muted");
    ctx.save();
    ctx.globalAlpha *= ph.alpha;
    for (let i = 0; i < G.n; i++) {
      // the crowd pops in in a wave from the top-left
      const delay = ((i % G.cols) / G.cols) * 0.6 + (Math.floor(i / G.cols) / Math.max(1, G.rows)) * 0.5;
      const k = clamp((ph.local - delay) / 0.35);
      if (k <= 0) continue;
      const sp = spring(ph.local - delay, 0.55, 2.4);
      let col = base;
      let lift = 0;
      const gi = g[i];
      if (gi >= 0) {
        const gr = groups[gi];
        const at = num(gr.at, Infinity);
        const order = g.slice(0, i).filter((v) => v === gi).length;
        const kk = clamp((absT - at - order * 0.04) / 0.3);
        if (kk > 0) {
          col = kk > 0.5 ? String(gr.color ?? ["accent", "indigo", "sage", "ochre"][gi % 4]) : base;
          lift = Math.sin(Math.PI * kk) * G.cell * 0.15;
        }
      }
      const hl = p.highlight && Math.round(num(p.highlight.index, -1)) === i && absT >= num(p.highlight.at, Infinity);
      if (hl) col = String(p.highlight.color ?? "accent");
      const [x, y] = G.at(i);
      const s = G.cell * 0.82 * Math.max(0.01, sp);
      if (kind === "person") person(A, x, y - lift, s, col, k);
      else if (kind === "dot") circle(A, x, y - lift, s * 0.32, col, { stroke: false, alpha: k });
      else drawProp(env, kind, x, y - lift, s * 0.9, { t: absT, color: col === base ? undefined : col, alpha: k, flat: G.cell < 40, seed: i % 7 });
      if (hl) {
        ctx.save();
        ctx.globalAlpha *= 0.35 + 0.25 * Math.sin(absT * 4);
        ctx.strokeStyle = color(tokens, String(p.highlight.color ?? "accent"));
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, G.cell * 0.55, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    // group labels, beside their groups
    groups.forEach((gr: any, gi: number) => {
      if (!gr.label || absT < num(gr.at, Infinity)) return;
      const pts = g.map((v, i) => (v === gi ? G.at(i) : null)).filter(Boolean) as P[];
      if (!pts.length) return;
      const top = Math.min(...pts.map((q) => q[1])) - G.cell * 0.6;
      const cx = pts.reduce((s, q) => s + q[0], 0) / pts.length;
      const b = layoutText(env, { text: String(gr.label), x: cx, y: Math.max(G.box.y - 56, top - 40), size: "sm", align: "center", maxWidth: 260, maxLines: 1, role: "label" });
      drawText(env, b, "center", clamp((absT - num(gr.at, 0) - 0.3) / 0.5), gr.color ?? "ink", 1);
    });
    ctx.restore();
  },
};

// ───────────────────────────── Bars ─────────────────────────────

function barsGeom(p: any) {
  const items = (Array.isArray(p.items) ? p.items : []).slice(0, 8);
  const horiz = String(p.orientation ?? "horizontal") !== "vertical";
  const w = num(p.width, 820), h = num(p.height, 360);
  const cx = num(p.x, 640), cy = num(p.y, 400);
  const max = num(p.max, Math.max(1e-9, ...items.map((it: any) => num(it.value, 0))));
  return { items, horiz, w, h, cx, cy, max, box: { x: cx - w / 2, y: cy - h / 2, w, h } as Rect };
}

function fmt(v: number, decimals: number) {
  return v.toLocaleString("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

export const Bars: Component = {
  inDur: () => 1,
  bounds: (_env, p) => {
    const B = barsGeom(p);
    return { x: B.box.x - 10, y: B.box.y - 10, w: B.box.w + 20, h: B.box.h + 20 };
  },
  anchors: (_env, p) => {
    const B = barsGeom(p);
    const n = Math.max(1, B.items.length);
    const out: Record<string, P> = { center: [B.cx, B.cy] };
    B.items.forEach((_: any, i: number) => {
      out[`b${i}`] = B.horiz ? [B.box.x + B.w * 0.5, B.box.y + (B.h / n) * (i + 0.5)] : [B.box.x + (B.w / n) * (i + 0.5), B.box.y + B.h * 0.5];
    });
    return out;
  },
  draw: (env, p, ph, el) => {
    const B = barsGeom(p);
    const absT = el.at + ph.local;
    const { ctx } = env;
    const A = artFor(env, 1, { seed: 111 });
    const n = Math.max(1, B.items.length);
    const dec = Math.round(num(p.decimals, 0));
    const unit = String(p.unit ?? "");
    const raceDur = num(p.raceDur, 3);
    ctx.save();
    ctx.globalAlpha *= ph.alpha;
    const labelW = B.horiz ? Math.min(240, B.w * 0.3) : 0;
    B.items.forEach((it: any, i: number) => {
      const at = num(it.at, el.at + 0.2 + i * 0.25);
      if (absT < at) return;
      // a race grows every bar together at the same rate; otherwise each springs to its value
      const kk = p.race ? clamp((absT - at) / raceDur) : clamp((absT - at) / 0.9);
      const e = p.race ? kk : 1 - Math.pow(1 - kk, 3);
      const v = num(it.value, 0) * e;
      const frac = clamp(v / B.max);
      const col = String(it.color ?? (num(p.highlight, -1) === i ? "accent" : ["indigo", "sage", "ochre", "accent", "ink"][i % 5]));
      if (B.horiz) {
        const slot = B.h / n, bh = slot * 0.62;
        const y = B.box.y + slot * i + (slot - bh) / 2;
        const x0 = B.box.x + labelW, len = (B.w - labelW - 120) * frac;
        if (len > 1) shape(A, [[x0, y], [x0 + len, y], [x0 + len, y + bh], [x0, y + bh]], col, { tension: 0.06, lw: 2 });
        const lb = layoutText(env, { text: String(it.label ?? ""), x: x0 - 14, y: y + bh / 2 - 16, size: "sm", align: "right", maxWidth: labelW - 16, maxLines: 1, role: "label" });
        drawText(env, lb, "right", clamp((absT - at) / 0.4), "ink", 1);
        const vb = layoutText(env, { text: fmt(v, dec) + unit, x: x0 + len + 12, y: y + bh / 2 - 16, size: "sm", align: "left", maxWidth: 160, maxLines: 1, family: "mono" });
        drawText(env, vb, "left", 1, "ink", 1);
      } else {
        const slot = B.w / n, bw = slot * 0.6;
        const x = B.box.x + slot * i + (slot - bw) / 2;
        const base = B.box.y + B.h - 40, len = (B.h - 100) * frac;
        if (len > 1) shape(A, [[x, base - len], [x + bw, base - len], [x + bw, base], [x, base]], col, { tension: 0.06, lw: 2 });
        const lb = layoutText(env, { text: String(it.label ?? ""), x: x + bw / 2, y: base + 8, size: "sm", align: "center", maxWidth: slot - 6, maxLines: 1, role: "label" });
        drawText(env, lb, "center", clamp((absT - at) / 0.4), "ink", 1);
        const vb = layoutText(env, { text: fmt(v, dec) + unit, x: x + bw / 2, y: base - len - 40, size: "sm", align: "center", maxWidth: slot, maxLines: 1, family: "mono" });
        drawText(env, vb, "center", 1, "ink", 1);
      }
    });
    if (B.horiz) line(A, [[B.box.x + labelW, B.box.y], [B.box.x + labelW, B.box.y + B.h]], "ink", 2.5, clamp(ph.local / 0.5));
    else line(A, [[B.box.x, B.box.y + B.h - 40], [B.box.x + B.w, B.box.y + B.h - 40]], "ink", 2.5, clamp(ph.local / 0.5));
    ctx.restore();
    void poly;
  },
};

// ───────────────────────────── Stamp ─────────────────────────────

function stampBlock(env: Env, p: any) {
  return layoutText(env, { text: String(p.text ?? "CASE CLOSED?"), x: num(p.x, 640), y: num(p.y, 330), size: p.size ?? "xl", weight: 700, align: "center", maxWidth: 820, maxLines: 2, family: "display" });
}

export const Stamp: Component = {
  inDur: () => 0.5,
  bounds: (env, p) => {
    const b = stampBlock(env, p);
    return { x: b.rect.x - 30, y: b.rect.y - 18, w: b.rect.w + 60, h: b.rect.h + 36 };
  },
  draw: (env, p, ph, el) => {
    const b = stampBlock(env, p);
    const absT = el.at + ph.local;
    const { ctx, tokens } = env;
    const col = color(tokens, p.color ?? "accent");
    const k = clamp(ph.local / 0.22);
    const s = lerp(1.7, 1, k * k) + (k >= 1 ? Math.sin(ph.local * 40) * Math.exp(-ph.local * 8) * 0.02 : 0);
    const rot = (num(p.rotate, -7) * Math.PI) / 180;
    const cx = b.rect.x + b.rect.w / 2, cy = b.rect.y + b.rect.h / 2;
    ctx.save();
    ctx.globalAlpha *= ph.alpha * clamp(k * 3);
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.scale(s, s);
    ctx.translate(-cx, -cy);
    // the stamp's double border
    ctx.strokeStyle = col;
    ctx.lineWidth = 6;
    ctx.strokeRect(b.rect.x - 26, b.rect.y - 14, b.rect.w + 52, b.rect.h + 28);
    ctx.lineWidth = 2;
    ctx.strokeRect(b.rect.x - 16, b.rect.y - 6, b.rect.w + 32, b.rect.h + 12);
    drawText(env, b, "center", 1, p.color ?? "accent", 1);
    // ink that did not take: a scatter of paper-coloured flecks
    ctx.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 70; i++) {
      const x = b.rect.x - 26 + ((i * 97) % 1000) / 1000 * (b.rect.w + 52), y = b.rect.y - 14 + ((i * 61) % 1000) / 1000 * (b.rect.h + 28);
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(x, y, 1 + (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // the strike: a hand-drawn line through the claim
    const strike = num(p.strikeAt, Infinity);
    if (absT >= strike) {
      const kk = clamp((absT - strike) / 0.35);
      const x0 = b.rect.x - 40, x1 = b.rect.x + b.rect.w + 40;
      const A = artFor(env, 1, { seed: 121 });
      ctx.save();
      ctx.globalAlpha *= ph.alpha;
      line(A, [[x0, cy + 18], [lerp(x0, x1, kk), cy - 14 * kk]], p.strikeColor ?? "ink", 9);
      ctx.restore();
    }
  },
};
