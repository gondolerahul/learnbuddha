# Zen Board v1 — shot grammar

Warm paper, black ink, **one** vermilion accent. Calm, patient, gentle motion. The frame should feel like a
patient teacher drawing on paper, not a dashboard.

## Canvas
- Logical canvas 1280×720, origin top-left. Keep everything inside a 64 px margin (x 64–1216, y 40–680).
- Headings sit at the top (y≈44). The working area is y 140–660.
- Layout grid: think in halves (x 64–600 | 680–1216) or thirds. Leave air; empty paper is good.

## Shot rules
1. **One idea per shot.** A shot is 4–12 s of narration. When the idea changes, fade the old elements
   (`until`) and bring in the next. At most ~5 text-bearing elements on screen at once.
2. **≤ 8 words per label**, ≤ 70 characters per bullet, ≤ 5 bullets. The narration carries the detail;
   the board carries the skeleton.
3. **Visuals are timed to the voice.** Every element's `at` should land on (or ~0.2 s before) the word that
   introduces it, using the word timings you are given. Emphasis marks (Underline, CircleHighlight,
   MarkerHighlight) land on the stressed word.
4. **Show, don't list.** If the idea is a *thing* or a *process* (an organ, a cell, weather, a machine, a
   journey, a reaction), draw it with illustrations and make it move (see "Make it move" below). Use charts
   (AxesPlot, NumberLine, BarChart) for quantities, Flow/SideBySide/Table for abstract structure. Bullets are
   the last resort.
5. **Accent sparingly**: vermilion (`accent`) for the one thing to remember in each shot. `indigo`
   and `sage` for secondary series, `muted` for asides.
6. **Gentle camera**: optional `camera` keyframes (zoom ≤ 1.35) to lean into a detail, then return.
   Never more than one camera move per shot.
7. **End on the takeaway**: the last 3–5 s of a scene keep the key idea on screen (a Callout or
   highlighted line), nothing new appearing in the final 1.5 s.
8. **Maths and chemistry**: plain Unicode (², ³, √, π, Σ, μ, σ, x̄, ≈, ≤, −, →). No LaTeX. The fonts have no
   subscripts or superscript signs: write H2O, CO2, O2, Na+, Cl−, K+, Ca²+, HCO3− (not H₂O, Na⁺).

## Direct it like a film
A scene is a short film, not a slide that fills up. (Rules adapted from cinecode and rossark-motion-skill, both MIT.)
- **Hook.** The first 2 seconds already move: the world builds in while the camera is moving. Never open on a still
  title or an empty frame.
- **Shots.** Plan 3–6 shots per scene with `camera` keys and change the framing every 4–8 s, each change on the word it
  serves: wide to establish (zoom 1) → medium on the process (1.3–1.6, centred on it) → close on the detail that
  matters (1.8–2.4) → pull back to connect it to the whole. Adjacent shots differ in size or position. Every move has a
  reason: push in = "look here", pull back = reveal or context, a sideways move = follow what flows. Moves are slow
  and deliberate (`dur` 1.4–3 s); one fast push (0.6–0.8 s) per scene at most, for the key moment. End wide or on the
  takeaway and hold it about 2 s.
- **Depth.** Give elements a `depth`: the backdrop far (−0.7, the Landscape default), the subject 0, foreground framing
  things near (0.6–0.9). When the camera moves, near planes slide more than far ones (parallax). On close shots set
  `focus` to the subject's depth and `dof` 3–6 so the far plane softens; keep every label you need read at the focus
  depth.
- **One lead per moment.** In each beat one thing makes the main move and the eye follows it; supporting elements move
  less. Cause before effect: the sun warms → then vapour rises; the pump turns → then the ions move. A group enters from
  one side; at most a third of the elements move at once, so stagger them across successive words.
- **Text sits in empty space,** never on the drawing; ≤ 6 words per label, on screen for at least 0.6 s + 0.25 s a word.
- **Avoid what makes video look generated:** particles with no physical cause, glow on everything, everything bouncing,
  a centred title on a blank frame, floating cards, a camera that drifts with no reason, consecutive shots that look
  the same, lists of bullets where a picture could move.
- Lighting, shadows, grain and grade are automatic (the light comes from the sun's side). You direct composition,
  timing, camera and depth.

## Make it move: illustrate processes
A learner should *see* the idea happen, not read about it. Every scene about something physical or biological
has at least one living illustration, and the main process is animated in sync with the words that describe it.
- **Big picture first.** The illustration owns the frame (60–80% of it); text is a short Heading plus
  2–4 Labels. Avoid BulletReveal in these scenes.
- **Systems** (one component draws a whole, accurate scene): `Landscape` (water cycle, weather, rivers,
  erosion, geography), `Nephron` (kidney function), `Body` (organs and where they are), `Epithelium`
  (membrane transport: pumps, cotransporters, channels and exchangers moving named ions between lumen and blood).
- **Props** (`Prop`): ~60 drawings: sun, cloud, raincloud, raindrop, mountain, sea, river, tree, plant, kidney,
  heart, lungs, brain, cell, rbc, neuron, dna, atom, magnet, battery, bulb, gear, rocket and more (see the
  catalog). Each has a gentle idle animation already. Compose them into a scene.
- **Processes**: `Particles` streams things along a path (evaporation = `vapor` rising from `land.seaSurface`
  to a cloud; rain = `drop` with spread 60–90; blood = `rbc`; signals = `spark`; light = `photon`; gas
  exchange = `oxygen`/`co2`). `Tube` draws vessels, tubules, roots or wires with `flow` inside. `Journey`
  follows one thing on its trip (a raindrop round the water cycle, food through the gut).
- **Change over time**: `stateKeys` (a bladder filling, a cloud growing, a bulb lighting, a thermometer rising),
  `motion` keys on any element (a cloud drifting toward the mountains, a cell dividing apart), `loop`
  (pulse, float, sway) for life.
- **Connect, don't float**: paths and labels should use anchors (`"land.seaSurface"`, `"n.glomerulus"`,
  `"k.ureter"`) so arrows and flows land exactly on the drawing.
- **Zoom for detail**: one camera move to lean into the part being explained, then back out. Keep the
  Heading `fixed: true` when the camera moves.
- **Accuracy beats decoration** for older learners: label real structure names and show the actual
  mechanism (what moves where and why), as a textbook figure would, but alive.

## Answer clips (doubts)
- Always start with `FrozenFrame` at `at: 0` (the pipeline embeds the paused scene). Hold ~0.6 s, then dim
  it to a faint backdrop (~0.8) so the answer visibly grows out of the lesson without competing with it.
- Put new content in the empty areas of the paused frame where possible; annotate lesson elements with
  `target: "frozen.<id>"` rather than redrawing them.
- Write the learner's question as a short accent line, then answer with one focused visual.
- 15–45 s total. Never re-teach the whole lesson.

## QA checklist (the pipeline lints these)
- No element outside the frame margin; no overlapping text on screen at the same time.
- Every `target` / `from` / `to` refers to an existing element id.
- Entrance animations finish before the scene ends; nothing appears in the last 1.5 s.
- Element ids are unique.
