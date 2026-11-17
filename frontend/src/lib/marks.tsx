// Instant visual answers: when the tutor points at something on the paused frame (point_at), draw a circle, arrow or
// underline around it straight away, with the tutor's short label. The box comes from the same renderer that drew
// the video, at the paused moment and through the same camera, so the mark lands on the drawing.
import { elementScreenBox, kitTokens, type SceneSpec } from "@kit/src/index";
import { api } from "./api";
import type { ServerMsg } from "./stream";

export interface Mark {
  key: number;
  box: { x: number; y: number; w: number; h: number };
  mark: "circle" | "arrow" | "underline";
  label: string;
}

const W = 1280, H = 720;
const specs = new Map<string, Promise<SceneSpec | null>>();
let seq = 0;

function specOf(sceneId: string): Promise<SceneSpec | null> {
  let p = specs.get(sceneId);
  if (!p) {
    p = api.scene(sceneId).then((r) => (r?.spec?.elements ? (r.spec as SceneSpec) : null)).catch(() => null);
    specs.set(sceneId, p);
  }
  return p;
}

export async function markFor(m: ServerMsg): Promise<Mark | null> {
  const spec = await specOf(m.scene_id);
  if (!spec) return null;
  const makeCanvas = (w: number, h: number) => Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = makeCanvas(W, H).getContext("2d") as any;
  const box = elementScreenBox(ctx, spec, String(m.target), Number(m.t) || 0, { tokens: kitTokens(spec.kit), makeCanvas });
  if (!box || box.w <= 0 || box.h <= 0) return null;
  const mark = ["circle", "arrow", "underline"].includes(m.mark) ? m.mark : "circle";
  return { key: ++seq, box, mark, label: String(m.label || "").slice(0, 60) };
}

/** The marks, drawn on in the order the tutor made them, over the paused video (same 16:9 box). */
export function MarksOverlay({ marks }: { marks: Mark[] }) {
  if (!marks.length) return null;
  return (
    <svg className="tutor-marks" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {marks.map((m) => <OneMark key={m.key} m={m} />)}
    </svg>
  );
}

function OneMark({ m }: { m: Mark }) {
  const { x, y, w, h } = m.box;
  const cx = Math.max(0, Math.min(W, x + w / 2)), cy = Math.max(0, Math.min(H, y + h / 2));
  let shape: JSX.Element;
  let lx = cx, ly: number;
  if (m.mark === "underline") {
    const yy = Math.min(H - 12, y + h + 10);
    shape = <path className="draw" pathLength={1} d={`M ${x - 6} ${yy} Q ${cx} ${yy + 9} ${x + w + 6} ${yy - 2}`} />;
    ly = Math.min(H - 20, yy + 38);
  } else if (m.mark === "arrow") {
    // come in from the side with more room, ending just short of the element
    const fromLeft = cx > W / 2;
    const sx = fromLeft ? Math.max(40, x - 170) : Math.min(W - 40, x + w + 170);
    const below = cy < H * 0.35; // near the top: come up from below, so the arrow and its label stay in frame
    const sy = below ? Math.min(H - 40, cy + 110) : Math.max(40, cy - 90);
    const ex = fromLeft ? x - 8 : x + w + 8, ey = cy;
    const a = Math.atan2(ey - sy, ex - sx);
    const head = (s: number) => `${ex - 22 * Math.cos(a + s)} ${ey - 22 * Math.sin(a + s)}`;
    shape = (
      <g>
        <path className="draw" pathLength={1} d={`M ${sx} ${sy} Q ${(sx + ex) / 2} ${sy} ${ex} ${ey}`} />
        <path className="draw late" pathLength={1} d={`M ${head(0.45)} L ${ex} ${ey} L ${head(-0.45)}`} />
      </g>
    );
    lx = sx;
    ly = below ? Math.min(H - 14, sy + 36) : sy - 18;
  } else {
    const rx = w / 2 + 18, ry = h / 2 + 14;
    // a hand-drawn loop: slightly more than a full turn, starting top-left
    shape = <path className="draw" pathLength={1} d={`M ${cx - rx * 0.7} ${cy - ry * 0.72} A ${rx} ${ry} 0 1 1 ${cx - rx * 0.86} ${cy - ry * 0.4}`} />;
    ly = cy - ry - 16 > 30 ? cy - ry - 16 : cy + ry + 38;
  }
  return (
    <g>
      {shape}
      {m.label && <text className="mark-label" x={Math.max(90, Math.min(W - 90, lx))} y={ly} textAnchor="middle">{m.label}</text>}
    </g>
  );
}
