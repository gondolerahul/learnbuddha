// Chemistry sets: a molecule in ball-and-stick (or space-filling), and a reaction in which the reactants' atoms
// really travel to their places in the products: bonds break, atoms fly on arcs, new bonds form. The equation is
// written beneath, with its coefficients.
import type { Component, Env, SceneElement } from "../../types";
import { artFor, circle, gloss, line } from "../../art/paint";
import { drawText, layoutText } from "../../text";
import { clamp, lerp, num } from "../../util";
import { anchorsOf, frameOf, h1, P, rectOf, since, stageK, world, type Frame } from "./common";

interface Atom { el: string; x: number; y: number }
interface Mol { atoms: Atom[]; bonds: [number, number, number][]; charge?: Record<number, string> }

/** Colours that chemistry teaching uses (CPK), and sizes in local units. */
const ATOM: Record<string, { col: string; r: number; text: string }> = {
  H: { col: "#F2F2F0", r: 15, text: "#333333" }, C: { col: "#3B3B3E", r: 22, text: "#FFFFFF" }, O: { col: "#E0473B", r: 21, text: "#FFFFFF" },
  N: { col: "#3E66D6", r: 21, text: "#FFFFFF" }, Na: { col: "#9B6BEA", r: 26, text: "#FFFFFF" }, Cl: { col: "#3FB950", r: 26, text: "#FFFFFF" },
  S: { col: "#F2C53D", r: 24, text: "#333333" }, P: { col: "#F08C3A", r: 24, text: "#FFFFFF" }, Fe: { col: "#C77A3A", r: 26, text: "#FFFFFF" },
};

const MOLS: Record<string, Mol> = {
  H2O: { atoms: [{ el: "O", x: 0, y: -6 }, { el: "H", x: -40, y: 22 }, { el: "H", x: 40, y: 22 }], bonds: [[0, 1, 1], [0, 2, 1]] },
  CO2: { atoms: [{ el: "C", x: 0, y: 0 }, { el: "O", x: -58, y: 0 }, { el: "O", x: 58, y: 0 }], bonds: [[0, 1, 2], [0, 2, 2]] },
  O2: { atoms: [{ el: "O", x: -25, y: 0 }, { el: "O", x: 25, y: 0 }], bonds: [[0, 1, 2]] },
  H2: { atoms: [{ el: "H", x: -19, y: 0 }, { el: "H", x: 19, y: 0 }], bonds: [[0, 1, 1]] },
  N2: { atoms: [{ el: "N", x: -24, y: 0 }, { el: "N", x: 24, y: 0 }], bonds: [[0, 1, 3]] },
  CO: { atoms: [{ el: "C", x: -24, y: 0 }, { el: "O", x: 24, y: 0 }], bonds: [[0, 1, 3]] },
  CH4: { atoms: [{ el: "C", x: 0, y: 0 }, { el: "H", x: 0, y: -48 }, { el: "H", x: -44, y: 20 }, { el: "H", x: 44, y: 20 }, { el: "H", x: 14, y: 40 }], bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1]] },
  NH3: { atoms: [{ el: "N", x: 0, y: -6 }, { el: "H", x: -42, y: 22 }, { el: "H", x: 42, y: 22 }, { el: "H", x: 0, y: 42 }], bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1]] },
  HCl: { atoms: [{ el: "H", x: -30, y: 0 }, { el: "Cl", x: 24, y: 0 }], bonds: [[0, 1, 1]] },
  NaCl: { atoms: [{ el: "Na", x: -34, y: 0 }, { el: "Cl", x: 34, y: 0 }], bonds: [], charge: { 0: "+", 1: "−" } },
  "Na+": { atoms: [{ el: "Na", x: 0, y: 0 }], bonds: [], charge: { 0: "+" } },
  "Cl-": { atoms: [{ el: "Cl", x: 0, y: 0 }], bonds: [], charge: { 0: "−" } },
  Na: { atoms: [{ el: "Na", x: 0, y: 0 }], bonds: [] },
  Cl2: { atoms: [{ el: "Cl", x: -27, y: 0 }, { el: "Cl", x: 27, y: 0 }], bonds: [[0, 1, 1]] },
  C: { atoms: [{ el: "C", x: 0, y: 0 }], bonds: [] },
  O: { atoms: [{ el: "O", x: 0, y: 0 }], bonds: [] },
  H: { atoms: [{ el: "H", x: 0, y: 0 }], bonds: [] },
};

export const MOLECULES = Object.keys(MOLS);

function molOf(name: string): Mol {
  return MOLS[name] ?? MOLS[name.replace(/\s/g, "")] ?? MOLS.H2O;
}

function drawBond(env: Env, A: ReturnType<typeof artFor>, a: P, b: P, order: number, alpha: number) {
  if (alpha <= 0) return;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l, ny = dx / l;
  const gap = 7;
  for (let i = 0; i < order; i++) {
    const o = (i - (order - 1) / 2) * gap;
    line(A, [[a[0] + nx * o, a[1] + ny * o], [b[0] + nx * o, b[1] + ny * o]], "metalDark", order > 1 ? 4 : 6, alpha);
  }
}

function drawAtom(env: Env, A: ReturnType<typeof artFor>, el: string, x: number, y: number, k: number, alpha: number, charge?: string, letters = true, space = false) {
  const d = ATOM[el] ?? ATOM.C;
  const r = d.r * (space ? 1.6 : 1) * k;
  if (r <= 0.5 || alpha <= 0) return;
  circle(A, x, y, r, d.col, { lw: 2.2, alpha });
  gloss(A, x - r * 0.35, y - r * 0.38, r * 0.32, r * 0.2, 0.45 * alpha);
  const { ctx } = env;
  if (letters && r > 10) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = d.text;
    ctx.font = `700 ${Math.round(r * 0.95)}px "LB Inter", "LB Poppins", "LB Hand", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(el, x, y + r * 0.04);
    if (charge) {
      ctx.font = `700 ${Math.round(r * 0.8)}px "LB Inter", "LB Hand", sans-serif`;
      ctx.fillStyle = A.c("ink");
      ctx.fillText(charge, x + r * 0.9, y - r * 0.9);
    }
    ctx.restore();
  }
}

export const Molecule: Component = {
  inDur: () => 0.8,
  bounds: (_env, p) => rectOf(frameOf({ scale: 1.8, ...p }), 170, 130),
  anchors: (_env, p) => {
    const f = frameOf({ scale: 1.8, ...p });
    const m = molOf(String(p.formula ?? "H2O"));
    const out: Record<string, P> = { center: [f.x, f.y] };
    m.atoms.forEach((a, i) => (out[`atom${i}`] = world(f, [a.x, a.y])));
    return out;
  },
  draw: (env, p, ph, el) => {
    const f = frameOf({ scale: 1.8, ...p });
    const absT = el.at + ph.local;
    const m = molOf(String(p.formula ?? "H2O"));
    const { ctx } = env;
    const vib = since(p, "vibrate", absT);
    const split = stageK(p, "split", absT, 1.2);
    const spin = since(p, "spin", absT);
    ctx.save();
    ctx.globalAlpha *= ph.alpha;
    ctx.translate(f.x, f.y);
    ctx.scale(f.s, f.s);
    if (Number.isFinite(spin)) ctx.rotate(spin * 0.8);
    const A = artFor(env, f.s, { seed: 41 });
    const pos = m.atoms.map((a, i): P => {
      const v = Number.isFinite(vib) ? Math.sin(vib * 26 + i * 2.1) * 3.5 : Math.sin(absT * 2 + i) * 0.8;
      const out = 1 + split * 0.9;
      return [a.x * out + v, a.y * out + v * 0.6];
    });
    const grow = (i: number) => clamp((ph.local - i * 0.08) / 0.45);
    for (const [i, j, o] of m.bonds) drawBond(env, A, pos[i], pos[j], o, (1 - split) * Math.min(grow(i), grow(j)));
    m.atoms.forEach((a, i) => drawAtom(env, A, a.el, pos[i][0], pos[i][1], 0.4 + 0.6 * Math.min(1, grow(i) * 1.4), clamp(grow(i) * 3), m.charge?.[i], p.letters !== false, p.style === "space"));
    ctx.restore();
    if (typeof p.label === "string" && p.label) {
      const b = layoutText(env, { text: p.label, x: f.x, y: f.y + 70 * f.s, size: "sm", align: "center", maxWidth: 220, maxLines: 1, role: "label" });
      drawText(env, b, "center", clamp((ph.local - 0.4) / 0.5), "ink", ph.alpha);
    }
  },
};

// ───────────────────────────── Reaction ─────────────────────────────

interface Placed { el: string; x: number; y: number; mol: number; charge?: string }

function layout(list: string[], x0: number, x1: number): { atoms: Placed[]; bonds: [number, number, number][]; centers: P[] } {
  const atoms: Placed[] = [];
  const bonds: [number, number, number][] = [];
  const centers: P[] = [];
  const n = list.length;
  list.forEach((name, i) => {
    const m = molOf(name);
    const cx = n === 1 ? (x0 + x1) / 2 : lerp(x0, x1, i / (n - 1));
    const cy = (i % 2 ? 24 : -24) * (n > 2 ? 1 : 0);
    centers.push([cx, cy]);
    const base = atoms.length;
    m.atoms.forEach((a, k) => atoms.push({ el: a.el, x: cx + a.x, y: cy + a.y, mol: i, charge: m.charge?.[k] }));
    for (const [a, b, o] of m.bonds) bonds.push([base + a, base + b, o]);
  });
  return { atoms, bonds, centers };
}

/** "CH4 + 2O2 → CO2 + 2H2O" from the molecule lists. */
function equation(reactants: string[], products: string[]) {
  const side = (l: string[]) => {
    const counts: [string, number][] = [];
    for (const n of l) {
      const c = counts.find((x) => x[0] === n);
      if (c) c[1]++;
      else counts.push([n, 1]);
    }
    return counts.map(([n, c]) => (c > 1 ? `${c}${n}` : n)).join(" + ");
  };
  return `${side(reactants)} → ${side(products)}`;
}

export const Reaction: Component = {
  inDur: () => 1,
  bounds: (_env, p) => rectOf(frameOf({ scale: 1.35, ...p }), 900, 300),
  anchors: (_env, p) => {
    const f = frameOf({ scale: 1.35, ...p });
    return anchorsOf(f, { reactants: [-250, 0], products: [250, 0], arrow: [0, 0], equation: [0, 120], center: [0, 0] });
  },
  draw: (env, p, ph, el) => {
    const f = frameOf({ scale: 1.35, ...p });
    const absT = el.at + ph.local;
    const reactants: string[] = Array.isArray(p.reactants) ? p.reactants.map(String) : ["H2", "H2", "O2"];
    const products: string[] = Array.isArray(p.products) ? p.products.map(String) : ["H2O", "H2O"];
    const R = layout(reactants, -380, -120), Q = layout(products, 120, 380);
    const react = since(p, "react", absT);
    const shake = since(p, "shake", absT);
    const k = Number.isFinite(react) ? clamp(react / Math.max(0.6, num(p.reactDur, 2.2))) : 0;
    const { ctx } = env;
    ctx.save();
    ctx.globalAlpha *= ph.alpha;
    ctx.translate(f.x, f.y);
    ctx.scale(f.s, f.s);
    const A = artFor(env, f.s, { seed: 43 });
    // match every product atom to an unused reactant atom of the same element
    const used = new Set<number>();
    const match = Q.atoms.map((q) => {
      const i = R.atoms.findIndex((r, j) => !used.has(j) && r.el === q.el);
      if (i >= 0) used.add(i);
      return i;
    });
    const moving = k > 0;
    const breakK = clamp(k / 0.3), formK = clamp((k - 0.7) / 0.3), fly = clamp((k - 0.15) / 0.75);
    const e = fly * fly * (3 - 2 * fly);
    const grow = (i: number) => clamp((ph.local - i * 0.06) / 0.4);
    // the arrow
    ctx.save();
    ctx.globalAlpha *= clamp(ph.local / 0.6);
    line(A, [[-70, 0], [60, 0]], "ink", 5);
    line(A, [[42, -14], [64, 0], [42, 14]], "ink", 5);
    ctx.restore();
    // reactant bonds break, product bonds form
    for (const [a, b, o] of R.bonds) {
      const pa = R.atoms[a], pb = R.atoms[b];
      const v = Number.isFinite(shake) && !moving ? Math.sin(shake * 30 + a) * 3 : 0;
      drawBond(env, A, [pa.x + v, pa.y], [pb.x - v, pb.y], o, (moving ? 1 - breakK : 1) * Math.min(grow(a), grow(b)));
    }
    if (moving) for (const [a, b, o] of Q.bonds) {
      const pa = Q.atoms[a], pb = Q.atoms[b];
      drawBond(env, A, [pa.x, pa.y], [pb.x, pb.y], o, formK);
    }
    // atoms: unmatched reactant atoms stay; matched ones fly on arcs to their product places
    R.atoms.forEach((r, i) => {
      if (moving && used.has(i)) return;
      const v = Number.isFinite(shake) && !moving ? Math.sin(shake * 30 + i) * 3 : 0;
      drawAtom(env, A, r.el, r.x + v, r.y, 0.4 + 0.6 * Math.min(1, grow(i) * 1.4), clamp(grow(i) * 3) * (moving ? 1 - formK : 1), r.charge);
    });
    if (moving) Q.atoms.forEach((q, j) => {
      const i = match[j];
      if (i < 0) {
        drawAtom(env, A, q.el, q.x, q.y, 1, formK, q.charge);
        return;
      }
      const r = R.atoms[i];
      const lift = Math.sin(Math.PI * e) * (60 + h1(j, 3) * 60) * (j % 2 ? 1 : -1);
      drawAtom(env, A, q.el, lerp(r.x, q.x, e), lerp(r.y, q.y, e) + lift, 1, 1, formK > 0.5 ? q.charge : r.charge);
    });
    ctx.restore();
    if (p.equation !== false) {
      const eq = String(p.equationText ?? equation(reactants, products));
      const b = layoutText(env, { text: eq, x: f.x, y: f.y + 110 * f.s, size: "md", align: "center", maxWidth: 900, maxLines: 1, family: "mono" });
      drawText(env, b, "center", clamp((ph.local - 0.6) / 0.8), "ink", ph.alpha);
    }
  },
};

export type { SceneElement, Frame };
