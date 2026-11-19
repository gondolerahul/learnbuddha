// Mechanism sets: machines that really work (gears that mesh at the right ratios, a crank driving a piston, a lever
// that lifts its load, a pulley) and an electric circuit whose switch closes, current flows and the bulb lights.
import type { Component, Env } from "../../types";
import { drawProp } from "../art";
import { artFor, circle, line, poly, shape } from "../../art/paint";
import { drawText, layoutText } from "../../text";
import { clamp, lerp, num } from "../../util";
import { anchorsOf, drawSetLabels, frameOf, P, pointAlong, rectOf, setLabelRects, since, stageK, world, type Frame } from "./common";

const TAU = Math.PI * 2;

/** Seconds the machine has been running (from "start", or from its entrance), slowed by "stop", sped by "fast". */
function runTime(p: any, absT: number, elAt: number): number {
  const start = since(p, "start", absT);
  const named = Array.isArray(p.stages) && p.stages.some((s: any) => s?.name === "start");
  let t = Number.isFinite(start) ? start : named ? 0 : absT - elAt;
  const fast = since(p, "fast", absT);
  if (Number.isFinite(fast)) t += fast; // twice the speed after "fast"
  const stop = since(p, "stop", absT);
  if (Number.isFinite(stop)) t -= Math.max(0, stop - 0.6 * (1 - Math.exp(-stop / 0.6))); // coasts to rest
  return t;
}

function gearPts(teeth: number, R: number, depth: number): P[] {
  const pts: P[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * TAU, w = TAU / teeth;
    pts.push([Math.cos(a - w * 0.32) * (R - depth), Math.sin(a - w * 0.32) * (R - depth)]);
    pts.push([Math.cos(a - w * 0.18) * R, Math.sin(a - w * 0.18) * R]);
    pts.push([Math.cos(a + w * 0.18) * R, Math.sin(a + w * 0.18) * R]);
    pts.push([Math.cos(a + w * 0.32) * (R - depth), Math.sin(a + w * 0.32) * (R - depth)]);
  }
  return pts;
}

function drawGear(env: Env, A: ReturnType<typeof artFor>, x: number, y: number, teeth: number, R: number, ang: number, col: string) {
  const { ctx } = env;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  poly(A, gearPts(teeth, R, Math.min(16, R * 0.18)), col, { lw: 2.4 });
  circle(A, 0, 0, R * 0.55, null, { lw: 1.6, alpha: 0.5 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    line(A, [[Math.cos(a) * R * 0.18, Math.sin(a) * R * 0.18], [Math.cos(a) * R * 0.55, Math.sin(a) * R * 0.55]], undefined, 2.2, 0.7);
  }
  circle(A, 0, 0, R * 0.16, "metalDark", { lw: 2 });
  ctx.restore();
}

interface GearSpec { x: number; y: number; teeth: number; R: number; ang: number }

/** A train of meshing gears left to right; each turns the other way at the ratio of their teeth. */
function gearTrain(p: any): GearSpec[] {
  const teeth: number[] = Array.isArray(p.teeth) && p.teeth.length ? p.teeth.slice(0, 5).map((n: any) => Math.max(6, Math.min(60, Math.round(num(n, 16))))) : [24, 12, 36];
  const module = 4.4; // radius per tooth
  const gears: GearSpec[] = [];
  let x = 0;
  teeth.forEach((n, i) => {
    const R = n * module;
    if (i === 0) x = 0;
    else x += gears[i - 1].R + R - Math.min(16, R * 0.18) * 0.9;
    gears.push({ x, y: 0, teeth: n, R, ang: 0 });
  });
  const span = gears[gears.length - 1].x;
  for (const g of gears) g.x -= span / 2;
  return gears;
}

const MACHINE_LABELS: Record<string, Record<string, { text: string; at: P; label: P }>> = {
  gears: { driver: { text: "Driver gear", at: [-1, 0], label: [-1, 1] }, driven: { text: "Driven gear", at: [1, 0], label: [1, 1] } },
  crank: {
    wheel: { text: "Crankshaft", at: [-200, 0], label: [-330, -160] }, rod: { text: "Connecting rod", at: [-40, 0], label: [-60, -170] },
    piston: { text: "Piston", at: [200, 0], label: [230, -170] }, cylinder: { text: "Cylinder", at: [300, 70], label: [320, 170] },
  },
  lever: {
    fulcrum: { text: "Fulcrum", at: [0, 40], label: [0, 170] }, effort: { text: "Effort", at: [-280, -40], label: [-330, -200] },
    load: { text: "Load", at: [280, -40], label: [330, -200] },
  },
  pulley: {
    pulley: { text: "Pulley", at: [0, -200], label: [170, -240] }, load: { text: "Load", at: [-90, 120], label: [-300, 120] },
    effort: { text: "Effort", at: [90, 60], label: [300, 60] },
  },
};

export const Machine: Component = {
  inDur: () => 1,
  bounds: (_env, p) => rectOf(frameOf(p, 640, 400), 900, 460),
  anchors: (_env, p) => {
    const f = frameOf(p, 640, 400);
    const kind = String(p.preset ?? "gears");
    if (kind === "gears") {
      const gs = gearTrain(p);
      const out: Record<string, P> = { center: [f.x, f.y], driver: world(f, [gs[0].x, gs[0].y]), driven: world(f, [gs[gs.length - 1].x, gs[gs.length - 1].y]) };
      gs.forEach((g, i) => (out[`gear${i}`] = world(f, [g.x, g.y])));
      return out;
    }
    const L = MACHINE_LABELS[kind] ?? {};
    const local: Record<string, P> = { center: [0, 0] };
    for (const [k, v] of Object.entries(L)) local[k] = v.at;
    return anchorsOf(f, local);
  },
  draw: (env, p, ph, el) => {
    const f = frameOf(p, 640, 400);
    const absT = el.at + ph.local;
    const kind = String(p.preset ?? "gears");
    const { ctx } = env;
    const run = runTime(p, absT, el.at) * num(p.speed, 1);
    const build = clamp(ph.local / 0.9);
    ctx.save();
    ctx.globalAlpha *= ph.alpha * build;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(f.s, f.s);
    const A = artFor(env, f.s, { seed: 61 });
    let labels = MACHINE_LABELS[kind] ?? {};
    if (kind === "gears") {
      const gs = gearTrain(p);
      const w0 = run * 1.4;
      gs.forEach((g, i) => {
        // meshing: alternate directions, speed by tooth ratio, phase so teeth fall into gaps
        const ratio = gs[0].teeth / g.teeth;
        const ang = (i % 2 ? -1 : 1) * w0 * ratio + (i % 2 ? Math.PI / g.teeth : 0);
        drawGear(env, A, g.x, g.y, g.teeth, g.R, ang, i === 0 ? "accent" : i === gs.length - 1 ? "indigo" : "metal");
        if (p.showTeeth !== false) {
          const b = layoutText(env, { text: `${g.teeth} teeth`, x: f.x + g.x * f.s, y: f.y + (g.R + 18) * f.s, size: "sm", align: "center", maxWidth: 200, maxLines: 1, role: "label" });
          labelsToDraw.push(b);
        }
      });
      labels = {
        driver: { text: "Driver gear", at: [gs[0].x, gs[0].y], label: [gs[0].x, -gs[0].R - 60] },
        driven: { text: "Driven gear", at: [gs[gs.length - 1].x, gs[gs.length - 1].y], label: [gs[gs.length - 1].x, -gs[gs.length - 1].R - 60] },
      };
    } else if (kind === "crank") {
      const cx = -200, r = 70, L = 260;
      const phi = run * 2.6;
      drawGear(env, A, cx, 0, 20, 92, phi * 0.0, "metal");
      circle(A, cx, 0, 88, "metal", { lw: 2.4 });
      const pin: P = [cx + Math.cos(phi) * r, Math.sin(phi) * r];
      const px = pin[0] + Math.sqrt(L * L - pin[1] * pin[1]);
      // cylinder, then piston, then the rod on top
      poly(A, [[60, -70], [380, -70], [380, 70], [60, 70]], null, { lw: 3 });
      shape(A, [[px - 5, -62], [px + 70, -62], [px + 70, 62], [px - 5, 62]], "metalDark", { tension: 0.08 });
      const burn = since(p, "combust", absT);
      if (Number.isFinite(burn) && Math.cos(phi) > 0.92) {
        ctx.save();
        ctx.globalAlpha *= 0.8;
        poly(A, [[px + 72, -60], [378, -60], [378, 60], [px + 72, 60]], "flame", { stroke: false });
        ctx.restore();
      }
      line(A, [pin, [px, 0]], "ochre", 14);
      circle(A, pin[0], pin[1], 10, "metalDark", { lw: 2 });
      circle(A, px, 0, 9, "metalDark", { lw: 2 });
      labels = { ...labels, piston: { ...labels.piston, at: [px + 35, 0] } };
    } else if (kind === "lever") {
      const fx = num(p.fulcrum, 0) * 200;
      const push = stageK(p, "push", absT, 1.2) * (1 - stageK(p, "release", absT, 1));
      const tilt = push * 0.2;
      poly(A, [[fx - 50, 90], [fx + 50, 90], [fx, 22]], "metalDark", {});
      ctx.save();
      ctx.translate(fx, 18);
      ctx.rotate(-tilt);
      shape(A, [[-340 - fx, -10], [340 - fx, -10], [340 - fx, 10], [-340 - fx, 10]], "wood", { tension: 0.05 });
      ctx.restore();
      // the load sits on the right end; the effort pushes the left end down
      const endL: P = [fx + Math.cos(Math.PI - tilt) * (340 + fx), 18 + Math.sin(tilt) * (340 + fx)];
      const endR: P = [fx + Math.cos(-tilt) * (340 - fx), 18 - Math.sin(tilt) * (340 - fx)];
      drawProp(env, String(p.loadProp ?? "rock"), f.x + endR[0] * f.s - 40 * f.s, f.y + (endR[1] - 50) * f.s, 90 * f.s, { t: absT, grounded: false });
      ctx.save();
      ctx.globalAlpha *= 0.5 + 0.5 * push;
      line(A, [[endL[0] + 30, endL[1] - 160], [endL[0] + 30, endL[1] - 30]], "accent", 7);
      line(A, [[endL[0] + 14, endL[1] - 54], [endL[0] + 30, endL[1] - 28], [endL[0] + 46, endL[1] - 54]], "accent", 7);
      ctx.restore();
      labels = {
        fulcrum: { text: "Fulcrum", at: [fx, 40], label: [fx, 170] },
        effort: { text: "Effort", at: [endL[0] + 30, endL[1] - 120], label: [endL[0] + 10, -220] },
        load: { text: "Load", at: [endR[0] - 40, endR[1] - 60], label: [endR[0] - 30, -220] },
      };
    } else if (kind === "pulley") {
      const pull = stageK(p, "pull", absT, 2.2);
      const rise = pull * 160;
      const wheel = run * 0 + pull * 4;
      drawGear(env, A, 0, -200, 16, 56, wheel, "metal");
      line(A, [[0, -320], [0, -256]], "metalDark", 6);
      line(A, [[-56, -200], [-56, 90 - rise]], "ochre", 4);
      line(A, [[56, -200], [56, 60 + rise * 0.0 + pull * 60]], "ochre", 4);
      drawProp(env, String(p.loadProp ?? "rock"), f.x - 56 * f.s, f.y + (140 - rise) * f.s, 110 * f.s, { t: absT, grounded: false });
      ctx.save();
      ctx.globalAlpha *= 0.4 + 0.6 * pull;
      line(A, [[56, 80 + pull * 60], [56, 170 + pull * 60]], "accent", 7);
      line(A, [[40, 146 + pull * 60], [56, 172 + pull * 60], [72, 146 + pull * 60]], "accent", 7);
      ctx.restore();
      labels = { ...labels, load: { ...labels.load, at: [-56, 120 - rise] } };
    }
    ctx.restore();
    for (const b of labelsToDraw.splice(0)) drawText(env, b, "center", clamp((ph.local - 0.6) / 0.6), "inkSoft", 1);
    drawSetLabels(env, p, f, absT, 1, labels, el);
    ctx.restore();
  },
};

const labelsToDraw: ReturnType<typeof layoutText>[] = [];

// ───────────────────────────── Circuit ─────────────────────────────

const LOOP: P[] = [[-300, -160], [300, -160], [300, 160], [-300, 160], [-300, -160]];
const CIRCUIT_LABELS: Record<string, { text: string; at: P; label: P }> = {
  battery: { text: "Battery", at: [-300, 0], label: [-440, -60] },
  switch: { text: "Switch", at: [0, -160], label: [0, -250] },
  bulb: { text: "Bulb", at: [300, 0], label: [440, -60] },
  resistor: { text: "Resistor", at: [0, 160], label: [0, 250] },
  wire: { text: "Wire", at: [-150, 160], label: [-330, 250] },
  current: { text: "Current", at: [150, -160], label: [330, -250] },
};

export const Circuit: Component = {
  inDur: () => 1,
  bounds: (_env, p) => rectOf(frameOf(p, 640, 390), 760, 420),
  labelRects: (env, p, el, t0, t1) => setLabelRects(env, p, frameOf(p, 640, 390), CIRCUIT_LABELS, el, t0, t1),
  anchors: (_env, p) => anchorsOf(frameOf(p, 640, 390), { battery: [-300, 0], switch: [0, -160], bulb: [300, 0], resistor: [0, 160], wire: [-150, 160], current: [150, -160], center: [0, 0] }),
  draw: (env, p, ph, el) => {
    const f = frameOf(p, 640, 390);
    const absT = el.at + ph.local;
    const { ctx } = env;
    const parts: string[] = Array.isArray(p.parts) ? p.parts.map(String) : ["battery", "switch", "bulb"];
    const close = since(p, "close", absT), open = since(p, "open", absT);
    const closedK = Number.isFinite(close) ? clamp(close / 0.35) * (Number.isFinite(open) && open > 0 ? 1 - clamp(open / 0.3) : 1) : p.closed ? 1 : 0;
    const build = clamp(ph.local / 1);
    ctx.save();
    ctx.globalAlpha *= ph.alpha;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(f.s, f.s);
    const A = artFor(env, f.s, { seed: 71 });
    // wires, drawn on (with a gap where the switch is)
    const wire = (pts: P[]) => line(A, pts, "copper", 6);
    const k = build;
    const loop = [...LOOP];
    const drawn: P[] = [];
    for (let s = 0; s <= 1; s += 0.01) if (s <= k) drawn.push(pointAlong(loop, s));
    if (drawn.length > 1) {
      if (parts.includes("switch")) {
        wire(drawn.filter(([x, y]) => !(y < -150 && x > -40 && x < 40)));
      } else wire(drawn);
    }
    // electrons drifting round once the circuit is closed (from the battery's − terminal)
    if (closedK > 0) {
      const n = 26;
      for (let i = 0; i < n; i++) {
        const s = (i / n + (Number.isFinite(close) ? close : absT) * 0.06 * num(p.speed, 1)) % 1;
        const q = pointAlong(loop, 1 - s);
        circle(A, q[0], q[1], 6, "electric", { stroke: false, alpha: closedK });
      }
    }
    // parts
    if (parts.includes("battery")) {
      ctx.save();
      ctx.translate(-300, 0);
      poly(A, [[-34, -70], [34, -70], [34, 70], [-34, 70]], "metal", {});
      poly(A, [[-34, -70], [34, -70], [34, -30], [-34, -30]], "accent", {});
      poly(A, [[-12, -84], [12, -84], [12, -70], [-12, -70]], "metalDark", {});
      ctx.restore();
    }
    if (parts.includes("switch")) {
      const ang = lerp(-0.6, 0, closedK);
      circle(A, -40, -160, 8, "metalDark", {});
      circle(A, 40, -160, 8, "metalDark", {});
      line(A, [[-40, -160], [-40 + Math.cos(ang) * 82, -160 + Math.sin(ang) * 82]], "ink", 6);
    }
    if (parts.includes("resistor")) {
      const zz: P[] = [[-70, 160]];
      for (let i = 0; i < 7; i++) zz.push([-60 + i * 20, 160 + (i % 2 ? 16 : -16)]);
      zz.push([70, 160]);
      poly(A, [[-80, 146], [80, 146], [80, 174], [-80, 174]], "paper", { stroke: false });
      line(A, zz, "ink", 5);
    }
    ctx.restore();
    if (parts.includes("bulb")) drawProp(env, "bulb", f.x + 300 * f.s, f.y, 130 * f.s, { t: absT, state: closedK, grounded: false });
    if (parts.includes("motor")) drawProp(env, "gear", f.x, f.y + 160 * f.s, 90 * f.s, { t: absT, rotate: closedK * absT * 4 });
    drawSetLabels(env, p, f, absT, 1, CIRCUIT_LABELS, el);
    ctx.restore();
  },
};

export type { Frame };
