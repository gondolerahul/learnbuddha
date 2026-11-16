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
                            },
                            "required": ["title", "objective", "key_points", "visual_idea", "target_seconds"],
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
PLAN_SCHEMA["properties"]["audience"] = {"type": "string", "enum": ["young_child", "child", "teen", "adult", "professional"]}
PLAN_SCHEMA["properties"]["style"] = {"type": "string", "enum": list(kit.STYLE_GUIDE)}
PLAN_SCHEMA["required"].append("style")

def scene_schema(answer_mode: bool = False) -> dict:
    types = kit.component_names(include_internal=False) + (["FrozenFrame"] if answer_mode else [])
    return {
    "type": "object",
    "properties": {
        "sentences": {"type": "array", "items": {"type": "string"}},
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
        "camera": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "cue": CUE, "x": {"type": "number"}, "y": {"type": "number"}, "zoom": {"type": "number"},
                    "dur": {"type": "number", "description": "seconds the move takes, starting at the cue"},
                    "focus": {"anyOf": [{"type": "number"}, {"type": "null"}], "description": "depth plane in focus, -1..1"},
                    "dof": {"anyOf": [{"type": "number"}, {"type": "null"}], "description": "depth-of-field blur, 0 (none) to 8"},
                },
                "required": ["cue", "x", "y", "zoom", "dur", "focus", "dof"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["sentences", "elements", "camera"],
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
    },
    "required": ["kind", "say", "control", "visual", "concept"],
    "additionalProperties": False,
}

# ───────────────────────────── system prompts ─────────────────────────────


def planner_system() -> str:
    return f"""{TUTOR_PERSONA}

You are the COURSE PLANNER. Given a topic, the learner's goal, the time they have and their answers to
diagnostic questions, design a short course taught as narrated motion-graphics scenes.

Rules:
- Structure: lessons → scenes. Each scene is one idea, 30–75 seconds of narration (target_seconds).
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
- `style`: the visual style that suits this subject and learner best:
{chr(10).join(f"  · {k}: {v}" for k, v in kit.STYLE_GUIDE.items())}
  For children choose storybook-v1 or papercut-v1 (or watercolor-v1 for nature topics). Pick by what the lessons
  must show, not by the subject's name alone.
- Each lesson ends with a checkpoint of 1–2 multiple-choice questions (3–4 options). For every option give
  an explanation: for wrong options, name the specific misconception gently; for the right one, why it's right.
- Teach only what is well established. When a fact is uncertain or disputed, leave it out rather than guess.
- `level` describes the learner in a short phrase (e.g. "comfortable with basic algebra").
- Write everything in the requested language."""


RICHNESS = """# Make it rich: a world to watch, not a diagram on paper
A learner should want to keep watching even with the sound off. Build every scene in four layers:
1. **A place.** The idea happens somewhere. Open in it: a Landscape for weather, water, geology, ecology, light and sky;
   a Body, Nephron or Epithelium for physiology; a stage of library pictures for everything else (a kitchen of props
   for chemistry, a street of people and cars for statistics, planets and a rocket for physics). Abstract maths still
   gets concrete things to count, weigh or move (coins, balls, people, books). Never leave the learner on blank paper
   for more than the first second.
   A Landscape already draws its own sun, clouds and trees: to place your own sun Prop, set the Landscape's `sun` to
   "none" so there is only one.
2. **A cast of pictures.** Use 4 or more DIFFERENT illustrations from the prop catalog, each one standing for a real
   thing in the explanation, and scale them so the subject fills the frame. Repeat a picture (many drops, many people)
   when quantity is the point.
3. **Things happening.** Every key point is acted out, not stated: something flows, grows, splits, travels, turns or
   changes state on the word that names it (Particles, Tube, Journey, `motion`, `stateKeys`, `loop`, Guide `poses`).
   Aim for 5 or more moving elements per scene, each with a physical cause.
4. **Direction.** 4–6 camera shots on the words they serve, `depth` on the backdrop (far) and the subject (0), and
   short Labels pointing at the drawing. Words on screen are labels; a Callout or BulletReveal only for the takeaway.

Pace: something new enters about every 2.5 seconds (the scene request gives the exact counts). Enter elements on the
words that name them and retire ones that are done with `until_cue`, so the frame keeps changing without clutter.

References must exist: `target`, `from`, `to`, `path` points and `pointAt` may only name ids you defined earlier in
this scene or anchors listed for that component or prop kind. Otherwise use [x, y] coordinates.

Before you answer, check: Is there a place? 4+ different pictures? 5+ things moving, each caused? A new element every
~2.5 s? 4+ shots? Every reference defined? If any answer is no, add to the scene until it is yes."""


def richness_rule(seconds: float) -> str:
    """Concrete counts for this scene's length (the system prompt explains why)."""
    s = max(15.0, float(seconds or 45))
    return (f"Richness for {int(s)} s: at least {max(8, round(s / 2.5))} elements in total, at least 4 different prop kinds, "
            f"at least {max(3, round(s / 9))} moving elements, {max(3, min(6, round(s / 9)))} or more camera shots, a place "
            "(see \"Make it rich\"), and at most 2 blocks of text besides labels.")


def scene_system(answer_mode: bool = False, kit_id: str = "") -> str:
    kit_id = kit_id if kit_id in kit.KITS else kit.DEFAULT_KIT
    golden = "\n".join(json.dumps(g, ensure_ascii=False) for g in kit.golden_scenes(kit_id))
    return f"""{TUTOR_PERSONA}

You are the SCENE WRITER. You write the narration for one scene AND its visuals as a timeline of Style Kit
components. A deterministic renderer draws and animates your timeline on a 1280×720 canvas; narration is
synthesised sentence by sentence and every element is timed to a word of that narration. Learners must be
able to SEE the idea happen: illustrate and animate it, don't just write it.

# Style Kit: {kit.KITS[kit_id]}
{kit.skill_md(kit_id)}

# Components
{kit.component_reference(answer_mode=answer_mode)}

# Output format
- `sentences`: the narration, one spoken sentence per item, conversational and clear. Keep strictly within the
  word budget you are given: the video is exactly as long as its narration. Speak to the learner ("you").
  No markdown, no stage directions, no emojis.
  Spell maths for the ear ("n minus one"), while the board shows symbols (n − 1).
- `elements`: each has a unique `id`, a `type`, a `cue` = [sentence_index, word_index] (0-based; words are
  the sentence split on spaces) for when its entrance begins, optional `until_cue` for when it fades out
  (null = stays), optional `dur` (null = component default), and `props_json`: the props as a JSON object
  string, exactly matching the component's props (no extra keys).
  Timing inside props: BulletReveal may take `"cues": [[s,w], ...]` (one per item) instead of `times`;
  items of NumberLine `marks`, AxesPlot `series`, and `motion`, `poses` (Guide), `flows` (Nephron) and
  `stateKeys` (Prop) take `"cue": [s,w]` instead of `at`.
- `camera`: the shots. Each key STARTS a camera move at its cue and lasts `dur` seconds: x,y = the logical point that
  ends up at the frame centre, zoom 1 = the whole frame (wide), 1.3–1.6 = medium, 1.8–2.4 = close; `focus` = the depth
  plane kept sharp and `dof` = how much the other planes blur (null = unchanged). See "Direct it like a film".
- Reference other elements in `target`/`from`/`to`/`path`/`pointAt` by id, or by "id.anchor" to hit a named
  point of an illustration (e.g. "land.seaSurface", "n.glomerulus", "heart1.aorta").

# Golden scenes (approved references; absolute-time format, shown for layout and pacing)
{golden}

{RICHNESS}"""


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
    return {"sentences": [s.strip() for s in raw.get("sentences", []) if s.strip()], "elements": elements, "camera": raw.get("camera", [])}


def to_wire(draft: dict) -> dict:
    return {
        "sentences": draft["sentences"],
        "elements": [{k: v for k, v in el.items() if k != "props"} | {"props_json": json.dumps(el.get("props", {}), ensure_ascii=False)} for el in draft["elements"]],
        "camera": draft.get("camera", []),
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
{length_rule(ctx.target_seconds, ctx.kit)}
{richness_rule(ctx.target_seconds)}
Previous scene ended with: {ctx.previous_summary or '(this is the first scene)'}
Next scene: {ctx.next_title or '(none — wrap this lesson up)'}
{"Open with a TitleCard for the lesson title, faded out before the content." if first else "Do not use a TitleCard; open straight into the idea with a Heading."}
{mode_note.strip()}

Write the scene."""


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
