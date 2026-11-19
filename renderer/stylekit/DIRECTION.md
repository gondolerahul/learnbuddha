# Direct it like a film
A scene is one short film about ONE idea in ONE place. The learner should want to keep watching with the sound off.
The craft lives in the sets, the kit and the camera engine; your job is to direct them.

## One set, one central image
- Build the scene on the set the plan names (Synapse, Cell, Reaction, Orbits, Machine, Circuit, Timeline, WorldMap,
  TokenGrid, Bars, Contraption, Landscape, Nephron, Body, Epithelium) or, when none fits, a small stage of 2-4 library
  pictures arranged as ONE picture (a kitchen, a street, a desk). The set fills 60-85% of the frame.
- The set stays for the whole scene. It changes state (its `stages`, a part lit with `highlight`, a picture that
  arrives or moves) instead of being replaced. Never a new picture for every sentence.
- A second set only when the idea truly moves to a new place; join them with ONE `Transition` (the kit's own), and
  start the new set and end the old one on the Transition's cue.
- Never stand in for a real thing with a box, a ball or a plain circle. If no set or prop shows it, choose a
  different, concrete image (a Contraption for a process, a TokenGrid for a proportion).

## Beats
- Plan the scene as 3-6 `beats` before you write the elements. Each beat begins on the word that names its change and
  changes ONE thing: a stage begins, a part is labelled or lit, something arrives, the camera reframes.
- Beats have uneven lengths (one of 3 s, one of 12 s). An even rhythm reads as a slideshow.
- One lead per beat: one element makes the main move and the eye follows it. Cause before effect: the spike arrives,
  then calcium flows; the sun warms the sea, then vapour rises.
- Rests: after the key reveal, a beat with `hold: true` and no shot change: nothing new for at least 1.5 s while the
  narrator explains. Rests are what make the moves land.

## The camera
- Each beat may set a `shot`: `shot` wide (the whole set) | medium | close | detail, `on` what it is about (an element
  id or "id.anchor"), `move`:
  cut (a new set-up, instantly) · push (slowly in: "look here") · pull (back out: reveal, context) · pan (sideways
  at the same size: follow what flows) · follow (pan from the first target to the last: `on` a list of two) ·
  whip (a very fast pan to the next thing; at most one per scene) · through (dive into the target; the next beat
  starts inside it; at most one) · hold (stay).
- The engine frames the target and its labels; you never write coordinates.
- A typical arc: wide to establish → push to medium on the process → close on the detail that matters → pull back
  wide to connect it to the whole. Adjacent shots differ in size or subject. 2-5 shots in a scene, not one per
  sentence. Close shots soften the background automatically.
- `shake` (4-10 px) only on a real impact or a reversal.

## Words on screen
- Text is a label, not a slide. Name parts with the set's own `labels` (they sit in the set's free space and step
  aside when the camera pushes past them) or with `Label` elements pointing at anchors. At most 5 words a label.
- At most 2 text blocks besides labels in a scene: a Heading (fixed) and, at the end, one takeaway (a Callout or a
  Stamp). No bullet lists where a picture can move.
- Numbers deserve a device: Counter, Bars (`race` to compare), TokenGrid ("1 in 12").

## What makes video look generated (avoid)
A new picture for every sentence; boxes and circles standing in for things; labels pointing at empty space; text on
top of the drawing; particles, sparkles or glow with no physical cause; everything moving at once; the camera moving
in every beat; the same framing twice in a row; an even beat every few seconds; a centred title on an empty frame.

## Frame and type facts
- Logical canvas 1280x720, origin top-left; keep everything inside x 64-1216, y 40-680. A fixed Heading sits at
  y≈44; the working area is y 140-660.
- Maths and chemistry: plain Unicode (², ³, √, π, Σ, ≈, ≤, −, →). No LaTeX. The fonts have no subscripts or
  superscript signs: write H2O, CO2, Na+, Cl−, Ca²+.
- Entrances finish before the scene ends; nothing appears in the last 1.5 s; element ids are unique.

## Answer clips (doubts)
- Start with `FrozenFrame` at cue [0,0] (the paused lesson); it dims so the answer grows out of it.
- Annotate lesson elements with `target: "frozen.<id>"`, write the question as a short accent line, then answer with
  ONE focused visual (a set at a new stage, a close shot). 15-45 s. Never re-teach the whole lesson.
