from app import kit, media
from app.playlist import first_fragment, sentence_start_at


def test_word_times_cover_sentence():
    w = media.word_times("one two three", 1.0, 3.0)
    assert w[0]["s"] == 1.0 and abs(w[-1]["e"] - 4.0) < 1e-6
    assert all(a["e"] <= b["s"] + 1e-9 for a, b in zip(w, w[1:]))


def test_cues_resolve_to_word_times():
    timings = [
        {"start": 0.6, "end": 2.0, "words": [{"w": "a", "s": 0.6, "e": 1.0}, {"w": "b", "s": 1.0, "e": 2.0}]},
        {"start": 2.4, "end": 4.0, "words": [{"w": "c", "s": 2.4, "e": 3.0}, {"w": "d", "s": 3.0, "e": 4.0}]},
    ]
    draft = {
        "elements": [
            {"id": "h", "type": "Heading", "cue": [0, 1], "until_cue": [1, 1], "dur": None, "props": {"text": "Hi"}},
            {"id": "b", "type": "BulletReveal", "cue": [1, 0], "until_cue": None, "dur": None, "props": {"items": ["x", "y"], "cues": [[1, 0], [1, 1]]}},
        ],
        "camera": [{"cue": [1, 1], "x": 700, "y": 360, "zoom": 1.2}],
    }
    spec = kit.resolve_cues(draft, timings, 5.0, "zen-board-v1")
    h, b = spec["elements"]
    assert h["at"] == 1.0 and h["until"] == 3.0
    assert b["props"]["times"] == [2.4, 3.0] and "cues" not in b["props"]
    assert spec["camera"][0]["t"] == 3.0
    assert kit.validate_spec(spec) == []


def test_validation_catches_bad_props_and_glyphs():
    spec = {
        "elements": [
            {"id": "a", "type": "Text", "at": 0, "props": {"text": "xᵢ", "x": 1, "y": 2}},
            {"id": "b", "type": "Nope", "at": 0, "props": {}},
            {"id": "c", "type": "Heading", "at": 0, "props": {"text": "ok", "bogus": 1}},
        ]
    }
    errs = kit.validate_spec(spec)
    assert any("[a]" in e and "cannot draw" in e for e in errs)
    assert any("[b]" in e and "unknown" in e for e in errs)
    assert any("[c]" in e for e in errs)
    assert kit.drop_invalid(spec, errs)["elements"] == []


def test_resume_points_align_with_fragments():
    m = {
        "sentence_starts": [0.6, 2.7333, 7.9],
        "fragments": [[0, 0.6, 0, 1], [0.6, 1.0, 1, 1], [1.0, 2.0, 2, 1], [2.0, 2.7333, 3, 1], [2.7333, 3.0, 4, 1]],
    }
    s = sentence_start_at(m, 3.5)
    assert s == 2.7333
    assert m["fragments"][first_fragment(m, s)][0] == 2.7333


def test_a_half_written_video_indexes_as_a_prefix_of_the_finished_one(tmp_path):
    # Live streaming reads the scene file while ffmpeg is still writing it; what it finds must match the final index.
    import array

    from app.pipeline import normalize_fragments

    spec = {"kit": "zen-board-v1", "duration": 5.0, "seed": 1, "elements": [
        {"id": "h", "type": "Heading", "at": 0.2, "props": {"text": "Streaming test", "x": 80, "y": 80}}]}
    wav = tmp_path / "n.wav"
    wav.write_bytes(media.pcm_to_wav(array.array("h", [0] * media.NARRATION_RATE * 5), media.NARRATION_RATE))
    mp4 = tmp_path / "s.mp4"
    starts = [0.0, 2.5]
    kf = media.encode_scene(spec, wav, mp4, keyframes=starts, music_level=0.0)
    assert kf == media.keyframe_times(starts, 5.0, media.get_settings().render_fps)
    full = media.index_fmp4(mp4)
    final = normalize_fragments(full["fragments"], kf, 5.0)
    data = mp4.read_bytes()
    part = tmp_path / "part.mp4"
    part.write_bytes(data[: full["fragments"][3][1] + full["fragments"][3][2] // 2])  # cut in the middle of fragment 4
    half = media.index_fmp4(part)
    assert half["init_size"] == full["init_size"] and half["fragments"] == full["fragments"][:3]
    live = normalize_fragments(half["fragments"], kf, 5.0)[:-1]  # what LiveWatcher publishes
    assert live == final[: len(live)] and len(live) == 2


def test_the_first_scene_is_read_from_a_plan_still_being_written():
    import json

    from app.pipeline import partial_first_scene

    plan = {"title": "Why \"blue\"?", "summary": "s", "level": "l", "audience": "adult", "style": "watercolor-v1", "lessons": [
        {"title": "Light", "objective": "see it", "scenes": [
            {"title": "Hook", "objective": "o", "key_points": ["a"], "visual_idea": "v", "target_seconds": 18},
            {"title": "Next", "objective": "o", "key_points": ["b"], "visual_idea": "v", "target_seconds": 40}],
         "checkpoint": {"questions": []}}]}
    text = json.dumps(plan)
    cut = text.index('"title": "Next"')
    assert partial_first_scene(text[: text.index('"target_seconds": 18')]) is None  # the scene is not finished yet
    got = partial_first_scene(text[:cut])
    assert got["style"] == "watercolor-v1" and got["course_title"] == 'Why "blue"?' and got["lesson_title"] == "Light"
    assert got["scene"]["title"] == "Hook" and got["scene"]["target_seconds"] == 18
