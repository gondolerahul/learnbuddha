"""Offline brain: deterministic canned content so the whole pipeline can run without API keys.
It is a stand-in for development and tests, not a teacher."""
from __future__ import annotations

import json
import re

from .base import AnswerContext, CourseRequest, SceneContext, TutorContext


class MockBrain:
    name = "mock"

    def plan(self, req: CourseRequest, on_partial=None) -> dict:
        p = self._plan(req)
        if on_partial:
            on_partial(json.dumps(p))
        return p

    def _plan(self, req: CourseRequest) -> dict:
        topic = req.topic.strip().rstrip("?.") or "this topic"
        level = next((a.get("answer") for a in req.answers if a.get("question", "").lower().startswith("how familiar")), "curious beginner")
        t = max(30, min(60, int(req.minutes * 60 / 4)))
        said = " ".join(str(a.get("answer", "")) for a in req.answers).lower() + " " + req.goal.lower()
        audience = "child" if re.search(r"\b(child|kid|year[- ]old|years old|class [1-5]|grade [1-5])\b", said) else "adult"
        return {
            "audience": audience,
            "style": "storybook-v1" if audience == "child" else "zen-board-v1",
            "title": f"{topic[:1].upper()}{topic[1:]}",
            "summary": f"A short, visual introduction to {topic}: the core idea, a worked picture, and why it matters.",
            "level": level,
            "lessons": [
                {
                    "title": "The big idea",
                    "objective": f"Explain in your own words what {topic} is about.",
                    "scenes": [
                        {"title": "Where it starts", "objective": f"See the question {topic} answers.", "key_points": [f"{topic} answers a real question", "Start from what you already know", "One picture captures the core"], "visual_idea": "Flow from question to idea", "target_seconds": t},
                        {"title": "The core picture", "objective": "Hold the central picture in mind.", "key_points": ["Name the parts", "See how they connect", "Notice what changes"], "visual_idea": "AxesPlot with a simple curve", "target_seconds": t},
                    ],
                    "checkpoint": {
                        "questions": [
                            {
                                "question": f"Which best describes the core of {topic}?",
                                "options": ["A picture of how the parts connect", "A list of facts to memorise", "A formula with no meaning"],
                                "answer_index": 0,
                                "explanations": ["Right — the connections are the idea.", "Facts help, but the connections are what make it stick.", "Every formula here tells a story about the picture."],
                            }
                        ]
                    },
                },
                {
                    "title": "Putting it to work",
                    "objective": f"Apply {topic} to a small example.",
                    "scenes": [
                        {"title": "A worked example", "objective": "Walk through one example step by step.", "key_points": ["Set up the example", "Apply the idea", "Check the answer makes sense"], "visual_idea": "NumberLine walk-through", "target_seconds": t},
                        {"title": "Why it matters", "objective": "Connect the idea to the real world.", "key_points": ["Where you'll meet it", "The common mistake", "The one thing to remember"], "visual_idea": "SideBySide comparison", "target_seconds": t},
                    ],
                    "checkpoint": {
                        "questions": [
                            {
                                "question": "What's the best last step when working an example?",
                                "options": ["Check the answer makes sense", "Move on quickly", "Add more steps"],
                                "answer_index": 0,
                                "explanations": ["Yes — a sanity check catches most slips.", "Speed is fine, but a quick check saves you.", "More steps rarely help; checking does."],
                            }
                        ]
                    },
                },
            ],
            "sources": [],
        }

    def draft_scene(self, ctx: SceneContext) -> dict:
        kps = ctx.key_points[:4] or [ctx.scene_title]
        intro = f"Let's look at {ctx.scene_title.lower()}." if ctx.mode == "lesson" else (
            "Let's try that again, more simply." if ctx.mode == "simpler" else "That answer is a very common slip, so let's look again."
        )
        sentences = [intro] + [f"First, {kps[0].lower()}."] + [f"Next, {k.lower()}." for k in kps[1:]] + [f"So remember: {ctx.scene_objective.rstrip('.').lower()}."]
        elements: list[dict] = []
        first = ctx.index_in_lesson == 0 and ctx.mode == "lesson"
        if first:
            elements.append({"id": "title", "type": "TitleCard", "cue": [0, 0], "until_cue": [1, 0], "dur": None, "props": {"title": ctx.lesson_title, "subtitle": ctx.course_title}})
        elements.append({"id": "h", "type": "Heading", "cue": [1 if first else 0, 0], "until_cue": None, "dur": None, "props": {"text": ctx.scene_title}})
        elements.append({"id": "pts", "type": "BulletReveal", "cue": [1, 0], "until_cue": None, "dur": None, "props": {"items": kps, "cues": [[1 + i, 1] for i in range(len(kps))], "y": 170, "maxWidth": 640}})
        vi = ctx.visual_idea.lower()
        if "axes" in vi or "plot" in vi:
            elements.append({"id": "viz", "type": "AxesPlot", "cue": [2, 0], "until_cue": None, "dur": None, "props": {"x": 820, "y": 170, "w": 360, "h": 300, "xRange": [0, 6], "yRange": [0, 6], "series": [{"kind": "line", "fn": "sqrt(6x)", "color": "accent"}]}})
        elif "number" in vi:
            elements.append({"id": "viz", "type": "NumberLine", "cue": [2, 0], "until_cue": None, "dur": None, "props": {"x": 140, "y": 560, "w": 1000, "range": [0, 10], "step": 1, "marks": [{"value": 3, "label": "start"}, {"value": 7, "label": "end", "color": "indigo"}]}})
        else:
            elements.append({"id": "viz", "type": "Flow", "cue": [2, 0], "until_cue": None, "dur": None, "props": {"nodes": [{"id": "a", "label": "Question", "x": 860, "y": 220, "w": 200, "h": 80}, {"id": "b", "label": "Idea", "x": 860, "y": 420, "w": 200, "h": 80}], "edges": [{"from": "a", "to": "b", "label": "leads to"}]}})
        elements.append({"id": "ul", "type": "Underline", "cue": [len(sentences) - 1, 1], "until_cue": None, "dur": None, "props": {"target": "pts"}})
        return {"sentences": sentences, "elements": elements, "camera": []}

    def draft_answer(self, ctx: AnswerContext) -> dict:
        q = ctx.question.strip().rstrip("?") + "?"
        return {
            "sentences": [
                "Good question.",
                f"You asked: {q}",
                "Here's the key picture: the idea on the board connects directly to your question.",
                "Hold onto that, and let's get back to the lesson.",
            ],
            "elements": [
                {"id": "bg", "type": "FrozenFrame", "cue": [0, 0], "until_cue": None, "dur": None, "props": {"t": ctx.paused_t, "dim": 0.8}},
                {"id": "q", "type": "Text", "cue": [1, 0], "until_cue": None, "dur": None, "props": {"text": q[:120], "x": 640, "y": 300, "size": "lg", "align": "center", "bold": True, "color": "accent", "maxWidth": 1000, "maxLines": 2}},
                {"id": "a", "type": "Callout", "cue": [2, 2], "until_cue": None, "dur": None, "props": {"text": "The idea on the board answers this — look at how the parts connect.", "x": 440, "y": 430, "w": 400}},
            ],
            "camera": [],
        }

    def tutor_reply(self, ctx: TutorContext, utterance: str) -> dict:
        u = utterance.lower().strip()
        controls = {
            "slower": r"\b(slow|slower)\b", "faster": r"\b(fast|faster|speed up)\b", "repeat": r"\b(repeat|again|say that again)\b",
            "skip": r"\b(skip|next)\b", "resume": r"^(continue|go on|resume|carry on|ok|okay|play)\b", "pause": r"^(pause|stop|wait)$",
        }
        for action, pat in controls.items():
            if re.search(pat, u):
                return {"kind": "control", "say": {"slower": "Sure, slowing down.", "faster": "Okay, a little faster.", "repeat": "Of course, from the top of that sentence.", "skip": "Skipping ahead.", "resume": "", "pause": "Paused."}[action], "control": action, "visual": False, "concept": ""}
        if len(u) < 3 or re.fullmatch(r"(uh+|um+|hm+|cough|ahem)[.!]*", u):
            return {"kind": "noise", "say": "", "control": "resume", "visual": False, "concept": ""}
        return {
            "kind": "question",
            "say": f"Good question. In short: it comes back to {ctx.scene_title.lower()}. I'll draw it for you.",
            "control": "none",
            "visual": len(u.split()) > 3,
            "concept": ctx.scene_title[:40],
            # point at the first thing on screen, as a real tutor would ("[id] text")
            "marks": [{"target": m.group(1), "mark": "circle", "label": ""} for m in [re.match(r"\[([^\]]+)\]", ctx.on_screen[0] if ctx.on_screen else "")] if m],
        }
