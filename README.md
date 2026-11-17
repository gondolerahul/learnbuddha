# LearnBuddha

A patient, real-time video tutor. You name a topic, and it plans a short course and teaches it as narrated,
hand-drawn motion graphics. Interrupt at any moment: it answers out loud, sketches a visual answer that starts
from the exact frame you paused on, plays a short recap card, and resumes at the start of the interrupted sentence.

Concept: [docs/concept/rough-concept.md](docs/concept/rough-concept.md) · Build plan and deviations: [docs/plan/v1-build-plan.md](docs/plan/v1-build-plan.md)

## Layout

| Path | What |
|---|---|
| `renderer/` | **Style Kit + deterministic renderer** (TypeScript). `renderScene(ctx, spec, t)` draws a declarative scene spec. It runs in Node (`@napi-rs/canvas`) for the workers and in the browser for previews. `stylekit/` holds tokens, `components.json` (prop schemas), `SKILL.md` (shot grammar) and the golden scenes. |
| `backend/` | **FastAPI + Postgres**: REST API, the session WebSocket (playlist pump, splicing, checkpoints, voice relay), the Postgres job queue and workers, and the video factory (Claude → TTS → spec → lint/fix → render → ffmpeg fMP4). |
| `frontend/` | **React + Vite**: course builder, outline editor, and the MSE lesson player (captions, chapters, transcript, Q&A, barge-in, checkpoints, end-of-course notes). Also the Style Kit gallery. |

## Run it (Windows dev box)

Prerequisites: Python 3.11+, Node 20+, ffmpeg on PATH, PostgreSQL 17 binaries.

```bash
npm install
```

```bash
npm run build:renderer
```

```bash
cd backend && py -m venv .venv && .venv/Scripts/pip install -r requirements.txt && cp .env.example .env
```

Start the dev database (a project-local cluster on port 5433, separate from any Postgres service you already run):

```bash
"/c/Program Files/PostgreSQL/17/bin/pg_ctl.exe" -D .dev/pgdata -o "-p 5433" -l .dev/pg.log start
```

For a first-time setup, create it with `initdb -D .dev/pgdata -U learnbuddha -A trust` and `createdb -p 5433 -U learnbuddha learnbuddha` (plus `learnbuddha_test` for tests). `docker compose up -d` also works (same port and credentials).

Then run the API (its workers run in-process) and the web app:

```bash
backend/.venv/Scripts/python -m uvicorn app.main:app --app-dir backend --port 8000
```

```bash
npm run dev:web
```

Open http://localhost:5173.

### Keys (`backend/.env`)

| Variable | Effect when set | Without it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude (`claude-opus-5-5`) plans courses (no web search), writes the narration and scene specs, writes visual answers and runs the typed tutor. Everything else is code: the diagnostic questions are a fixed form, layout problems are repaired by the renderer (`fix`), and an over-long narration is spoken up to 12% faster instead of being rewritten. | An **offline mock brain** produces canned, generic content, so the whole pipeline is demoable. |
| `GEMINI_API_KEY` | `gemini-3.8-flash-tts` narrates. The **always-on voice tutor** (`gemini-3.8-live`) hears you and answers in about a second. | The Windows SAPI voice narrates (dev stand-in), and the tutor is typed: your browser speaks its replies, and the mic uses browser speech recognition where available. |
| `GOOGLE_CLOUD_PROJECT` | **Vertex AI** for every Gemini model: the Gemini brain (`gemini-4-hydrogen` from the `us` multi-region, falling back to `gemini-4-argon` if Hydrogen is unavailable. `/api/health` shows how many calls each model served), TTS (`gemini-3.8-flash-tts`, location `global`) and Live voice (`gemini-3.8-live`, `us-central1`; one connection is kept warm per open lesson, so the tutor starts speaking about a second after you finish). Auth is ADC or `GOOGLE_APPLICATION_CREDENTIALS`. | Gemini uses `GEMINI_API_KEY` (Developer API) if set. |

With both Claude and Gemini configured, each course can choose its tutor model on the home page (`BRAIN_PROVIDER` sets the default).

The app sets the Anthropic base URL explicitly, so an inherited `ANTHROPIC_BASE_URL` in your shell is ignored.

## How it works

- **Pictures that move.** The renderer has an illustration library drawn in code (`renderer/src/art/`).
  About 60 props (sun, clouds, rain, sea, mountains, plants, organs, cells, neurons, DNA, atoms, circuits, everyday
  objects) each come with a gentle idle animation. Motion components bring processes to life: `Particles`
  (evaporation, rain, blood cells, electrons), `Tube` (vessels and pipes with flow), `Journey` (one thing's trip) and
  `Label` (leader-line labels). There are scene systems for whole topics: `Landscape` for the water cycle and
  geography, `Nephron` for kidney function, `Epithelium` for membrane transport (pumps, cotransporters, channels and exchangers moving named ions between lumen and blood) and `Body` for organs. Any element can also take `motion` keyframes or an
  idle `loop`. Elements connect through named anchors (`"land.seaSurface"`, `"n.glomerulus"`), so flows land exactly
  on the drawing.
- **Directed and finished like a film.** Every scene is shot, not just laid out:
  - **Camera:** moves on cues with inertia easing, a slow push and operator drift so it is never dead, parallax by
    `depth`, and depth of field on close shots.
  - **Motion:** spring entrances in the kit's tone, and a guide character who acts (flowing poses, follow-through,
    timed blinks, gaze).
  - **Light:** props are lit from the scene's key light with soft lift and contact shadows. Landscapes have sky glow,
    light shafts, aerial perspective, a sea that sparkles and foreground framing.
  - **Finish:** the encoder adds halation, a per-kit colour grade, a vignette and moving film grain.
  - **Sound:** a quiet effects track (pops, ticks, rises, whooshes, chimes) is generated from the scene's actions.
  - **Credits:** the motion engine and direction rules adapt cinecode and rossark-motion-skill (both MIT, see
    `NOTICE.md`).
- **A style library (11 kits).**
  - **What a kit is:** each kit is one `tokens.json` plus a short `SKILL.md`. It sets the palette, the drawing
    treatment, the surface, the texture, the light, the motion tone, the camera drift, the film finish and the narrator.
  - **How a style is chosen:** with the style left on "Fits the subject and learner", the planner picks one from
    the subject (`kit.STYLE_GUIDE`). Children always get a child-friendly kit.

  | Kit | For | Treatment |
  |---|---|---|
  | Zen Board | general default | ink on paper |
  | Zen Board · High contrast | accessibility (chosen by hand) | crisp black on white |
  | Storybook | children | cartoon, faces, Buddy the guide |
  | Paper cut-out | young learners, stories | layered paper with crisp shadows, animated on twos |
  | Chalkboard | maths, physics | broken chalk lines on a slate board |
  | Blueprint | engineering, machines | white linework on blue grid paper |
  | Field notes | biology, nature, geography | watercolour washes and a pen line |
  | Clinical schematic | medicine, anatomy, chemistry | clean textbook figures, serif labels |
  | Dark cinematic | space, the very large and small | glowing subjects on a dark set |
  | Ink wash | literature, philosophy, culture | grey brush washes, one red seal accent |
  | Comic | stories and events for teens | bold ink, cel shading, halftone, animated on twos |
- **The look follows the learner.** The planner decides who is learning (`audience`). With the style left on "Fits
  the learner", children get the **Storybook** kit: bright colours, friendly faces, short words and Buddy, a guide
  character who talks, points and cheers in time with the narration. Everyone else gets **Zen Board**, with accurate,
  labelled, animated schematics.
- **Rich scenes.** The scene writer's prompt ends with a four-layer checklist: a place (a Landscape, a body system, or a stage of library pictures, even for maths), 4+ different pictures, 5+ things moving with a physical cause, and 4–6 camera shots. Each scene request gives exact counts for its length (an element about every 2.5 s). Small prop mistakes (a value past its limit, an unknown option) are mended in code rather than losing the element.
- **Scenes are data.** Claude writes `sentences` (narration) plus `elements`, each timed by a word cue `[sentence, word]`. TTS runs per sentence, which gives exact sentence boundaries. Cues resolve to real times, the spec is validated against `components.json`, and the renderer lints the layout (overflow, overlap, out-of-frame, bad targets) and repairs it in code: it moves text to the nearest free space, shrinks what cannot fit, ends an earlier text when a later one needs its place, and drops annotations whose target is missing. The checks run as the camera frames each shot: text that appears during a push-in must be fully in it (the fixer reframes the shot), earlier text may leave the shot but not be half cut (it leaves as the push-in starts), and pinned headings must not cover pictures anywhere the camera carries them, including a landscape's sun, trees and clouds. Pictures are never moved, since where the sun is can be the lesson. No model call; about half a second a scene.
- **Speed.** The plan is streamed: the first scene (a 15–20 s hook) is queued as soon as its outline appears, while the rest of the plan is still being written. All of a course's scenes are scripted at once (`WORKER_THREADS`, default 8); renders queue at the render gate. A scene starts streaming while it is still rendering, once the render is far enough ahead that playback cannot catch it. Lit pictures are kept as sprites (idle loops step 12 times a second) and video is 24 fps. `SCENE_THINKING` (default medium) sets how hard the model thinks before writing a scene.
- **Instant answers.** While the voice tutor answers, it can call `point_at` to circle, arrow or underline something on the paused frame; the browser draws it at once from the same renderer. Clips (`show_visual_answer`) are for doubts that need a new picture.
- **Render.** Scene jobs overlap their model calls, and lesson renders are gated, earliest scene first (`RENDER_SLOTS`, default 3 at once); a learner's answer, recap or re-explanation never waits. On a throttling 12-thread laptop, one render at a time won clip benchmarks but lost in a real course, so tune it on the deployment machine. Node renders frames on several threads (`RENDER_THREADS`) and streams raw RGBA, in order, over TCP into ffmpeg (Windows pipes are too slow); every frame is a pure function of time, so threaded output is byte-identical to single-threaded. A 30 s illustrated scene renders in about 20 s on a 12-core machine. The narration is mixed with a ducked procedural ambient bed. The encode is H.264 Main without B-frames plus AAC, fragmented MP4, with **a keyframe and fragment boundary at every sentence start**.
- **Stream.** One WebSocket per session. The server pumps fMP4 fragments about 18 s ahead of the playhead. The client appends them to one `SourceBuffer` with a per-entry `timestampOffset`. A splice (answer → recap → resume) is a `truncate(τ)` plus new playlist entries, with no re-encoding.
- **Voice.** The player's session socket opens a Gemini Live connection as soon as the lesson loads and keeps it. Each interruption sends a short note about the paused moment (scene, narration so far, what's on screen) into that open connection, so the tutor can start answering in about a second instead of waiting ~5 s for a new connection.
- **Answers.** The answer clip opens with `FrozenFrame`: the paused scene re-rendered at exactly *t*, dimmed, and annotated (`target: "frozen.<id>"`). An express worker lane keeps answers from queuing behind lesson renders.
- **Caching.** Courses are keyed by topic, goal, time, answers, kit and language, and reused across learners. Scenes are keyed by content hash, so outline edits and gentler/deeper re-plans only re-render what changed.

## Costs (INR)

Every paid model call is priced and stored in `usage_events`: Claude, the Gemini brain, Gemini TTS narration and Gemini Live voice replies. Each row has the tokens the API reported, the list price
that applied that day and the USD→INR rate used, and is tagged with its course, scene and learning session. You can see
the costs in three places:

- **Costs** in the top bar shows every operation, with totals per operation and per course.
- **The course page** shows what that course has cost so far.
- **The player's Cost tab** shows the current session: voice replies plus the scripts and narration of visual answers.

Prices live in `backend/app/costs.py` with their sources. They are list prices, so Search's 5,000 free searches a month
and any discounts are not subtracted. The INR rate is fetched from open.er-api.com every 12 hours (`FX_LIVE`); set
`USD_INR` in `backend/.env` to fix it. Rendering runs locally and costs nothing.

## Tests

```bash
cd backend && .venv/Scripts/python -m pytest -q
```

```bash
node renderer/dist/cli.mjs selftest
```

The backend end-to-end test drives the whole loop over a real WebSocket using the mock brain and silent narration: plan → render → stream → interrupt → visual answer splice → resume at the sentence start → checkpoint → remediation. `selftest` renders and lints the golden scenes.

## Not in v1 (yet)

Auth and accounts (`learner_id` is fixed to `local`); S3/CDN storage (local disk now); Lyria music; vision QA of
rendered frames; KaTeX stroke-by-stroke maths; parallel frame-range rendering per scene; true low-bandwidth audio-only
segments (audio-only is a view mode).
