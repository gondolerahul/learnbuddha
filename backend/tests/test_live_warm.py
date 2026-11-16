"""The warm Gemini Live lane: one connection serves many interruptions, each one handed over as a context note;
a resumed lesson mutes the rest of a reply; a dropped connection is reopened. Uses a fake Live server (no network)."""
import asyncio
from types import SimpleNamespace as NS

import pytest

from app import costs, voice
from app.db import session
from app.models import UsageEvent
from sqlalchemy import select
from app.brain import TutorContext
from app.config import get_settings


class FakeSession:
    def __init__(self, server: "FakeServer") -> None:
        self.server = server
        self.inbox: asyncio.Queue = asyncio.Queue()
        self.notes: list[str] = []
        self.texts: list[str] = []
        self.closed = False

    async def send_client_content(self, turns, turn_complete):
        assert turn_complete is False  # a context note must never ask for a reply
        self.notes.append(turns[0]["parts"][0]["text"])

    async def send_realtime_input(self, text=None, audio=None, audio_stream_end=None):
        if text is not None:
            self.texts.append(text)
            for m in self.server.reply(text):
                self.inbox.put_nowait(m)

    async def send_tool_response(self, function_responses):
        self.server.tool_responses.extend(function_responses)
        for m in self.server.after_tool():
            self.inbox.put_nowait(m)

    async def receive(self):
        while True:
            m = await self.inbox.get()
            if isinstance(m, Exception):
                raise m
            yield m
            if m.server_content is not None and m.server_content.turn_complete:
                return


def content(audio: bytes | None = None, said: str | None = None, done: bool = False, usage=None):
    sc = NS(
        model_turn=NS(parts=[NS(inline_data=NS(data=audio))]) if audio else None,
        input_transcription=None,
        output_transcription=NS(text=said) if said else None,
        turn_complete=done,
    )
    return NS(server_content=sc, tool_call=None, go_away=None, usage_metadata=usage)


USAGE = NS(prompt_token_count=100, response_token_count=300, thoughts_token_count=0,
           prompt_tokens_details=[NS(modality="TEXT", token_count=100)],
           response_tokens_details=[NS(modality="TEXT", token_count=20), NS(modality="AUDIO", token_count=280)])


class FakeServer:
    def __init__(self) -> None:
        self.sessions: list[FakeSession] = []
        self.tool_responses: list = []
        self.hold = False  # when set, replies stop before turn_complete (the model is "still talking")

    def reply(self, text):
        msgs = [content(b"\x00\x01" * 10, f"Answer to {text}.")]
        if not self.hold:
            msgs.append(content(done=True, usage=USAGE))
        return msgs

    def after_tool(self):
        return []

    def client(self, purpose="live"):
        server = self

        class CM:
            async def __aenter__(self_inner):
                s = FakeSession(server)
                server.sessions.append(s)
                return s

            async def __aexit__(self_inner, *a):
                server.sessions[-1].closed = True

        return NS(aio=NS(live=NS(connect=lambda model, config: CM())))


def ctx(sentence: str) -> TutorContext:
    return TutorContext("Variance", "beginner", "English", "Why n − 1", [sentence], sentence, ["n − 1"])


@pytest.fixture
def live(monkeypatch):
    server = FakeServer()
    monkeypatch.setattr(voice, "genai_client", server.client)
    monkeypatch.setattr(get_settings(), "google_genai_backend", "vertex")
    got = {"audio": 0, "final": [], "turns": [], "controls": []}

    async def user_text(t, f): pass
    async def tutor_text(t, f, sp):
        if f:
            got["final"].append(t)
    async def tutor_audio(b):
        got["audio"] += len(b)
    async def control(a):
        got["controls"].append(a)
    async def visual(q, c): pass
    async def turn_done(d):
        got["turns"].append(d)

    agent = voice.GeminiLiveAgent(voice.Callbacks(user_text, tutor_text, tutor_audio, control, visual, turn_done))
    return server, agent, got


async def settle():
    for _ in range(20):
        await asyncio.sleep(0)


def test_one_warm_connection_serves_many_interruptions(live):
    server, agent, got = live

    async def run():
        costs.set_scope(session_id="live-test-1")  # the session socket does this
        agent.warm({"title": "Variance", "level": "beginner", "language": "English"})
        await settle()
        assert agent.connects == 1  # connected before anyone interrupted

        await agent.begin(ctx("We divide by n minus one."))
        await agent.ask("Why minus one?", ctx("We divide by n minus one."))
        await settle()
        await agent.begin(ctx("The mean is pulled toward the sample."))
        await agent.ask("What does pulled mean?", ctx("The mean is pulled toward the sample."))
        await settle()

        s = server.sessions
        assert len(s) == 1 and agent.connects == 1
        assert len(s[0].notes) == 2 and "n minus one" in s[0].notes[0] and "pulled toward" in s[0].notes[1]
        assert s[0].texts == ["Why minus one?", "What does pulled mean?"]
        assert [t["question"] for t in got["turns"]] == ["Why minus one?", "What does pulled mean?"]
        assert got["final"] == ["Answer to Why minus one?.", "Answer to What does pulled mean?."]
        if agent._bg:  # cost rows are written off the event loop; wait for them
            await asyncio.wait(list(agent._bg), timeout=10)
        with session() as db:
            rows = db.execute(select(UsageEvent).where(UsageEvent.session_id == "live-test-1").order_by(UsageEvent.id)).scalars().all()
        # the two rows are written on background threads, so they may land in either order
        assert sorted((r.operation, r.detail) for r in rows) == [("voice", "What does pulled mean?"), ("voice", "Why minus one?")]
        first = next(r for r in rows if r.detail == "Why minus one?")
        assert first.units == {"in": 100, "out": 20, "audio_out": 280}
        assert first.cost_usd == pytest.approx(100 * 0.75e-6 + 20 * 4.5e-6 + 280 * 12e-6)
        await agent.close()
        assert s[0].closed

    asyncio.run(run())


def test_resuming_mutes_the_rest_of_a_reply(live):
    server, agent, got = live

    async def run():
        agent.warm({"title": "Variance"})
        await settle()
        server.hold = True
        await agent.begin(ctx("We divide by n minus one."))
        await agent.ask("Why?", ctx("We divide by n minus one."))
        await settle()
        heard = got["audio"]
        assert heard > 0
        await agent.release()  # learner pressed play while the tutor was still talking
        sess = server.sessions[0]
        sess.inbox.put_nowait(content(b"\x00" * 50, " and more."))
        sess.inbox.put_nowait(content(done=True))
        await settle()
        assert got["audio"] == heard  # nothing more played over the lesson
        assert got["final"] == []  # no late transcript popped up
        assert got["turns"][0]["question"] == "Why?"  # but the Q&A is still logged
        await agent.close()

    asyncio.run(run())


def test_dropped_connection_is_reopened_for_an_active_learner(live):
    server, agent, got = live

    async def run():
        agent.warm({"title": "Variance"})
        await settle()
        server.sessions[0].inbox.put_nowait(ConnectionError("socket closed"))
        await settle()
        assert agent.connects == 2  # reopened in the background
        await agent.begin(ctx("We divide by n minus one."))
        await agent.ask("Why?", ctx("We divide by n minus one."))
        await settle()
        assert server.sessions[1].texts == ["Why?"] and got["turns"][0]["question"] == "Why?"
        await agent.close()

    asyncio.run(run())


def test_idle_learner_is_not_reconnected(live):
    server, agent, got = live

    async def run():
        agent.warm({"title": "Variance"})
        await settle()
        agent._last_active -= voice.GeminiLiveAgent.IDLE + 1
        server.sessions[0].inbox.put_nowait(ConnectionError("socket closed"))
        await settle()
        assert agent.connects == 1
        await agent.begin(ctx("We divide by n minus one."))  # reconnects on demand
        assert agent.connects == 2
        await agent.close()

    asyncio.run(run())
