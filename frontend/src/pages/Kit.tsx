// Style Kit gallery: the same deterministic renderer the workers use, running live in the browser.
// Scrub any golden scene (or any produced scene by id) frame-exactly.
import { useEffect, useRef, useState } from "react";
import { KITS, kitTokens, lintScene, renderScene, type SceneSpec } from "@kit/src/index";
import { fontsReady } from "../lib/fonts";
import { api } from "../lib/api";

const golden = import.meta.glob("@kit/stylekit/zen-board-v1/golden/*.json", { eager: true, import: "default" }) as Record<string, SceneSpec>;
const makeCanvas = (w: number, h: number) => Object.assign(document.createElement("canvas"), { width: w, height: h });

export default function KitPage() {
  const names = Object.keys(golden).sort();
  const [name, setName] = useState(names[0]);
  const [spec, setSpec] = useState<SceneSpec | null>(golden[names[0]] ?? null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [kit, setKit] = useState("zen-board-v1");
  const [sceneId, setSceneId] = useState("");
  const [issues, setIssues] = useState<{ id: string; message: string }[]>([]);
  const [ready, setReady] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    fontsReady.then(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!spec || !ready) return;
    const c = canvas.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr);
    const h = Math.round((w * 9) / 16);
    if (c.width !== w) { c.width = w; c.height = h; }
    const ctx = c.getContext("2d")!;
    renderScene(ctx, { ...spec, kit }, t, { tokens: kitTokens(kit), makeCanvas, width: w, height: h });
  }, [spec, t, kit, ready]);

  useEffect(() => {
    if (!spec || !ready) return;
    const c = makeCanvas(1280, 720);
    setIssues(lintScene(c.getContext("2d")!, spec, { tokens: kitTokens(kit), makeCanvas }));
  }, [spec, kit, ready]);

  useEffect(() => {
    if (!playing || !spec) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      setT((x) => {
        const n = x + (now - last) / 1000;
        return n >= spec.duration ? 0 : n;
      });
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, spec]);

  async function loadScene() {
    try {
      const s = await api.scene(sceneId.trim());
      if (s.spec?.elements) {
        setSpec(s.spec);
        setName("");
        setT(0);
      }
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <main className="page">
      <section className="hero">
        <h1>Style Kit · Zen Board v1</h1>
        <p className="lede">
          Every lesson and every answer is drawn by one deterministic function, <code>renderScene(ctx, spec, t)</code>. This page runs
          it in your browser. The render workers run the same code in Node, which is how an answer can open on the exact frame you paused.
        </p>
      </section>
      <div className="chips" style={{ marginBottom: 12 }}>
        {names.map((n) => (
          <button key={n} className={`chip ${n === name ? "on" : ""}`} onClick={() => { setName(n); setSpec(golden[n]); setKit(golden[n].kit ?? "zen-board-v1"); setT(0); }}>
            {n.split("/").pop()!.replace(".json", "")}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        {Object.values(KITS).map((k) => (
          <button key={k.id} className={`chip ${kit === k.id ? "on" : ""}`} onClick={() => setKit(k.id)}>{k.name}</button>
        ))}
      </div>
      <canvas ref={canvas} className="kit-canvas" />
      <div className="controls">
        <button className="icon-btn" onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"}>{playing ? "❚❚" : "▶"}</button>
        <input className="timeline" type="range" min={0} max={spec?.duration ?? 1} step={1 / 30} value={t} onChange={(e) => { setPlaying(false); setT(+e.target.value); }} aria-label="Scrub" />
        <span className="small muted">{t.toFixed(2)}s / {spec?.duration.toFixed(1)}s</span>
      </div>
      <div className="card" style={{ padding: 14, display: "grid", gap: 10 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="input" placeholder="Load a produced scene by id" value={sceneId} onChange={(e) => setSceneId(e.target.value)} />
          <button className="btn" onClick={loadScene} disabled={!sceneId.trim()}>Load</button>
        </div>
        <div className="small">
          <b>Layout lint:</b> {issues.length === 0 ? <span className="muted">no issues</span> : (
            <ul style={{ margin: "4px 0 0" }}>{issues.map((i, k) => <li key={k}><code>{i.id}</code> {i.message}</li>)}</ul>
          )}
        </div>
      </div>
    </main>
  );
}
