"""The 'brain' interface: everything the pipeline asks an LLM to do."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


class BrainError(RuntimeError):
    pass


@dataclass
class CourseRequest:
    topic: str
    goal: str = ""
    minutes: int = 8
    language: str = "English"
    answers: list[dict] = field(default_factory=list)  # [{question, answer}]


@dataclass
class SceneContext:
    course_title: str
    level: str
    language: str
    lesson_title: str
    lesson_objective: str
    scene_title: str
    scene_objective: str
    key_points: list[str]
    visual_idea: str
    target_seconds: int
    index_in_lesson: int
    scenes_in_lesson: int
    previous_summary: str = ""
    next_title: str = ""
    sources: list[dict] = field(default_factory=list)
    mode: str = "lesson"  # lesson | remediation | simpler
    misconception: str = ""
    original_script: list[str] = field(default_factory=list)
    kit: str = ""


@dataclass
class AnswerContext:
    course_title: str
    level: str
    language: str
    question: str
    scene_title: str
    script: list[str]
    sentence_index: int
    paused_t: float
    visible: list[dict]  # [{id,type,text}]
    recent_qa: list[dict] = field(default_factory=list)
    kit: str = ""


@dataclass
class TutorContext:
    course_title: str
    level: str
    language: str
    scene_title: str
    script_so_far: list[str]
    current_sentence: str
    on_screen: list[str]
    recent_qa: list[dict] = field(default_factory=list)


class Brain(Protocol):
    name: str

    def plan(self, req: CourseRequest) -> dict:
        """{title, summary, level, lessons:[{title, objective, scenes:[...], checkpoint:{questions:[...]}}]}"""

    def draft_scene(self, ctx: SceneContext) -> dict:
        """{sentences:[...], elements:[{id,type,cue,until_cue,dur,props}], camera:[...]}"""

    def draft_answer(self, ctx: AnswerContext) -> dict:
        """Same shape as draft_scene, for a 15–45 s visual answer."""

    def tutor_reply(self, ctx: TutorContext, utterance: str) -> dict:
        """{kind: question|control|noise, say, control, visual, concept}"""
