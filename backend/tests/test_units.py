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
