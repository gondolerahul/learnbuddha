# Third-party notices

LearnBuddha's renderer and scene-writing guidance adapt code and text from the projects below. Each is used under its
licence; the copyright notices and licence text are reproduced here as those licences require.

## cinecode — MIT

Copyright (c) 2026 Sarp Yıldız (@sarpstar) · https://github.com/sarpstar/cinecode

Used in LearnBuddha:
- `renderer/src/motion.ts`: `spring`, `back`, `anticipate`, `stagger`, `arc` and the named spring tones
  (from `references/motion.md` §5 and §8), and the camera "inertia" easing (`references/camera-moves.md`).
- `renderer/src/scene.ts`: camera moves that start on a cue and run for a duration with inertia; the film finish
  idea of halation, vignette and grain chosen per look (`references/finish.md`), here done in the encoder.
- `renderer/stylekit/zen-board-v1/SKILL.md`, "Direct it like a film": rules adapted from `SKILL.md` (the hook),
  `references/craft.md` (shots, framing changes, rhythm), `references/motion.md` (one lead per moment, cause before
  effect, stagger) and `references/looks.md` §8 (visual clichés).
- `backend/app/sfx.py`: the principle of sound on every visible action from the first version.

## rossark-motion-skill — MIT

Copyright (c) 2026 rossark0 · https://github.com/rossark0/rossark-motion-skill

Used in LearnBuddha:
- `renderer/src/motion.ts`: the cubic-bezier curves (travel, arrive, leave), `track`, `flow` (monotone cubic
  through key poses), `seg`, `wave`, `loop`, `bell` and `seeded` (from `templates/react-native/motion.ts`).
- `renderer/src/components/art.ts`, the `Guide` character: acting rules from `SKILL.md` §4–§5 (poses that flow,
  idle layers on every channel, follow-through by delay, two-segment limbs, blink timing, gaze leading head turns,
  squash that keeps volume) and the subject recipes in `MOTION.md`.

## opus-js-animations — MIT

Copyright (c) 2026 klsoen · https://github.com/klsoen/opus-js-animations

Used in LearnBuddha:
- `renderer/src/art/material.ts`: hand-cut paper edges pushed along the normal by noise, and shading toward the ink or
  the paper rather than toward black or white (`references/styles.md` §2).
- `renderer/src/text.ts` and `renderer/stylekit/DIRECTION.md`: text that rises into place, restraint ("rich rendering of
  few elements"), and the two clocks of stop motion (poses held, camera smooth) (`references/design.md`, `styles.md`).

## Licence text (MIT, identical for the three projects above)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Data and fonts

- **world-atlas** (ISC, Mike Bostock) with **Natural Earth** country shapes (public domain), and **topojson-client** (ISC):
  the WorldMap set.
- Fonts from **@fontsource** (all SIL Open Font License 1.1): Kalam, Source Serif 4, Noto Sans Math, Caveat, Lora,
  Poppins, Fredoka, Space Grotesk, JetBrains Mono, Fredericka the Great, Patrick Hand, Architects Daughter, Archivo Black,
  Courier Prime, Inter.

## Studied but not copied

- **onetake** (PolyForm Noncommercial) and **OpenMontage** (AGPL-3.0): ideas only (beats that grow out of each other,
  still rests, motion blur on fast moves, taste dials). No code or text from either is used.
- **VOX-COLLAGE-BROLL** (MIT): its collage visual language informed Riso collage; its pipeline uses image and video
  models, so nothing of it is used.

- **claude-drawing-skill** (MIT, Copyright (c) 2026 cloveric, https://github.com/cloveric/claude-drawing-skill):
  its painting principles (paint back to front, one key light, aerial perspective, few big shapes) informed the
  landscape and prop lighting; no code was copied (its renderer is Python/numpy).
- **lemo-opuscar** (https://github.com/lemomo-ai/lemo-opuscar): its docs and style prompts are CC BY-NC 4.0 and need
  a commercial licence for use in a product, so none of their text is used here; its MIT code was not needed.
