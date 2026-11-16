// Layout components: SideBySide, ProgressBar.
import type { Component, Env } from "../types";
import { inkStroke, partial, wobble } from "../ink";
import { drawText, layoutText, writeDur } from "../text";
import { clamp, color, ease, num } from "../util";

function sideLayout(env: Env, p: any) {
  const m = env.tokens.margin;
  const y = num(p.y, 140);
  const W = env.tokens.canvas.width;
  const colW = (W - 2 * m - 60) / 2;
  const cols = [p.left ?? {}, p.right ?? {}].map((c: any, i: number) => {
    const x = m + i * (colW + 60);
    const title = layoutText(env, { text: String(c.title ?? ""), x, y, size: "lg", weight: 700, maxWidth: colW, maxLines: 1 });
    let yy = y + title.rect.h + 26;
    const items = (Array.isArray(c.items) ? c.items : []).map((it: any) => {
      const b = layoutText(env, { text: String(it), x: x + 28, y: yy, size: p.size ?? "md", maxWidth: colW - 28, maxLines: 2 });
      yy += b.rect.h + 18;
      return b;
    });
    return { x, title, items, color: c.color ?? (i === 0 ? "indigo" : "accent"), bottom: yy };
  });
  return { cols, y, colW, divX: m + colW + 30, bottom: Math.max(cols[0].bottom, cols[1].bottom) };
}

export const SideBySide: Component = {
  inDur: (env, p) => {
    const n = (p.left?.items?.length ?? 0) + (p.right?.items?.length ?? 0);
    return 1 + n * 0.7;
  },
  bounds: (env, p) => {
    const l = sideLayout(env, p);
    return { x: env.tokens.margin, y: l.y, w: env.tokens.canvas.width - 2 * env.tokens.margin, h: l.bottom - l.y };
  },
  draw: (env, p, ph, el) => {
    const l = sideLayout(env, p);
    const div = wobble(env, "sbs" + el.id, [[l.divX, l.y], [l.divX, l.bottom]], 1.2);
    inkStroke(env.ctx, partial(div, ease.inOut(clamp(ph.local / 0.6))), color(env.tokens, "grid"), env.tokens.stroke.thin, ph.alpha);
    // reveal: left title, right title, then items alternating left/right
    const seq: { b: any; colIdx: number; bullet: boolean }[] = [];
    seq.push({ b: l.cols[0].title, colIdx: 0, bullet: false }, { b: l.cols[1].title, colIdx: 1, bullet: false });
    const n = Math.max(l.cols[0].items.length, l.cols[1].items.length);
    for (let i = 0; i < n; i++) {
      if (l.cols[0].items[i]) seq.push({ b: l.cols[0].items[i], colIdx: 0, bullet: true });
      if (l.cols[1].items[i]) seq.push({ b: l.cols[1].items[i], colIdx: 1, bullet: true });
    }
    const span = Math.max(0.5, ph.dur - 0.3);
    const per = span / seq.length;
    seq.forEach((s, i) => {
      const lt = ph.local - 0.3 - i * per;
      if (lt <= 0) return;
      const k = clamp(lt / Math.min(per * 1.4, writeDur(env, s.b.lines.join(" "))));
      const c = l.cols[s.colIdx].color;
      if (s.bullet) {
        env.ctx.save();
        env.ctx.globalAlpha *= ph.alpha;
        env.ctx.fillStyle = color(env.tokens, c);
        env.ctx.beginPath();
        env.ctx.arc(s.b.rect.x - 18, s.b.rect.y + s.b.px * 0.62, 6 * ease.outBack(clamp(lt / 0.25)), 0, Math.PI * 2);
        env.ctx.fill();
        env.ctx.restore();
      }
      drawText(env, s.b, "left", k, s.bullet ? "ink" : c, ph.alpha);
    });
  },
};

export const ProgressBar: Component = {
  inDur: () => 0.4,
  bounds: (env) => ({ x: 0, y: env.tokens.canvas.height - 10, w: env.tokens.canvas.width, h: 10 }),
  draw: (env, p, ph) => {
    const { ctx, tokens } = env;
    const from = num(p.from, num(p.value, 0));
    const to = num(p.value, from);
    const v = from + (to - from) * ease.inOut(ph.k);
    ctx.save();
    ctx.globalAlpha *= ph.alpha * 0.8;
    ctx.fillStyle = color(tokens, "grid");
    ctx.fillRect(0, tokens.canvas.height - 6, tokens.canvas.width, 6);
    ctx.fillStyle = color(tokens, "accent");
    ctx.fillRect(0, tokens.canvas.height - 6, tokens.canvas.width * clamp(v), 6);
    ctx.restore();
  },
};
