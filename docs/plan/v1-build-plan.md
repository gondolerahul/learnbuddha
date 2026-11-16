# LearnBuddha v1 — build plan

*2026-11-13 · built from `docs/concept/rough-concept.md` (v0.2)*

## Decisions taken with the user

| Topic | Decision |
|---|---|
| Scope basis | The v0.2 concept doc only: a general "teach me anything" tutor. Older CBSE/pilot decisions do not apply. |
| Rendering | The full video pipeline from the doc: deterministic canvas scenes → ffmpeg fMP4 segments → in-house WebSocket + MSE streaming with playlist splicing. |
| AI services | Claude (`claude-opus-5-5`) plans and writes scripts and scenes (no web search, no fact-check pass since 2026-11-15). Gemini does narration (`gemini-3.8-flash-tts`) and the live voice tutor (`gemini-3.8-live`). |
| Accounts | No auth in v1. One local learner (`learner_id = "local"`), with the column kept so accounts can be added later. |
| Stack | React + Vite + TypeScript · Python FastAPI · Postgres · Node (renderer only) · ffmpeg. |

## Deviations from the concept doc (and why)

1. **Scenes are declarative JSON, not LLM-written code.** Claude writes a *scene spec*: a timeline of Style Kit components with props and times. One deterministic `renderScene(ctx, spec, t)` draws it. The doc's guarantees all hold: pure `render(t)`, re-rendering the exact paused frame, and the same code in browser and worker. There is no untrusted code execution, and Python can validate every spec against `components.json` before rendering.
2. **The job queue is Postgres (`FOR UPDATE SKIP LOCKED`), not Redis/Celery.** It means one less service, Celery's Windows problems are avoided, and priority (barge-in answers first) is a column. It's swappable later.
3. **The renderer is Node + `@napi-rs/canvas` (Skia), not a headless browser.** Rendering is several times faster, the canvas API is the same as the browser's, and frames are piped straight to ffmpeg.
4. **Word timings: TTS runs per sentence.** Gemini TTS doesn't return timestamps. Sentence boundaries are exact (they are what "resume from the start of the sentence" needs), and word times inside a sentence are estimated from character length.
5. **Music is a procedural ambient bed made with ffmpeg**, ducked under narration. Lyria sits behind the same interface and is a later swap.
6. **Frame QA is deterministic.** The renderer's `lint` reports overflow, out-of-frame and overlap problems, and its `fix` command repairs them in code (since 2026-11-15; it used to be one Claude fix round). Vision QA of sampled frames is a later addition.
7. **Storage is local disk** (`backend/media/`) behind a small storage module, with S3/CDN later.
8. **One warm Live connection per lesson session.** Opening a Gemini Live connection takes ~4–5 s, so the session socket opens it when the player loads and keeps it for every interruption. Each barge-in hands over the paused moment as a context note (`send_client_content`, no reply requested) instead of a new system instruction. First audio arrives ~0.8 s after a typed question and within ~1 s of the end of a spoken one. The connection uses sliding-window context compression, is reopened when the server sends `go_away`, drops it, or it passes 8 minutes, and is not reopened after 5 idle minutes.
9. **Illustrations are drawn in code, not generated.** The renderer draws the illustration library and the motion
   components deterministically. There is no AI image or video generation, so there is no per-image cost, the style
   stays consistent, and any paused frame can be re-rendered exactly for answer clips. The trade-off is coverage:
   subjects outside the library are composed from props and shapes. New props and scene systems
   (`renderer/src/art/props.ts`, `renderer/src/components/art.ts`) widen it, and `stylekit/props.json` (regenerated
   on build) tells the scene writer what exists.

## Architecture

```
React player ──WS (fMP4 chunks ↓, mic PCM ↑, JSON control ↕)── FastAPI session socket
                                                                 ├─ playlist + pump (per connection)
                                                                 ├─ voice agent (Gemini Live; Claude text fallback)
                                                                 └─ Postgres (courses, scenes, sessions, Q&A, mastery, jobs)
Worker process(es) ── job queue ── plan_course · produce_scene · produce_answer · produce_remediation
   produce_scene = script (Claude) → narrate (Gemini TTS, sped up ≤12% if long) → animate (spec + layout repair in code)
                   → lint/fix → render (node renderer) | ffmpeg mix+encode → fMP4 + fragment index
```

### Splicing

- Every encode forces keyframes every 1 s **and at every sentence start**, so each sentence start is also an fMP4 fragment start. Resuming at a sentence start therefore needs no re-encode or trimming.
- Barge-in pauses on the client in about 0.2 s (client VAD). The server maps the timeline time to (entry, media time).
  - A voice-only answer → the client seeks back to the start of the sentence, which is still buffered.
  - A visual answer → the server sends `truncate(τ)`, and the playlist becomes `[answer][recap][same scene from sentence start]…`.
- Answer clips open with a `FrozenFrame` element: the paused scene re-rendered at exactly *t*, then dimmed and annotated.

## Feature checklist (v1)

- Course planner: three fixed diagnostic questions (who, level, goal), then a plan (no web search), and an editable outline (drop, reorder, gentler/deeper per lesson).
- Lesson player: word-synced captions, chapter rail, transcript, 0.75–1.5× speed, 10 s rewind, "explain again", typed and voice questions (always-on or push-to-talk).
- Barge-in → voice answer → visual answer from the paused frame → recap card → resume, recursively.
- Checkpoints with tap answers; a wrong answer → misconception text plus an optional remediation scene; mastery per objective.
- Memory: sessions resume, plus the Q&A log, review cards, and end-of-course notes (Markdown download).
- Accessibility: captions on by default, keyboard control, a high-contrast Style Kit (`zen-board-hc-v1`), audio-only view.
- Global cache: courses keyed by topic+level+kit+language, and scenes keyed by content hash.
