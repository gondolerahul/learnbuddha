// Data/maths components: AxesPlot, NumberLine, BarChart.
import type { Component, Env } from "../types";
import { compileExpr } from "../expr";
import { arrowHead, inkStroke, P, partial, wobble } from "../ink";
import { drawText, layoutText } from "../text";
import { clamp, color, ease, font, fontSize, num, seriesColor } from "../util";

function axesLayout(p: any) {
  const x = num(p.x, 140);
  const y = num(p.y, 140);
  const w = num(p.w, 640);
  const h = num(p.h, 440);
  const xr: [number, number] = Array.isArray(p.xRange) ? [num(p.xRange[0], 0), num(p.xRange[1], 10)] : [0, 10];
  const yr: [number, number] = Array.isArray(p.yRange) ? [num(p.yRange[0], 0), num(p.yRange[1], 10)] : [0, 10];
  const sx = (v: number) => x + ((v - xr[0]) / (xr[1] - xr[0] || 1)) * w;
  const sy = (v: number) => y + h - ((v - yr[0]) / (yr[1] - yr[0] || 1)) * h;
  return { x, y, w, h, xr, yr, sx, sy };
}

function niceTicks(a: number, b: number, n = 5) {
  const span = Math.abs(b - a) || 1;
  const raw = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(Math.min(a, b) / step) * step; v <= Math.max(a, b) + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

const fmt = (v: number) => (Math.abs(v) >= 1000 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(Math.abs(v) < 1 ? 2 : 1));

export const AxesPlot: Component = {
  inDur: (env, p) => 1.0 + (Array.isArray(p.series) ? p.series.length : 0) * 1.2,
  bounds: (env, p) => {
    const l = axesLayout(p);
    return { x: l.x - 60, y: l.y - 20, w: l.w + 90, h: l.h + 80 };
  },
  draw: (env, p, ph, el) => {
    const l = axesLayout(p);
    const { ctx, tokens } = env;
    const ax = ease.inOut(clamp(ph.local / 0.8));
    const xAxisY = l.sy(clamp(0, Math.min(...l.yr), Math.max(...l.yr)));
    const yAxisX = l.sx(clamp(0, Math.min(...l.xr), Math.max(...l.xr)));
    const xa = wobble(env, "ax-x" + el.id, [[l.x - 10, xAxisY], [l.x + l.w + 20, xAxisY]], 0.8);
    const ya = wobble(env, "ax-y" + el.id, [[yAxisX, l.y + l.h + 10], [yAxisX, l.y - 20]], 0.8);
    const ink = color(tokens, "ink");
    inkStroke(ctx, partial(xa, ax), ink, tokens.stroke.base - 1, ph.alpha);
    inkStroke(ctx, partial(ya, ax), ink, tokens.stroke.base - 1, ph.alpha);
    if (ax >= 1) {
      arrowHead(ctx, xa[xa.length - 1], xa[xa.length - 3], ink, tokens.stroke.thin, 11, ph.alpha);
      arrowHead(ctx, ya[ya.length - 1], ya[ya.length - 3], ink, tokens.stroke.thin, 11, ph.alpha);
    }
    // ticks + labels
    const tk = clamp((ph.local - 0.5) / 0.5);
    if (tk > 0 && p.ticks !== false) {
      ctx.save();
      ctx.globalAlpha *= ph.alpha * tk;
      ctx.font = font(tokens, "hand", fontSize(tokens, "sm") * 0.8);
      ctx.fillStyle = color(tokens, "muted");
      ctx.strokeStyle = color(tokens, "muted");
      ctx.lineWidth = 2;
      ctx.textAlign = "center";
      for (const v of niceTicks(l.xr[0], l.xr[1], num(p.xTicks, 5))) {
        const xx = l.sx(v);
        ctx.beginPath(); ctx.moveTo(xx, xAxisY - 5); ctx.lineTo(xx, xAxisY + 5); ctx.stroke();
        if (v !== 0 || yAxisX !== xx) ctx.fillText(fmt(v), xx, xAxisY + 28);
      }
      ctx.textAlign = "right";
      for (const v of niceTicks(l.yr[0], l.yr[1], num(p.yTicks, 5))) {
        const yy = l.sy(v);
        ctx.beginPath(); ctx.moveTo(yAxisX - 5, yy); ctx.lineTo(yAxisX + 5, yy); ctx.stroke();
        if (v !== 0) ctx.fillText(fmt(v), yAxisX - 10, yy + 7);
      }
      ctx.restore();
      if (p.xLabel) drawText(env, layoutText(env, { text: p.xLabel, x: l.x + l.w, y: xAxisY + 34, size: "sm", align: "right", maxWidth: 400, maxLines: 1 }), "right", 1, "inkSoft", ph.alpha * tk);
      if (p.yLabel) drawText(env, layoutText(env, { text: p.yLabel, x: yAxisX + 14, y: l.y - 36, size: "sm", align: "left", maxWidth: 400, maxLines: 1 }), "left", 1, "inkSoft", ph.alpha * tk);
    }
    // series
    const series: any[] = Array.isArray(p.series) ? p.series : [];
    series.forEach((s, i) => {
      const start = num(s.at, 0) > 0 ? num(s.at, 0) - el.at : 0.9 + i * 1.2;
      const lt = ph.local - start;
      if (lt <= 0) return;
      const k = clamp(lt / num(s.dur, 1.1));
      const c = seriesColor(tokens, i, s.color);
      const kind = s.kind ?? (s.fn ? "line" : "points");
      let pts: P[] = [];
      if (typeof s.fn === "string") {
        try {
          const f = compileExpr(s.fn);
          const [a, b] = Array.isArray(s.domain) ? [num(s.domain[0], l.xr[0]), num(s.domain[1], l.xr[1])] : l.xr;
          for (let j = 0; j <= 160; j++) {
            const xv = a + ((b - a) * j) / 160;
            const yv = f(xv);
            if (Number.isFinite(yv) && yv >= Math.min(...l.yr) - 1e-9 && yv <= Math.max(...l.yr) + 1e-9) pts.push([l.sx(xv), l.sy(yv)]);
          }
        } catch (e) {
          env.warn(el.id, `series ${i}: bad fn '${s.fn}': ${(e as Error).message}`);
        }
      } else if (Array.isArray(s.points)) {
        pts = s.points.filter((q: any) => Array.isArray(q)).map((q: any) => [l.sx(num(q[0], 0)), l.sy(num(q[1], 0))] as P);
      }
      if (kind === "line") {
        inkStroke(ctx, partial(pts, ease.inOut(k)), c, tokens.stroke.base, ph.alpha);
      } else if (kind === "points") {
        pts.forEach((q, j) => {
          const pk = ease.outBack(clamp((lt - (j / Math.max(1, pts.length)) * num(s.dur, 1.1)) / 0.3));
          if (pk <= 0) return;
          ctx.save();
          ctx.globalAlpha *= ph.alpha;
          ctx.fillStyle = c;
          ctx.beginPath();
          ctx.arc(q[0], q[1], 7 * pk, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        });
      } else if (kind === "bars" && Array.isArray(s.points)) {
        const bw = (l.w / Math.max(1, s.points.length)) * 0.6;
        s.points.forEach((q: any, j: number) => {
          const bk = ease.out(clamp((lt - j * 0.12) / 0.6));
          const x0 = l.sx(num(q[0], 0)) - bw / 2;
          const y0 = l.sy(0);
          const y1 = l.sy(num(q[1], 0));
          ctx.save();
          ctx.globalAlpha *= ph.alpha * 0.85;
          ctx.fillStyle = c;
          ctx.fillRect(x0, y0 + (y1 - y0) * bk, bw, (y0 - y1) * bk);
          ctx.restore();
        });
      }
      if (s.label && k >= 1 && pts.length) {
        const last = pts[pts.length - 1];
        drawText(env, layoutText(env, { text: s.label, x: Math.min(last[0] + 12, l.x + l.w - 10), y: last[1] - 40, size: "sm", maxWidth: 260, maxLines: 1 }), "left", 1, s.color ?? tokens.series[i % tokens.series.length], ph.alpha * clamp((lt - num(s.dur, 1.1)) / 0.4));
      }
    });
  },
};

export const NumberLine: Component = {
  inDur: (env, p) => 0.9 + (Array.isArray(p.marks) ? p.marks.length * 0.5 : 0),
  bounds: (env, p) => ({ x: num(p.x, 140) - 20, y: num(p.y, 380) - 70, w: num(p.w, 1000) + 40, h: 130 }),
  draw: (env, p, ph, el) => {
    const { ctx, tokens } = env;
    const x = num(p.x, 140);
    const y = num(p.y, 380);
    const w = num(p.w, 1000);
    const r: [number, number] = Array.isArray(p.range) ? [num(p.range[0], 0), num(p.range[1], 10)] : [0, 10];
    const sx = (v: number) => x + ((v - r[0]) / (r[1] - r[0] || 1)) * w;
    const line = wobble(env, "nl" + el.id, [[x - 16, y], [x + w + 16, y]], 0.8);
    const k = ease.inOut(clamp(ph.local / 0.7));
    inkStroke(ctx, partial(line, k), color(tokens, "ink"), tokens.stroke.base - 1, ph.alpha);
    const step = num(p.step, niceTicks(r[0], r[1], 10)[1] - niceTicks(r[0], r[1], 10)[0] || 1);
    ctx.save();
    ctx.globalAlpha *= ph.alpha * clamp((ph.local - 0.4) / 0.4);
    ctx.font = font(tokens, "hand", fontSize(tokens, "sm") * 0.85);
    ctx.fillStyle = color(tokens, "muted");
    ctx.strokeStyle = color(tokens, "ink");
    ctx.lineWidth = 2;
    ctx.textAlign = "center";
    for (let v = r[0]; v <= r[1] + 1e-9; v += step) {
      ctx.beginPath(); ctx.moveTo(sx(v), y - 9); ctx.lineTo(sx(v), y + 9); ctx.stroke();
      ctx.fillText(fmt(+v.toFixed(6)), sx(v), y + 38);
    }
    ctx.restore();
    const marks: any[] = Array.isArray(p.marks) ? p.marks : [];
    marks.forEach((m, i) => {
      const lt = ph.local - (num(m.at, 0) > 0 ? num(m.at, 0) - el.at : 0.8 + i * 0.5);
      if (lt <= 0) return;
      const mk = ease.outBack(clamp(lt / 0.35));
      const c = color(tokens, m.color ?? "accent");
      const mx = sx(num(m.value, 0));
      ctx.save();
      ctx.globalAlpha *= ph.alpha;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(mx, y, 9 * mk, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (m.label) drawText(env, layoutText(env, { text: String(m.label), x: mx, y: y - 66, size: "sm", align: "center", maxWidth: 220, maxLines: 1 }), "center", 1, m.color ?? "accent", ph.alpha * clamp(lt / 0.4));
    });
  },
};

export const BarChart: Component = {
  inDur: (env, p) => 0.6 + (Array.isArray(p.bars) ? p.bars.length : 1) * 0.3,
  bounds: (env, p) => ({ x: num(p.x, 160), y: num(p.y, 150), w: num(p.w, 700), h: num(p.h, 420) + 50 }),
  draw: (env, p, ph, el) => {
    const { ctx, tokens } = env;
    const bars: any[] = Array.isArray(p.bars) ? p.bars : [];
    const x = num(p.x, 160), y = num(p.y, 150), w = num(p.w, 700), h = num(p.h, 420);
    const max = num(p.max, Math.max(1e-9, ...bars.map((b) => num(b.value, 0))));
    const base = wobble(env, "bc" + el.id, [[x - 10, y + h], [x + w + 10, y + h]], 0.8);
    inkStroke(ctx, partial(base, ease.inOut(clamp(ph.local / 0.5))), color(tokens, "ink"), tokens.stroke.base - 1, ph.alpha);
    const slot = w / Math.max(1, bars.length);
    const bw = slot * 0.62;
    bars.forEach((b, i) => {
      const lt = ph.local - 0.4 - i * 0.3;
      if (lt <= 0) return;
      const k = ease.out(clamp(lt / 0.7));
      const bh = (num(b.value, 0) / max) * h * k;
      const bx = x + slot * i + (slot - bw) / 2;
      ctx.save();
      ctx.globalAlpha *= ph.alpha * 0.9;
      ctx.fillStyle = seriesColor(tokens, i, b.color ?? (p.color as string | undefined));
      ctx.fillRect(bx, y + h - bh, bw, bh);
      ctx.restore();
      const lb = layoutText(env, { text: String(b.label ?? ""), x: bx + bw / 2, y: y + h + 10, size: "sm", align: "center", maxWidth: slot - 6, maxLines: 1 });
      drawText(env, lb, "center", 1, "inkSoft", ph.alpha * clamp(lt / 0.4));
      if (p.showValues !== false) {
        const vb = layoutText(env, { text: fmt(num(b.value, 0)) + (p.suffix ?? ""), x: bx + bw / 2, y: y + h - bh - 40, size: "sm", align: "center", maxWidth: slot, maxLines: 1 });
        drawText(env, vb, "center", 1, "ink", ph.alpha * clamp((lt - 0.5) / 0.3));
      }
    });
  },
};
