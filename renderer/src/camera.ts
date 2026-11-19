// The camera operator. The scene writer names shots ("a close shot on the synaptic cleft, pushing in") and this
// module frames them: it finds what the shot is about (an element, an anchor, a few of them, and the labels that
// point at them), sizes the frame to the shot, keeps the view inside the set, and eases the move.
//
// Moves (key.move):
//   cut      the frame jumps on the cue (a new set-up)
//   push     a slow, eased move in (or to any framing): "look here"
//   pull     the same toward a wider framing: reveal, context
//   pan      a sideways move at the same size: follow what flows
//   follow   pan from the first target to the last over the shot (a journey, a flow)
//   whip     a very fast pan with motion blur, to the next thing
//   through  a dive into the target until it fills the frame (the next beat starts inside it)
//   hold     no move: a rest; the camera is dead still
// Shot sizes (key.shot): wide (the whole set) · medium · close · detail.
//
// Zoom is eased in log space, so a push feels the same speed from 1× to 2× as from 2× to 4×. Rests are still: the
// kit's handheld drift (if any) only runs while the camera is moving or on a handheld kit.
// Ideas from the films studied for this rebuild (onetake, opus-js-animations): log-space zoom, rests that are dead
// still, and motion blur for fast moves. The code is LearnBuddha's own.
import type { CameraKey, Rect, SceneElement, SceneSpec, Tokens } from "./types";

export type ShotSize = "wide" | "medium" | "close" | "detail";
export type Move = "cut" | "push" | "pull" | "pan" | "follow" | "whip" | "through" | "hold";

export interface NamedShot {
  t: number;
  shot?: ShotSize;
  /** what the shot is about: an element id, "id.anchor", [x, y], or a list of them */
  on?: any;
  move?: Move;
  dur?: number;
  focus?: number | null;
  dof?: number | null;
  /** a decaying shake on the cue (px) */
  shake?: number;
  x?: number;
  y?: number;
  zoom?: number;
}

export const MOVE_DUR: Record<Move, number> = { cut: 0, push: 2.4, pull: 2.2, pan: 1.8, follow: 3.0, whip: 0.42, through: 1.1, hold: 0 };

const SIZE_FILL: Record<ShotSize, number> = { wide: 1, medium: 0.68, close: 0.8, detail: 0.86 };
const SIZE_ZOOM: Record<ShotSize, [number, number]> = { wide: [1, 1], medium: [1.15, 1.75], close: [1.5, 2.4], detail: [2.0, 3.0] };

/** smootherstep: zero velocity and acceleration at both ends (an operated move that settles). */
export const settle = (k: number) => {
  k = Math.min(1, Math.max(0, k));
  return k * k * k * (k * (k * 6 - 15) + 10);
};
const expoInOut = (k: number) => {
  k = Math.min(1, Math.max(0, k));
  if (k === 0 || k === 1) return k;
  return k < 0.5 ? Math.pow(2, 20 * k - 10) / 2 : (2 - Math.pow(2, -20 * k + 10)) / 2;
};
const easeInCubic = (k: number) => {
  k = Math.min(1, Math.max(0, k));
  return k * k * k;
};

export function moveEase(move: string | undefined): (k: number) => number {
  switch (move) {
    case "whip":
      return expoInOut;
    case "through":
      return easeInCubic;
    case "cut":
      return (k) => (k > 0 ? 1 : 0);
    default:
      return settle;
  }
}

function isNamed(k: any): boolean {
  return !(typeof k?.x === "number" && typeof k?.y === "number" && typeof k?.zoom === "number");
}

/** Boxes of what a shot is about. */
function targetRects(env: any, spec: SceneSpec, on: any): Rect[] {
  const list = Array.isArray(on) && !(on.length === 2 && typeof on[0] === "number") ? on : on === undefined || on === null ? [] : [on];
  const out: Rect[] = [];
  for (const ref of list) {
    if (Array.isArray(ref) && typeof ref[0] === "number") {
      out.push({ x: ref[0] - 40, y: ref[1] - 40, w: 80, h: 80 });
      continue;
    }
    if (typeof ref !== "string" || !ref) continue;
    const dot = ref.indexOf(".");
    if (dot > 0) {
      const p = env.pointOf(ref);
      if (p) {
        out.push({ x: p[0] - 50, y: p[1] - 50, w: 100, h: 100 });
        continue;
      }
    }
    const r = env.boundsOf(ref.split(".")[0]);
    if (r) out.push(r);
  }
  return out;
}

function union(rs: Rect[]): Rect | null {
  if (!rs.length) return null;
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Labels and callouts pointing at the shot's subject, on screen during the shot: they must be in it too. */
function attachedText(spec: SceneSpec, env: any, on: any, t0: number, t1: number): Rect[] {
  const ids = new Set<string>();
  const list = Array.isArray(on) ? on : [on];
  for (const r of list) if (typeof r === "string") ids.add(r.split(".")[0]);
  const out: Rect[] = [];
  for (const el of spec.elements) {
    if (!["Label", "Callout", "Text"].includes(el.type)) continue;
    const until = typeof el.until === "number" ? el.until : spec.duration;
    if (el.at > t1 || until < t0) continue;
    const tgt = String(el.props?.target ?? el.props?.pointAt ?? "").split(".")[0];
    if (!tgt || !ids.has(tgt)) continue;
    const r = env.boundsOf(el.id);
    if (r) out.push(r);
  }
  // a set's own labels shown during the shot
  for (const id of ids) {
    const el = spec.elements.find((e) => e.id === id);
    const comp = el ? env.componentOf?.(el.type) : null;
    if (el && comp?.labelRects) out.push(...comp.labelRects(env, el.props ?? {}, el, t0, t1));
  }
  return out;
}

/** Frame a box at a shot size: the zoom and the centre, kept inside the set. */
export function frameBox(box: Rect | null, size: ShotSize, W: number, H: number, world?: Rect): { x: number; y: number; zoom: number } {
  const wx0 = world ? Math.min(0, world.x) : 0, wy0 = world ? Math.min(0, world.y) : 0;
  const wx1 = world ? Math.max(W, world.x + world.w) : W, wy1 = world ? Math.max(H, world.y + world.h) : H;
  if (!box || size === "wide") {
    // a wide shot shows the frame; on a set larger than the frame, it centres on the subject at zoom 1
    if (!box || (wx0 === 0 && wx1 === W && wy0 === 0 && wy1 === H)) return { x: W / 2, y: H / 2, zoom: 1 };
    return { x: Math.min(wx1 - W / 2, Math.max(wx0 + W / 2, box.x + box.w / 2)), y: Math.min(wy1 - H / 2, Math.max(wy0 + H / 2, box.y + box.h / 2)), zoom: 1 };
  }
  const fill = SIZE_FILL[size];
  const [zmin, zmax] = SIZE_ZOOM[size];
  // headroom for labels and the frame margin
  const bw = Math.max(80, box.w + 48), bh = Math.max(60, box.h + 40);
  let zoom = Math.min((W * fill) / bw, (H * fill) / bh);
  zoom = Math.max(zmin, Math.min(zmax, zoom));
  // if the subject does not fit at this size, take the largest zoom that shows it all (never below 1)
  const fitAll = Math.min(W / (box.w + 32), H / (box.h + 28));
  if (fitAll < zoom) zoom = Math.max(1, fitAll);
  const hw = W / (2 * zoom), hh = H / (2 * zoom);
  const cx = Math.min(wx1 - hw, Math.max(wx0 + hw, box.x + box.w / 2));
  const cy = Math.min(wy1 - hh, Math.max(wy0 + hh, box.y + box.h / 2));
  return { x: cx, y: cy, zoom };
}

/**
 * Concrete camera keys (t, x, y, zoom, dur…) from named shots. Keys that already carry x, y and zoom pass through.
 * `env` resolves element boxes and anchors (scene.ts makeEnv).
 */
export function resolveShots(spec: SceneSpec, tokens: Tokens, env: any): CameraKey[] {
  const W = tokens.canvas.width, H = tokens.canvas.height;
  const raw = ((spec.camera ?? []) as any[]).filter((k) => typeof k?.t === "number").sort((a, b) => a.t - b.t);
  const out: CameraKey[] = [];
  let prev = { x: W / 2, y: H / 2, zoom: 1 };
  // sets larger than the frame (a long timeline) widen the world the camera may travel over
  const worldRects = spec.elements.filter((e) => e.type === "Timeline" || e.type === "WorldMap").map((e) => env.boundsOf(e.id)).filter(Boolean) as Rect[];
  const world = union([{ x: 0, y: 0, w: W, h: H }, ...worldRects]) ?? undefined;
  for (let i = 0; i < raw.length; i++) {
    const k = raw[i] as NamedShot;
    const next = raw[i + 1];
    const end = next ? next.t : spec.duration;
    const move: Move = (k.move as Move) ?? (isNamed(k) ? "push" : "push");
    const base: any = { t: k.t, move };
    if (typeof k.focus === "number") base.focus = k.focus;
    if (typeof k.dof === "number") base.dof = k.dof;
    if (typeof k.shake === "number" && k.shake > 0) base.shake = Math.min(24, k.shake);
    if (!isNamed(k)) {
      const dur = typeof k.dur === "number" ? k.dur : 1.6;
      out.push({ ...base, x: k.x!, y: k.y!, zoom: k.zoom!, dur });
      prev = { x: k.x!, y: k.y!, zoom: k.zoom! };
      continue;
    }
    if (move === "hold") {
      out.push({ ...base, x: prev.x, y: prev.y, zoom: prev.zoom, dur: 0.05 });
      continue;
    }
    const size: ShotSize = (k.shot as ShotSize) ?? (move === "pull" ? "wide" : "medium");
    const dur = Math.max(0, Math.min(typeof k.dur === "number" ? k.dur : MOVE_DUR[move] ?? 2, Math.max(0.05, end - k.t)));
    if (move === "follow") {
      // pan from the first target to the last across the shot, at the shot's size
      const list = Array.isArray(k.on) && !(k.on.length === 2 && typeof k.on[0] === "number") ? k.on : [k.on];
      const first = union(targetRects(env, spec, list[0]));
      const last = union(targetRects(env, spec, list[list.length - 1]));
      const a = frameBox(first, size, W, H, world), b = frameBox(last, size, W, H, world);
      const zoom = Math.min(a.zoom, b.zoom);
      const fa = frameBox(first, size, W, H, world), fb = frameBox(last, size, W, H, world);
      out.push({ ...base, move: "cut", x: fa.x, y: fa.y, zoom, dur: 0.6 } as any);
      out.push({ ...base, t: k.t + 0.01, move: "follow", x: fb.x, y: fb.y, zoom, dur: Math.max(0.6, typeof k.dur === "number" ? k.dur : Math.max(1.2, end - k.t - 0.4)) } as any);
      prev = { x: fb.x, y: fb.y, zoom };
      continue;
    }
    let box = union(targetRects(env, spec, k.on));
    if (box && size !== "wide" && size !== "detail") {
      const extra = attachedText(spec, env, k.on, k.t, end);
      box = union([box, ...extra]);
    }
    let f = frameBox(box, size, W, H, world);
    if (move === "through" && box) {
      // dive until the subject's centre fills the frame
      const fill = Math.min(6, Math.max(2.4, Math.min(W / Math.max(20, box.w * 0.35), H / Math.max(20, box.h * 0.35))));
      f = { x: box.x + box.w / 2, y: box.y + box.h / 2, zoom: fill };
    }
    // close shots get a shallow depth of field on the subject's plane unless the writer set one
    if ((size === "close" || size === "detail") && base.dof === undefined) {
      const id = typeof k.on === "string" ? k.on.split(".")[0] : Array.isArray(k.on) && typeof k.on[0] === "string" ? String(k.on[0]).split(".")[0] : "";
      const el = spec.elements.find((e) => e.id === id);
      base.focus = typeof el?.props?.depth === "number" ? el.props.depth : 0;
      base.dof = 3;
    } else if (size === "wide" && base.dof === undefined) base.dof = 0;
    out.push({ ...base, x: f.x, y: f.y, zoom: f.zoom, dur: move === "cut" ? 0 : dur });
    prev = f;
  }
  return out;
}

/** Replace named shots in a spec with concrete keys, once. Returns the spec (mutated). */
export function ensureShots(spec: SceneSpec, tokens: Tokens, envFactory: () => any): SceneSpec {
  const cam = spec.camera as any[] | undefined;
  if (!cam || !cam.length || (spec as any).__shots) return spec;
  if (!cam.some(isNamed)) return spec; // already concrete (written as x/y/zoom, or resolved by an earlier pass)
  spec.camera = resolveShots(spec, tokens, envFactory());
  Object.defineProperty(spec, "__shots", { value: true, enumerable: false, configurable: true });
  return spec;
}

/** A deterministic shake that decays after its cue (px). */
export function shakeAt(t: number, t0: number, amp: number): [number, number] {
  const d = t - t0;
  if (d < 0 || d > 0.7) return [0, 0];
  const e = Math.exp(-d * 7) * amp;
  return [Math.sin(d * 71 + 1.3) * e, Math.cos(d * 59 + 0.4) * e * 0.8];
}

export function isMoving(keys: CameraKey[], t: number): boolean {
  for (const k of keys) {
    const d = Math.max(0, (k as any).dur ?? 1.6);
    if (t >= k.t && t <= k.t + d && d > 0.06) return true;
  }
  return false;
}

export type { SceneElement };
