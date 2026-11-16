import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, BrainOption, CourseListItem, DiagQ } from "../lib/api";

const EXAMPLES = [
  "Why sample variance divides by n − 1",
  "How vaccines train the immune system",
  "What a derivative really means",
  "How public-key cryptography works",
];

export default function Home() {
  const nav = useNavigate();
  const [topic, setTopic] = useState("");
  const [goal, setGoal] = useState("");
  const [minutes, setMinutes] = useState(8);
  const [language, setLanguage] = useState("English");
  const [kit, setKit] = useState("auto");
  const [questions, setQuestions] = useState<DiagQ[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"" | "diagnose" | "create">("");
  const [costRef, setCostRef] = useState("");
  const [error, setError] = useState("");
  const [courses, setCourses] = useState<CourseListItem[]>([]);
  const [brains, setBrains] = useState<BrainOption[]>([]);
  const [kits, setKits] = useState<[string, string][]>([]);
  const [brain, setBrain] = useState("");

  useEffect(() => {
    api.courses().then(setCourses).catch(() => {});
    api.health().then((h) => {
      setBrains(h.brains);
      setKits(Object.entries(h.kits));
      setBrain(h.brains.find((b) => b.default)?.id ?? h.brain);
    }).catch(() => {});
  }, []);

  async function diagnose(e: FormEvent) {
    e.preventDefault();
    if (topic.trim().length < 2) return;
    setError("");
    setBusy("diagnose");
    try {
      const r = await api.diagnose({ topic, goal, minutes, language, brain });
      setQuestions(r.questions);
      setCostRef(r.cost_ref);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function create() {
    setError("");
    setBusy("create");
    try {
      const c = await api.createCourse({
        topic, goal, minutes, language, kit, brain, cost_ref: costRef,
        answers: (questions ?? []).filter((q) => answers[q.id]).map((q) => ({ question: q.question, answer: answers[q.id] })),
      });
      nav(`/course/${c.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy("");
    }
  }

  return (
    <main className="page">
      <section className="hero">
        <h1>What would you like to understand?</h1>
        <p className="lede">
          Say a topic. LearnBuddha plans a short course and teaches it as a hand-drawn film. Interrupt any time with a question:
          it answers out loud, sketches the answer from the very frame you paused on, then picks up where you left off.
        </p>
      </section>

      <form className="card composer" onSubmit={diagnose}>
        <div className="field">
          <label htmlFor="topic">Topic</label>
          <input id="topic" className="input big" placeholder="Teach me why…" value={topic} onChange={(e) => { setTopic(e.target.value); setQuestions(null); }} autoFocus />
          <div className="chips" aria-label="Examples">
            {EXAMPLES.map((x) => (
              <button type="button" className="chip" key={x} onClick={() => { setTopic(x); setQuestions(null); }}>{x}</button>
            ))}
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="goal">What you already know / what you want</label>
            <input id="goal" className="input" placeholder="e.g. I know basic algebra; I want the intuition" value={goal} onChange={(e) => setGoal(e.target.value)} />
          </div>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="minutes">Time: {minutes} min</label>
              <input id="minutes" type="range" min={3} max={30} value={minutes} onChange={(e) => setMinutes(+e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="lang">Language</label>
              <select id="lang" className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
                {["English", "Hindi", "Spanish", "French", "German", "Portuguese"].map((l) => <option key={l}>{l}</option>)}
              </select>
            </div>
          </div>
        </div>
        {brains.length > 1 && (
          <div className="field">
            <label>Tutor model</label>
            <div className="chips">
              {brains.map((b) => (
                <button type="button" key={b.id} className={`chip ${brain === b.id ? "on" : ""}`} onClick={() => { setBrain(b.id); setQuestions(null); }}>{b.label}</button>
              ))}
            </div>
          </div>
        )}
        <div className="field">
          <label>Visual style</label>
          <div className="chips">
            {([["auto", "Fits the subject and learner"], ...kits] as [string, string][]).map(([id, label]) => (
              <button type="button" key={id} className={`chip ${kit === id ? "on" : ""}`} onClick={() => setKit(id)}>{label}</button>
            ))}
          </div>
        </div>
        {!questions && (
          <div>
            <button className="btn primary" disabled={topic.trim().length < 2 || !!busy}>
              {busy === "diagnose" ? "Thinking…" : "Continue"}
            </button>
          </div>
        )}
        {questions && (
          <div className="card" style={{ padding: 18, display: "grid", gap: 16, background: "var(--paper)" }}>
            <h3>A couple of quick questions</h3>
            {questions.map((q) => (
              <div key={q.id} className="field">
                <label>{q.question}</label>
                <div className="chips">
                  {q.options.map((o) => (
                    <button type="button" key={o} className={`chip ${answers[q.id] === o ? "on" : ""}`} onClick={() => setAnswers({ ...answers, [q.id]: o })}>{o}</button>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" className="btn primary" onClick={create} disabled={!!busy}>{busy === "create" ? "Planning…" : "Build my course"}</button>
              <button type="button" className="btn ghost" onClick={create} disabled={!!busy}>Skip questions</button>
            </div>
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </form>

      {courses.length > 0 && (
        <section style={{ marginTop: 40 }}>
          <h2>Your courses</h2>
          <div className="course-list">
            {courses.map((c) => (
              <Link key={c.id} to={`/course/${c.id}`} className="card course-row">
                <span className="title">{c.title}</span>
                <span className="spacer" style={{ flex: 1 }} />
                {c.completed ? <span className="pill ok">finished</span> : c.session_id ? <span className="pill">in progress</span> : null}
                <span className={`pill ${c.status === "ready" ? "ok" : c.status === "failed" ? "bad" : "busy"}`}>{c.status}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
