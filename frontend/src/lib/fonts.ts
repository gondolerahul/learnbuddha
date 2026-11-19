// Register the Style Kit faces under the same family names the renderer uses (renderer/src/cli.ts FONT_FACES), so
// browser previews (Style Kit page, the tutor's instant marks) match server renders exactly. All SIL OFL.
// Generated list: keep it in step with FONT_FACES.
import f0 from "@fontsource/kalam/files/kalam-latin-400-normal.woff2?url";
import f1 from "@fontsource/kalam/files/kalam-latin-ext-400-normal.woff2?url";
import f2 from "@fontsource/kalam/files/kalam-latin-700-normal.woff2?url";
import f3 from "@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff2?url";
import f4 from "@fontsource/source-serif-4/files/source-serif-4-greek-400-normal.woff2?url";
import f5 from "@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff2?url";
import f6 from "@fontsource/noto-sans-math/files/noto-sans-math-latin-400-normal.woff2?url";
import f7 from "@fontsource/caveat/files/caveat-latin-400-normal.woff2?url";
import f8 from "@fontsource/caveat/files/caveat-latin-600-normal.woff2?url";
import f9 from "@fontsource/caveat/files/caveat-latin-700-normal.woff2?url";
import f10 from "@fontsource/lora/files/lora-latin-400-normal.woff2?url";
import f11 from "@fontsource/lora/files/lora-latin-600-normal.woff2?url";
import f12 from "@fontsource/lora/files/lora-latin-700-normal.woff2?url";
import f13 from "@fontsource/lora/files/lora-latin-400-italic.woff2?url";
import f14 from "@fontsource/lora/files/lora-latin-600-italic.woff2?url";
import f15 from "@fontsource/poppins/files/poppins-latin-400-normal.woff2?url";
import f16 from "@fontsource/poppins/files/poppins-latin-500-normal.woff2?url";
import f17 from "@fontsource/poppins/files/poppins-latin-600-normal.woff2?url";
import f18 from "@fontsource/poppins/files/poppins-latin-700-normal.woff2?url";
import f19 from "@fontsource/poppins/files/poppins-latin-800-normal.woff2?url";
import f20 from "@fontsource/fredoka/files/fredoka-latin-400-normal.woff2?url";
import f21 from "@fontsource/fredoka/files/fredoka-latin-500-normal.woff2?url";
import f22 from "@fontsource/fredoka/files/fredoka-latin-600-normal.woff2?url";
import f23 from "@fontsource/fredoka/files/fredoka-latin-700-normal.woff2?url";
import f24 from "@fontsource/space-grotesk/files/space-grotesk-latin-400-normal.woff2?url";
import f25 from "@fontsource/space-grotesk/files/space-grotesk-latin-500-normal.woff2?url";
import f26 from "@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff2?url";
import f27 from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2?url";
import f28 from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2?url";
import f29 from "@fontsource/fredericka-the-great/files/fredericka-the-great-latin-400-normal.woff2?url";
import f30 from "@fontsource/patrick-hand/files/patrick-hand-latin-400-normal.woff2?url";
import f31 from "@fontsource/architects-daughter/files/architects-daughter-latin-400-normal.woff2?url";
import f32 from "@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff2?url";
import f33 from "@fontsource/courier-prime/files/courier-prime-latin-400-normal.woff2?url";
import f34 from "@fontsource/courier-prime/files/courier-prime-latin-700-normal.woff2?url";
import f35 from "@fontsource/inter/files/inter-latin-400-normal.woff2?url";
import f36 from "@fontsource/inter/files/inter-latin-500-normal.woff2?url";
import f37 from "@fontsource/inter/files/inter-latin-600-normal.woff2?url";
import f38 from "@fontsource/inter/files/inter-latin-700-normal.woff2?url";

const faces: [string, string, string][] = [
  ["LB Hand", f0, "400"],
  ["LB Hand", f1, "400"],
  ["LB Hand", f2, "700"],
  ["LB Serif", f3, "400"],
  ["LB Serif", f4, "400"],
  ["LB Serif", f5, "600"],
  ["LB Math", f6, "400"],
  ["LB Caveat", f7, "400"],
  ["LB Caveat", f8, "600"],
  ["LB Caveat", f9, "700"],
  ["LB Lora", f10, "400"],
  ["LB Lora", f11, "600"],
  ["LB Lora", f12, "700"],
  ["LB Lora Italic", f13, "400"],
  ["LB Lora Italic", f14, "600"],
  ["LB Poppins", f15, "400"],
  ["LB Poppins", f16, "500"],
  ["LB Poppins", f17, "600"],
  ["LB Poppins", f18, "700"],
  ["LB Poppins", f19, "800"],
  ["LB Fredoka", f20, "400"],
  ["LB Fredoka", f21, "500"],
  ["LB Fredoka", f22, "600"],
  ["LB Fredoka", f23, "700"],
  ["LB Grotesk", f24, "400"],
  ["LB Grotesk", f25, "500"],
  ["LB Grotesk", f26, "700"],
  ["LB Mono", f27, "400"],
  ["LB Mono", f28, "700"],
  ["LB Chalk", f29, "400"],
  ["LB Patrick", f30, "400"],
  ["LB Architect", f31, "400"],
  ["LB Archivo", f32, "400"],
  ["LB Courier", f33, "400"],
  ["LB Courier", f34, "700"],
  ["LB Inter", f35, "400"],
  ["LB Inter", f36, "500"],
  ["LB Inter", f37, "600"],
  ["LB Inter", f38, "700"],
];

export const fontsReady: Promise<void> = Promise.all(
  faces.map(async ([family, url, weight]) => {
    const f = new FontFace(family, `url(${url})`, { weight });
    try {
      await f.load();
      document.fonts.add(f);
    } catch {
      /* a missing face falls back to the next family in the kit's stack */
    }
  }),
).then(() => undefined);
