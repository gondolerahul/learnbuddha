// Surface textures for the drawing treatments: seeded tiles, generated once per kit and reused as patterns.
//   chalk       pits where the chalk skipped the board (applied with destination-out on a prop's own layer)
//   granulation watercolour pigment settling in the paper's tooth
//   halftone    print dots for comic shading
//   fibre       paper fibres (cut paper, rice paper)
import type { Env } from "../types";
import { hash, rng } from "../util";

const tiles = new Map<string, any>();

export function textureTile(env: Env, kind: string): any {
  const key = `${kind}`;
  const hit = tiles.get(key);
  if (hit) return hit;
  const size = kind === "halftone" ? 12 : kind === "fibre" ? 220 : 160;
  const c = env.makeCanvas(size, size);
  const g = c.getContext("2d");
  const r = rng(hash("tex:" + kind));
  if (kind === "chalk") {
    for (let i = 0; i < 900; i++) {
      g.globalAlpha = 0.25 + r() * 0.75;
      g.fillStyle = "#000";
      const rr = 0.4 + r() ** 3 * 1.8;
      g.beginPath();
      g.arc(r() * size, r() * size, rr, 0, Math.PI * 2);
      g.fill();
    }
    // a few long skips along the stroke direction
    g.globalAlpha = 0.5;
    g.strokeStyle = "#000";
    for (let i = 0; i < 18; i++) {
      const x = r() * size, y = r() * size;
      g.lineWidth = 0.6 + r();
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 6 + r() * 14, y + (r() - 0.5) * 3);
      g.stroke();
    }
  } else if (kind === "granulation") {
    for (let i = 0; i < 1400; i++) {
      const dark = r() < 0.6;
      g.globalAlpha = (dark ? 0.08 : 0.12) + r() * 0.18;
      g.fillStyle = dark ? "#3A2A1A" : "#FFFFFF";
      const x = r() * size, y = r() * size;
      g.beginPath();
      g.arc(x, y, 0.5 + r() * 1.4, 0, Math.PI * 2);
      g.fill();
    }
  } else if (kind === "halftone") {
    g.fillStyle = "#000";
    g.beginPath();
    g.arc(size / 2, size / 2, 2.3, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(0, 0, 2.3, 0, Math.PI * 2);
    g.arc(size, 0, 2.3, 0, Math.PI * 2);
    g.arc(0, size, 2.3, 0, Math.PI * 2);
    g.arc(size, size, 2.3, 0, Math.PI * 2);
    g.fill();
  } else if (kind === "riso") {
    // riso stock and ink: fine speckle of black and the drums' colours, never even
    const inks = ["#201E22", "#FF48B0", "#0078BF", "#201E22"];
    for (let i = 0; i < 1600; i++) {
      g.globalAlpha = 0.05 + r() * 0.12;
      g.fillStyle = inks[Math.floor(r() * inks.length)];
      g.beginPath();
      g.arc(r() * size, r() * size, 0.35 + r() ** 4 * 1.1, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 0.18;
    g.fillStyle = "#FFFFFF";
    for (let i = 0; i < 260; i++) {
      g.beginPath();
      g.arc(r() * size, r() * size, 0.3 + r() * 0.9, 0, Math.PI * 2);
      g.fill();
    }
  } else if (kind === "fibre") {
    g.lineCap = "round";
    for (let i = 0; i < 260; i++) {
      const x = r() * size, y = r() * size, a = r() * Math.PI * 2, l = 6 + r() * 22;
      g.globalAlpha = 0.08 + r() * 0.16;
      g.strokeStyle = r() < 0.5 ? "#5A4630" : "#FFFFFF";
      g.lineWidth = 0.5 + r() * 0.8;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
  }
  tiles.set(key, c);
  return c;
}

/** Apply the kit's texture to an isolated layer (a prop, or a cached backdrop) covering [0,0,w,h]. */
export function applyTexture(env: Env, g: any, w: number, h: number, kind: string | undefined, strength = 1) {
  if (!kind || kind === "none") return;
  const tile = textureTile(env, kind);
  const pat = g.createPattern(tile, "repeat");
  if (!pat) return;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (kind === "chalk") {
    g.globalCompositeOperation = "destination-out";
    g.globalAlpha = 0.5 * strength;
  } else {
    g.globalCompositeOperation = "source-atop";
    g.globalAlpha = (kind === "halftone" ? 0.2 : kind === "granulation" ? 0.55 : kind === "riso" ? 0.9 : 0.3) * strength;
  }
  g.fillStyle = pat;
  g.fillRect(0, 0, w, h);
  g.restore();
}
