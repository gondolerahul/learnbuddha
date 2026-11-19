// Node CLI for the render workers.
//   frames  --spec f.json [--width 1280 --height 720 --fps 30] [--workers N] [--tcp host:port]  → raw RGBA frames, in order
//   still   --spec f.json --t 3.2 --out frame.png [--width --height]
//   lint    --spec f.json                                       → JSON issues on stdout
//   visible --spec f.json --t 3.2                               → JSON list of on-screen text
//   info                                                         → kits + component names
//   selftest [--out dir]                                         → stills + lint for golden scenes
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import fs from "node:fs";
import net from "node:net";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMPONENTS, KITS, kitTokens, lintScene, renderScene, RETIRED_KITS, visibleText } from "./index";
import { PROPS } from "./art/props";
import { fixScene } from "./autofix";
import type { Ctx, SceneSpec } from "./types";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");

function registerFonts() {
  const roots = [path.join(pkgRoot, "node_modules"), path.join(pkgRoot, "..", "node_modules")];
  const find = (pkg: string) => roots.map((r) => path.join(r, "@fontsource", pkg, "files")).find((p) => fs.existsSync(p));
  const reg = (pkg: string, files: string[], alias: string) => {
    const dir = find(pkg);
    if (!dir) throw new Error(`font package @fontsource/${pkg} not installed`);
    for (const f of files) GlobalFonts.registerFromPath(path.join(dir, f), alias);
  };
  for (const [pkg, files, alias] of FONT_FACES) reg(pkg, files, alias);
}

/** Every face a kit may name (all SIL Open Font License, from @fontsource). Mirrored in frontend/src/lib/fonts.ts. */
export const FONT_FACES: [string, string[], string][] = [
  ["kalam", ["kalam-latin-400-normal.woff2", "kalam-latin-ext-400-normal.woff2", "kalam-latin-700-normal.woff2", "kalam-latin-ext-700-normal.woff2"], "LB Hand"],
  ["source-serif-4", ["source-serif-4-latin-400-normal.woff2", "source-serif-4-latin-ext-400-normal.woff2", "source-serif-4-greek-400-normal.woff2", "source-serif-4-latin-600-normal.woff2"], "LB Serif"],
  ["noto-sans-math", ["noto-sans-math-latin-400-normal.woff2"], "LB Math"],
  ["caveat", ["caveat-latin-400-normal.woff2", "caveat-latin-600-normal.woff2", "caveat-latin-700-normal.woff2"], "LB Caveat"],
  ["lora", ["lora-latin-400-normal.woff2", "lora-latin-600-normal.woff2", "lora-latin-700-normal.woff2"], "LB Lora"],
  ["lora", ["lora-latin-400-italic.woff2", "lora-latin-600-italic.woff2"], "LB Lora Italic"],
  ["poppins", ["poppins-latin-400-normal.woff2", "poppins-latin-500-normal.woff2", "poppins-latin-600-normal.woff2", "poppins-latin-700-normal.woff2", "poppins-latin-800-normal.woff2"], "LB Poppins"],
  ["fredoka", ["fredoka-latin-400-normal.woff2", "fredoka-latin-500-normal.woff2", "fredoka-latin-600-normal.woff2", "fredoka-latin-700-normal.woff2"], "LB Fredoka"],
  ["space-grotesk", ["space-grotesk-latin-400-normal.woff2", "space-grotesk-latin-500-normal.woff2", "space-grotesk-latin-700-normal.woff2"], "LB Grotesk"],
  ["jetbrains-mono", ["jetbrains-mono-latin-400-normal.woff2", "jetbrains-mono-latin-700-normal.woff2"], "LB Mono"],
  ["fredericka-the-great", ["fredericka-the-great-latin-400-normal.woff2"], "LB Chalk"],
  ["patrick-hand", ["patrick-hand-latin-400-normal.woff2"], "LB Patrick"],
  ["architects-daughter", ["architects-daughter-latin-400-normal.woff2"], "LB Architect"],
  ["archivo-black", ["archivo-black-latin-400-normal.woff2"], "LB Archivo"],
  ["courier-prime", ["courier-prime-latin-400-normal.woff2", "courier-prime-latin-700-normal.woff2"], "LB Courier"],
  ["inter", ["inter-latin-400-normal.woff2", "inter-latin-500-normal.woff2", "inter-latin-600-normal.woff2", "inter-latin-700-normal.woff2"], "LB Inter"],
];

function args(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[k] = v;
    }
  }
  return out;
}

function readSpec(p: string | undefined): SceneSpec {
  if (!p) throw new Error("--spec is required");
  const raw = p === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(p, "utf8");
  const spec = JSON.parse(raw) as SceneSpec;
  if (!Array.isArray(spec.elements)) throw new Error("spec.elements must be an array");
  if (typeof spec.duration !== "number" || spec.duration <= 0) throw new Error("spec.duration must be > 0");
  return spec;
}

const makeCanvas = (w: number, h: number) => createCanvas(w, h);

async function connectRetry(host: string, port: number, tries = 100): Promise<net.Socket> {
  for (let i = 0; i < tries; i++) {
    try {
      return await new Promise<net.Socket>((resolve, reject) => {
        const s = net.connect(port, host);
        s.once("connect", () => resolve(s));
        s.once("error", reject);
      });
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error(`could not connect to ${host}:${port}`);
}

async function writeAll(buf: Uint8Array) {
  if (!process.stdout.write(buf)) await new Promise<void>((r) => process.stdout.once("drain", () => r()));
}

/**
 * A render thread: draws every Nth frame of the range and hands each one back without copying it again.
 * It may run at most AHEAD frames ahead of what the main thread has written, so memory stays bounded.
 */
const AHEAD = 3;
async function renderWorker() {
  const d = workerData as { spec: SceneSpec; fps: number; width: number; height: number; from: number; to: number; index: number; count: number };
  registerFonts();
  const tokens = kitTokens(d.spec.kit);
  const canvas = createCanvas(d.width, d.height);
  const ctx = canvas.getContext("2d") as unknown as Ctx;
  const opts = { tokens, makeCanvas, width: d.width, height: d.height, fps: d.fps };
  let credits = AHEAD;
  let wake: (() => void) | null = null;
  parentPort!.on("message", (m) => {
    if (m === "credit") {
      credits++;
      const w = wake;
      wake = null;
      w?.();
    }
  });
  for (let i = d.from + d.index; i < d.to; i += d.count) {
    while (credits <= 0) await new Promise<void>((r) => (wake = r));
    credits--;
    renderScene(ctx, d.spec, i / d.fps, opts);
    const px = canvas.data();
    const buf = new Uint8Array(px.byteLength);
    buf.set(px);
    parentPort!.postMessage({ i, buf }, [buf.buffer]);
  }
}

/** Render [from, to) on `count` threads and deliver the frames to `sink` strictly in order. */
async function renderParallel(spec: SceneSpec, fps: number, width: number, height: number, from: number, to: number, count: number, sink: (b: Uint8Array) => Promise<void>, progress: boolean) {
  const self = fileURLToPath(import.meta.url);
  const workers = Array.from({ length: count }, (_, index) => new Worker(self, { workerData: { spec, fps, width, height, from, to, index, count } }));
  const pending = new Map<number, Uint8Array>();
  let next = from;
  let failed: Error | null = null;
  let notify: (() => void) | null = null;
  const poke = () => {
    const n = notify;
    notify = null;
    n?.();
  };
  for (const w of workers) {
    w.on("message", (m: { i: number; buf: Uint8Array }) => {
      pending.set(m.i, m.buf);
      poke();
    });
    w.on("error", (e) => {
      failed = e as Error;
      poke();
    });
    w.on("exit", (code) => {
      if (code !== 0 && !failed) failed = new Error(`render thread exited with code ${code}`);
      poke();
    });
  }
  try {
    while (next < to) {
      if (failed) throw failed;
      const buf = pending.get(next);
      if (!buf) {
        await new Promise<void>((r) => (notify = r));
        continue;
      }
      pending.delete(next);
      await sink(buf);
      workers[(next - from) % count].postMessage("credit");
      if (progress && next % 15 === 0) process.stderr.write(`progress ${((next - from) / Math.max(1, to - from)).toFixed(3)}\n`);
      next++;
    }
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
  }
}

async function main() {
  if (!isMainThread) return renderWorker();
  const [cmd, ...rest] = process.argv.slice(2);
  const a = args(rest);
  registerFonts();
  if (cmd === "props") {
    // The illustration catalog for the scene writer: kind → group, aspect and named anchors.
    const out: Record<string, any> = {};
    for (const [k, d] of Object.entries(PROPS)) out[k] = { group: d.group, aspect: d.aspect, anchors: Object.keys(d.anchors ?? {}) };
    process.stdout.write(JSON.stringify(out, null, 1) + "\n");
    return;
  }
  if (cmd === "info") {
    process.stdout.write(JSON.stringify({ kits: Object.keys(KITS), components: Object.keys(COMPONENTS) }) + "\n");
    return;
  }
  if (cmd === "selftest") {
    const out = a.out ?? path.join(pkgRoot, "out");
    fs.mkdirSync(out, { recursive: true });
    const dir = path.join(pkgRoot, "stylekit", "zen-board-v1", "golden");
    let bad = 0;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const spec = readSpec(path.join(dir, f));
      const tokens = kitTokens(spec.kit);
      const c = createCanvas(tokens.canvas.width, tokens.canvas.height);
      const ctx = c.getContext("2d") as unknown as Ctx;
      const issues = lintScene(ctx, spec, { tokens, makeCanvas });
      if (issues.length) bad++;
      console.log(`${f}: ${issues.length ? issues.map((i) => `\n  - [${i.id}] ${i.message}`).join("") : "ok"}`);
      for (const t of [spec.duration * 0.3, spec.duration * 0.7, spec.duration - 0.1]) {
        renderScene(ctx, spec, t, { tokens, makeCanvas });
        fs.writeFileSync(path.join(out, `${f.replace(".json", "")}-${t.toFixed(1)}.png`), c.toBuffer("image/png"));
      }
    }
    process.exitCode = bad ? 1 : 0;
    return;
  }
  const spec = readSpec(a.spec);
  const tokens = kitTokens(spec.kit);
  const width = parseInt(a.width ?? String(tokens.canvas.width), 10);
  const height = parseInt(a.height ?? String(tokens.canvas.height), 10);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d") as unknown as Ctx;
  const opts = { tokens, makeCanvas, width, height };

  if (cmd === "lint") {
    const lc = createCanvas(tokens.canvas.width, tokens.canvas.height);
    const issues = lintScene(lc.getContext("2d") as unknown as Ctx, spec, { tokens, makeCanvas });
    process.stdout.write(JSON.stringify({ issues }) + "\n");
    return;
  }
  if (cmd === "fix") {
    const lc = createCanvas(tokens.canvas.width, tokens.canvas.height);
    const res = fixScene(lc.getContext("2d") as unknown as Ctx, spec, { tokens, makeCanvas });
    process.stdout.write(JSON.stringify(res) + "\n");
    return;
  }
  if (cmd === "sheet") {
    // A contact sheet for the style lab: one row per kit, one column per moment.
    //   sheet --spec f.json [--kits a,b] [--times 1,4,9] [--scale 0.3] --out sheet.png
    const kits = (a.kits ? a.kits.split(",") : Object.keys(KITS).filter((k) => !RETIRED_KITS.has(k) && k !== "zen-board-hc-v1"));
    const times = a.times ? a.times.split(",").map(Number) : [0.15, 0.35, 0.55, 0.75, 0.95].map((f) => +(spec.duration * f).toFixed(2));
    const scale = parseFloat(a.scale ?? "0.3");
    const cw = Math.round(1280 * scale), ch = Math.round(720 * scale), gap = 4, head = 22;
    const sheet = createCanvas(times.length * (cw + gap) + gap, kits.length * (ch + gap + head) + gap);
    const sg = sheet.getContext("2d") as unknown as Ctx;
    sg.fillStyle = "#FFFFFF";
    sg.fillRect(0, 0, sheet.width, sheet.height);
    const full = createCanvas(1280, 720);
    const fg = full.getContext("2d") as unknown as Ctx;
    kits.forEach((k, row) => {
      const tk = kitTokens(k);
      const s = JSON.parse(JSON.stringify({ ...spec, kit: k }));
      const y0 = gap + row * (ch + gap + head);
      sg.fillStyle = "#222";
      sg.font = "600 14px sans-serif";
      sg.fillText(`${tk.name}  (${k})`, gap + 2, y0 + 15);
      times.forEach((t, col) => {
        renderScene(fg, s, t, { tokens: tk, makeCanvas, width: 1280, height: 720, fps: 24 });
        fg.getImageData(0, 0, 1, 1); // force the deferred draw before the canvas is reused
        sg.drawImage(full as any, gap + col * (cw + gap), y0 + head, cw, ch);
        sg.fillStyle = "rgba(0,0,0,0.55)";
        sg.fillRect(gap + col * (cw + gap), y0 + head, 44, 16);
        sg.fillStyle = "#fff";
        sg.font = "11px sans-serif";
        sg.fillText(`${t.toFixed(1)}s`, gap + col * (cw + gap) + 4, y0 + head + 12);
      });
    });
    fs.writeFileSync(a.out ?? "sheet.png", a.out?.endsWith(".jpg") ? sheet.toBuffer("image/jpeg", 86) : sheet.toBuffer("image/png"));
    return;
  }
  if (cmd === "visible") {
    process.stdout.write(JSON.stringify(visibleText(spec, parseFloat(a.t ?? "0"))) + "\n");
    return;
  }
  if (cmd === "still") {
    renderScene(ctx, spec, parseFloat(a.t ?? "0"), opts);
    const buf = a.out?.endsWith(".jpg") ? canvas.toBuffer("image/jpeg", 88) : canvas.toBuffer("image/png");
    if (a.out) fs.writeFileSync(a.out, buf);
    else await writeAll(buf);
    return;
  }
  if (cmd === "frames") {
    const fps = parseFloat(a.fps ?? "30");
    const total = Math.round(spec.duration * fps);
    const from = Math.round(parseFloat(a.from ?? "0") * fps);
    const to = a.to ? Math.min(total, Math.round(parseFloat(a.to) * fps)) : total;
    // Windows pipes are slow for ~3.6 MB frames; `--tcp host:port` streams straight
    // into an ffmpeg `tcp://...?listen=1` input instead of stdout.
    let sink: (b: Uint8Array) => Promise<void> = writeAll;
    let sock: net.Socket | null = null;
    if (a.tcp) {
      const [host, port] = a.tcp.split(":");
      sock = await connectRetry(host, parseInt(port, 10));
      const s = sock;
      sink = async (b) => {
        if (!s.write(b)) await new Promise<void>((r) => s.once("drain", () => r()));
      };
    }
    const threads = Math.max(1, Math.min(16, parseInt(a.workers ?? "1", 10) || 1));
    if (threads > 1 && to - from > threads) {
      await renderParallel(spec, fps, width, height, from, to, threads, sink, !!a.progress);
    } else {
      for (let i = from; i < to; i++) {
        renderScene(ctx, spec, i / fps, { ...opts, fps });
        // Opaque frames, so premultiplied RGBA == straight RGBA; data() avoids an unpremultiply copy.
        await sink(canvas.data());
        if (a.progress && i % 15 === 0) process.stderr.write(`progress ${((i - from) / Math.max(1, to - from)).toFixed(3)}\n`);
      }
    }
    if (sock) await new Promise<void>((r) => sock!.end(() => r()));
    return;
  }
  throw new Error(`unknown command '${cmd}'`);
}

main().catch((e) => {
  process.stderr.write(`renderer error: ${e?.stack ?? e}\n`);
  process.exit(2);
});
