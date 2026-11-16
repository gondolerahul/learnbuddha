// Deterministic layout repair: takes the issues lintScene finds and fixes them in code, with no model call.
//   duplicate ids        rename
//   unknown types        drop
//   timing outside       pull the element back inside the scene
//   out of frame         shrink if it cannot fit, then slide it inside
//   overlapping text     move the later text to the nearest free space; failing that, end the earlier one
//                        when the later one arrives, shrink it, or drop it if it is only an annotation
//   text on a drawing    move it into empty space (labels keep their leader lines to the target)
//   broken references    drop the annotation, or keep a label without its leader line
//   camera crops text    reframe that camera shot (less zoom, re-centred) so everything it must show fits
//   heading on a picture move the heading to the nearest clear spot along the top, shrink it, or let it leave before the
//                        picture reaches it (pictures are never moved: where the sun is can be the lesson)
// It works on the resolved spec, so the result goes straight to the renderer.
import { PROP_KINDS } from "./art/props";
import { BACKDROPS, cameraShots, elementDur, lintScene, logicalRect, makeEnv, pictureRects, screenRect, TEXTY, type LintIssue, type RenderOptions } from "./scene";
import type { Ctx, Rect, SceneElement, SceneSpec } from "./types";

export interface FixResult {
  spec: SceneSpec;
  issues: LintIssue[];
  before: number;
  changes: string[];
}

const CAMERA_MUST_SHOW = new Set(["Arrow"]);
// annotations that may be dropped when there is nowhere to put them
const DROPPABLE = new Set(["Label", "Callout", "Arrow", "Highlight", "Underline", "Circle", "Bracket"]);
const SIZE_LADDER = ["xxl", "xl", "lg", "md", "sm"];
const M = 16; // margin kept from the frame edge
const PAD = 10; // gap kept between texts

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const span = (el: SceneElement, d: number): [number, number] => [el.at, typeof el.until === "number" ? el.until : d];
const together = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];
const inter = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const grow = (r: Rect, p: number): Rect => ({ x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p });
const union = (rs: Rect[]): Rect | null => {
  if (!rs.length) return null;
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

export function fixScene(ctx: Ctx, input: SceneSpec, o: RenderOptions, maxPasses = 8): FixResult {
  let spec = clone(input);
  const W = o.tokens.canvas.width;
  const H = o.tokens.canvas.height;
  const D = spec.duration;
  const changes: string[] = [];
  const lint = (s: SceneSpec) => lintScene(ctx, s, o);
  const first = lint(spec);
  let best = { spec: clone(spec), issues: first };
  let issues = first;

  const byId = () => new Map(spec.elements.map((e) => [e.id, e]));
  const boundsIn = (s: SceneSpec, id: string): Rect | null => makeEnv(ctx, s, o).boundsOf(id);
  const bounds = (id: string) => boundsIn(spec, id);
  const drop = (id: string, why: string) => {
    spec.elements = spec.elements.filter((e) => e.id !== id);
    changes.push(`dropped ${id}: ${why}`);
  };

  /** How the element's box follows props.x / props.y (null when it does not move with them). */
  const axis = (el: SceneElement, key: "x" | "y"): ((edge: number) => number) | null => {
    const r0 = bounds(el.id);
    if (!r0) return null;
    const probe = (v: number) => {
      const s = clone(spec);
      const e = s.elements.find((x) => x.id === el.id)!;
      e.props = { ...(e.props ?? {}), [key]: v };
      return boundsIn(s, el.id);
    };
    const base = typeof el.props?.[key] === "number" ? el.props[key] : key === "x" ? r0.x + r0.w / 2 : r0.y + r0.h / 2;
    const a = probe(base);
    const b = probe(base + 100);
    if (!a || !b) return null;
    const moved = key === "x" ? b.x - a.x : b.y - a.y;
    if (Math.abs(moved - 100) > 0.5) return null;
    const edge = key === "x" ? a.x : a.y;
    return (target: number) => Math.round(base + (target - edge));
  };

  const moveTo = (el: SceneElement, x: number, y: number): boolean => {
    const ax = axis(el, "x");
    const ay = axis(el, "y");
    const r = bounds(el.id);
    if (!r) return false;
    let moved = false;
    if (ax && Math.abs(x - r.x) > 0.5) {
      el.props = { ...el.props, x: ax(x) };
      moved = true;
    }
    if (ay && Math.abs(y - r.y) > 0.5) {
      el.props = { ...el.props, y: ay(y) };
      moved = true;
    }
    return moved;
  };

  const smaller = (el: SceneElement): boolean => {
    const p = (el.props ??= {});
    if (TEXTY.has(el.type)) {
      const cur = typeof p.size === "string" ? p.size : el.type === "Heading" || el.type === "TitleCard" ? "lg" : el.type === "Label" ? "sm" : "md";
      const i = SIZE_LADDER.indexOf(cur);
      const next = SIZE_LADDER.slice(i + 1).find((s) => s in o.tokens.sizes);
      if (i >= 0 && next) {
        p.size = next;
        return true;
      }
      if (typeof p.size === "number" && p.size > 18) {
        p.size = Math.round(p.size * 0.85);
        return true;
      }
      return false;
    }
    if (typeof p.spread === "number" && p.spread > 24) {
      p.spread = Math.round(p.spread * 0.75); // particle streams: a tighter stream
      return true;
    }
    if (typeof p.size === "number" && p.size > 30) {
      p.size = Math.round(p.size * 0.85);
      return true;
    }
    if (typeof p.scale === "number" && p.scale > 0.4) {
      p.scale = +(p.scale * 0.88).toFixed(3);
      return true;
    }
    return false;
  };

  /** Rects the element must keep clear of while it is on screen. */
  const obstacles = (el: SceneElement): Rect[] => {
    const me = span(el, D);
    const out: Rect[] = [];
    for (const other of spec.elements) {
      if (other.id === el.id || !together(me, span(other, D)) || !TEXTY.has(other.type)) continue;
      const r = bounds(other.id);
      if (!r) continue;
      if (!other.fixed || el.fixed) {
        out.push(grow(r, PAD));
        continue;
      }
      // a pinned heading: keep clear of where it lands in this element's coordinates at every camera position
      const sp = span(other, D), from = Math.max(me[0], sp[0]), to = Math.min(me[1], sp[1]);
      for (let t = from; t < to; t += 0.5) out.push(grow(logicalRect(spec, o.tokens, el, r, t), PAD));
    }
    for (const b of pictureRects(makeEnv(ctx, spec, o), spec)) {
      if (b.owner.id === el.id || !together(me, [b.from, b.to])) continue;
      if (!el.fixed) {
        out.push(b.r);
        continue;
      }
      // pinned to the screen: avoid every place the camera carries the picture while both are visible
      const from = Math.max(me[0], b.from), to = Math.min(me[1], b.to);
      for (let t = from; t < to; t += 0.5) out.push(screenRect(spec, o.tokens, b.owner, b.r, t));
    }
    return out;
  };

  /** Nearest place for the element's box where it touches nothing it must avoid. */
  const TITLES = new Set(["Heading", "TitleCard"]);
  const freeSpot = (el: SceneElement): [number, number] | null => {
    const r = bounds(el.id);
    if (!r || r.w > W - 2 * M || r.h > H - 2 * M) return null;
    const obs = obstacles(el);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    let found: [number, number] | null = null;
    let bestD = Infinity;
    const step = 16;
    // a heading stays a heading: it slides along the top, never into the middle of the frame;
    // when the top is full, a lower third, as in film titles.
    const bands: [number, number][] = TITLES.has(el.type)
      ? [[M, Math.min(H - M - r.h, Math.max(r.y, 40) + 40)], [Math.max(M, H - M - r.h - 48), H - M - r.h]]
      : [[M, H - M - r.h]];
    for (const [y0, y1] of bands) {
      for (let y = y0; y <= y1; y += step) {
        for (let x = M; x <= W - M - r.w; x += step) {
          const c = { x, y, w: r.w, h: r.h };
          if (obs.some((b) => inter(c, b) > 0)) continue;
          const d = Math.hypot(x + r.w / 2 - cx, y + r.h / 2 - cy);
          if (d < bestD) {
            bestD = d;
            found = [x, y];
          }
        }
      }
      if (found) break;
    }
    return found;
  };

  const relocate = (el: SceneElement): boolean => {
    const spot = freeSpot(el);
    if (!spot) return false;
    const before = clone(el.props);
    if (!moveTo(el, spot[0], spot[1])) return false;
    const r = bounds(el.id);
    if (!r || r.x < M - 1 || r.y < M - 1 || r.x + r.w > W - M + 1 || r.y + r.h > H - M + 1) {
      el.props = before;
      return false;
    }
    changes.push(`moved ${el.id} to ${Math.round(spot[0])},${Math.round(spot[1])}`);
    return true;
  };

  /** Reframe camera shot i so the text, arrows and new arrivals it must show all fit, keeping as much of the move as possible. */
  const fitShot = (i: number): boolean => {
    const shots = cameraShots(spec);
    spec.camera = shots;
    const k = shots[i];
    if (!k) return false;
    const end = i + 1 < shots.length ? shots[i + 1].t : D;
    const settle = Math.min(end, k.t + Math.max(0.2, k.dur ?? 1.6));
    const must: Rect[] = [];
    for (const el of spec.elements) {
      if (el.fixed || BACKDROPS.has(el.type) || ["ProgressBar", "RecapCard", "FrozenFrame"].includes(el.type)) continue;
      const until = typeof el.until === "number" ? el.until : D;
      if (until <= settle || el.at >= end) continue;
      if (!(CAMERA_MUST_SHOW.has(el.type) || el.at >= k.t - 0.05)) continue;
      const r = bounds(el.id);
      if (r) must.push(r);
    }
    const u = union(must);
    if (!u) return false;
    const m = 14;
    const zoom0 = typeof k.zoom === "number" ? k.zoom : 1;
    const zoom = Math.max(1, Math.min(zoom0, (W - 2 * m) / u.w, (H - 2 * m) / u.h));
    const hw = W / 2 / zoom, hh = H / 2 / zoom;
    const fitC = (c: number, lo: number, hi: number, half: number, size: number) => {
      // the shot must show [lo, hi] and must not look past the edge of the page
      let a = hi - half + m / zoom, b = lo + half - m / zoom;
      a = Math.max(a, half);
      b = Math.min(b, size - half);
      return a <= b ? Math.max(a, Math.min(b, c)) : (lo + hi) / 2;
    };
    const x = Math.round(fitC(typeof k.x === "number" ? k.x : W / 2, u.x, u.x + u.w, hw, W));
    const y = Math.round(fitC(typeof k.y === "number" ? k.y : H / 2, u.y, u.y + u.h, hh, H));
    if (Math.abs(zoom - zoom0) < 0.005 && x === k.x && y === k.y) {
      if (zoom0 <= 1.0001) return false;
      k.zoom = +Math.max(1, zoom0 - 0.08).toFixed(3); // parallax made it miss: back off a little more
    } else {
      k.zoom = +zoom.toFixed(3);
      k.x = x;
      k.y = y;
    }
    changes.push(`reframed camera shot ${i + 1}: zoom ${zoom0} → ${k.zoom}, centre ${k.x},${k.y}`);
    return true;
  };

  for (let pass = 0; pass < maxPasses && issues.length; pass++) {
    const els = byId();
    const handled = new Set<string>();
    const shotsDone = new Set<number>();
    for (const iss of issues) {
      const el = els.get(iss.id);
      if (!el || !spec.elements.includes(el)) continue;
      const msg = iss.message;
      const key = `${iss.id}|${msg.split(" ")[0]}`;
      if (handled.has(key)) continue;
      handled.add(key);

      if (msg === "duplicate element id") {
        const dup = spec.elements.filter((e) => e.id === iss.id);
        dup.slice(1).forEach((e, i) => {
          e.id = `${iss.id}-${i + 2}`;
          changes.push(`renamed a duplicate ${iss.id} to ${e.id}`);
        });
      } else if (msg.startsWith("unknown component type") || msg.startsWith("draw failed")) {
        drop(el.id, msg);
      } else if (msg.startsWith("starts at")) {
        el.at = Math.max(0, Math.min(D - 0.6, el.at));
        changes.push(`moved ${el.id} to start at ${el.at}s`);
      } else if (msg.startsWith("entrance ends")) {
        const dur = elementDur(makeEnv(ctx, spec, o), el);
        if (D - dur - 0.1 >= 0) el.at = +Math.min(el.at, D - dur - 0.1).toFixed(3);
        else {
          el.at = 0;
          el.dur = Math.max(0.2, D - 0.15);
        }
        changes.push(`${el.id} now enters by the end of the scene`);
      } else if (msg.startsWith("extends outside the frame")) {
        let r = bounds(el.id);
        let n = 0;
        while (r && (r.w > W - 2 * M || r.h > H - 2 * M) && n++ < 6 && smaller(el)) r = bounds(el.id);
        if (n) changes.push(`shrank ${el.id} to fit the frame`);
        r = bounds(el.id);
        if (r) {
          const x = Math.max(M, Math.min(W - M - r.w, r.x));
          const y = Math.max(M, Math.min(H - M - r.h, r.y));
          if (moveTo(el, x, y)) changes.push(`slid ${el.id} inside the frame`);
          else if (smaller(el)) changes.push(`shrank ${el.id} to keep it inside the frame`);
          else if (DROPPABLE.has(el.type) && pass >= 2) drop(el.id, "could not be kept inside the frame");
        }
      } else if (msg.startsWith("draws its own sun")) {
        el.props = { ...el.props, sun: "none" };
        changes.push(`${el.id}: the landscape's own sun removed (the scene draws one)`);
      } else if (msg.startsWith("cut off by camera shot")) {
        const i = parseInt(msg.slice("cut off by camera shot ".length), 10) - 1;
        const shot = cameraShots(spec)[i];
        if (shot && msg.endsWith("(on screen before the shot)") && TEXTY.has(el.type) && !el.fixed) {
          // clear the board for the push-in, as an editor would, rather than undo the shot
          el.until = +Math.max(el.at + 0.5, shot.t).toFixed(3);
          changes.push(`${el.id} now leaves at ${el.until}s as camera shot ${i + 1} pushes in`);
          // marks drawn on it (a circle, an underline, a label pointing at it) leave with it
          for (const m of spec.elements) {
            const tgt = typeof m.props?.target === "string" ? m.props.target.split(".")[0] : "";
            if (m !== el && tgt === el.id && (typeof m.until !== "number" || m.until > el.until)) {
              m.until = el.until;
              changes.push(`${m.id} leaves with ${el.id}`);
            }
          }
        } else if (!shotsDone.has(i)) {
          shotsDone.add(i);
          fitShot(i);
        }
      } else if (msg.startsWith("text sits on the illustration") && el.fixed) {
        const ref = /'([^']+)'/.exec(msg)?.[1] ?? "";
        // the heading moves to the nearest clear spot (text is safe to move; the picture may carry meaning)
        if (relocate(el)) continue;
        if (smaller(el)) {
          changes.push(`shrank ${el.id} to fit beside the picture`);
          continue;
        }
        // nowhere to put it: the heading has done its job by the time the picture reaches it
        const t = /\((\d+(?:\.\d+)?)–/.exec(msg);
        const start = t ? parseFloat(t[1]) : NaN;
        if (start >= el.at + 2 && (typeof el.until !== "number" || el.until > start)) {
          el.until = start;
          changes.push(`${el.id} now leaves at ${start}s, before ${ref} reaches it`);
        }
      } else if (msg.includes("overlaps '") || msg.startsWith("text sits on the illustration")) {
        if (relocate(el)) continue;
        const other = els.get(/'([^']+)'/.exec(msg)?.[1] ?? "");
        // the earlier text gives way when the later one arrives (a cut, as an editor would make it)
        if (other && msg.includes("overlaps '") && other.at < el.at - 1.2 && !other.fixed) {
          other.until = el.at;
          changes.push(`${other.id} now leaves at ${el.at}s, when ${el.id} arrives`);
          continue;
        }
        if (smaller(el)) {
          changes.push(`shrank ${el.id} to make room`);
          continue;
        }
        if (DROPPABLE.has(el.type) && pass >= 1) drop(el.id, "no free space for it");
      } else if (/label target .* not found/.test(msg)) {
        delete el.props.target;
        changes.push(`${el.id} keeps its text without a leader line`);
      } else if (/not found|could not be resolved|missing node/.test(msg)) {
        if (DROPPABLE.has(el.type)) drop(el.id, msg);
      } else if (msg.startsWith("series ")) {
        const i = parseInt(msg.slice(7), 10);
        if (Array.isArray(el.props?.series) && el.props.series.length > 1) {
          el.props.series.splice(i, 1);
          changes.push(`removed series ${i} from ${el.id}`);
        } else drop(el.id, msg);
      } else if (msg.startsWith("unknown prop kind")) {
        const kind = nearestKind(String(el.props?.kind ?? ""));
        if (kind) {
          changes.push(`${el.id}: picture '${el.props.kind}' drawn as '${kind}'`);
          el.props.kind = kind;
        } else drop(el.id, msg);
      }
    }
    issues = lint(spec);
    if (issues.length < best.issues.length) best = { spec: clone(spec), issues };
  }
  if (issues.length > best.issues.length) {
    spec = best.spec;
    issues = best.issues;
  }
  return { spec, issues, before: first.length, changes };
}

/** The library picture closest to a name the writer made up ("rain_clouds" → raincloud), or null. */
export function nearestKind(name: string): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(es|s)$/, "");
  const n = norm(name);
  if (!n) return null;
  const kinds = PROP_KINDS.map((k) => [k, norm(k)] as const);
  return (
    kinds.find(([, k]) => k === n)?.[0] ??
    kinds.find(([, k]) => k.length >= 3 && n.includes(k))?.[0] ??
    kinds.find(([, k]) => n.length >= 3 && k.includes(n))?.[0] ??
    null
  );
}
