// Contraption: a whimsical machine that acts out an abstract process. Things go into the hopper, the machine works
// (gears turn behind its window, it shudders, a gauge climbs, a puff of steam), and something comes out of the chute
// and piles up on the tray. Compound interest, an algorithm, photosynthesis, a factory, a law of nature: name the
// input, the output and the machine.
import type { Component } from "../../types";
import { drawProp } from "../art";
import { artFor, circle, ellipse, line, poly, shape } from "../../art/paint";
import { clamp, lerp, num } from "../../util";
import { anchorsOf, drawSetLabels, frameOf, h1, P, rectOf, since, world } from "./common";

const LABELS: Record<string, { text: string; at: P; label: P }> = {
  input: { text: "In", at: [-250, -150], label: [-380, -250] },
  machine: { text: "The machine", at: [0, 10], label: [0, -270] },
  output: { text: "Out", at: [330, 120], label: [400, -40] },
  gauge: { text: "Gauge", at: [70, -150], label: [220, -260] },
};

export const Contraption: Component = {
  inDur: () => 1,
  bounds: (_env, p) => rectOf(frameOf(p, 620, 410), 860, 480),
  anchors: (_env, p) => anchorsOf(frameOf(p, 620, 410), { hopper: [-250, -150], input: [-250, -150], machine: [0, 10], output: [330, 120], tray: [330, 150], gauge: [70, -150], crank: [-150, 60], center: [0, 0] }),
  parts: (_env, p) => {
    const f = frameOf(p, 620, 410);
    const a = world(f, [-320, -230]), b = world(f, [420, 200]);
    return [{ name: "machine", rect: { x: a[0], y: a[1], w: b[0] - a[0], h: b[1] - a[1] } }];
  },
  draw: (env, p, ph, el) => {
    const f = frameOf(p, 620, 410);
    const absT = el.at + ph.local;
    const { ctx } = env;
    const feed = since(p, "feed", absT);
    const stop = since(p, "stop", absT);
    const period = Math.max(0.8, num(p.every, 1.8));
    const count = Math.max(1, Math.min(12, Math.round(num(p.count, 4))));
    const running = Number.isFinite(feed) && !(Number.isFinite(stop) && stop > 0.6);
    const fed = Number.isFinite(feed) ? Math.min(count, Math.floor(feed / period) + 1) : 0;
    const work = Number.isFinite(feed) ? (Number.isFinite(stop) ? Math.min(feed, feed - stop) : feed) : 0;
    const shudder = running ? Math.sin(absT * 38) * 1.6 : 0;
    const build = clamp(ph.local / 1);
    ctx.save();
    ctx.globalAlpha *= ph.alpha * build;
    ctx.save();
    ctx.translate(f.x + shudder * f.s, f.y);
    ctx.scale(f.s, f.s);
    const A = artFor(env, f.s, { seed: 131 });
    // legs, body, window
    poly(A, [[-200, 150], [-180, 200], [-160, 150]], "metalDark", { lw: 2 });
    poly(A, [[160, 150], [180, 200], [200, 150]], "metalDark", { lw: 2 });
    shape(A, [[-230, -110], [230, -110], [230, 150], [-230, 150]], p.color ?? "indigo", { tension: 0.08, lw: 3 });
    shape(A, [[-150, -60], [110, -60], [110, 100], [-150, 100]], "paper", { tension: 0.1, lw: 2.4 });
    // gears turning behind the window
    const spin = work * 2.2;
    for (const [gx, gy, r, dir] of [[-80, 20, 52, 1], [20, 30, 34, -1.5], [70, -10, 26, 2]] as const) {
      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate(spin * dir);
      const pts: P[] = [];
      const n = Math.round(r / 5);
      for (let i = 0; i < n * 2; i++) {
        const a = (i / (n * 2)) * Math.PI * 2;
        const rr = i % 2 ? r : r * 0.82;
        pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      poly(A, pts, "metal", { lw: 1.8 });
      circle(A, 0, 0, r * 0.25, "metalDark", { lw: 1.4 });
      ctx.restore();
    }
    // hopper (funnel) on the left, chute and tray on the right
    poly(A, [[-320, -230], [-180, -230], [-220, -120], [-280, -120]], p.hopperColor ?? "ochre", { lw: 2.6 });
    poly(A, [[230, 60], [340, 110], [340, 140], [230, 100]], "metal", { lw: 2.4 });
    shape(A, [[300, 150], [440, 150], [430, 175], [310, 175]], "wood", { tension: 0.1, lw: 2.4 });
    // the crank and the gauge
    const crankA = work * 3;
    circle(A, -150, 60 + 120, 0.01, null, {});
    line(A, [[-230, 40], [-262 + Math.cos(crankA) * 30, 40 + Math.sin(crankA) * 30]], "metalDark", 6);
    circle(A, -262 + Math.cos(crankA) * 30, 40 + Math.sin(crankA) * 30, 9, "accent", { lw: 1.6 });
    circle(A, 70, -150, 44, "paper", { lw: 2.6 });
    const level = clamp(num(p.gauge, fed / count) * (running || fed ? 1 : 0));
    const needle = lerp(-Math.PI * 0.85, -Math.PI * 0.15, level);
    line(A, [[70, -150], [70 + Math.cos(needle) * 34, -150 + Math.sin(needle) * 34]], "accent", 4);
    line(A, [[70, -194], [70, -205]], "metalDark", 8);
    // a puff of steam while it works
    if (running) for (let i = 0; i < 3; i++) {
      const k = (work * 0.8 + i / 3) % 1;
      ellipse(A, 150 + k * 20, -130 - k * 90, 16 + k * 22, 12 + k * 16, "cloud", 0, { stroke: false, alpha: (1 - k) * 0.7 });
    }
    line(A, [[150, -110], [150, -130]], "metalDark", 10);
    ctx.restore();
    // the things: in through the hopper, out down the chute onto the tray
    const inKind = String(p.input ?? "coin"), outKind = String(p.output ?? p.input ?? "coin");
    const inSize = num(p.inputSize, 60) * f.s, outSize = num(p.outputSize, 64) * f.s;
    for (let i = 0; i < fed; i++) {
      const tIn = (Number.isFinite(feed) ? feed : 0) - i * period;
      if (tIn < 0) continue;
      // falling into the hopper
      const kIn = clamp(tIn / 0.7);
      if (kIn < 1) {
        const x = lerp(-420, -250, kIn), y = lerp(-320, -150, kIn * kIn);
        drawProp(env, inKind, f.x + x * f.s, f.y + y * f.s, inSize, { t: absT, seed: i, grounded: false, rotate: kIn * 2 });
      }
      // coming out after the machine has worked on it
      const kOut = clamp((tIn - 1.3) / 0.6);
      if (kOut > 0) {
        const pile = Math.min(i, 5);
        const tx = 350 + pile * 18 + (h1(i, 2) - 0.5) * 10, ty = 132 - pile * 6;
        const x = lerp(240, tx, kOut), y = lerp(70, ty, kOut) - Math.sin(Math.PI * kOut) * 30;
        drawProp(env, outKind, f.x + x * f.s, f.y + y * f.s, outSize * (p.grow ? 1 + i * 0.08 : 1), { t: absT, seed: 20 + i, grounded: false });
      }
    }
    drawSetLabels(env, p, f, absT, 1, {
      input: { ...LABELS.input, text: String(p.inputLabel ?? LABELS.input.text) },
      machine: { ...LABELS.machine, text: String(p.label ?? LABELS.machine.text) },
      output: { ...LABELS.output, text: String(p.outputLabel ?? LABELS.output.text) },
      gauge: { ...LABELS.gauge, text: String(p.gaugeLabel ?? LABELS.gauge.text) },
    }, el);
    ctx.restore();
  },
};
