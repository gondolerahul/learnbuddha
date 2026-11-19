"""Prompts and JSON schemas for the Claude brain. Static text first so it caches well."""
from __future__ import annotations

import json

from .base import AnswerContext, SceneContext

from .. import kit

TUTOR_PERSONA = (
    "You are LearnBuddha, a calm, patient, ego-less tutor. No question is dumb and nothing is rushed. "
    "You teach like a great private teacher with a whiteboard: concrete, warm, precise, never condescending."
)

# ───────────────────────────── schemas ─────────────────────────────

CUE = {"type": "array", "items": {"type": "integer"}, "description": "[sentence_index, word_index] (0-based)"}
# what a scene can be built on: a set or system drawn by the renderer, or a stage of library pictures ("props")
SET_CHOICES = kit.SETS + kit.SYSTEMS + ["props"]

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "summary": {"type": "string"},
        "level": {"type": "string"},
        "lessons": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "objective": {"type": "string"},
                    "scenes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string"},
                                "objective": {"type": "string"},
                                "key_points": {"type": "array", "items": {"type": "string"}},
                                "visual_idea": {"type": "string"},
                                "target_seconds": {"type": "integer"},
                                "central_image": {"type": "string", "description": "the ONE picture the scene is built on, in a sentence"},
                                "set": {"type": "string", "enum": SET_CHOICES},
                                "opens_with": {"type": "string", "description": "usually empty; rarely, the image from the end of the previous scene this one opens on"},
                            },
                            "required": ["title", "objective", "key_points", "visual_idea", "target_seconds", "central_image", "set", "opens_with"],
                            "additionalProperties": False,
                        },
                    },
                    "checkpoint": {
                        "type": "object",
                        "properties": {
                            "questions": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "question": {"type": "string"},
                                        "options": {"type": "array", "items": {"type": "string"}},
                                        "answer_index": {"type": "integer"},
                                        "explanations": {"type": "array", "items": {"type": "string"}},
                                    },
                                    "required": ["question", "options", "answer_index", "explanations"],
                                    "additionalProperties": False,
                                },
                            }
                        },
                        "required": ["questions"],
                        "additionalProperties": False,
                    },
                },
                "required": ["title", "objective", "scenes", "checkpoint"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["title", "summary", "level", "audience", "lessons"],
    "additionalProperties": False,
}
# audience and style are written before the lessons (models follow the schema's key order), so the first scene can
# be scripted in the right style while the rest of the plan is still being written (pipeline.plan_course)
_p = PLAN_SCHEMA["properties"]
PLAN_SCHEMA["properties"] = {"title": _p["title"], "summary": _p["summary"], "level": _p["level"],
                             "audience": {"type": "string", "enum": ["young_child", "child", "teen", "adult", "professional"]},
                             "style": {"type": "string", "enum": list(kit.STYLE_GUIDE)},
                             "design_read": {"type": "string", "description": "one line: how this course should look, feel and move, and why"},
                             "lessons": _p["lessons"]}
PLAN_SCHEMA["required"] = ["title", "summary", "level", "audience", "style", "design_read", "lessons"]

SHOT = {
    "anyOf": [
        {
            "type": "object",
            "properties": {
                "shot": {"type": "string", "enum": ["wide", "medium", "close", "detail"]},
                "on": {"anyOf": [{"type": "string"}, {"type": "null"}], "description": "what the shot is about: an element id or id.anchor"},
                "move": {"type": "string", "enum": ["cut", "push", "pull", "pan", "follow", "whip", "through", "hold"]},
                "dur": {"anyOf": [{"type": "number"}, {"type": "null"}], "description": "seconds the move takes (null = the move's own pace)"},
                "shake": {"anyOf": [{"type": "number"}, {"type": "null"}], "description": "px of camera shake on an impact, or null"},
            },
            "required": ["shot", "on", "move", "dur", "shake"],
            "additionalProperties": False,
        },
        {"type": "null"},
    ]
}


def scene_schema(answer_mode: bool = False) -> dict:
    types = kit.component_names(include_internal=False) + (["FrozenFrame"] if answer_mode else [])
    return {
    "type": "object",
    "properties": {
        "sentences": {"type": "array", "items": {"type": "string"}},
        "beats": {
            "type": "array",
            "description": "3-6 beats, written BEFORE the elements: the scene's plan",
            "items": {
                "type": "object",
                "properties": {
                    "cue": CUE,
                    "change": {"type": "string", "description": "what changes in the picture on this word (one thing)"},
                    "lead": {"type": "string", "description": "id of the element that makes the main move"},
                    "shot": SHOT,
                    "hold": {"type": "boolean", "description": "true = a rest: no new element and no camera move for a while"},
                },
                "required": ["cue", "change", "lead", "shot", "hold"],
                "additionalProperties": False,
            },
        },
        "elements": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "type": {"type": "string", "enum": types},
                    "cue": CUE,
                    "until_cue": {"anyOf": [CUE, {"type": "null"}]},
                    "dur": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                    "props_json": {"type": "string", "description": "the component props as a JSON object string"},
                    "fixed": {"type": "boolean", "description": "true = stays put during camera moves (headings)"},
                },
                "required": ["id", "type", "cue", "until_cue", "dur", "props_json", "fixed"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["sentences", "beats", "elements"],
    "additionalProperties": False,
    }


TUTOR_SCHEMA = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["question", "control", "noise"]},
        "say": {"type": "string"},
        "control": {"type": "string", "enum": ["none", "slower", "faster", "repeat", "skip", "resume", "pause"]},
        "visual": {"type": "boolean"},
        "concept": {"type": "string"},
        "marks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "target": {"type": "string"},
                    "mark": {"type": "string", "enum": ["circle", "arrow", "underline"]},
                    "label": {"type": "string"},
                },
                "required": ["target", "mark", "label"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["kind", "say", "control", "visual", "concept", "marks"],
    "additionalProperties": False,
}

# ───────────────────────────── system prompts ─────────────────────────────


def planner_system() -> str:
    return f"""{TUTOR_PERSONA}

You are the COURSE PLANNER. Given a topic, the learner's goal, the time they have and their answers to
diagnostic questions, design a short course taught as narrated motion-graphics scenes.

Rules:
- Structure: lessons → scenes. Each scene is one idea, 30–75 seconds of narration (target_seconds).
- The very first scene of the course is a hook of 15–20 seconds: one vivid, concrete picture of the question the
  course answers (what the learner will be able to see or explain by the end). It plays while the rest is prepared.
  Total narration ≈ the learner's available minutes (do not exceed it by more than 15%).
- Order ideas so each builds on the last; start from what the learner already knows.
- Every scene: a learning objective, 2–4 key points (the facts the scene must teach, precise and checkable),
  and a visual_idea: the animated picture that carries the idea. For anything physical, biological or a process,
  describe the illustration and what MOVES (e.g. "Landscape: vapour rises from the sea into a growing cloud that
  drifts to the mountains and rains"; "Nephron: blood enters the glomerulus, filtrate flows down the tubule,
  glucose and water return to the capillaries"; "Body with kidneys highlighted, urine flowing to the bladder").
  Use plots/number lines/tables only for quantities and abstract structure. Never "a list of bullet points".
- `audience`: who is learning, from their answers and goal: young_child (≈5–7), child (≈8–11), teen,
  adult, or professional (e.g. medical, engineering). Children get a picture-book style with a guide
  character, simpler words and shorter scenes (20–45 s); professionals get precise terminology and mechanism.
- `design_read`: one line on how this course should look, feel and move, and why (e.g. "calm and precise, one
  continuous cutaway of the synapse; the camera moves only to follow the signal"). Not just adjectives.
- Every scene also gets a `central_image` (the ONE picture the whole scene is built on, which changes but is never
  replaced) and a `set`: what the renderer draws it with. Prefer a set when one fits: Synapse (nerve signals),
  Cell (organelles, protein making), Molecule/Reaction (chemistry), Orbits (planets, moons, days and years),
  Machine (gears, levers, pulleys, engines), Circuit (electricity), Timeline (history, sequences of dates),
  WorldMap (geography, empires, trade, migration), TokenGrid (proportions, "1 in N", populations), Bars
  (comparisons), Contraption (an abstract process: input, machine, output), Landscape (weather, water, land),
  Nephron/Body/Epithelium (physiology). Otherwise "props" (a stage of 2-4 library pictures).
  The `visual_idea` then says what MOVES in that image, in order.
- `opens_with` is "" for almost every scene. Only when one scene's last image is a natural door into the next (a
  push into the cell that the next scene explores) write that image there. Never chain every scene.
- `style`: the visual style that suits this subject and learner best:
{chr(10).join(f"  · {k}: {v}" for k, v in kit.STYLE_GUIDE.items())}
  For children choose storybook-v1 or papercut-v1 (or watercolor-v1 for nature topics). Pick by what the lessons
  must show, not by the subject's name alone.
- Each lesson ends with a checkpoint of 1–2 multiple-choice questions (3–4 options). For every option give
  an explanation: for wrong options, name the specific misconception gently; for the right one, why it's right.
- Teach only what is well established. When a fact is uncertain or disputed, leave it out rather than guess.
- `level` describes the learner in a short phrase (e.g. "comfortable with basic algebra").
- Write everything in the requested language."""


def direction_rule(seconds: float) -> str:
    """Concrete shape for this scene's length (the direction brief explains why)."""
    s = max(15.0, float(seconds or 45))
    lo, hi = (3, 4) if s < 30 else (4, 5) if s < 55 else (4, 6)
    return (f"Direction for {int(s)} s: {lo}-{hi} beats of uneven length on one set; at least one hold after the key reveal; "
            "2-5 shots with different framings; at most 2 text blocks besides labels; nothing new in the last 1.5 s.")


def scene_system(answer_mode: bool = False, kit_id: str = "", sets: list[str] | None = None) -> str:
    kit_id = kit_id if kit_id in kit.KITS else kit.DEFAULT_KIT
    golden = "\n".join(json.dumps(g, ensure_ascii=False) for g in kit.golden_scenes(kit_id, answer_mode=answer_mode))
    return f"""{TUTOR_PERSONA}

You are the SCENE WRITER and its DIRECTOR. You write the narration for one scene AND direct its visuals as a timeline
of Style Kit components. A deterministic renderer draws and animates your timeline on a 1280x720 canvas; narration is
synthesised sentence by sentence and every element is timed to a word of that narration. Learners must SEE the idea
happen, in a picture that looks designed and shot, not assembled.

# The look: {kit.KITS[kit_id]}
{kit.skill_md(kit_id)}

{kit.direction_md()}

# Components
{kit.component_reference(answer_mode=answer_mode, kit_id=kit_id, sets=sets)}

# Output format
- `sentences`: the narration, one spoken sentence per item, conversational and clear. Keep strictly within the
  word budget you are given: the video is exactly as long as its narration. Speak to the learner ("you").
  No markdown, no stage directions, no emojis. Spell maths for the ear ("n minus one"), while the board shows symbols.
- `beats`: write these FIRST. 3-6 beats, each with the `cue` [sentence, word] of the word that names its change, the
  `change` in a few words, the `lead` element id, a `shot` (or null to keep the framing) and `hold` (true for a rest).
  Shots: `shot` wide | medium | close | detail, `on` an element id or "id.anchor", `move` cut | push | pull | pan |
  follow | whip | through | hold. The engine frames every shot itself: never write coordinates for the camera.
- `elements`: each has a unique `id`, a `type`, a `cue` (0-based [sentence, word]; words are the sentence split on
  spaces) for when its entrance begins, `until_cue` for when it fades out (null = stays), `dur` (null = default), and
  `props_json`: the props as a JSON object string, exactly matching the component's props (no extra keys).
  Any time inside props is written as a cue: list items (`stages`, `labels`, `events`, `regions`, `routes`, `pins`,
  `groups`, `items`, `motion`, `poses`, `flows`, `stateKeys`, ...) take `"cue": [s,w]` instead of `at`, a nested
  object likewise (`flood`, `highlight`), and a time prop named fooAt is written fooCue (e.g. Stamp `strikeCue`).
  BulletReveal takes `"cues": [[s,w], ...]`.
- Reference other elements in `target`/`from`/`to`/`path`/`pointAt`/`on` by id, or by "id.anchor" to hit a named
  point of a set or picture (e.g. "syn.cleft", "land.seaSurface", "map.Rome"). Only ids you defined and listed anchors.

# Example scenes in this look (the format you write, with props shown as objects for readability)
{golden}"""


def tutor_system() -> str:
    return f"""{TUTOR_PERSONA}

You are the live tutor. The learner just interrupted the lesson. Decide what the interruption is:
- "question": a real doubt. Answer it in `say` in 1–3 short spoken sentences (≤ 45 words), warm and concrete,
  tied to what is on screen. Set `visual` true when a picture would genuinely help (a conceptual why/how,
  a comparison, a process) and false for quick factual or yes/no doubts.
- "control": a playback command (slower, faster, repeat, skip, resume/continue, pause). Set `control`,
  and `say` a very short acknowledgement ("Sure — slowing down.").
- "noise": a cough, background chatter, an accidental sound, or nothing meaningful. `say` "" and control "resume".
`concept` = a 2–5 word name of the concept asked about (for review cards), or "".
`marks`: when the answer is about something already on screen, up to 3 marks drawn on the paused frame instantly:
`target` = an [id] from the on-screen list, `mark` = circle | arrow | underline, `label` = at most 6 words or "".
Otherwise [].
Reply in the course language."""


# ───────────────────────────── user prompts + wire format (shared by all brains) ─────────────────────────────


def from_wire(raw: dict) -> dict:
    """props_json strings → props dicts. Unparseable props become a validation issue."""
    elements = []
    for el in raw.get("elements", []):
        try:
            props = json.loads(el.get("props_json") or "{}")
            if not isinstance(props, dict):
                raise ValueError("props must be an object")
        except (json.JSONDecodeError, ValueError) as e:
            props = {"__invalid__": f"props_json could not be parsed: {e}"}
        elements.append({k: v for k, v in el.items() if k != "props_json"} | {"props": props})
    return {"sentences": [s.strip() for s in raw.get("sentences", []) if s.strip()], "beats": raw.get("beats", []) or [], "elements": elements,
            "camera": raw.get("camera", []) or []}


def to_wire(draft: dict) -> dict:
    return {
        "sentences": draft["sentences"],
        "elements": [{k: v for k, v in el.items() if k != "props"} | {"props_json": json.dumps(el.get("props", {}), ensure_ascii=False)} for el in draft["elements"]],
        "beats": draft.get("beats", []),
    }


def scene_user(ctx: SceneContext) -> str:
    first = ctx.index_in_lesson == 0 and ctx.mode == "lesson"
    mode_note = {
        "lesson": "",
        "remediation": f"\nTHIS IS A REMEDIATION SCENE. The learner answered a checkpoint wrongly, showing this misconception: {ctx.misconception}\n"
        "Gently name the misconception, show why it's tempting, then show the correct idea with a different visual than before. 25–45 s.",
        "simpler": "\nTHIS IS AN 'EXPLAIN AGAIN' SCENE. The learner asked for this scene again, more simply. Use a simpler analogy, "
        "smaller steps, fewer symbols, and a different visual. Original narration for reference:\n" + " ".join(ctx.original_script),
    }[ctx.mode]
    return f"""Course: {ctx.course_title}
Learner: {ctx.level}
Language: {ctx.language}
Lesson: {ctx.lesson_title} — objective: {ctx.lesson_objective}
Scene {ctx.index_in_lesson + 1} of {ctx.scenes_in_lesson}: {ctx.scene_title}
Scene objective: {ctx.scene_objective}
Key points to teach (all must be covered, accurately):
{chr(10).join('- ' + k for k in ctx.key_points)}
Visual idea from the planner: {ctx.visual_idea}
Central image: {ctx.central_image or ctx.visual_idea}
Built on: {ctx.set_name or "your choice of set or library pictures"}
How the course should feel: {ctx.design_read or "(not given)"}
{opening_note(ctx)}
{length_rule(ctx.target_seconds, ctx.kit)}
{direction_rule(ctx.target_seconds)}
Previous scene ended with: {ctx.previous_summary or '(this is the first scene)'}
Next scene: {ctx.next_title or '(none — wrap this lesson up)'}
{"Open with a TitleCard for the lesson title, faded out before the content." if first else "Do not use a TitleCard; open straight into the idea with a Heading."}
{mode_note.strip()}

Write the scene."""


def opening_note(ctx: SceneContext) -> str:
    if ctx.opens_with:
        return f"Open on this image, where the previous scene ended: {ctx.opens_with}"
    return "Open in a fresh image of your own."


def scene_sets(ctx: SceneContext) -> list[str] | None:
    """The sets whose docs this scene's prompt carries (all of them when the planner named none)."""
    return [ctx.set_name] if ctx.set_name and ctx.set_name != "props" else None


def length_rule(seconds: float, kit_id: str) -> str:
    b = kit.word_budget(seconds, kit_id or kit.DEFAULT_KIT)
    return (f"Length: {int(seconds)} seconds of narration = AT MOST {b['words']} words in total, in at most {b['sentences']} sentences "
            f"of at most {b['per_sentence']} words each. The narrator speaks about {b['wps']:.1f} words a second, so every extra word "
            "makes the video longer than planned; cut detail rather than exceed the budget.")


def answer_user(ctx: AnswerContext) -> str:
    vis = "\n".join(f"- frozen.{v['id']} ({v['type']}): {v['text']}" for v in ctx.visible) or "(nothing)"
    return f"""Course: {ctx.course_title}
Learner: {ctx.level}
Language: {ctx.language}
The learner paused the lesson scene "{ctx.scene_title}" at {ctx.paused_t:.1f}s, during this sentence:
"{ctx.script[ctx.sentence_index] if ctx.script else ''}"
Scene narration up to there: {' '.join(ctx.script[: ctx.sentence_index + 1])}

On screen when they paused (you may target these with `target`/`from`/`to` = "frozen.<id>"):
{vis}

Recent questions: {json.dumps(ctx.recent_qa[-3:], ensure_ascii=False)}

Their question: "{ctx.question}"

Write a VISUAL ANSWER clip of about 30 s. {length_rule(30, ctx.kit)} The tutor has already given a one-line spoken answer, so go one
level deeper with a visual. Start with a FrozenFrame element (id "bg", cue [0,0], props {{"t": {ctx.paused_t:.2f}, "dim": 0.8}})
so the answer grows out of the paused frame; then write the question as a short accent line and answer it with one
focused visual. End by connecting back to the lesson in one sentence."""
