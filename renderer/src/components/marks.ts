// Annotation and diagram marks: Underline, CircleHighlight, MarkerHighlight,
// Arrow, Box, Flow.
import type { Component, Env, Rect, SceneElement } from "../types";
import { arrowHead, ellipsePoints, inkStroke, P, partial, quadPoints, roughRect, wobble } from "../ink";
import { drawText, layoutText } from "../text";
import { clamp, color, ease, inflate, num, pt } from "../util";

/** Resolve a target rect from `target` (element id) or explicit x/y/w/h. */
function targetRect(env: Env, p: any): Rect | null {
  if (typeof p.target === "string") {
    const r = env.boundsOf(p.target);
    if (r) return r;
    env.warn(p.__id ?? "?", `target '${p.target}' not found`);
  }
  if (typeof p.x === "number" && typeof p.y === "number") return { x: p.x, y: p.y, w: num(p.w, 200), h: num(p.h, 60) };
  return null;
}

export const Underline: Component = {
  inDur: () => 0.6,
  bounds: (env, p) => {
    const r = targetRect(env, p);
    return r ? { x: r.x, y: r.y + r.h + 2, w: r.w, h: 10 } : null;
  },
  draw: (env, p, ph, el) => {
    const r = targetRect(env, { ...p, __id: el.id });
    if (!r) return;
    const y = r.y + r.h + num(p.offset, 4);
    const pts = wobble(env, "ul-" + el.id, [[r.x - 4, y + 2], [r.x + r.w + 6, y - 1]], 2.2);
    inkStroke(env.ctx, partial(pts, ease.inOut(ph.k)), color(env.tokens, p.color ?? "accent"), env.tokens.stroke.bold, ph.alpha);
    if (p.double) {
      const p2 = wobble(env, "ul2-" + el.id, [[r.x + 8, y + 12], [r.x + r.w - 4, y + 10]], 2);
      inkStroke(env.ctx, partial(p2, ease.inOut(clamp(ph.k * 2 - 1))), color(env.tokens, p.color ?? "accent"), env.tokens.stroke.base, ph.alpha);
    }
  },
};

export const CircleHighlight: Component = {
  inDur: () => 0.8,
  bounds: (env, p) => {
    const r = targetRect(env, p);
    return r ? inflate(r, num(p.pad, 16)) : null;
  },
  draw: (env, p, ph, el) => {
    const r0 = targetRect(env, { ...p, __id: el.id });
    if (!r0) return;
    const r = inflate(r0, num(p.pad, 16));
    const pts = wobble(env, "ci-" + el.id, ellipsePoints(r.x + r.w / 2, r.y + r.h / 2, r.w / 2 + 6, r.h / 2 + 4), 3, 12);
    inkStroke(env.ctx, partial(pts, ease.inOut(ph.k)), color(env.tokens, p.color ?? "accent"), env.tokens.stroke.base + 0.5, ph.alpha);
  },
};

export const MarkerHighlight: Component = {
  inDur: () => 0.5,
  bounds: (env, p) => targetRect(env, p),
  draw: (env, p, ph, el) => {
    const r = targetRect(env, { ...p, __id: el.id });
    if (!r) return;
    const ctx = env.ctx;
    ctx.save();
    ctx.globalAlpha *= ph.alpha * 0.35;
    ctx.fillStyle = color(env.tokens, p.color ?? "accent");
    ctx.fillRect(r.x - 6, r.y + r.h * 0.15, (r.w + 12) * ease.inOut(ph.k), r.h * 0.8);
    ctx.restore();
  },
};

function anchor(env: Env, v: any, toward: P | null): P | null {
  if (typeof v === "string") {
    const r = env.boundsOf(v);
    if (!r) return null;
    const c: P = [r.x + r.w / 2, r.y + r.h / 2];
    if (!toward) return c;
    return edgePoint(inflate(r, 10), c, toward);
  }
  if (Array.isArray(v)) return pt(v, [0, 0]);
  return null;
}

function edgePoint(r: Rect, c: P, toward: P): P {
  const dx = toward[0] - c[0];
  const dy = toward[1] - c[1];
  if (!dx && !dy) return c;
  const sx = dx ? r.w / 2 / Math.abs(dx) : Infinity;
  const sy = dy ? r.h / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return [c[0] + dx * s, c[1] + dy * s];
}

function arrowPts(env: Env, p: any): { a: P; b: P } | null {
  const ac = anchor(env, p.from, null);
  const bc = anchor(env, p.to, null);
  if (!ac || !bc) return null;
  const a = anchor(env, p.from, bc) ?? ac;
  const b = anchor(env, p.to, ac) ?? bc;
  return { a, b };
}

export const Arrow: Component = {
  inDur: () => 0.7,
  bounds: (env, p) => {
    const ab = arrowPts(env, p);
    if (!ab) return null;
    const x = Math.min(ab.a[0], ab.b[0]);
    const y = Math.min(ab.a[1], ab.b[1]);
    return { x, y, w: Math.abs(ab.a[0] - ab.b[0]) || 4, h: Math.abs(ab.a[1] - ab.b[1]) || 4 };
  },
  draw: (env, p, ph, el) => {
    const ab = arrowPts(env, p);
    if (!ab) {
      env.warn(el.id, "arrow endpoints could not be resolved");
      return;
    }
    const c = color(env.tokens, p.color ?? "ink");
    const pts = wobble(env, "ar-" + el.id, quadPoints(ab.a, ab.b, num(p.curve, 0.15)), 1.2, 16);
    const k = ease.inOut(ph.k);
    const shown = partial(pts, k);
    inkStroke(env.ctx, shown, c, env.tokens.stroke.base, ph.alpha);
    if (k > 0.8 && shown.length > 2) arrowHead(env.ctx, shown[shown.length - 1], shown[Math.max(0, shown.length - 4)], c, env.tokens.stroke.base, 16, ph.alpha * clamp((k - 0.8) / 0.2));
    if (p.label) {
      const mid = pts[Math.floor(pts.length / 2)];
      const b = layoutText(env, { text: p.label, x: mid[0], y: mid[1] - 46, size: "sm", align: "center", maxWidth: 260, maxLines: 2 });
      drawText(env, b, "center", clamp((ph.local - ph.dur) / 0.4), p.labelColor ?? "inkSoft", ph.alpha);
    }
  },
};

function boxLayout(env: Env, p: any) {
  const w = num(p.w, 240);
  const h = num(p.h, 110);
  const x = num(p.x, 100);
  const y = num(p.y, 200);
  const label = p.label ? layoutText(env, { text: p.label, x: x + w / 2, y: 0, size: p.size ?? "md", align: "center", maxWidth: w - 24, maxLines: 3 }) : null;
  const labelBlock = label ? layoutText(env, { text: p.label, x: x + w / 2, y: y + (h - label.rect.h) / 2, size: label.px, align: "center", maxWidth: w - 24, maxLines: 3 }) : null;
  return { x, y, w, h, label: labelBlock };
}

export const Box: Component = {
  inDur: () => 0.9,
  bounds: (env, p) => {
    const l = boxLayout(env, p);
    return { x: l.x, y: l.y, w: l.w, h: l.h };
  },
  draw: (env, p, ph, el) => {
    const l = boxLayout(env, p);
    const { ctx, tokens } = env;
    if (p.fill) {
      ctx.save();
      ctx.globalAlpha *= ph.alpha * 0.55 * clamp((ph.local - 0.4) / 0.4);
      ctx.fillStyle = color(tokens, p.fill === true ? "paperShade" : p.fill);
      ctx.fillRect(l.x, l.y, l.w, l.h);
      ctx.restore();
    }
    inkStroke(ctx, partial(roughRect(env, "bx-" + el.id, l.x, l.y, l.w, l.h), ease.inOut(clamp(ph.local / 0.6))), color(tokens, p.color ?? "ink"), tokens.stroke.base - 0.5, ph.alpha);
    if (l.label) drawText(env, l.label, "center", clamp((ph.local - 0.45) / 0.45), p.labelColor ?? "ink", ph.alpha);
  },
};

interface FlowNode { id: string; label: string; x: number; y: number; w?: number; h?: number; color?: string }

function flowNodes(p: any): FlowNode[] {
  return (Array.isArray(p.nodes) ? p.nodes : []).map((n: any, i: number) => ({
    id: String(n.id ?? i),
    label: String(n.label ?? ""),
    x: num(n.x, 200 + i * 260),
    y: num(n.y, 330),
    w: num(n.w, 210),
    h: num(n.h, 92),
    color: n.color,
  }));
}

export const Flow: Component = {
  inDur: (env, p) => 0.5 + flowNodes(p).length * 0.55 + (Array.isArray(p.edges) ? p.edges.length : 0) * 0.45,
  bounds: (env, p) => {
    const ns = flowNodes(p);
    if (!ns.length) return null;
    const x0 = Math.min(...ns.map((n) => n.x - n.w! / 2));
    const y0 = Math.min(...ns.map((n) => n.y - n.h! / 2));
    const x1 = Math.max(...ns.map((n) => n.x + n.w! / 2));
    const y1 = Math.max(...ns.map((n) => n.y + n.h! / 2));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  },
  draw: (env, p, ph, el) => {
    const ns = flowNodes(p);
    const byId = new Map(ns.map((n) => [n.id, n]));
    const edges: any[] = Array.isArray(p.edges) ? p.edges : [];
    // nodes first, then edges, staggered over the entrance
    ns.forEach((n, i) => {
      const lt = ph.local - i * 0.55;
      if (lt <= 0) return;
      Box.draw(env, { x: n.x - n.w! / 2, y: n.y - n.h! / 2, w: n.w, h: n.h, label: n.label, color: n.color, fill: p.fill ?? true, size: p.size ?? "sm" }, { local: lt, k: clamp(lt / 0.9), dur: 0.9, alpha: ph.alpha }, { ...el, id: `${el.id}.${n.id}` } as SceneElement);
    });
    const base = ns.length * 0.55;
    edges.forEach((e, i) => {
      const a = byId.get(String(e.from));
      const b = byId.get(String(e.to));
      if (!a || !b) {
        env.warn(el.id, `flow edge ${e.from}->${e.to} references a missing node`);
        return;
      }
      const lt = ph.local - base - i * 0.45;
      if (lt <= 0) return;
      const ra = inflate({ x: a.x - a.w! / 2, y: a.y - a.h! / 2, w: a.w!, h: a.h! }, 8);
      const rb = inflate({ x: b.x - b.w! / 2, y: b.y - b.h! / 2, w: b.w!, h: b.h! }, 8);
      const pa = edgePoint(ra, [a.x, a.y], [b.x, b.y]);
      const pb = edgePoint(rb, [b.x, b.y], [a.x, a.y]);
      Arrow.draw(env, { from: pa, to: pb, curve: num(e.curve, 0.12), label: e.label, color: e.color }, { local: lt, k: clamp(lt / 0.6), dur: 0.6, alpha: ph.alpha }, { ...el, id: `${el.id}.e${i}` } as SceneElement);
    });
  },
};
