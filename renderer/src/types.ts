// Shared types for the LearnBuddha Style Kit renderer.
// Everything here must stay deterministic: no Date.now(), no Math.random().

export type Ctx = CanvasRenderingContext2D;

export interface Tokens {
  id: string;
  name: string;
  canvas: { width: number; height: number };
  colors: Record<string, string>;
  series: string[];
  fonts: { hand: string; serif: string };
  sizes: Record<string, number>;
  stroke: { thin: number; base: number; bold: number };
  margin: number;
  motion: { fadeOut: number; charsPerSecond: number; minWrite: number; maxWrite: number };
  grain: number;
  vignette: number;
  jitter: number;
  voice: { name: string; style: string };
  music: { provider: string; level: number };
}

export interface CameraKey {
  /** When the move STARTS (seconds). */
  t: number;
  x: number;
  y: number;
  zoom: number;
  /** How long the move takes (default 1.6 s), eased with inertia. */
  dur?: number;
  /** Depth plane in focus (-1 far … 0 mid … 1 near) and depth-of-field strength (blur px per unit of depth). */
  focus?: number;
  dof?: number;
}

export interface SceneElement {
  id: string;
  type: string;
  at: number;
  until?: number | null;
  dur?: number | null;
  fixed?: boolean;
  props: Record<string, any>;
}

export interface SceneSpec {
  kit: string;
  duration: number;
  seed?: number;
  /** Narration sentence spans [start, end] in seconds (drives talking characters). */
  speech?: [number, number][];
  camera?: CameraKey[];
  elements: SceneElement[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Env {
  ctx: Ctx;
  tokens: Tokens;
  spec: SceneSpec;
  seed: number;
  /** Creates an offscreen canvas (node or browser). */
  makeCanvas: (w: number, h: number) => any;
  /** Bounds of other elements, filled lazily (for `target` references). */
  boundsOf: (id: string) => Rect | null;
  /** A point from [x,y], "elementId" (centre) or "elementId.anchor". */
  pointOf: (ref: any) => [number, number] | null;
  /** Layout warnings collected during lint. */
  warn: (elementId: string, message: string) => void;
  /** Recursion depth guard for FrozenFrame. */
  depth: number;
}

export interface Phase {
  /** Seconds since element.at */
  local: number;
  /** Entrance progress 0..1 */
  k: number;
  /** Entrance duration in seconds */
  dur: number;
  /** Opacity multiplier (fade-out) */
  alpha: number;
}

export interface Component {
  /** Default entrance duration given props. */
  inDur: (env: Env, p: any) => number;
  /** Layout box in logical (1280x720) coordinates, or null. */
  bounds: (env: Env, p: any, el: SceneElement) => Rect | null;
  draw: (env: Env, p: any, ph: Phase, el: SceneElement) => void;
  /** Named points (logical coordinates) other elements can target as "id.name". */
  anchors?: (env: Env, p: any, el: SceneElement) => Record<string, [number, number]>;
  /** Pictures drawn inside a backdrop (a landscape's sun and trees), which text must not cover. */
  parts?: (env: Env, p: any, el: SceneElement) => { name: string; rect: Rect }[];
}
