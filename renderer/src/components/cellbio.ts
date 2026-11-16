// Cell-level physiology: Epithelium — a transporting epithelium between a lumen and the blood, with membrane
// transporters (pumps, cotransporters, channels, exchangers) moving labelled ions and molecules across.
// Kidney tubules, gut absorption, secretory glands, the blood–brain barrier: the same picture.
import type { Component, Env, Rect } from "../types";
import { artFor, circle, line, paint, type P } from "../art/paint";
import { drawParticle } from "./art";
import { drawText, layoutText } from "../text";
import { clamp, color, ease, hash, num } from "../util";

const TAU = Math.PI * 2;

/** Well-known ions get consistent colours; anything else is hashed into the palette. */
const ION_COLORS: Record<string, string> = {
  "Na+": "#F2C94C", "K+": "#9B7BC4", "Cl−": "#6FBF73", "Cl-": "#6FBF73", "H+": "#F28CA0", "Ca2+": "#F0974B", "Ca²+": "#F0974B",
  "HCO3−": "#4FB3A9", "HCO3-": "#4FB3A9", "Mg2+": "#B0C4DE", "NH4+": "#C9A66B", "PO4": "#D9A0D9", "urea": "#E9C84A", "AA": "#8CB8E8",
};
const PARTICLES = new Set(["dot", "drop", "water", "glucose", "salt", "urea", "ion", "electron", "oxygen", "co2", "molecule", "nutrient", "rbc"]);

function bead(env: Env, token: string, x: number, y: number, size: number, t: number, seed: number, alpha: number) {
  if (PARTICLES.has(token)) {
    drawParticle(env, token, x, y, size, 0, t, seed, undefined, alpha);
    return;
  }
  const { ctx } = env;
  const r = size * 0.62 + Math.min(10, token.length * 1.6);
  const pal = ["#F2C94C", "#9B7BC4", "#6FBF73", "#F28CA0", "#4FB3A9", "#F0974B"];
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = artFor(env, 1).c(ION_COLORS[token] ?? pal[hash(token) % pal.length]);
  ctx.strokeStyle = color(env.tokens, "ink");
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.ellipse(x, y, r, size * 0.62, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#2B2622";
  ctx.font = `700 ${Math.round(size * 0.62)}px ${env.tokens.fonts.hand}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(token, x, y + 1);
  ctx.restore();
}

interface Layout {
  x0: number; y0: number; w: number; h: number;
  lumenR: number; apical: number; baso: number; capX: number; capW: number;
  cells: { top: number; bot: number }[]; junctions: number[];
}

function layout(p: any): Layout {
  const w = num(p.w, 1080), h = num(p.h, 430);
  const x0 = num(p.x, 640) - w / 2, y0 = num(p.y, 405) - h / 2;
  const lumenR = x0 + w * 0.24;
  const apical = lumenR + 10;
  const baso = x0 + w * 0.66;
  const capW = Math.min(110, w * 0.11);
  const capX = x0 + w * 0.86;
  const n = Math.round(clamp(num(p.cells, 2), 1, 3));
  const gap = 16;
  const ch = (h - gap * (n - 1)) / n;
  const cells = Array.from({ length: n }, (_, i) => ({ top: y0 + i * (ch + gap), bot: y0 + i * (ch + gap) + ch }));
  const junctions = cells.slice(0, -1).map((c) => c.bot + gap / 2);
  return { x0, y0, w, h, lumenR, apical, baso, capX, capW, cells, junctions };
}

function transporterY(L: Layout, tr: any, i: number, n: number): number {
  const pos = typeof tr.pos === "number" ? clamp(tr.pos, 0.05, 0.95) : (i + 0.5) / Math.max(1, n);
  return L.y0 + pos * L.h;
}

export const Epithelium: Component = {
  inDur: () => 1.2,
  bounds: (_env, p): Rect => {
    const L = layout(p);
    return { x: L.x0, y: L.y0 - 44, w: L.w, h: L.h + 44 };
  },
  anchors: (_env, p) => {
    const L = layout(p);
    const mid = L.y0 + L.h / 2;
    const out: Record<string, P> = {
      lumen: [(L.x0 + L.lumenR) / 2, mid], blood: [L.capX, mid], interstitium: [(L.baso + L.capX - L.capW / 2) / 2, mid],
      cell: [(L.apical + L.baso) / 2, (L.cells[0].top + L.cells[0].bot) / 2], apical: [L.apical, mid], basolateral: [L.baso, mid],
      nucleus: [(L.apical + L.baso) / 2, (L.cells[0].top + L.cells[0].bot) / 2],
    };
    if (L.junctions.length) out.junction = [(L.apical + L.baso) / 2, L.junctions[0]];
    const trs: any[] = Array.isArray(p.transporters) ? p.transporters : [];
    const bySide = (s: string) => trs.filter((t) => (t.side ?? "apical") === s);
    trs.forEach((t, i) => {
      const side = t.side ?? "apical";
      const list = bySide(side);
      out[`transporter${i}`] = [side === "apical" ? L.apical : L.baso, transporterY(L, t, list.indexOf(t), list.length)];
    });
    return out;
  },
  draw: (env, p, ph, el) => {
    const { ctx } = env;
    const L = layout(p);
    const A = artFor(env, 1);
    const absT = el.at + ph.local;
    const k = ease.out(clamp(ph.k));
    ctx.save();
    ctx.globalAlpha *= ph.alpha;
    // lumen
    ctx.save();
    ctx.globalAlpha *= 0.55 * k;
    ctx.beginPath();
    ctx.rect(L.x0, L.y0, L.lumenR - L.x0, L.h);
    paint(A, p.lumenColor ?? "#F3E6B8", { stroke: false });
    ctx.globalAlpha /= 0.55;
    ctx.globalAlpha *= 0.35;
    ctx.beginPath();
    ctx.rect(L.baso, L.y0, L.x0 + L.w - L.baso, L.h);
    paint(A, "tissue", { stroke: false });
    ctx.restore();
    // capillary
    const capTop = L.y0 + L.capW / 2, capBot = L.y0 + L.h - L.capW / 2;
    line(A, [[L.capX, capTop], [L.capX, capBot]], undefined, (L.capW + A.lw * 2) * k);
    line(A, [[L.capX, capTop], [L.capX, capBot]], p.bloodColor ?? "blood", L.capW * k);
    if (k >= 1) {
      for (let i = 0; i < 6; i++) {
        const s = (ph.local * 0.12 + i / 6) % 1;
        drawParticle(env, "rbc", L.capX + Math.sin(i * 2.1) * L.capW * 0.18, capTop + s * (capBot - capTop), L.capW * 0.42, Math.PI / 2, ph.local, i, undefined, ph.alpha * Math.sin(s * Math.PI));
      }
    }
    // cells
    const nucleusX = (L.apical + L.baso) / 2;
    for (const [i, c] of L.cells.entries()) {
      const ck = clamp(ph.k * 1.6 - i * 0.2);
      if (ck <= 0) continue;
      ctx.save();
      ctx.globalAlpha *= ck;
      const r = 26;
      ctx.beginPath();
      ctx.moveTo(L.apical + r, c.top);
      ctx.lineTo(L.baso - r, c.top);
      ctx.quadraticCurveTo(L.baso, c.top, L.baso, c.top + r);
      ctx.lineTo(L.baso, c.bot - r);
      ctx.quadraticCurveTo(L.baso, c.bot, L.baso - r, c.bot);
      ctx.lineTo(L.apical + r, c.bot);
      ctx.quadraticCurveTo(L.apical, c.bot, L.apical, c.bot - r);
      ctx.lineTo(L.apical, c.top + r);
      ctx.quadraticCurveTo(L.apical, c.top, L.apical + r, c.top);
      ctx.closePath();
      paint(A, p.cellColor ?? "cell", { strokeColor: "membrane", lw: 4 });
      // brush border (microvilli) on the apical side
      if (p.brushBorder !== false) {
        ctx.strokeStyle = A.c("membrane");
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        for (let y = c.top + 12; y < c.bot - 8; y += 11) {
          const wv = Math.sin(ph.local * 2 + y * 0.3) * 1.5;
          ctx.beginPath();
          ctx.moveTo(L.apical, y);
          ctx.lineTo(L.apical - 14 + wv, y);
          ctx.stroke();
        }
      }
      const cy = (c.top + c.bot) / 2;
      circle(A, nucleusX, cy + 10, Math.min(26, (c.bot - c.top) * 0.18), "nucleus", { alpha: 0.85 });
      // mitochondria fuel the pumps
      for (const [dx, dy] of [[-70, 38], [70, 40], [0, -44]]) {
        ctx.save();
        ctx.translate((L.apical + L.baso) / 2 + dx, cy + dy);
        ctx.rotate(dx * 0.02);
        ctx.fillStyle = A.c("mito");
        ctx.strokeStyle = A.outline;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(0, 0, 16, 7, 0, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }
    // tight junctions
    for (const jy of L.junctions) {
      ctx.save();
      ctx.globalAlpha *= k;
      ctx.fillStyle = A.c("ink");
      for (const dx of [6, 14, 22]) {
        ctx.beginPath();
        ctx.arc(L.apical + dx, jy, 3, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
    // region labels
    const lbl = (text: string, x: number, colorName: string) => {
      const b = layoutText(env, { text, x, y: L.y0 - 40, size: 22, align: "center", maxWidth: 240, maxLines: 1, weight: 700 });
      drawText(env, b, "center", clamp((ph.k - 0.3) / 0.7), colorName, ph.alpha);
    };
    lbl(p.lumenLabel ?? "Lumen", (L.x0 + L.lumenR) / 2, "ochre");
    lbl(p.cellLabel ?? "Epithelial cell", (L.apical + L.baso) / 2, "inkSoft");
    lbl(p.bloodLabel ?? "Blood", L.capX, "accent");
    // transporters
    const trs: any[] = Array.isArray(p.transporters) ? p.transporters : [];
    const seed = hash(el.id) % 300;
    trs.forEach((tr, i) => {
      const at = num(tr.at, el.at + 0.8 + i * 0.6);
      const lt = absT - at;
      if (lt < 0) return;
      const tk = ease.outBack(clamp(lt / 0.5));
      const side = tr.side ?? "apical";
      const list = trs.filter((t) => (t.side ?? "apical") === side);
      const x = side === "apical" ? L.apical : L.baso;
      const y = transporterY(L, tr, list.indexOf(tr), list.length);
      const kind = tr.kind ?? "cotransporter";
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(tk, tk);
      ctx.strokeStyle = A.outline;
      ctx.lineWidth = 2.5;
      if (kind === "pump") {
        ctx.fillStyle = A.c(tr.color ?? "accent");
        ctx.beginPath();
        ctx.arc(0, 0, 24, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.save();
        ctx.rotate(lt * 2.5);
        for (let j = 0; j < 3; j++) {
          ctx.rotate(TAU / 3);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(16, 0);
          ctx.strokeStyle = "rgba(255,255,255,0.8)";
          ctx.stroke();
        }
        ctx.restore();
        ctx.fillStyle = "#fff";
        ctx.font = `700 13px ${env.tokens.fonts.hand}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("ATP", 0, 1);
      } else if (kind === "channel") {
        ctx.fillStyle = A.c(tr.color ?? "indigo");
        for (const dy of [-16, 8]) {
          ctx.beginPath();
          ctx.roundRect(-11, dy, 22, 10, 4);
          ctx.fill();
          ctx.stroke();
        }
      } else if (kind === "exchanger") {
        ctx.fillStyle = A.c(tr.color ?? "teal");
        ctx.beginPath();
        ctx.ellipse(0, 0, 16, 26, 0, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = "#fff";
        ctx.beginPath();
        ctx.moveTo(-8, -10); ctx.lineTo(8, -10); ctx.lineTo(4, -14);
        ctx.moveTo(8, 10); ctx.lineTo(-8, 10); ctx.lineTo(-4, 14);
        ctx.stroke();
      } else {
        ctx.fillStyle = A.c(tr.color ?? "sage");
        ctx.beginPath();
        ctx.roundRect(-14, -26, 28, 52, 10);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, -20);
        ctx.lineTo(0, 20);
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.stroke();
      }
      ctx.restore();
      // cargo moving through (toward blood unless told otherwise; an exchanger's second cargo goes the other way)
      const carries: string[] = (Array.isArray(tr.carries) ? tr.carries : []).slice(0, 3).map(String);
      const towardBlood = (tr.toward ?? "blood") === "blood";
      carries.forEach((tok, j) => {
        // exchangers and the Na+/K+ pump move their second cargo the opposite way (3 Na+ out, 2 K+ in)
        const dir = ((kind === "exchanger" || kind === "pump") && j === 1 ? !towardBlood : towardBlood) ? 1 : -1;
        const lane = carries.length > 1 ? (j - (carries.length - 1) / 2) * 20 : 0;
        for (let m = 0; m < 3; m++) {
          const s = (lt * num(tr.speed, 0.45) + m / 3 + j * 0.17) % 1;
          if (lt < 0.5) continue;
          const px = x - dir * 80 + dir * s * 160;
          bead(env, tok, px, y + lane, 22, lt, seed + i * 7 + j, ph.alpha * Math.sin(s * Math.PI));
        }
      });
      if (typeof tr.label === "string" && tr.label) {
        const inward = side === "apical" ? 1 : -1;
        const b = layoutText(env, { text: tr.label, x: x + inward * 100, y: y - 54, size: 19, align: "center", maxWidth: 165, maxLines: 2 });
        drawText(env, b, "center", clamp((lt - 0.3) / 0.6), "ink", ph.alpha);
      }
    });
    // paracellular route through the junction
    const para = p.paracellular;
    if (para && L.junctions.length) {
      const lt = absT - num(para.at, el.at + 1);
      if (lt > 0) {
        const toward = (para.toward ?? "blood") === "blood" ? 1 : -1;
        const jy = L.junctions[0];
        for (let m = 0; m < 4; m++) {
          const s = (lt * 0.35 + m / 4) % 1;
          const px = toward > 0 ? L.apical - 40 + s * (L.baso - L.apical + 80) : L.baso + 40 - s * (L.baso - L.apical + 80);
          bead(env, String(para.kind ?? "water"), px, jy, 18, lt, m, ph.alpha * Math.sin(s * Math.PI));
        }
      }
    }
    ctx.restore();
  },
};
