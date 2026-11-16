"""End-to-end with the mock brain + silent narration: plan → render → stream → barge-in → visual answer
splice → checkpoint → remediation. Needs the renderer built, ffmpeg and Postgres."""
import json
import os
import struct
import time

from fastapi.testclient import TestClient

from app import worker
from app.db import session
from app.main import app
from app.models import Scene


def drain_jobs(timeout=300):
    end = time.time() + timeout
    while time.time() < end:
        if not worker.run_one():
            return
    raise AssertionError("jobs did not finish")


def unpack(b: bytes):
    n = struct.unpack("<I", b[:4])[0]
    return json.loads(b[4 : 4 + n]), b[4 + n :]


def recv_until(ws, pred, limit=400):
    seen = []
    for _ in range(limit):
        m = ws.receive()
        if m.get("text") is not None:
            msg = json.loads(m["text"])
        else:
            h, payload = unpack(m["bytes"])
            msg = {"type": "bin", **h, "size": len(payload), "head": payload[:8]}
        seen.append(msg)
        if os.environ.get("LB_TRACE"):
            print("<<", {k: v for k, v in msg.items() if k not in ("timings", "playlist", "head")}, flush=True)
        if pred(msg):
            return msg, seen
    raise AssertionError(f"condition not met; last: {seen[-5:]}")


def test_full_flow():
    with TestClient(app) as c:
        assert c.get("/api/health").json()["brain"] == "mock"
        q = c.post("/api/diagnose", json={"topic": "photosynthesis", "minutes": 3}).json()["questions"]
        assert q
        body = {"topic": "photosynthesis", "minutes": 3, "answers": [{"question": q[0]["question"], "answer": q[0]["options"][0]}]}
        course = c.post("/api/courses", json=body).json()
        drain_jobs()
        course = c.get(f"/api/courses/{course['id']}").json()
        assert course["status"] == "ready" and len(course["lessons"]) == 2
        scenes = [s for L in course["lessons"] for s in L["scenes"]]
        assert all(s["status"] == "ready" for s in scenes), [(s["title"], s["error"]) for s in scenes]

        # same request again (different spacing/case) → global course cache hit
        again = c.post("/api/courses", json={**body, "topic": "Photosynthesis "}).json()
        assert again["cached"] and again["id"] == course["id"]

        sid = c.post(f"/api/courses/{course['id']}/sessions").json()["id"]
        with c.websocket_connect(f"/ws/sessions/{sid}") as ws:
            hello, _ = recv_until(ws, lambda m: m["type"] == "hello")
            assert hello["voice_mode"] == "text"
            entry, _ = recv_until(ws, lambda m: m["type"] == "entry")
            assert entry["tl_start"] == 0 and entry["timings"]
            init, _ = recv_until(ws, lambda m: m["type"] == "bin" and m["k"] == "init")
            assert init["head"][4:8] == b"ftyp"
            frag, _ = recv_until(ws, lambda m: m["type"] == "bin" and m["k"] == "frag")
            assert frag["head"][4:8] == b"moof"

            # learner interrupts 3 s in with a question that deserves a picture
            ws.send_text(json.dumps({"type": "playhead", "tl": 3.0}))
            ws.send_text(json.dumps({"type": "ask", "text": "why does the plant need light for this?", "tl": 3.0}))
            tut, _ = recv_until(ws, lambda m: m["type"] == "tutor_text" and m["final"])
            assert tut["speak"] is True
            trunc, _ = recv_until(ws, lambda m: m["type"] == "truncate")
            assert abs(trunc["tl"] - 3.0) < 1e-6
            tags = [e["tag"] for e in trunc["playlist"][trunc["cursor"] : trunc["cursor"] + 3]]
            assert tags == ["answer", "recap", "resume"]
            pending, _ = recv_until(ws, lambda m: m["type"] == "answer_pending")
            drain_jobs()
            with session() as db:
                ans = db.get(Scene, pending["scene_id"])
                assert ans.status == "ready", ans.error
                assert ans.spec["elements"][0]["type"] == "FrozenFrame"
                assert ans.spec["elements"][0]["props"]["spec"]["elements"]
            ans_entry, seen = recv_until(ws, lambda m: m["type"] == "entry" and m["tag"] == "answer")
            # nothing from the old timeline may be pumped after the truncate
            assert not [m for m in seen if m["type"] == "entry" and m["tag"] == ""]
            assert abs(ans_entry["tl_start"] - 3.0) < 1e-6
            recv_until(ws, lambda m: m["type"] == "entry" and m["tag"] == "recap")
            ws.send_text(json.dumps({"type": "playhead", "tl": 25.0}))
            res_entry, _ = recv_until(ws, lambda m: m["type"] == "entry" and m["tag"] == "resume")
            # resumes at the start of the interrupted sentence, which is a fragment boundary
            assert res_entry["src_from"] <= 3.0 and res_entry["scene_id"] == entry["scene_id"]
            assert any(abs(s["start"] - res_entry["src_from"]) < 1e-3 for s in res_entry["timings"])

            # move the playhead far ahead → the pump reaches the lesson-1 checkpoint
            ws.send_text(json.dumps({"type": "playhead", "tl": 10_000}))
            cp, _ = recv_until(ws, lambda m: m["type"] == "checkpoint", limit=3000)
            ws.send_text(json.dumps({"type": "checkpoint_answer", "eid": cp["eid"], "q": 0, "choice": 1}))
            res, _ = recv_until(ws, lambda m: m["type"] == "checkpoint_result")
            assert res["correct"] is False and res["explanation"]
            ws.send_text(json.dumps({"type": "checkpoint_done", "eid": cp["eid"], "remediate": {"q": 0, "choice": 1}}))
            recv_until(ws, lambda m: m["type"] == "waiting" and m["kind"] == "remediation", limit=3000)

        summary = c.get(f"/api/sessions/{sid}").json()
        assert summary["qa"] and summary["qa"][0]["answer_clip"]["status"] == "ready"
        assert summary["mastery"][0]["score"] == 0
        notes = c.get(f"/api/sessions/{sid}/notes.md").text
        assert notes.startswith("# ") and "Your questions" in notes
