// Transitions: how one set gives way to the next inside a scene. Each is a cover-and-reveal drawn over the whole
// frame: the cover is complete at the midpoint, where the elements swap (applyTransitions moves their entrances and
// exits there), then it opens on the new set. Every kit has a signature (tokens.transition):
//   brush    Zen ink: wide strokes of fresh rice paper sweep across
//   iris     Storybook: a circle closes on the subject and opens on the next picture
//   slide    Flat explainer: two flat colour panels wipe through
//   bleed    Field notes: a wet bloom of paper spreads from a point, then dries away
//   glow     Night glow: a bloom of light from the subject, a dip into the dark
//   dissolve Clinical cutaway: a clean dip to the page
//   eraser   Chalkboard: a felt eraser wipes the board in strokes, leaving smears
//   sheet    Paper shadowbox, Blueprint: a new sheet slides over the old one
//   print    Riso collage: a new print slides in, slightly askew, with a shadow
//   flash    a quick white flash (a hard cut with a beat)
// Everything is a pure function of time.
import type { Component, Env, SceneElement, SceneSpec } from "../types";
import { clamp, color, hash, lerp, num, rng } from "../util";
import { fnoise } from "../art/material";

const DUR: Record<string, number> = { brush: 1.2, iris: 1.1, slide: 0.8, bleed: 1.4, glow: 1.0, dissolve: 0.8, eraser: 1.4, sheet: 1.0, print: 0.8, flash: 0.35 };

export function transitionKind(env: Env, p: any): string {
  const k = String(p.kind ?? (env.tokens as any).transition ?? "dissolve");
  return DUR[k] ? k : "dissolve";
}

export function transitionDur(kind: string, p: any): number {
  return num(p.dur, DUR[kind] ?? 1);
}

const smooth = (k: number) => {
  k = clamp(k);
  return k * k * (3 - 2 * k);
};

/** Cover progress: 0 → 1 over the first half, 1 → 0 over the second (for kinds that open by fading or receding). */
function cover(k: number) {
  return k < 0.5 ? smooth(k * 2) : 1 - smooth((k - 0.5) * 2);
}

let paperPainter: ((ctx: any, env: Env) => void) | null = null;
/** scene.ts hands over its cached paper so sheets are made of the kit's own paper. */
export function setPaperPainter(f: (ctx: any, env: Env) => void) {
  paperPainter = f;
}

function fillPaper(ctx: any, env: Env) {
  if (paperPainter) paperPainter(ctx, env);
  else {
    ctx.fillStyle = color(env.tokens, "paper");
    ctx.fillRect(0, 0, env.tokens.canvas.width, env.tokens.canvas.height);
  }
}

export const Transition: Component = {
  inDur: (env, p) => transitionDur(transitionKind(env, p), p),
  bounds: () => null,
  draw: (env, p, ph, el) => {
    const kind = transitionKind(env, p);
    const dur = transitionDur(kind, p);
    const k = clamp(ph.local / dur);
    if (k <= 0 || k >= 1) return;
    const { ctx, tokens } = env;
    const W = tokens.canvas.width, H = tokens.canvas.height;
    const at = env.pointOf(p.center ?? p.on) ?? [W / 2, H / 2];
    const seed = hash(el.id);
    ctx.save();
    switch (kind) {
      case "dissolve": {
        ctx.globalAlpha = cover(k);
        fillPaper(ctx, env);
        break;
      }
      case "flash": {
        ctx.globalAlpha = Math.pow(cover(k), 0.6) * 0.92;
        ctx.fillStyle = p.color ? color(tokens, p.color) : "#FFFFFF";
        ctx.fillRect(0, 0, W, H);
        break;
      }
      case "glow": {
        // a dip into the dark with a bloom of light from the subject
        ctx.globalAlpha = cover(k);
        fillPaper(ctx, env);
        const r = lerp(40, Math.hypot(W, H), smooth(k));
        const g = ctx.createRadialGradient(at[0], at[1], 0, at[0], at[1], r);
        const c = color(tokens, p.color ?? "accent");
        g.addColorStop(0, c);
        g.addColorStop(0.25, c);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.55 * Math.sin(Math.PI * k);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        break;
      }
      case "iris": {
        // closes on the subject, opens on the centre of the new picture
        const R = Math.hypot(W, H);
        const closing = k < 0.5;
        const c = closing ? at : env.pointOf(p.to) ?? [W / 2, H / 2];
        const r = closing ? R * Math.pow(1 - smooth(k * 2), 1.4) : R * Math.pow(smooth((k - 0.5) * 2), 1.4);
        ctx.beginPath();
        ctx.rect(-10, -10, W + 20, H + 20);
        ctx.arc(c[0], c[1], Math.max(0.5, r), 0, Math.PI * 2, true);
        ctx.fillStyle = color(tokens, p.color ?? "ink");
        ctx.fill("evenodd" as any);
        break;
      }
      case "slide": {
        // two flat panels wipe through, right to left: the accent on top, the ink a beat behind it
        const e = (x: number) => {
          x = clamp(x);
          return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
        };
        for (const [lag, col] of [[0.08, p.color2 ?? "ink"], [0, p.color ?? "accent"]] as const) {
          const kk = clamp((k - lag) / 0.92);
          ctx.fillStyle = color(tokens, col);
          if (kk < 0.5) {
            const left = W * (1 - e(kk * 2));
            ctx.fillRect(left, -10, W - left + 10, H + 20);
          } else {
            const right = W * (1 - e((kk - 0.5) * 2));
            ctx.fillRect(-10, -10, right + 10, H + 20);
          }
        }
        break;
      }
      case "brush": {
        // three wide strokes of fresh paper, each with a ragged, dry leading edge
        const bands = 3;
        for (let i = 0; i < bands; i++) {
          const y0 = (i * H) / bands - 24, y1 = ((i + 1) * H) / bands + 24;
          const kk = clamp(k * 2.2 - i * 0.12);
          const lead = lerp(-260, W + 260, smooth(kk));
          ctx.save();
          ctx.globalAlpha = k < 0.5 ? 1 : 1 - smooth((k - 0.5) * 2);
          ctx.beginPath();
          ctx.moveTo(-40, y0);
          for (let y = y0; y <= y1; y += 8) ctx.lineTo(lead + fnoise(y * 0.035, i * 3.1, seed) * 70 + Math.sin(((y - y0) / (y1 - y0)) * Math.PI) * 60, y);
          ctx.lineTo(-40, y1);
          ctx.closePath();
          ctx.clip();
          fillPaper(ctx, env);
          ctx.restore();
        }
        break;
      }
      case "bleed": {
        // a wet bloom spreading from a point; its edge wobbles and darkens like a wash drying
        const R = Math.hypot(W, H) * 1.05;
        const grow = smooth(clamp(k * 2.1));
        const r = R * grow;
        ctx.globalAlpha = k < 0.5 ? 1 : 1 - smooth((k - 0.5) * 2);
        ctx.beginPath();
        const n = 90;
        for (let i = 0; i <= n; i++) {
          const a = (i / n) * Math.PI * 2;
          const rr = r * (1 + 0.12 * fnoise(Math.cos(a) * 2.2 + k, Math.sin(a) * 2.2, seed));
          const x = at[0] + Math.cos(a) * rr, y = at[1] + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.save();
        ctx.clip();
        fillPaper(ctx, env);
        ctx.restore();
        ctx.strokeStyle = "rgba(90,110,130,0.18)";
        ctx.lineWidth = 6;
        ctx.stroke();
        break;
      }
      case "eraser": {
        // the felt eraser wipes the board in tall zig-zag strokes, left to right, and leaves smears
        const sweep = smooth(clamp(k * 2.05));
        const lead = lerp(-120, W + 140, sweep);
        const r = rng(seed);
        ctx.globalAlpha = k < 0.5 ? 1 : 1 - smooth((k - 0.5) * 2.4);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(-20, -20);
        for (let y = -20; y <= H + 20; y += 10) ctx.lineTo(lead + Math.sin(y * 0.05) * 26 + fnoise(y * 0.02, 1.7, seed) * 30, y);
        ctx.lineTo(-20, H + 20);
        ctx.closePath();
        ctx.clip();
        fillPaper(ctx, env);
        // smears: soft chalk ghosts the felt leaves behind
        ctx.strokeStyle = "rgba(255,255,255,0.05)";
        ctx.lineCap = "round";
        for (let i = 0; i < 9; i++) {
          ctx.lineWidth = 60 + r() * 70;
          const x = r() * W, y = r() * H;
          ctx.beginPath();
          ctx.moveTo(x - 80, y - 120);
          ctx.quadraticCurveTo(x + 40, y, x - 60, y + 140);
          ctx.stroke();
        }
        ctx.restore();
        if (k < 0.52) {
          // the eraser itself, riding the wave of the stroke
          const ey = H / 2 + Math.sin(k * 40) * (H * 0.36);
          const ex = lead + Math.sin(ey * 0.05) * 26;
          ctx.save();
          ctx.globalAlpha = 1;
          ctx.translate(ex, ey);
          ctx.rotate(0.12 * Math.sin(k * 40 + 1));
          ctx.fillStyle = "#6B4A32";
          ctx.fillRect(-34, -90, 46, 180);
          ctx.fillStyle = "#3A3A40";
          ctx.fillRect(10, -88, 22, 176);
          ctx.restore();
        }
        break;
      }
      case "sheet":
      case "print": {
        // a new sheet of the same paper slides over the old one with a soft shadow on its leading edge;
        // it stays as the paper the next picture is drawn on, so nothing needs to open again
        const from = String(p.from ?? (kind === "print" ? "right" : "bottom"));
        const e = smooth(clamp(k * 2));
        const tilt = kind === "print" ? 0.07 * (1 - e) : 0;
        const dx = from === "right" ? (1 - e) * (W + 60) : from === "left" ? -(1 - e) * (W + 60) : 0;
        const dy = from === "bottom" ? (1 - e) * (H + 60) : from === "top" ? -(1 - e) * (H + 60) : 0;
        if (k >= 0.5) {
          // the sheet has landed: it is now simply the paper, and the old picture is gone under it
          ctx.globalAlpha = 1 - smooth((k - 0.5) * 2) ;
          fillPaper(ctx, env);
          break;
        }
        ctx.translate(W / 2 + dx, H / 2 + dy);
        ctx.rotate(tilt);
        ctx.translate(-W / 2, -H / 2);
        // shadow
        ctx.fillStyle = "rgba(10,8,6,0.28)";
        ctx.fillRect(from === "right" ? -18 : 0, from === "bottom" ? -18 : 0, W, H);
        ctx.beginPath();
        ctx.rect(0, 0, W, H);
        ctx.clip();
        fillPaper(ctx, env);
        break;
      }
    }
    ctx.restore();
  },
};

/**
 * Move elements to the midpoint of the transitions they straddle: what was leaving is gone when the cover is full,
 * what arrives starts entering as it opens. Camera keys inside the window jump there too. Mutates the spec once.
 */
export function applyTransitions(spec: SceneSpec, tokens: any): SceneSpec {
  if ((spec as any).__transitions) return spec;
  const trans = spec.elements.filter((e) => e.type === "Transition");
  Object.defineProperty(spec, "__transitions", { value: true, enumerable: false, configurable: true });
  const fade = num(tokens?.motion?.fadeOut, 0.35);
  // one pinned heading replacing another: the new one waits until the old has faded, so the two never print on
  // top of each other mid-fade
  const heads = spec.elements.filter((e) => e.type === "Heading" && e.fixed).sort((x, y) => x.at - y.at);
  for (let i = 1; i < heads.length; i++) {
    const prev = heads[i - 1], cur = heads[i];
    if (typeof prev.until === "number" && cur.at >= prev.until - 0.3 && cur.at < prev.until + fade) cur.at = +(prev.until + fade).toFixed(3);
    else if (typeof prev.until !== "number" && cur.at > prev.at) prev.until = Math.max(prev.at + 0.5, cur.at - fade);
  }
  if (!trans.length) return spec;
  for (const tr of trans) {
    const kind = String(tr.props?.kind ?? tokens?.transition ?? "dissolve");
    const dur = num(tr.props?.dur, DUR[kind] ?? 1);
    const t0 = tr.at, mid = t0 + dur / 2;
    for (const el of spec.elements) {
      if (el === tr || el.fixed && el.type === "Heading" && false) continue;
      if (el.type === "Transition" || el.type === "FrozenFrame") continue;
      if (typeof el.until === "number" && el.until >= t0 - 0.8 && el.until <= t0 + dur) el.until = Math.max(el.at + 0.1, mid - fade);
      if (el.at >= t0 - 0.4 && el.at <= t0 + dur) el.at = +(mid + Math.max(0, el.at - t0) * 0.25).toFixed(3);
    }
    for (const k of (spec.camera ?? []) as any[]) {
      if (typeof k.t === "number" && k.t >= t0 - 0.4 && k.t <= t0 + dur) {
        k.t = mid;
        k.move = "cut";
        k.dur = 0;
      }
    }
  }
  return spec;
}

export type { SceneElement };
