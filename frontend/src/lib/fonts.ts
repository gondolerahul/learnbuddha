// Register the Style Kit faces under the same family names the renderer uses, so browser previews
// (Style Kit page) match server renders exactly.
import kalam400 from "@fontsource/kalam/files/kalam-latin-400-normal.woff2?url";
import kalam700 from "@fontsource/kalam/files/kalam-latin-700-normal.woff2?url";
import kalamExt400 from "@fontsource/kalam/files/kalam-latin-ext-400-normal.woff2?url";
import serif400 from "@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff2?url";
import serif600 from "@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff2?url";
import serifGreek from "@fontsource/source-serif-4/files/source-serif-4-greek-400-normal.woff2?url";
import math400 from "@fontsource/noto-sans-math/files/noto-sans-math-latin-400-normal.woff2?url";

const faces: [string, string, string][] = [
  ["LB Hand", kalam400, "400"],
  ["LB Hand", kalamExt400, "400"],
  ["LB Hand", kalam700, "700"],
  ["LB Serif", serif400, "400"],
  ["LB Serif", serifGreek, "400"],
  ["LB Serif", serif600, "600"],
  ["LB Math", math400, "400"],
];

export const fontsReady: Promise<void> = Promise.all(
  faces.map(async ([family, url, weight]) => {
    const f = new FontFace(family, `url(${url})`, { weight });
    await f.load();
    document.fonts.add(f);
  }),
).then(() => undefined);
