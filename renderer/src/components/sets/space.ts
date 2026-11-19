// Orbits: a star or planet with bodies circling it on tilted orbits, seen a little from above. Bodies pass behind
// and in front of the centre, carry a fading trail, show the side facing the light, and can count their laps
// (a day against a year, one planet against another). Speeds are relative: `period` is seconds of film per orbit.
import type { Component, Env } from "../../types";
import { drawProp } from "../art";
import { artFor, circle, ellipse, line, mix } from "../../art/paint";
import { drawText, layoutText } from "../../text";
import { clamp, num } from "../../util";
import { frameOf, P, rectOf, since, world } from "./common";

interface Body { name: string; kind: string; radius: number; size: number; period: number; phase: number; color?: string; trail: boolean; label?: string; spin?: number }

function bodiesOf(p: any): Body[] {
  const list = Array.isArray(p.bodies) && p.bodies.length ? p.bodies : [{ name: "earth", kind: "earth", radius: 260, size: 46, period: 8 }];
  return list.slice(0, 8).map((b: any, i: number) => ({
    name: String(b.name ?? b.kind ?? `body${i}`), kind: String(b.kind ?? "planet"), radius: num(b.radius, 180 + i * 110),
    size: num(b.size, 44), period: Math.max(0.5, num(b.period, 6 + i * 4)), phase: num(b.phase, i * 0.7), color: b.color,
    trail: b.trail !== false, label: b.label, spin: b.spin,
  }));
}

/** Angle of a body at time t (it starts moving when the "start" stage begins, or at once). */
function angleOf(p: any, b: Body, absT: number, elAt: number): number {
  const s = since(p, "start", absT);
  const run = Number.isFinite(s) ? s : (Array.isArray(p.stages) && p.stages.some((x: any) => x?.name === "start") ? 0 : absT - elAt);
  const stop = since(p, "stop", absT);
  const tRun = Number.isFinite(stop) ? run - stop : run;
  return b.phase + (tRun / b.period) * Math.PI * 2 * num(p.speed, 1);
}

const TILT = 0.38;

function drawBody(env: Env, b: Body, x: number, y: number, s: number, absT: number, light: P, alpha: number) {
  const kind = b.kind === "moon" ? "moon" : b.kind === "earth" ? "earth" : b.kind === "star" ? "star" : "planet";
  if (kind === "star") {
    drawProp(env, "star", x, y, b.size * s * 1.6, { t: absT, alpha, color: b.color });
    return;
  }
  drawProp(env, kind, x, y, b.size * s * 2, { t: absT, alpha, color: b.color, flat: true });
  // the night side: shade the half turned away from the light
  const { ctx } = env;
  const r = b.size * s * 0.98;
  const dx = x - light[0], dy = y - light[1];
  const l = Math.hypot(dx, dy) || 1;
  const g = ctx.createLinearGradient(x - (dx / l) * r, y - (dy / l) * r, x + (dx / l) * r, y + (dy / l) * r);
  g.addColorStop(0, "rgba(0,0,12,0)");
  g.addColorStop(0.48, "rgba(0,0,12,0.05)");
  g.addColorStop(0.62, "rgba(0,0,12,0.55)");
  g.addColorStop(1, "rgba(0,0,12,0.72)");
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

export const Orbits: Component = {
  inDur: () => 1.2,
  bounds: (_env, p) => {
    const f = frameOf(p, 640, 390);
    const R = Math.max(...bodiesOf(p).map((b) => b.radius + b.size)) + 20;
    return rectOf(f, R * 2, R * 2 * TILT + 160);
  },
  anchors: (_env, p, el) => {
    const f = frameOf(p, 640, 390);
    const out: Record<string, P> = { center: [f.x, f.y] };
    const t = num((el as any)?.at, 0) + 0.01;
    for (const b of bodiesOf(p)) {
      const a = angleOf(p, b, t, num((el as any)?.at, 0));
      out[b.name] = world(f, [Math.cos(a) * b.radius, Math.sin(a) * b.radius * TILT]);
      out[`${b.name}Orbit`] = world(f, [0, b.radius * TILT]);
    }
    return out;
  },
  draw: (env, p, ph, el) => {
    const f = frameOf(p, 640, 390);
    const absT = el.at + ph.local;
    const { ctx } = env;
    const bodies = bodiesOf(p);
    const center = String(p.center ?? "sun");
    const A = artFor(env, 1, { seed: 51 });
    const build = clamp(ph.local / 1.2);
    ctx.save();
    ctx.globalAlpha *= ph.alpha;
    // orbit paths, drawn on as the set builds
    bodies.forEach((b, i) => {
      const k = clamp(build * 1.6 - i * 0.15);
      if (k <= 0) return;
      ctx.save();
      ctx.setLineDash([6, 9]);
      ctx.globalAlpha *= 0.45;
      ctx.strokeStyle = A.c(p.orbitColor ?? "muted");
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(f.x, f.y, b.radius * f.s, b.radius * TILT * f.s, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
      ctx.stroke();
      ctx.restore();
    });
    const pos = bodies.map((b) => {
      const a = angleOf(p, b, absT, el.at);
      return { b, a, x: f.x + Math.cos(a) * b.radius * f.s, y: f.y + Math.sin(a) * b.radius * TILT * f.s };
    });
    const light: P = [f.x, f.y];
    const drawOne = (q: (typeof pos)[number]) => {
      const { b } = q;
      const k = clamp(build * 1.5 - 0.3);
      if (b.trail) {
        // a fading trail behind the body
        ctx.save();
        ctx.lineCap = "round";
        for (let i = 0; i < 18; i++) {
          const a0 = q.a - (i + 1) * 0.06, a1 = q.a - i * 0.06;
          ctx.globalAlpha = ph.alpha * k * (1 - i / 18) * 0.5;
          ctx.strokeStyle = A.c(b.color ?? "accent");
          ctx.lineWidth = Math.max(1, b.size * f.s * 0.35 * (1 - i / 18));
          ctx.beginPath();
          ctx.moveTo(f.x + Math.cos(a0) * b.radius * f.s, f.y + Math.sin(a0) * b.radius * TILT * f.s);
          ctx.lineTo(f.x + Math.cos(a1) * b.radius * f.s, f.y + Math.sin(a1) * b.radius * TILT * f.s);
          ctx.stroke();
        }
        ctx.restore();
      }
      drawBody(env, b, q.x, q.y, f.s * (0.85 + 0.15 * Math.sin(q.a)), absT, light, k);
      if (b.label && p.labels !== false) {
        const bl = layoutText(env, { text: b.label, x: q.x, y: q.y + b.size * f.s + 10, size: "sm", align: "center", maxWidth: 200, maxLines: 1, role: "label" });
        drawText(env, bl, "center", clamp((ph.local - 0.8) / 0.6), "ink", k);
      }
      if (p.counters) {
        const laps = Math.max(0, Math.floor((q.a - b.phase) / (Math.PI * 2)));
        const cb = layoutText(env, { text: `×${laps}`, x: q.x, y: q.y - b.size * f.s - 36, size: "sm", align: "center", maxWidth: 120, maxLines: 1, family: "mono" });
        drawText(env, cb, "center", 1, "accent", k);
      }
    };
    // behind the centre first (far half of the orbit), then the centre, then the near half
    for (const q of pos) if (Math.sin(q.a) < 0) drawOne(q);
    const cs = num(p.centerSize, 150) * f.s;
    if (center !== "none") {
      if (center === "sun" || center === "star") {
        const g = ctx.createRadialGradient(f.x, f.y, cs * 0.2, f.x, f.y, cs * 2.4);
        g.addColorStop(0, "rgba(255,214,120,0.35)");
        g.addColorStop(1, "rgba(255,214,120,0)");
        ctx.save();
        ctx.globalAlpha *= build;
        ctx.fillStyle = g;
        ctx.fillRect(f.x - cs * 2.4, f.y - cs * 2.4, cs * 4.8, cs * 4.8);
        ctx.restore();
      }
      drawProp(env, center === "star" ? "sun" : center, f.x, f.y, cs, { t: absT, alpha: build, face: false });
    }
    for (const q of pos) if (Math.sin(q.a) >= 0) drawOne(q);
    ctx.restore();
    void ellipse; void circle; void line; void mix;
  },
};
