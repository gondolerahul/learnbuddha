import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CostBreakdown, useCosts } from "./Costs";
import { api, CourseOut, fmtINR, fmtTime, SceneOut } from "../lib/api";

export function StatusDot({ s }: { s: Pick<SceneOut, "status"> }) {
  const cls = s.status === "ready" ? "ready" : s.status === "failed" ? "failed" : s.status === "working" ? "working" : "";
  return <span className={`status-dot ${cls}`} aria-label={s.status} title={s.status} />;
}

export default function CoursePage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const [c, setC] = useState<CourseOut | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const cost = useCosts({ course_id: id }, 5000);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await api.course(id);
        if (!stop) setC(r);
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [id]);

  async function op(ops: any[]) {
    try {
      setC(await api.outline(id, ops));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function reflow(lessonId: string, dir: "gentler" | "deeper") {
    setBusy(lessonId + dir);
    try {
      setC(await api.reflow(lessonId, dir));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function start(fresh = false) {
    const s = await api.openSession(id, fresh);
    nav(`/learn/${s.id}`);
  }

  if (!c) return <main className="page">{error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}</main>;

  const scenes = c.lessons.flatMap((l) => l.scenes.filter((s) => !s.dropped));
  const ready = scenes.filter((s) => s.status === "ready").length;
  const firstReady = scenes[0]?.status === "ready";

  return (
    <main className="page">
      {c.status === "planning" && (
        <section className="hero">
          <span className="pill busy">Planning your course</span>
          <h1>{c.topic}</h1>
          <p className="lede">Researching the topic and laying out lessons, scenes and checkpoints. This takes a few seconds…</p>
        </section>
      )}
      {c.status === "failed" && (
        <section className="hero">
          <h1>{c.topic}</h1>
          <p className="error">Planning failed: {c.error}</p>
        </section>
      )}
      {c.status === "ready" && (
        <>
          <section className="hero">
            <span className="muted small">{c.level} · {c.language} · ~{fmtTime(c.estimated_seconds)} of lessons · {c.brain_label ?? c.brain}
              {c.written_by && c.written_by.some((w) => w.id !== c.brain) && (
                <> · written by {c.written_by.map((w) => w.label).join(" + ")}</>
              )}</span>
            <h1>{c.title}</h1>
            <p className="lede">{c.summary}</p>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn primary" onClick={() => start()} disabled={!scenes.length}>
                {firstReady ? "Start learning" : "Start (first scene is rendering…)"}
              </button>
              <button className="btn ghost small" onClick={() => start(true)}>Start over</button>
              <span className="muted small">{ready}/{scenes.length} scenes drawn{ready < scenes.length ? "; the rest render ahead of you" : ""}</span>
            </div>
            {c.cached && <span className="pill ok">Reused from the course library</span>}
          </section>

          <div style={{ display: "grid", gap: 14 }}>
            {c.lessons.map((L, li) => (
              <section className="card lesson" key={L.id}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                  <h2 style={{ fontSize: 24 }}>{li + 1}. {L.title}</h2>
                  <span className="muted small">{L.objective}</span>
                  <span style={{ flex: 1 }} />
                  <button className="btn small" disabled={!!busy} onClick={() => reflow(L.id, "gentler")}>{busy === L.id + "gentler" ? "Re-planning…" : "Gentler"}</button>
                  <button className="btn small" disabled={!!busy} onClick={() => reflow(L.id, "deeper")}>{busy === L.id + "deeper" ? "Re-planning…" : "Deeper"}</button>
                </div>
                {L.scenes.filter((s) => !s.dropped || true).map((s, si) => (
                  <div className={`scene-row ${s.dropped ? "dropped" : ""}`} key={s.id}>
                    <StatusDot s={s} />
                    <div>
                      <div style={{ fontFamily: "var(--serif)", fontSize: 17 }}>{s.title}</div>
                      <div className="muted small">
                        {s.objective}
                        {s.status !== "ready" && s.status !== "queued" && !s.dropped && <> · {s.stage} {Math.round(s.progress * 100)}%</>}
                        {s.duration ? <> · {fmtTime(s.duration)}</> : <> · ~{s.target_seconds}s</>}
                      </div>
                      {s.status === "working" && <div className="bar" style={{ marginTop: 6 }}><span style={{ width: `${s.progress * 100}%` }} /></div>}
                      {s.status === "failed" && <div className="error small">{s.error} <button className="btn small" onClick={() => api.retry(s.id)}>Retry</button></div>}
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="btn ghost small" aria-label="Move up" disabled={si === 0} onClick={() => op([{ op: "move", scene_id: s.id, to_index: si - 1 }])}>↑</button>
                      <button className="btn ghost small" aria-label="Move down" disabled={si === L.scenes.length - 1} onClick={() => op([{ op: "move", scene_id: s.id, to_index: si + 1 }])}>↓</button>
                      {s.dropped ? (
                        <button className="btn ghost small" onClick={() => op([{ op: "restore", scene_id: s.id }])}>Restore</button>
                      ) : (
                        <button className="btn ghost small" onClick={() => op([{ op: "drop", scene_id: s.id }])}>Drop</button>
                      )}
                    </div>
                  </div>
                ))}
                {L.checkpoint_count > 0 && <div className="muted small" style={{ paddingLeft: 52 }}>✓ Checkpoint · {L.checkpoint_count} question{L.checkpoint_count > 1 ? "s" : ""}</div>}
              </section>
            ))}
          </div>

          <section className="card cost-card course-cost" aria-labelledby="course-cost">
            <div className="cost-head">
              <h3 id="course-cost">What this course has cost</h3>
              <span className="cost-total">{cost ? fmtINR(cost.total_inr) : "…"}</span>
            </div>
            <p className="muted small">
              Every paid model call made for this course: planning, scene scripts, fact checks, narration, and any learner's
              questions and visual answers. <Link to={`/costs?course=${c.id}`}>See each operation</Link>
            </p>
            {cost && <CostBreakdown report={cost} empty="No paid model calls recorded yet. Courses made before cost tracking was added show ₹0." />}
          </section>

          {c.sources.length > 0 && (
            <section style={{ marginTop: 28 }}>
              <h3>Sources</h3>
              <ul className="small">
                {c.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></li>)}
              </ul>
            </section>
          )}
        </>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
