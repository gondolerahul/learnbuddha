# v2: animation quality (branch `animation-quality-v2`)

Started 2026-11-19. Goal: 10 perfected styles whose lessons look directed and shot, not assembled.

## Decisions (user, 2026-11-19)

1. **Restraint over quotas.** The richness quotas (4+ pictures, 5+ moving things, an element every 2.5 s) are replaced
   outright by a direction brief: one set per scene, 3–6 beats that change it, one lead per beat, holds, uneven rhythm.
2. **Hand-drawn sets.** Invest fully: the model directs, the renderer draws accurate, well-made subject systems.
3. **Ten styles** (wave 1 first): Zen ink, Storybook cel, Flat explainer, Field notes, Night glow; then Clinical cutaway,
   Chalkboard, Paper shadowbox, Blueprint, Riso collage.
4. **Render budget:** up to about +40% render time per video second.
5. **Scene-to-scene transitions are optional**, never forced: the planner may propose a hand-off between two scenes
   when one scene's last image is a natural door into the next. Most scenes stay independent.

Also: CPU rendering only (no GPU path); the vision critic runs in the style lab only; licences — opus-js-animations and
VOX-COLLAGE-BROLL (MIT) may be adapted with credit, onetake (PolyForm NC) and OpenMontage (AGPL) are ideas only.

## Kits

| id | name | for | status |
|---|---|---|---|
| zen-board-v1 | Zen ink (default) | general, humanities, everyday | rebuilt |
| zen-board-hc-v1 | Zen ink · High contrast | accessibility | follows Zen ink |
| storybook-v1 | Storybook | children 5–11 | rebuilt (cel) |
| flat-explainer-v1 | Flat explainer | tech, business, economics, statistics | new |
| watercolor-v1 | Field notes | biology, ecology, earth science | rebuilt |
| cinematic-dark-v1 | Night glow | space, physics, the very small | rebuilt |
| schematic-v1 | Clinical cutaway | medicine, anatomy, chemistry | rebuilt |
| chalkboard-v1 | Chalkboard | maths, physics derivations | rebuilt |
| papercut-v1 | Paper shadowbox | young learners, stories | rebuilt |
| blueprint-v1 | Blueprint | engineering, machines | rebuilt |
| riso-v1 | Riso collage | social studies, economics stories, teens | new |
| inkwash-v1, comic-v1 | retired | kept only so old scenes still render | hidden from planner and picker |

## Architecture

- **Materials** (`renderer/src/art/material.ts`): the paint helpers build explicit geometry, and each kit's treatment
  draws it: hand-cut edges, tapered brush ribbons with dry-brush, chalk and crayon strokes that skip the paper's tooth,
  watercolour wet edges and blooms, riso plates with halftone and misregistration, glow, flat with long shadows, cel.
  **Line boil** is a cycle of 3 variant drawings stepped at the kit's boil rate, so sprites stay cached.
- **Camera** (`renderer/src/camera.ts`): named shots (`wide`, `medium`, `close`, `detail`) on targets, framed by the
  engine with safe margins; moves `cut | push | pull | pan | whip | follow | through | hold`; zoom eased in log space;
  holds are dead still (drift only where the kit asks for a handheld feel); `shake` on impacts; motion blur on fast
  frames (sub-frame accumulation).
- **Transitions** (`Transition` component): cover-and-reveal overlays, one signature per kit (eraser wipe, paper sheet,
  brush sweep, watercolour bleed, print slide, iris, flash), plus `through` dives.
- **Sets** (`renderer/src/components/sets/*`): Synapse, Cell, Molecule + Reaction, Orbits, Machine, Circuit, Timeline,
  WorldMap, TokenGrid, Bars (+ race), Contraption, Stamp. Each has anchors, named states cued to words, and parts.
- **Type** per kit: display, body and label faces (all OFL), reveals per kit (write, rise into focus, type, chalk).
- **Prompts**: a neutral direction brief, one full bible per kit, golden scenes per kit, a beats-first schema whose beats
  carry the shots, a planner design read and per-scene central image and set, and a component reference pruned to
  the scene's set and kit.
- **QA**: lint metrics (rest share, rhythm variety, stand-ins, heading collisions), a style lab (fixed benchmark
  scripts rendered in every kit as contact sheets), and a critic script for the lab.
- **Finish**: static grain instead of per-frame noise, x264 `tune animation`; a sound palette per kit.

## Progress

- [x] Materials, boil, two clocks
- [x] Kits: tokens, surfaces, skies, type
- [x] Camera: named shots, framing, log zoom, holds, shake, whip, motion blur
- [x] Transitions
- [x] Sets (Synapse, Cell, Molecule, Reaction, Orbits, Machine, Circuit, Timeline, WorldMap, TokenGrid, Bars, Stamp, Contraption)
- [x] Characters: per-kit puppets (Buddy, block figure, chalk stick figure), two-bone IK pointing
- [x] Prompts: brief, bibles, golden scenes, beats schema, planner, pruned reference
- [x] QA: style lab, critic, heading cross-fade fix, direction lint (camera rests, metronome shots, box stand-ins)
- [x] Finish and sound
- [x] Tests, docs, review renders

## Status when the session stopped (2026-11-19)

Done and rendering: materials and boil, all ten kit tokens (+ high contrast), per-kit type and label styles, surfaces,
skies and flat landscape mode, camera (named shots, framing solver, log zoom, holds, shake, motion blur), transitions,
13 sets with schemas in components.json, kit.py (new registry, style guide, per-kit bible loading, pruned reference,
generic cue resolution, beats → camera), planner direction stored on courses and scenes (DB columns, pipeline,
SceneContext). PIPELINE_VERSION bumped to 4.

Next, in order:
1. prompts.py: beats-first scene schema with named shots (no raw camera); DIRECTION.md replacing RICHNESS; planner
   fields design_read (after style) and per-scene central_image, set, opens_with (optional, rare); scene_user shows
   them; scene_system(kit_id, sets) passes the planned set to kit.component_reference. Update gemini.py/claude.py
   calls and mock.py (beats instead of camera).
2. Write renderer/stylekit/DIRECTION.md and a SKILL.md bible per kit (no kit inherits Zen's text any more: kit.skill_md
   now returns only the kit's own file — until bibles exist, non-Zen kits get their old short addenda).
3. One golden scene per kit in renderer/stylekit/<kit>/golden/ (draft format), style lab script + critic.
4. Lint metrics (rest share, rhythm, stand-ins, heading collisions); static grain + x264 tune animation; sound palettes.
5. Guide IK pointing; frontend picker/gallery; tests (test_visuals expects old kit names/golden layout); README, NOTICE
   (credit opus-js-animations recipes).

2026-11-20: the remaining steps are done except characters and rhythm lint: prompts (beats schema, design read,
central image, set, optional hand-off), DIRECTION.md, ten bibles, an example per kit, style lab with critic, sound
palettes and music beds per kit, still grain, x264 tune animation, gallery examples. 37 tests pass.
2026-11-20 (later): characters and direction lint done; the plan is complete. Merged to main.
