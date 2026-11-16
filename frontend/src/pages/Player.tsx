import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, CourseOut, fmtINR, fmtTime, Health, SessionSummary } from "../lib/api";
import { Entry, LessonStream, Mic, PcmPlayer, ServerMsg, speechRecognition } from "../lib/stream";
import { StatusDot } from "./Course";
import { CostBreakdown, useCosts } from "./Costs";

type Mode = "idle" | "playing" | "paused" | "listening" | "answering" | "awaiting" | "checkpoint" | "ended";
interface Checkpoint { eid: string; tl_at: number; lesson_title: string; objective: string; questions: { question: string; options: string[] }[] }
interface CpResult { q: number; choice: number; correct: boolean; correct_index: number; explanation: string }

const RATES = [0.75, 1, 1.25, 1.5];

export default function Player({ health }: { health: Health | null }) {
  const { sessionId = "" } = useParams();
  const videoRef = useRef<HTMLVideoElement>(null);
  const eng = useRef<LessonStream | null>(null);
  const pcm = useRef(new PcmPlayer());
  const mic = useRef<Mic | null>(null);
  const recog = useRef<any>(null);
  const askRef = useRef<HTMLInputElement>(null);

  const [mode, _setMode] = useState<Mode>("idle");
  const modeRef = useRef<Mode>("idle");
  const setMode = (m: Mode) => { modeRef.current = m; _setMode(m); };
  const [voiceMode, setVoiceMode] = useState<"gemini" | "text">("text");
  const [course, setCourse] = useState<CourseOut | null>(null);
  const [statuses, setStatuses] = useState<Record<string, { status: string; stage: string; progress: number; kind: string; title: string }>>({});
  const [now, setNow] = useState({ tl: 0, entry: null as Entry | null, si: -1, wi: -1 });
  const [captions, setCaptions] = useState(true);
  const [audioOnly, setAudioOnly] = useState(false);
  const [rate, setRate] = useState(1);
  const [tab, setTab] = useState<"chapters" | "transcript" | "qa" | "cost">("chapters");
  const cost = useCosts({ session_id: sessionId }, 6000);
  const [userText, setUserText] = useState("");
  const [tutorText, setTutorText] = useState("");
  const [notice, setNotice] = useState("");
  const [waitInfo, setWaitInfo] = useState<any>(null);
  const [stalled, setStalled] = useState(false);
  const [pending, setPending] = useState<{ id: string; kind: "answer" | "simpler"; question?: string } | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const [cp, setCp] = useState<Checkpoint | null>(null);
  const cpRef = useRef(cp);
  cpRef.current = cp;
  const [cpResults, setCpResults] = useState<CpResult[]>([]);
  const endAt = useRef<number | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [hearing, setHearing] = useState(false);
  const [draft, setDraft] = useState("");
  const bargeTl = useRef(0);
  const pendingControl = useRef<string | null>(null);
  const spoken = useRef(true);

  // ── setup ──
  useEffect(() => {
    const v = videoRef.current!;
    const s = new LessonStream(v, sessionId);
    eng.current = s;
    s.onMessage = (m) => onServer(m);
    s.onTts = (p, r) => {
      spoken.current = false;
      pcm.current.play(p, r);
    };
    pcm.current.onIdle = () => {
      if (modeRef.current === "answering" && tutorFinal.current) afterSpoken();
    };
    s.start();
    api.session(sessionId).then((ss) => {
      setSummary(ss);
      api.course(ss.course_id).then(setCourse);
    });
    return () => {
      s.close();
      mic.current?.stop();
      pcm.current.stop();
      speechSynthesis.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const tutorFinal = useRef(false);

  // ── server messages ──
  const onServer = (m: ServerMsg) => {
    switch (m.type) {
      case "hello":
        setVoiceMode(m.voice_mode);
        break;
      case "user_text":
        setUserText(m.text);
        break;
      case "tutor_text":
        setTutorText(m.text);
        if (m.final) {
          tutorFinal.current = true;
          if (m.speak && m.text) speak(m.text);
          else if (!pcm.current.playing) afterSpoken();
        }
        break;
      case "control":
        pendingControl.current = m.action;
        if (spoken.current || modeRef.current === "listening") afterSpoken();
        break;
      case "answer_pending":
        setPending({ id: m.scene_id, kind: "answer", question: m.question });
        break;
      case "simpler_pending":
        setPending({ id: m.scene_id, kind: "simpler" });
        setMode("awaiting");
        break;
      case "waiting":
        setWaitInfo(m);
        break;
      case "entry":
        setWaitInfo((w: any) => (w && w.scene_id === m.scene_id ? null : w));
        break;
      case "course_status": {
        const map: Record<string, any> = {};
        for (const s of m.scenes) map[s.id] = s;
        setStatuses(map);
        break;
      }
      case "checkpoint":
        setCp(m as any);
        setCpResults([]);
        break;
      case "checkpoint_result":
        setCpResults((r) => [...r.filter((x) => x.q !== m.q), m as any]);
        break;
      case "course_end":
        endAt.current = m.tl_at;
        break;
      case "scene_failed":
        if (pendingRef.current?.id === m.scene_id) {
          setNotice("I couldn't draw that one — let's carry on.");
          setPending(null);
          if (modeRef.current === "awaiting") resumeAt(videoRef.current!.currentTime);
        } else setNotice(`A scene failed to render (${m.title}); skipping it.`);
        break;
      case "voice_error":
        setNotice(`Voice tutor unavailable: ${m.message}. You can still type questions.`);
        break;
      case "disconnected":
        setNotice("Connection lost. Reload to resume where you left off.");
        break;
    }
  };

  // ── speaking + resuming ──
  function speak(text: string) {
    spoken.current = false;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    u.onend = () => afterSpoken();
    u.onerror = () => afterSpoken();
    speechSynthesis.speak(u);
  }

  function resumeAt(tl: number) {
    const v = videoRef.current!;
    v.currentTime = tl;
    v.play().catch(() => {});
    setMode("playing");
  }

  function afterSpoken() {
    spoken.current = true;
    tutorFinal.current = false;
    const v = videoRef.current!;
    const ctl = pendingControl.current;
    pendingControl.current = null;
    if (ctl) {
      if (ctl === "slower" || ctl === "faster") {
        const i = Math.max(0, Math.min(RATES.length - 1, RATES.indexOf(v.playbackRate) + (ctl === "slower" ? -1 : 1)));
        v.playbackRate = RATES[i];
        setRate(RATES[i]);
        resumeAt(eng.current!.sentenceStartTl(bargeTl.current));
      } else if (ctl === "repeat") resumeAt(eng.current!.sentenceStartTl(bargeTl.current));
      else if (ctl === "skip" || ctl === "resume") resumeAt(v.currentTime);
      else if (ctl === "pause") setMode("paused");
      return;
    }
    if (pendingRef.current) {
      setMode("awaiting");
      return;
    }
    if (modeRef.current === "answering" || modeRef.current === "listening") resumeAt(eng.current!.sentenceStartTl(bargeTl.current));
  }

  // ── interrupting ──
  const bargeIn = useCallback(() => {
    const v = videoRef.current!;
    const m = modeRef.current;
    if (m === "idle" || m === "checkpoint" || m === "ended") return;
    if (m === "playing" || m === "paused") bargeTl.current = v.currentTime;
    v.pause();
    pcm.current.stop();
    speechSynthesis.cancel();
    setUserText("");
    setTutorText("");
    tutorFinal.current = false;
    setMode("listening");
    eng.current!.send({ type: "barge_in", tl: bargeTl.current });
  }, []);

  function ask(text: string) {
    if (!text.trim()) return;
    if (modeRef.current !== "listening") bargeIn();
    setMode("answering");
    eng.current!.send({ type: "ask", text, tl: bargeTl.current });
  }

  function onAskSubmit(e: FormEvent) {
    e.preventDefault();
    ask(draft);
    setDraft("");
  }

  async function toggleMic() {
    if (micOn) {
      mic.current?.stop();
      mic.current = null;
      recog.current?.abort?.();
      setMicOn(false);
      return;
    }
    if (voiceMode === "gemini") {
      const m = new Mic({
        onSpeechStart: () => {
          setHearing(true);
          if (["playing", "paused", "awaiting", "answering"].includes(modeRef.current)) bargeIn();
          m.streaming = true;
        },
        onChunk: (buf) => eng.current!.sendBinary({ k: "mic" }, buf),
        onSpeechEnd: () => {
          setHearing(false);
          m.streaming = false;
          setMode(modeRef.current === "listening" ? "answering" : modeRef.current);
          eng.current!.send({ type: "speech_end" });
        },
      });
      try {
        await m.start();
        mic.current = m;
        setMicOn(true);
      } catch (e) {
        setNotice(`Microphone unavailable: ${(e as Error).message}`);
      }
    } else {
      const r = speechRecognition();
      if (!r) {
        setNotice("This browser has no speech recognition — type your question instead.");
        return;
      }
      r.continuous = true;
      r.interimResults = true;
      r.lang = course?.language === "Hindi" ? "hi-IN" : "en-US";
      r.onresult = (ev: any) => {
        const res = ev.results[ev.results.length - 1];
        const txt = res[0].transcript;
        if (modeRef.current === "playing" || modeRef.current === "paused") bargeIn();
        setUserText(txt);
        if (res.isFinal) ask(txt);
      };
      r.onend = () => { if (recog.current === r) try { r.start(); } catch { /* restarting */ } };
      recog.current = r;
      r.start();
      setMicOn(true);
    }
  }

  // ── awaiting a visual answer ──
  useEffect(() => {
    if (mode !== "awaiting") return;
    const t = setInterval(() => {
      const v = videoRef.current!;
      const e = eng.current!;
      const at = e.entryAt(v.currentTime + 0.05);
      if (at && (at.tag === "answer" || at.tag === "simpler") && e.hasBuffered(v.currentTime, 0.8)) {
        setPending(null);
        v.play().catch(() => {});
        setMode("playing");
      }
    }, 250);
    return () => clearInterval(t);
  }, [mode]);

  function continueWithoutWaiting() {
    eng.current!.send({ type: "skip_answer" });
    setPending(null);
    resumeAt(videoRef.current!.currentTime);
  }

  // ── frame loop: captions, checkpoints, end, stalls ──
  useEffect(() => {
    let raf = 0;
    let stallSince = 0;
    const loop = () => {
      const v = videoRef.current;
      const e = eng.current;
      if (v && e) {
        const tl = v.currentTime;
        const s = e.sentenceAt(tl);
        let wi = -1;
        if (s) wi = s.s.words.findIndex((w) => s.t >= w.s && s.t < w.e);
        setNow((p) => (p.entry?.eid === s?.e.eid && p.si === (s?.i ?? -1) && p.wi === wi && Math.abs(p.tl - tl) < 0.25 ? p : { tl, entry: s?.e ?? e.entryAt(tl), si: s?.i ?? -1, wi }));
        const c = cpRef.current;
        // reached the checkpoint (or stalled right at it: it sits at the end of the buffer)
        if (c && modeRef.current === "playing" && (tl >= c.tl_at - 0.12 || (!e.hasBuffered(tl, 0.1) && e.bufferedEnd() >= c.tl_at - 0.3))) {
          v.pause();
          setMode("checkpoint");
        }
        if (endAt.current != null && modeRef.current === "playing" && tl >= endAt.current - 0.15) {
          v.pause();
          setMode("ended");
          api.session(sessionId).then(setSummary);
        }
        if (modeRef.current === "playing" && !e.hasBuffered(tl, 0.1)) {
          if (!stallSince) stallSince = performance.now();
          if (performance.now() - stallSince > 600) setStalled(true);
        } else {
          stallSince = 0;
          setStalled(false);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sessionId]);

  // ── keyboard ──
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const typing = (ev.target as HTMLElement)?.tagName === "INPUT" || (ev.target as HTMLElement)?.tagName === "TEXTAREA";
      if (typing) return;
      const v = videoRef.current!;
      if (ev.key === " ") { ev.preventDefault(); togglePlay(); }
      else if (ev.key === "ArrowLeft") v.currentTime = Math.max(0, v.currentTime - 10);
      else if (ev.key.toLowerCase() === "c") setCaptions((x) => !x);
      else if (ev.key.toLowerCase() === "a") setAudioOnly((x) => !x);
      else if (ev.key.toLowerCase() === "e") explainAgain();
      else if (ev.key.toLowerCase() === "m") toggleMic();
      else if (ev.key === "/") { ev.preventDefault(); askRef.current?.focus(); }
      else if (ev.key === "[" || ev.key === "]") changeRate(ev.key === "]" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function togglePlay() {
    const v = videoRef.current!;
    const m = modeRef.current;
    if (m === "idle" || m === "paused") {
      v.play().catch(() => {});
      setMode("playing");
    } else if (m === "playing") {
      v.pause();
      setMode("paused");
    }
  }

  function changeRate(d: number) {
    const i = Math.max(0, Math.min(RATES.length - 1, RATES.indexOf(rate) + d));
    videoRef.current!.playbackRate = RATES[i];
    setRate(RATES[i]);
  }

  function explainAgain() {
    const v = videoRef.current!;
    if (!["playing", "paused"].includes(modeRef.current)) return;
    v.pause();
    eng.current!.send({ type: "explain_again", tl: v.currentTime });
    setMode("awaiting");
  }

  // ── checkpoint ──
  function answerCp(q: number, choice: number) {
    eng.current!.send({ type: "checkpoint_answer", eid: cp!.eid, q, choice });
  }

  function finishCp(remediate: CpResult | null) {
    const c = cp!;
    eng.current!.send({ type: "checkpoint_done", eid: c.eid, remediate: remediate ? { q: remediate.q, choice: remediate.choice } : null });
    setCp(null);
    resumeAt(videoRef.current!.currentTime);
  }

  // ── derived ──
  const entry = now.entry;
  const sentence = entry && now.si >= 0 ? entry.timings[now.si] : null;
  const lessonScenes = useMemo(() => course?.lessons.filter((l) => !l.dropped) ?? [], [course]);
  const curSceneId = entry?.scene_id;
  const waitingStage = pending ? statuses[pending.id] : null;
  const freshWait = !!waitInfo && Math.abs((waitInfo.tl_at ?? -99) - now.tl) < 1.5 && statuses[waitInfo.scene_id]?.status !== "ready";

  return (
    <main className="page wide">
      <div className="player-layout">
        <div>
          <div className={`stage ${audioOnly ? "audio-only" : ""}`}>
            <video ref={videoRef} playsInline aria-label="Lesson video" />
            {captions && sentence && (mode === "playing" || mode === "paused") && (
              <div className="captions" aria-live="off">
                {sentence.words.map((w, i) => (
                  <span key={i} className={`w ${i === now.wi ? "on" : i < now.wi ? "past" : "future"}`}>{w.w} </span>
                ))}
              </div>
            )}
            {audioOnly && sentence && (
              <div className="overlay" style={{ background: "var(--paper)" }}>
                <p style={{ fontFamily: "var(--serif)", fontSize: 26, textAlign: "center", maxWidth: 760 }}>{sentence.text}</p>
              </div>
            )}

            {(userText || tutorText) && ["listening", "answering", "awaiting"].includes(mode) && (
              <div className="tutor-bubble" aria-live="polite">
                {userText && <div className="bubble you"><span className="who">You</span>{userText}</div>}
                {tutorText && <div className="bubble"><span className="who">Tutor</span>{tutorText}</div>}
              </div>
            )}

            {mode === "idle" && (
              <div className="overlay">
                <div className="card panel" style={{ textAlign: "center" }}>
                  <h2>{course?.title ?? "Your lesson"}</h2>
                  <p className="muted">
                    Interrupt any time: {voiceMode === "gemini" ? "turn on the mic and just speak, or type." : "type a question (or use the mic if your browser supports speech recognition)."}
                  </p>
                  <div><button className="btn primary" onClick={togglePlay} autoFocus>Begin</button></div>
                  <p className="small muted">Keys: <span className="kbd">Space</span> play/pause · <span className="kbd">/</span> ask · <span className="kbd">←</span> back 10s · <span className="kbd">E</span> explain again · <span className="kbd">C</span> captions · <span className="kbd">A</span> audio-only · <span className="kbd">M</span> mic</p>
                </div>
              </div>
            )}

            {mode === "listening" && !userText && (
              <div className="tutor-bubble"><div className="bubble you"><span className="who">Listening</span>{hearing ? "…" : "Ask your question"}</div></div>
            )}

            {mode === "awaiting" && (
              <div className="overlay" style={{ background: "rgba(243,235,221,.55)" }}>
                <div className="card panel waiting-card">
                  <span className="pill busy">{pending?.kind === "simpler" ? "Re-drawing this scene more simply" : "Sketching your answer from this frame"}</span>
                  {pending?.question && <p style={{ fontFamily: "var(--serif)", margin: 0 }}>“{pending.question}”</p>}
                  {waitingStage && (
                    <>
                      <div className="bar"><span style={{ width: `${Math.round((waitingStage.progress || 0) * 100)}%` }} /></div>
                      <span className="small muted">{waitingStage.stage}…</span>
                    </>
                  )}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button className="btn" onClick={continueWithoutWaiting}>Continue the lesson</button>
                    <span className="small muted" style={{ alignSelf: "center" }}>It'll still be in your Q&A log.</span>
                  </div>
                </div>
              </div>
            )}

            {stalled && mode === "playing" && !(cp && eng.current && eng.current.bufferedEnd() >= cp.tl_at - 0.3) && (
              <div className="overlay">
                <div className="card panel waiting-card">
                  <span className="pill busy">{freshWait ? `Drawing the next scene: ${waitInfo.title}` : "Loading…"}</span>
                  {freshWait && <div className="bar"><span style={{ width: `${Math.round((waitInfo.progress || 0) * 100)}%` }} /></div>}
                  {freshWait && waitInfo?.key_points?.length > 0 && (
                    <>
                      <p className="muted small" style={{ margin: 0 }}>While you wait, here's what's coming:</p>
                      <ul>{waitInfo.key_points.map((k: string) => <li key={k}>{k}</li>)}</ul>
                    </>
                  )}
                </div>
              </div>
            )}

            {mode === "checkpoint" && cp && (
              <div className="overlay">
                <div className="card panel">
                  <span className="pill">Checkpoint · {cp.lesson_title}</span>
                  {cp.questions.map((q, qi) => {
                    const r = cpResults.find((x) => x.q === qi);
                    return (
                      <div key={qi} style={{ display: "grid", gap: 8 }}>
                        <h3>{q.question}</h3>
                        {q.options.map((o, oi) => (
                          <button key={oi} className={`option ${r ? (oi === r.correct_index ? "right" : oi === r.choice ? "wrong" : "") : ""}`} disabled={!!r} onClick={() => answerCp(qi, oi)}>
                            {o}
                          </button>
                        ))}
                        {r && <p style={{ margin: 0, fontFamily: "var(--serif)" }}>{r.correct ? "✓ " : ""}{r.explanation}</p>}
                      </div>
                    );
                  })}
                  {cpResults.length === cp.questions.length && (
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {cpResults.some((r) => !r.correct) && (
                        <button className="btn accent" onClick={() => finishCp(cpResults.find((r) => !r.correct)!)}>Show me another way (~1 min)</button>
                      )}
                      <button className="btn primary" onClick={() => finishCp(null)}>Continue</button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {mode === "ended" && (
              <div className="overlay" style={{ overflow: "auto" }}>
                <div className="card panel" style={{ maxWidth: 760 }}>
                  <h2>Well done. That's the course.</h2>
                  <p className="lede" style={{ margin: 0 }}>{course?.summary}</p>
                  <div className="summary-grid">
                    {summary?.mastery.map((m) => (
                      <div key={m.lesson_id} className="card" style={{ padding: 12 }}>
                        <div className="small muted">Checkpoint</div>
                        <div style={{ fontFamily: "var(--serif)" }}>{m.objective}</div>
                        <div className="bar" style={{ marginTop: 6 }}><span style={{ width: `${m.score * 100}%`, background: "var(--sage)" }} /></div>
                      </div>
                    ))}
                  </div>
                  {summary && summary.review_cards.length > 0 && (
                    <div>
                      <h3>Review cards</h3>
                      <ul>{summary.review_cards.map((r, i) => <li key={i}><b>{r.front}</b>: {r.back} <span className="muted small">({r.reason})</span></li>)}</ul>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <a className="btn primary" href={`/api/sessions/${sessionId}/notes.md`} download="learnbuddha-notes.md">Download notes</a>
                    <button className="btn" onClick={() => setTab("qa")}>See the Q&A log</button>
                    <Link className="btn ghost" to="/">Learn something else</Link>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="controls" role="toolbar" aria-label="Playback">
            <button className="icon-btn" onClick={togglePlay} aria-label={mode === "playing" ? "Pause" : "Play"}>{mode === "playing" ? "❚❚" : "▶"}</button>
            <button className="icon-btn" onClick={() => { const v = videoRef.current!; v.currentTime = Math.max(0, v.currentTime - 10); }} aria-label="Back 10 seconds">↺</button>
            <span className="small muted" style={{ minWidth: 48 }}>{fmtTime(now.tl)}</span>
            <span className="small" style={{ fontFamily: "var(--serif)" }}>{entry?.tag === "answer" ? "Answer: " : entry?.tag === "recap" ? "" : ""}{entry?.title}</span>
            <span className="spacer" />
            <button className="btn small" onClick={explainAgain} disabled={!["playing", "paused"].includes(mode)} title="Explain this scene again, more simply (E)">Explain again</button>
            <select className="input" style={{ width: 84, padding: "6px 8px" }} value={rate} onChange={(e) => { videoRef.current!.playbackRate = +e.target.value; setRate(+e.target.value); }} aria-label="Speed">
              {RATES.map((r) => <option key={r} value={r}>{r}×</option>)}
            </select>
            <button className={`icon-btn ${captions ? "on" : ""}`} onClick={() => setCaptions(!captions)} aria-pressed={captions} aria-label="Captions">CC</button>
            <button className={`icon-btn ${audioOnly ? "on" : ""}`} onClick={() => setAudioOnly(!audioOnly)} aria-pressed={audioOnly} aria-label="Audio-only mode">♪</button>
          </div>

          <form className="card askbar" onSubmit={onAskSubmit}>
            <button type="button" className={`icon-btn ${micOn ? (hearing ? "live" : "on") : ""}`} onClick={toggleMic} aria-pressed={micOn} title={voiceMode === "gemini" ? "Always-on voice: just speak to interrupt (M)" : "Speak your question (browser speech recognition)"} aria-label="Microphone">🎙</button>
            <input
              ref={askRef}
              className="input"
              placeholder={mode === "awaiting" ? "Ask a follow-up…" : "Ask anything, any time…"}
              value={draft}
              onChange={(e) => {
                if (!draft && e.target.value && (modeRef.current === "playing")) bargeIn();
                setDraft(e.target.value);
              }}
              aria-label="Ask a question"
            />
            <button className="btn primary" disabled={!draft.trim()}>Ask</button>
            {mode === "listening" && !draft && (
              <button type="button" className="btn ghost small" onClick={() => resumeAt(bargeTl.current)}>Never mind</button>
            )}
          </form>
          {notice && <p className="small" role="status" style={{ color: "var(--ink-soft)" }}>{notice} <button className="btn ghost small" onClick={() => setNotice("")}>Dismiss</button></p>}
          {health && health.voice !== "gemini" && <p className="small muted">Live voice is off (no Gemini key), so the tutor reads its answers with your browser's voice.</p>}
        </div>

        <aside className="card side">
          <div style={{ padding: "12px 12px 0" }}>
            <div className="tabs" role="tablist">
              {(["chapters", "transcript", "qa", "cost"] as const).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => { setTab(t); if (t === "qa") api.session(sessionId).then(setSummary); }}>
                  {t === "qa" ? "Q&A" : t === "cost" ? `Cost ${cost ? fmtINR(cost.total_inr) : ""}` : t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="side-scroll">
            {tab === "chapters" && lessonScenes.map((L) => (
              <div className="rail-lesson" key={L.id}>
                <h4>{L.title}</h4>
                {L.scenes.filter((s) => !s.dropped).map((s) => {
                  const st = statuses[s.id] ?? s;
                  return (
                    <div key={s.id} className={`rail-scene ${curSceneId === s.id ? "current" : ""}`}>
                      <StatusDot s={st} />
                      <span>{s.title}{st.status === "working" ? <span className="muted small"> · {Math.round((st.progress || 0) * 100)}%</span> : null}</span>
                    </div>
                  );
                })}
              </div>
            ))}
            {tab === "transcript" && (
              <div className="transcript">
                {entry ? entry.timings.map((s, i) => (
                  <p key={i} className={i === now.si ? "now" : ""} onClick={() => {
                    const t = entry.tl_start + (s.start - entry.src_from);
                    if (t >= entry.tl_start && eng.current!.hasBuffered(t, 0.2)) videoRef.current!.currentTime = t;
                  }}>{s.text}</p>
                )) : <p className="muted">The transcript appears as the lesson plays.</p>}
              </div>
            )}
            {tab === "cost" && (
              <div>
                <p className="muted small" style={{ marginTop: 0 }}>
                  This session's paid model calls: the voice tutor's replies, and the scripts and narration of any visual answers.
                  The lesson itself was paid for when the course was made.
                </p>
                {cost ? <CostBreakdown report={cost} showEvents compact /> : <p className="muted small">Loading…</p>}
              </div>
            )}
            {tab === "qa" && (
              <div>
                {!summary?.qa.length && <p className="muted small">Your questions and answers collect here.</p>}
                {summary?.qa.filter((q) => q.kind !== "noise").map((q) => (
                  <div className="qa-item" key={q.id}>
                    <b>{q.question || "(voice)"}</b>
                    <div className="muted">{q.answer}</div>
                    {q.answer_clip?.video && <a href={`/media/${q.answer_clip.video}`} target="_blank" rel="noreferrer" className="small">▶ Watch the visual answer</a>}
                    {q.answer_clip && !q.answer_clip.video && <span className="small muted">Visual answer: {q.answer_clip.status}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
