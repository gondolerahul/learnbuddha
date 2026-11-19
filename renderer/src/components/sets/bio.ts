// Biology sets: a chemical synapse and a eukaryotic cell, accurate enough for a medical student and drawn in the
// kit's hand, with their processes as stages the narration calls for.
import type { Component, Env, SceneElement } from "../../types";
import { artFor, circle, ellipse, line, mix, shape, type Art } from "../../art/paint";
import { clamp, lerp, num } from "../../util";
import { anchorsOf, drawSetLabels, frameOf, h1, P, pointAlong, rectOf, setLabelRects, since, stageK, world, type Frame } from "./common";

const TAU = Math.PI * 2;

/** Draw in the set's local space: translate and scale the canvas, and an Art whose px→units knows the scale. */
function local(env: Env, f: Frame, seed: number): Art {
  env.ctx.translate(f.x, f.y);
  env.ctx.scale(f.s, f.s);
  return artFor(env, f.s, { seed });
}

function glowDot(A: Art, x: number, y: number, r: number, col: string, a = 1) {
  const { ctx } = A;
  ctx.save();
  ctx.globalAlpha *= a;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.6);
  const c = A.c(col);
  g.addColorStop(0, c);
  g.addColorStop(0.35, c);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.6, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// ───────────────────────────── Synapse ─────────────────────────────

const TERMINAL: P[] = [[-46, -430], [-44, -230], [-120, -165], [-228, -92], [-262, -10], [-240, 52], [-150, 80], [0, 86], [150, 80], [240, 52], [262, -10], [228, -92], [120, -165], [44, -230], [46, -430]];
const POST: P[] = [[-440, 168], [-300, 154], [-150, 148], [0, 150], [150, 148], [300, 154], [440, 168], [440, 360], [-440, 360]];
const VESICLES: P[] = [[-120, 2], [-60, 22], [0, -6], [60, 22], [120, 2], [-92, -66], [-22, -76], [50, -64], [112, -72]];
const RECEPTORS = [-160, -80, 0, 80, 160];
const CHANNELS: P[] = [[-190, 62], [190, 62]];
const SYN_LABELS: Record<string, { text: string; at: P; label: P }> = {
  axon: { text: "Axon", at: [0, -300], label: [330, -330] },
  terminal: { text: "Axon terminal", at: [150, -110], label: [370, -215] },
  vesicle: { text: "Synaptic vesicle", at: [60, 22], label: [380, -105] },
  transmitter: { text: "Neurotransmitter", at: [40, 118], label: [390, 5] },
  cleft: { text: "Synaptic cleft", at: [-20, 118], label: [390, 110] },
  postsynaptic: { text: "Postsynaptic neuron", at: [220, 250], label: [380, 250] },
  mitochondrion: { text: "Mitochondrion", at: [-120, -115], label: [-370, -190] },
  channel: { text: "Ca²+ channel", at: [-190, 62], label: [-380, 10] },
  receptor: { text: "Receptor", at: [-80, 140], label: [-380, 200] },
};

function synTerminalPts(): P[] {
  return TERMINAL;
}

export const Synapse: Component = {
  inDur: () => 1.2,
  bounds: (env, p, el) => {
    const f = frameOf(p, 640, 380);
    const r = rectOf(f, 900, 620);
    return r;
  },
  anchors: (_env, p) => anchorsOf(frameOf(p, 640, 380), {
    axon: [0, -300], terminal: [0, -60], vesicle: [0, -6], vesicles: [0, -20], mitochondrion: [-120, -115], channel: CHANNELS[0],
    channelRight: CHANNELS[1], cleft: [0, 118], transmitter: [0, 118], receptor: [0, 140], receptors: [0, 140], postsynaptic: [0, 250],
    membrane: [0, 86], center: [0, 0],
  }),
  labelRects: (env, p, el, t0, t1) => setLabelRects(env, p, frameOf(p, 640, 380), SYN_LABELS, el, t0, t1),
  parts: (_env, p) => {
    const f = frameOf(p, 640, 380);
    const a = world(f, [-262, -230]), b = world(f, [262, 86]);
    const c = world(f, [-440, 148]), d = world(f, [440, 300]);
    return [
      { name: "terminal", rect: { x: a[0], y: a[1], w: b[0] - a[0], h: b[1] - a[1] } },
      { name: "postsynaptic", rect: { x: c[0], y: c[1], w: d[0] - c[0], h: d[1] - c[1] } },
    ];
  },
  draw: (env, p, ph, el) => {
    const f = frameOf(p, 640, 380);
    const absT = el.at + ph.local;
    const { ctx } = env;
    const build = clamp(ph.local / 1.2);
    ctx.save();
    ctx.globalAlpha *= ph.alpha;
    ctx.save();
    const A = local(env, f, 11);
    const spike = since(p, "spike", absT);
    const calcium = since(p, "calcium", absT);
    const release = since(p, "release", absT);
    const bind = since(p, "bind", absT);
    const flow = since(p, "flow", absT);
    const reup = since(p, "reuptake", absT);
    const hl = String(p.highlight ?? "");

    // postsynaptic neuron (the dendrite below the cleft)
    ctx.save();
    ctx.globalAlpha *= clamp(build * 1.6);
    shape(A, POST, "tissue", { strokeColor: "membrane", lw: 3.2, tension: 0.4 });
    // depolarisation spreading along the postsynaptic membrane
    if (Number.isFinite(flow)) {
      const spread = clamp(flow / 1.6) * 460;
      ctx.save();
      ctx.globalAlpha *= 0.55 * clamp(flow / 0.4);
      line(A, [[-spread, 150], [-spread / 2, 148], [0, 150], [spread / 2, 148], [spread, 150]], "accent", 7);
      ctx.restore();
    }
    ctx.restore();

    // receptors on the postsynaptic membrane: they open when transmitter binds
    const openK = Number.isFinite(bind) ? clamp((bind - 0.7) / 0.5) * (Number.isFinite(reup) ? 1 - clamp(reup / 1.2) : 1) : 0;
    for (const x of RECEPTORS) {
      const sep = 7 + openK * 8;
      const col = hl === "receptor" ? "accent" : "indigo";
      ellipse(A, x - sep, 138, 9, 19, col, 0.12, { lw: 2.2 });
      ellipse(A, x + sep, 138, 9, 19, col, -0.12, { lw: 2.2 });
      if (openK > 0.05) glowDot(A, x, 140, 6, "accent", openK * 0.6);
    }

    // the presynaptic terminal
    ctx.save();
    ctx.globalAlpha *= clamp(build * 1.4);
    shape(A, synTerminalPts(), hl === "terminal" ? "accentSoft" : "cell", { strokeColor: "membrane", lw: 3.6, tension: 0.45 });
    ctx.restore();

    // the action potential arriving down the axon, then washing over the terminal membrane
    if (Number.isFinite(spike) && spike < 2.2) {
      const s = clamp(spike / 1.0);
      const y = lerp(-430, -150, s);
      glowDot(A, 0, y, 18, "accent", 0.9 * (1 - clamp((spike - 1.2) / 1.0)));
      if (spike > 0.8) {
        ctx.save();
        ctx.globalAlpha *= 0.65 * (1 - clamp((spike - 1.2) / 1.0));
        line(A, TERMINAL.slice(2, 13), "accent", 6);
        ctx.restore();
      }
    }

    // mitochondrion (the terminal's energy for refilling vesicles)
    ellipse(A, -120, -115, 46, 20, hl === "mitochondrion" ? "accent" : "mito", -0.35, { lw: 2.2 });
    line(A, [[-150, -104], [-138, -122], [-126, -104], [-114, -124], [-102, -110], [-92, -128]], "black", 1.6, 0.55);

    // Ca2+ channels on the terminal membrane
    const chOpen = Number.isFinite(calcium) ? clamp(calcium / 0.4) : 0;
    for (const [cx, cy] of CHANNELS) {
      const dir = cx < 0 ? -1 : 1;
      const sep = 6 + chOpen * 7;
      const col = hl === "channel" ? "accent" : "ochre";
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(dir * -0.55);
      ellipse(A, -sep, 0, 8, 16, col, 0, { lw: 2 });
      ellipse(A, sep, 0, 8, 16, col, 0, { lw: 2 });
      ctx.restore();
      if (chOpen > 0) {
        // calcium flows in from the cleft side, a steady stream once open
        const outside: P = [cx + dir * 70, cy + 64], inside: P = [cx - dir * 70, cy - 70];
        for (let i = 0; i < 7; i++) {
          const k = (calcium * 0.55 + i / 7) % 1;
          const q = pointAlong([outside, [cx, cy], inside], k);
          circle(A, q[0], q[1], 5.5, "ochre", { lw: 1.2, alpha: chOpen * Math.sin(Math.PI * k) });
        }
      }
    }

    // vesicles: the lower five dock and fuse on "release", spilling transmitter into the cleft
    const relK = Number.isFinite(release) ? release : -1;
    VESICLES.forEach(([vx, vy], i) => {
      const docking = i < 5 && relK >= 0;
      const dock = docking ? clamp(relK / 0.7) : 0;
      const fuse = docking ? clamp((relK - 0.7) / 0.5) : 0;
      const x = vx, y = lerp(vy, 60, dock * dock * (3 - 2 * dock));
      const r = 24 * (1 - 0.75 * fuse);
      const col = hl === "vesicle" ? "accent" : "white";
      if (fuse < 1) circle(A, x, y, r, col, { strokeColor: "membrane", lw: 2.2, alpha: 1 - fuse * 0.7 });
      // transmitter inside the vesicle until it spills
      for (let j = 0; j < 5; j++) {
        const a = (j / 5) * TAU + i;
        const inner: P = [x + Math.cos(a) * 9, y + Math.sin(a) * 9];
        if (!docking || fuse <= 0) circle(A, inner[0], inner[1], 4, "accent", { stroke: false });
      }
    });

    // transmitter in the cleft: spills out, crosses to the receptors, and is taken back up
    if (relK >= 0.7) {
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) {
          const idx = i * 5 + j;
          const src: P = [VESICLES[i][0] + (h1(idx, 1) - 0.5) * 30, 80];
          const spill = clamp((relK - 0.7) / 0.6);
          const cloud: P = [src[0] + (h1(idx, 2) - 0.5) * 60, 96 + h1(idx, 3) * 30];
          let q = pointAlong([src, cloud], spill);
          if (Number.isFinite(bind)) {
            const rx = RECEPTORS[idx % RECEPTORS.length] + (j - 2) * 3;
            q = pointAlong([cloud, [rx, 128]], clamp((bind - h1(idx, 4) * 0.3) / 0.8));
          }
          let a = 1;
          if (Number.isFinite(reup)) {
            const back: P = [idx % 2 ? 236 : -236, 40];
            const kk = clamp((reup - h1(idx, 5) * 0.4) / 1.0);
            q = pointAlong([q, back], kk);
            a = 1 - clamp((kk - 0.8) / 0.2);
          }
          const wob = Math.sin(absT * 7 + idx) * 1.5;
          if (a > 0) circle(A, q[0] + wob, q[1], 4.2, "accent", { stroke: false, alpha: a });
        }
      }
    }

    // ions rushing into the postsynaptic cell through the open receptors
    if (Number.isFinite(flow) && openK > 0) {
      for (const x of RECEPTORS) {
        for (let i = 0; i < 4; i++) {
          const k = (flow * 0.7 + i / 4 + x * 0.001) % 1;
          circle(A, x + Math.sin(k * 6 + x) * 4, lerp(110, 290, k), 5, "sage", { lw: 1.2, alpha: openK * Math.sin(Math.PI * k) });
        }
      }
    }
    ctx.restore();
    drawSetLabels(env, p, f, absT, 1, SYN_LABELS, el);
    ctx.restore();
  },
};

// ───────────────────────────── Cell ─────────────────────────────

const NUC: P = [-150, -10];
const GOLGI: P = [225, -50];
const MITO: [number, number, number][] = [[40, 175, -0.25], [300, 150, 0.4], [-330, 160, 0.6], [-300, -190, -0.3]];
const CELL_LABELS: Record<string, { text: string; at: P; label: P }> = {
  nucleus: { text: "Nucleus", at: [-180, -60], label: [-300, -300] },
  nucleolus: { text: "Nucleolus", at: [-120, 10], label: [-120, -300] },
  er: { text: "Rough ER", at: [60, -120], label: [80, -300] },
  golgi: { text: "Golgi apparatus", at: [225, -50], label: [330, -300] },
  mitochondrion: { text: "Mitochondrion", at: [300, 150], label: [360, 270] },
  ribosome: { text: "Ribosomes", at: [60, 40], label: [140, 270] },
  lysosome: { text: "Lysosome", at: [340, -170], label: [450, -150] },
  membrane: { text: "Cell membrane", at: [-420, 60], label: [-380, 270] },
  cytoplasm: { text: "Cytoplasm", at: [-60, 200], label: [-120, 270] },
};

function cellOutline(t: number): P[] {
  const pts: P[] = [];
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const w = 1 + 0.035 * Math.sin(a * 3 + t * 0.6) + 0.025 * Math.cos(a * 5 - t * 0.4);
    pts.push([Math.cos(a) * 470 * w, Math.sin(a) * 280 * w]);
  }
  return pts;
}

export const Cell: Component = {
  inDur: () => 1.4,
  bounds: (_env, p) => rectOf(frameOf({ scale: 0.85, ...p }, 640, 390), 980, 600),
  anchors: (_env, p) => anchorsOf(frameOf({ scale: 0.85, ...p }, 640, 390), {
    nucleus: NUC, nucleolus: [-120, 10], pore: [-30, -60], er: [60, -110], ribosome: [60, 40], golgi: GOLGI,
    mitochondrion: [300, 150], lysosome: [340, -170], membrane: [-460, 0], cytoplasm: [-40, 190], vesicle: [330, -40], center: [0, 0],
  }),
  labelRects: (env, p, el, t0, t1) => setLabelRects(env, p, frameOf({ scale: 0.85, ...p }, 640, 390), CELL_LABELS, el, t0, t1),
  parts: (_env, p) => {
    const f = frameOf({ scale: 0.85, ...p }, 640, 390);
    const box = (x: number, y: number, w: number, h: number) => {
      const a = world(f, [x, y]);
      return { x: a[0], y: a[1], w: w * f.s, h: h * f.s };
    };
    return [
      { name: "nucleus", rect: box(-290, -150, 280, 280) },
      { name: "golgi", rect: box(170, -110, 120, 120) },
      ...MITO.map(([x, y], i) => ({ name: `mito${i}`, rect: box(x - 60, y - 30, 120, 60) })),
    ];
  },
  draw: (env, p, ph, el) => {
    const f = frameOf({ scale: 0.85, ...p }, 640, 390);
    const absT = el.at + ph.local;
    const { ctx } = env;
    const build = clamp(ph.local / 1.4);
    const hl = String(p.highlight ?? "");
    ctx.save();
    ctx.globalAlpha *= ph.alpha;
    ctx.save();
    const A = local(env, f, 23);
    // membrane and cytoplasm
    ctx.save();
    ctx.globalAlpha *= clamp(build * 2);
    shape(A, cellOutline(absT), hl === "cytoplasm" ? "accentSoft" : "cell", { strokeColor: hl === "membrane" ? "accent" : "membrane", lw: 5, tension: 0.5 });
    ctx.restore();
    const at = (k0: number) => clamp((build - k0) / 0.35);
    // free ribosomes scattered in the cytoplasm
    for (let i = 0; i < 34; i++) {
      const a = h1(i, 7) * TAU, r = 0.35 + h1(i, 8) * 0.55;
      const x = Math.cos(a) * 430 * r, y = Math.sin(a) * 250 * r;
      if (Math.hypot(x - NUC[0], y - NUC[1]) < 150) continue;
      circle(A, x, y, 4, hl === "ribosome" ? "accent" : "purple", { stroke: false, alpha: at(0.5) });
    }
    // rough ER: folded sheets around the nucleus, studded with ribosomes
    ctx.save();
    ctx.globalAlpha *= at(0.3);
    for (let r = 0; r < 4; r++) {
      const rad = 165 + r * 26;
      const pts: P[] = [];
      for (let a = -1.25; a <= 1.15; a += 0.12) pts.push([NUC[0] + Math.cos(a) * rad + Math.sin(a * 9 + r) * 5, NUC[1] + Math.sin(a) * rad * 0.92]);
      line(A, pts, hl === "er" ? "accent" : "tissueDark", 9);
      line(A, pts, "tissue", 5);
      for (let i = 0; i < pts.length; i += 2) circle(A, pts[i][0] + 6, pts[i][1] - 6, 3.2, "purple", { stroke: false });
    }
    ctx.restore();
    // nucleus: double envelope with pores, chromatin and nucleolus
    ctx.save();
    ctx.globalAlpha *= at(0.15);
    circle(A, NUC[0], NUC[1], 138, hl === "nucleus" ? "accentSoft" : "nucleus", { strokeColor: "membrane", lw: 3.4, alpha: 0.95 });
    circle(A, NUC[0], NUC[1], 128, null, { strokeColor: "membrane", lw: 1.6 });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU;
      circle(A, NUC[0] + Math.cos(a) * 133, NUC[1] + Math.sin(a) * 133, 4.2, "cell", { stroke: false });
    }
    for (let i = 0; i < 7; i++) {
      const pts: P[] = [];
      for (let j = 0; j < 6; j++) pts.push([NUC[0] - 90 + h1(i * 6 + j, 3) * 170, NUC[1] - 90 + h1(i * 6 + j, 4) * 170]);
      line(A, pts, "nucleus", 2.2, 0.0);
      line(A, pts.map(([x, y]) => [x, y] as P), mix(A.c("nucleus"), -0.35), 2, 0.55);
    }
    circle(A, -120, 10, 38, hl === "nucleolus" ? "accent" : mix(A.c("nucleus"), -0.4), { lw: 2 });
    ctx.restore();
    // Golgi: stacked cisternae with vesicles budding off
    ctx.save();
    ctx.globalAlpha *= at(0.45);
    for (let i = 0; i < 5; i++) {
      const r = 48 + i * 14;
      const pts: P[] = [];
      for (let a = -0.9; a <= 0.9; a += 0.15) pts.push([GOLGI[0] - 40 + Math.cos(a) * r, GOLGI[1] + Math.sin(a) * r * 0.9]);
      line(A, pts, hl === "golgi" ? "accent" : "ochre", 10);
      line(A, pts, mix(A.c("ochre"), 0.35), 5);
    }
    for (const [x, y] of [[300, -95], [312, -10], [292, 30]] as P[]) circle(A, x, y, 9, "ochre", { lw: 1.6 });
    ctx.restore();
    // mitochondria with cristae
    MITO.forEach(([x, y, rot], i) => {
      ctx.save();
      ctx.globalAlpha *= at(0.55 + i * 0.05);
      ctx.translate(x, y);
      ctx.rotate(rot);
      ellipse(A, 0, 0, 62, 27, hl === "mitochondrion" ? "accent" : "mito", 0, { lw: 2.4 });
      const cr: P[] = [];
      for (let j = 0; j <= 10; j++) cr.push([-48 + j * 9.6, (j % 2 ? -1 : 1) * 14]);
      line(A, cr, mix(A.c("mito"), -0.35), 2.4);
      ctx.restore();
    });
    // lysosome
    circle(A, 340, -170, 26, hl === "lysosome" ? "accent" : "purple", { lw: 2, alpha: at(0.6) });

    // processes
    const tr = since(p, "transcribe", absT);
    if (Number.isFinite(tr)) {
      // an mRNA strand copied from the DNA, leaving through a nuclear pore toward the ribosomes
      const k = clamp(tr / 2.2);
      const path: P[] = [[-170, -10], [-120, -40], [-60, -50], [-20, -62], [40, -70], [70, -40], [80, 0]];
      const pts: P[] = [];
      for (let i = 0; i <= 40 * k; i++) {
        const q = pointAlong(path, i / 40);
        pts.push([q[0] + Math.sin(i * 1.3) * 4, q[1] + Math.cos(i * 1.1) * 4]);
      }
      if (pts.length > 1) line(A, pts, "accent", 4);
    }
    const tl = since(p, "translate", absT);
    if (Number.isFinite(tl)) {
      // a ribosome reads the message and a protein chain grows bead by bead
      const n = Math.floor(clamp(tl / 2.4) * 12);
      circle(A, 80, 6, 14, "purple", { lw: 2 });
      for (let i = 0; i < n; i++) circle(A, 96 + i * 9, 18 + Math.sin(i * 0.9) * 8, 4.6, "accent", { stroke: false });
    }
    const sh = since(p, "ship", absT);
    if (Number.isFinite(sh)) {
      // a vesicle carries the protein from the ER to the Golgi, then on to the membrane, and opens outside
      const route: P[] = [[60, -110], [150, -70], [190, -50], [270, -40], [360, -20], [455, -10]];
      const k = clamp(sh / 3.2);
      const q = pointAlong(route, k);
      const fuse = clamp((sh - 3.0) / 0.6);
      if (fuse < 1) circle(A, q[0], q[1], 13 * (1 - fuse * 0.6), "accent", { strokeColor: "membrane", lw: 2 });
      if (fuse > 0) for (let i = 0; i < 6; i++) circle(A, 470 + fuse * (20 + i * 8), -10 + (i - 2.5) * 10 * fuse, 3.5, "accent", { stroke: false, alpha: 1 - fuse * 0.5 });
    }
    const pw = since(p, "power", absT);
    if (Number.isFinite(pw)) {
      // mitochondria make ATP: bright sparks drifting out into the cell
      MITO.forEach(([x, y], i) => {
        for (let j = 0; j < 5; j++) {
          const k = (pw * 0.5 + j / 5 + i * 0.13) % 1;
          const a = h1(i * 5 + j, 9) * TAU;
          circle(A, x + Math.cos(a) * 80 * k, y + Math.sin(a) * 60 * k, 5, "yellow", { stroke: false, alpha: Math.sin(Math.PI * k) * clamp(pw / 0.4) });
        }
      });
    }
    ctx.restore();
    drawSetLabels(env, p, f, absT, 1, CELL_LABELS, el);
    ctx.restore();
  },
};

export const SET_LABEL_PLACES = { Synapse: SYN_LABELS, Cell: CELL_LABELS };
export { setLabelRects, num };
export type { SceneElement };
