import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, CostReport, fmtINR, fmtUnits } from "../lib/api";

/** Polls /api/costs for a course, a session, or everything. */
export function useCosts(q: { course_id?: string; session_id?: string }, everyMs = 0): CostReport | null {
  const [r, setR] = useState<CostReport | null>(null);
  const key = `${q.course_id ?? ""}|${q.session_id ?? ""}`;
  useEffect(() => {
    let stop = false;
    const tick = () => api.costs({ ...q, limit: 500 }).then((x) => { if (!stop) setR(x); }).catch(() => {});
    tick();
    const t = everyMs ? setInterval(tick, everyMs) : undefined;
    return () => {
      stop = true;
      if (t) clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, everyMs]);
  return r;
}

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function CostBreakdown({ report, showEvents = false, compact = false, empty = "No paid model calls recorded yet." }: {
  report: CostReport; showEvents?: boolean; compact?: boolean; empty?: string;
}) {
  if (!report.count) return <p className="muted small">{empty}</p>;
  const max = Math.max(...report.by_operation.map((b) => b.cost_inr), 1e-9);
  return (
    <div className="cost-breakdown">
      <table className="cost-table">
        <thead>
          <tr><th scope="col">Operation</th><th scope="col" className="num">Calls</th><th scope="col" className="num">Cost</th></tr>
        </thead>
        <tbody>
          {report.by_operation.map((b) => (
            <tr key={b.operation}>
              <td>
                {b.label}
                <span className="cost-bar" aria-hidden><span style={{ width: `${(b.cost_inr / max) * 100}%` }} /></span>
              </td>
              <td className="num">{b.count}</td>
              <td className="num">{fmtINR(b.cost_inr)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><th scope="row">Total</th><td className="num">{report.count}</td><td className="num"><b>{fmtINR(report.total_inr)}</b></td></tr>
        </tfoot>
      </table>
      {showEvents && (
        <ol className={`cost-events ${compact ? "compact" : ""}`}>
          {report.events.map((e) => (
            <li key={e.id}>
              <div className="cost-event-head">
                <b>{e.label}</b>
                <span className="num">{fmtINR(e.cost_inr)}</span>
              </div>
              {e.detail && <div className="cost-detail">{e.detail}</div>}
              <div className="muted small">{when(e.at)} · {e.model} · {fmtUnits(e.units)}</div>
            </li>
          ))}
        </ol>
      )}
      <p className="muted small cost-rate">
        $1 = ₹{report.usd_inr.toFixed(2)} ({report.fx_source}). Total ${report.total_usd.toFixed(4)}.
      </p>
    </div>
  );
}

export default function CostsPage() {
  const [params, setParams] = useSearchParams();
  const course = params.get("course") ?? "";
  const all = useCosts({}, 8000);
  const report = useCosts({ course_id: course || undefined }, 8000);
  const title = course ? all?.courses.find((c) => c.course_id === course)?.title || "This course" : "All courses";

  return (
    <main className="page">
      <section className="hero">
        <span className="muted small">Model costs in Indian rupees</span>
        <h1>What each operation costs</h1>
        <p className="lede">
          Every paid call to Claude or Gemini, priced from the tokens the API reported. Rendering runs on your own machine and
          costs nothing here.
        </p>
      </section>

      <div className="cost-layout">
        <section className="card cost-card">
          <div className="cost-head">
            <h3>{title}</h3>
            <span className="cost-total">{report ? fmtINR(report.total_inr) : "…"}</span>
          </div>
          {course && <button className="btn ghost small" onClick={() => setParams({})}>Show all courses</button>}
          {report ? <CostBreakdown report={report} showEvents /> : <p className="muted">Loading…</p>}
        </section>

        <aside className="cost-side">
          <section className="card cost-card">
            <h3>By course</h3>
            {!all?.courses.length && <p className="muted small">No courses with costs yet.</p>}
            <ul className="cost-courses">
              {all?.courses.map((c) => (
                <li key={c.course_id} className={c.course_id === course ? "on" : ""}>
                  <button onClick={() => setParams({ course: c.course_id })}>{c.title || c.course_id}</button>
                  <span className="num">{fmtINR(c.cost_inr)}</span>
                  <Link to={`/course/${c.course_id}`} className="small" aria-label={`Open ${c.title}`}>Open</Link>
                </li>
              ))}
            </ul>
          </section>
          {report && (
            <section className="card cost-card">
              <h3>How it's priced</h3>
              <ul className="small muted cost-notes">
                {report.notes.map((n) => <li key={n}>{n}</li>)}
                <li>Calls made before cost tracking was added aren't counted.</li>
              </ul>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
