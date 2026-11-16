"""Animated visuals: kit choice by audience, nested cue resolution (motion/poses/flows/stateKeys), narration
spans for talking characters, validation of the illustration library, and rendering the reference scenes."""
import json
import subprocess

from app import kit
from app.brain import prompts
from app.config import get_settings
from app.config import RENDERER_DIR

RENDERER_CLI = RENDERER_DIR / "dist" / "cli.mjs"


def test_kit_follows_the_learner():
    assert kit.choose_kit("auto", "child") == "storybook-v1"
    assert kit.choose_kit("auto", "young_child") == "storybook-v1"
    assert kit.choose_kit("auto", "professional") == "zen-board-v1"
    assert kit.choose_kit("auto", None) == "zen-board-v1"
    assert kit.choose_kit("zen-board-hc-v1", "child") == "zen-board-hc-v1"  # an explicit choice wins
    assert "audience" in prompts.PLAN_SCHEMA["required"]


def test_nested_cues_and_speech_resolve_to_times():
    timings = [
        {"text": "The sun warms the sea.", "start": 0.0, "end": 2.0, "words": [{"w": w, "s": i * 0.4, "e": i * 0.4 + 0.3} for i, w in enumerate("The sun warms the sea.".split())]},
        {"text": "Water rises.", "start": 2.2, "end": 3.6, "words": [{"w": "Water", "s": 2.2, "e": 2.6}, {"w": "rises.", "s": 2.7, "e": 3.4}]},
    ]
    draft = {"elements": [
        {"id": "c", "type": "Prop", "cue": [0, 1], "props": {"kind": "cloud", "x": 400, "y": 150, "motion": [{"cue": [1, 1], "x": 800}], "stateKeys": [{"cue": [1, 0], "v": 1}]}},
        {"id": "g", "type": "Guide", "cue": [0, 0], "props": {"x": 1000, "y": 560, "poses": [{"cue": [1, 0], "pose": "point"}]}},
        {"id": "n", "type": "Nephron", "cue": [0, 0], "props": {"flows": [{"cue": [0, 2], "kind": "blood"}]}},
    ]}
    spec = kit.resolve_cues(draft, timings, 4.0, "storybook-v1")
    c, g, n = spec["elements"]
    assert c["at"] == 0.4 and c["props"]["motion"][0]["at"] == 2.7 and c["props"]["stateKeys"][0]["at"] == 2.2
    assert g["props"]["poses"][0]["at"] == 2.2 and n["props"]["flows"][0]["at"] == 0.8
    assert spec["speech"] == [[0.0, 2.0], [2.2, 3.6]]
    assert kit.validate_spec(spec) == []


def test_validation_knows_the_library():
    bad = {"elements": [
        {"id": "a", "type": "Prop", "at": 0, "props": {"kind": "dragon", "x": 1, "y": 1}},
        {"id": "b", "type": "Particles", "at": 0, "props": {"path": [[0, 0], [10, 10]], "kind": "glitter"}},
        {"id": "c", "type": "Prop", "at": 0, "props": {"kind": "sun", "x": 1, "y": 1, "loop": "moonwalk"}},
        {"id": "d", "type": "Text", "at": 0, "props": {"text": "hi", "x": 10, "y": 10, "motion": [{"dx": 4}]}},
    ]}
    errs = " ".join(kit.validate_spec(bad))
    assert "dragon" in errs and "glitter" in errs and "loop must be" in errs and "[d] motion" in errs
    assert "Prop catalog" in kit.component_reference() and "raindrop" in kit.component_reference()


def test_reference_scenes_render_and_lint_clean(tmp_path):
    s = get_settings()
    for g in kit._all_golden():
        f = tmp_path / "s.json"
        f.write_text(json.dumps(g), encoding="utf-8")
        out = subprocess.run([s.node_bin, str(RENDERER_CLI), "lint", "--spec", str(f)], capture_output=True, text=True, timeout=120)
        assert out.returncode == 0, out.stderr
        assert json.loads(out.stdout)["issues"] == [], (g.get("kit"), out.stdout)


def test_overlong_narration_is_spoken_faster_not_rewritten():
    import array

    from app import media
    from app.brain.base import SceneContext

    ctx = SceneContext("C", "L", "English", "Les", "obj", "Scene", "sobj", ["k"], "viz", 30, 0, 1, kit="zen-board-v1")
    assert "AT MOST 52 words" in prompts.scene_user(ctx)  # the writer is still given the word budget
    sec = lambda n: array.array("h", [1000, -1000] * int(media.NARRATION_RATE * n / 2))
    ok = [sec(5.0)] * 5  # ≈ 28 s for a 30 s scene: left alone
    assert media.fit_to_length(ok, 30)[1] == 1.0
    slightly = [sec(7.0)] * 5  # ≈ 38 s: sped up, but never beyond 12 %
    clips, f = media.fit_to_length(slightly, 30)
    assert f == media.MAX_SPEEDUP
    assert abs(media.narration_seconds(clips) - (media.narration_seconds(slightly) - 35 + 35 / f)) < 0.1


def test_layout_is_repaired_in_code(tmp_path):
    from app import media

    spec = {"kit": "zen-board-v1", "duration": 12, "seed": 1, "elements": [
        {"id": "h", "type": "Heading", "at": 0.5, "props": {"text": "Why the sky is blue", "x": 80, "y": 60}},
        {"id": "a", "type": "Text", "at": 1, "props": {"text": "Sunlight is a mix of every colour.", "x": 120, "y": 300}},
        {"id": "b", "type": "Text", "at": 3, "props": {"text": "Air scatters blue light the most.", "x": 130, "y": 310}},
        {"id": "c", "type": "Text", "at": 4, "props": {"text": "So blue reaches us from every direction.", "x": 1150, "y": 690}},
        {"id": "late", "type": "Heading", "at": 13, "props": {"text": "Late", "x": 80, "y": 500}},
        {"id": "sun", "type": "Prop", "at": 2, "props": {"kind": "suns", "x": 1000, "y": 250, "size": 160}},
    ]}
    before = media.lint_spec(spec)
    assert len(before) >= 3
    out = media.fix_spec(spec)
    assert out["before"] == len(before) and out["issues"] == [], out
    els = {e["id"]: e for e in out["spec"]["elements"]}
    assert els["sun"]["props"]["kind"] == "sun" and els["late"]["at"] <= 12
    assert media.lint_spec(out["spec"]) == []


def test_camera_crops_and_pinned_headings_are_caught_and_repaired():
    from app import media

    spec = {"kit": "storybook-v1", "duration": 14, "seed": 2, "elements": [
        {"id": "land", "type": "Landscape", "at": 0, "props": {"sea": "none", "sun": "left", "mountains": "none", "trees": 2, "horizon": 560}},
        {"id": "h", "type": "Heading", "at": 0.5, "fixed": True, "props": {"text": "Where the sun sits", "x": 64, "y": 44, "size": "lg"}},
        {"id": "drop", "type": "Prop", "at": 1, "props": {"kind": "raindrop", "x": 900, "y": 300, "size": 60}},
        {"id": "lbl", "type": "Label", "at": 5, "props": {"text": "Far from the drop", "x": 180, "y": 640, "target": "drop"}},
    ], "camera": [{"t": 3, "x": 900, "y": 300, "zoom": 1.6, "dur": 1.5}]}
    msgs = [i["message"] for i in media.lint_spec(spec)]
    assert any("'land.sun'" in m for m in msgs), msgs  # the heading covers the landscape's own sun
    assert any(m.startswith("cut off by camera shot 1") for m in msgs), msgs  # the zoom crops a label that arrives during the shot
    out = media.fix_spec(spec)
    assert out["issues"] == [], out
    fixed = {e["id"]: e for e in out["spec"]["elements"]}
    assert fixed["land"]["props"]["sun"] == "left"  # the picture keeps its meaning; the text moves
    assert media.lint_spec(out["spec"]) == [] and out["changes"]  # reframed or moved, the label now shows in the shot


def test_scene_writer_asks_for_rich_scenes():
    from app.brain.base import SceneContext

    ctx = SceneContext("C", "L", "English", "Les", "obj", "Scene", "sobj", ["k"], "viz", 50, 0, 1, kit="watercolor-v1")
    system, user = prompts.scene_system(kit_id="watercolor-v1"), prompts.scene_user(ctx)
    assert system.rstrip().endswith(prompts.RICHNESS.rstrip())  # the checklist comes last, where fast models weigh it most
    assert "at least 20 elements" in user and "at least 4 different prop kinds" in user and "6 or more camera shots" in user


def test_small_prop_mistakes_are_mended_not_dropped():
    spec = {"kit": "zen-board-v1", "duration": 10, "elements": [
        {"id": "t", "type": "Tube", "at": 0, "props": {"path": [[100, 100], [400, 300]], "width": 3, "loop": "wiggle"}},
        {"id": "p", "type": "Prop", "at": 0, "props": {"kind": "sun", "x": 200, "y": 200, "size": 100, "depth": 3}},
    ]}
    spec, mended = kit.repair_props(spec)
    assert kit.validate_spec(spec) == [], mended
    t, p = spec["elements"]
    assert t["props"]["width"] == 4 and "loop" not in t["props"] and p["props"]["depth"] == 1


def test_one_sun_and_labels_off_tubes():
    from app import media

    spec = {"kit": "watercolor-v1", "duration": 12, "seed": 3, "elements": [
        {"id": "land", "type": "Landscape", "at": 0, "props": {"sun": "left", "sea": "none", "mountains": "none", "trees": 0, "horizon": 560}},
        {"id": "s", "type": "Prop", "at": 0.5, "props": {"kind": "sun", "x": 1100, "y": 140, "size": 110}},
        {"id": "bow", "type": "Tube", "at": 1, "props": {"path": [[500, 560], [640, 300], [780, 560]], "width": 14}},
        {"id": "lbl", "type": "Label", "at": 2, "props": {"text": "Violet inside", "x": 560, "y": 420, "maxWidth": 160}},
    ]}
    msgs = [i["id"] + " " + i["message"] for i in media.lint_spec(spec)]
    assert any(m.startswith("land draws its own sun") for m in msgs), msgs
    assert any(m.startswith("lbl text sits on the illustration 'bow.stroke'") for m in msgs), msgs
    out = media.fix_spec(spec)
    assert out["issues"] == [] and out["spec"]["elements"][0]["props"]["sun"] == "none", out


def test_render_gate_runs_earliest_scene_first_and_lets_answers_through(monkeypatch):
    import threading
    import time as _t

    from app import media

    monkeypatch.setattr(get_settings(), "render_slots", 1)
    gate, order, inside = media.RenderGate(), [], []

    def render(rank, urgent=False, hold=0.3):
        with gate.slot(rank, urgent=urgent):
            inside.append(rank)
            order.append(rank)
            _t.sleep(hold)
            inside.remove(rank)

    first = threading.Thread(target=render, args=((0, 9),))
    first.start()
    _t.sleep(0.05)  # scene 9 is rendering; scenes 3 and 1 queue up, 3 first
    late = [threading.Thread(target=render, args=((0, i),)) for i in (3, 1)]
    for t in late:
        t.start()
        _t.sleep(0.05)
    t0 = _t.time()
    render(("answer",), urgent=True, hold=0)  # a learner's answer does not wait
    assert _t.time() - t0 < 0.1
    for t in [first, *late]:
        t.join()
    assert order == [(0, 9), ("answer",), (0, 1), (0, 3)]


def test_style_library():
    # every kit loads, has a drawing treatment and a narrator, and the non-default ones carry scene-writer notes
    for k in kit.KITS:
        t = kit.tokens(k)
        assert t["id"] == k and t["voice"]["name"] and t.get("art", {}).get("style")
        if k not in ("zen-board-v1", "zen-board-hc-v1"):
            assert len(kit.skill_md(k)) > len(kit.skill_md("zen-board-v1"))
    assert len(kit.KITS) == 11 and len(kit.STYLE_GUIDE) == 10
    # the planner's style is used, but children never get an adult style, and an explicit choice always wins
    assert kit.choose_kit("auto", "adult", "chalkboard-v1") == "chalkboard-v1"
    assert kit.choose_kit("auto", "professional", "schematic-v1") == "schematic-v1"
    assert kit.choose_kit("auto", "child", "schematic-v1") == "storybook-v1"
    assert kit.choose_kit("auto", "child", "papercut-v1") == "papercut-v1"
    assert kit.choose_kit("auto", "teen", "bogus") == "zen-board-v1"
    assert kit.choose_kit("blueprint-v1", "child", "storybook-v1") == "blueprint-v1"
    assert "style" in prompts.PLAN_SCHEMA["required"] and "chalkboard-v1" in prompts.planner_system()


def test_every_style_draws_the_reference_scenes(tmp_path):
    s = get_settings()
    for g in kit._all_golden():
        for k in kit.KITS:
            f = tmp_path / "s.json"
            f.write_text(json.dumps({**g, "kit": k}), encoding="utf-8")
            out = subprocess.run([s.node_bin, str(RENDERER_CLI), "lint", "--spec", str(f)], capture_output=True, text=True, timeout=120)
            assert out.returncode == 0, out.stderr
            issues = [i for i in json.loads(out.stdout)["issues"] if "draw failed" in i["message"] or "unknown" in i["message"]]
            assert issues == [], (k, g.get("kit"), issues)
