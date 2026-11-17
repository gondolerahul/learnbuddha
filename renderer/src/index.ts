export * from "./types";
export { renderScene, drawScene, lintScene, visibleText, cameraAt, elementScreenBox, COMPONENTS } from "./scene";
export { compileExpr } from "./expr";
import zen from "../stylekit/zen-board-v1/tokens.json";
import zenHc from "../stylekit/zen-board-hc-v1/tokens.json";
import storybook from "../stylekit/storybook-v1/tokens.json";
import chalkboard from "../stylekit/chalkboard-v1/tokens.json";
import blueprint from "../stylekit/blueprint-v1/tokens.json";
import watercolor from "../stylekit/watercolor-v1/tokens.json";
import papercut from "../stylekit/papercut-v1/tokens.json";
import inkwash from "../stylekit/inkwash-v1/tokens.json";
import schematic from "../stylekit/schematic-v1/tokens.json";
import cinematicDark from "../stylekit/cinematic-dark-v1/tokens.json";
import comic from "../stylekit/comic-v1/tokens.json";
import type { Tokens } from "./types";

export const KITS: Record<string, Tokens> = {
  [zen.id]: zen as Tokens,
  [zenHc.id]: zenHc as Tokens,
  [storybook.id]: storybook as Tokens,
  [chalkboard.id]: chalkboard as Tokens,
  [blueprint.id]: blueprint as Tokens,
  [watercolor.id]: watercolor as Tokens,
  [papercut.id]: papercut as Tokens,
  [inkwash.id]: inkwash as Tokens,
  [schematic.id]: schematic as Tokens,
  [cinematicDark.id]: cinematicDark as Tokens,
  [comic.id]: comic as Tokens,
};

export function kitTokens(id: string | undefined): Tokens {
  return KITS[id ?? ""] ?? KITS["zen-board-v1"];
}
