export interface BrainOption { id: string; label: string; provider: "gemini" | "anthropic" | "mock"; note: string; via: string; default: boolean }
export interface Health {
  ok: boolean; brain: string; brains: BrainOption[]; tts: string; voice: string; kits: Record<string, string>;
  google: { backend: "vertex" | "studio" | "none"; project: string | null; location: string | null; live_location: string | null };
  models: { claude: string; gemini_brain: string; gemini_tts: string; gemini_live: string };
}
export interface DiagQ { id: string; question: string; options: string[] }
export interface SceneOut {
  id: string; kind: string; title: string; objective: string; key_points: string[]; visual_idea: string; target_seconds: number;
  status: string; stage: string; progress: number; error: string | null; dropped: boolean; duration: number | null; poster: string | null;
  video: string | null; sources: any[]; idx: number;
}
export interface LessonOut { id: string; title: string; objective: string; dropped: boolean; checkpoint_count: number; scenes: SceneOut[] }
export interface CourseOut {
  id: string; topic: string; goal: string; title: string; summary: string; level: string; language: string; kit: string; brain: string; brain_label?: string; written_by?: { id: string; label: string; calls: number }[]; minutes: number;
  status: string; error: string | null; sources: { title: string; url: string }[]; version: number; created_at: string; lessons: LessonOut[];
  estimated_seconds: number; cached?: boolean;
}
export interface CourseListItem { id: string; title: string; topic: string; status: string; kit: string; created_at: string; session_id: string | null; completed: boolean }
export interface QAItem {
  id: string; question: string; answer: string; kind: string; concept: string; t: number; scene_id: string | null; created_at: string;
  answer_clip: { id: string; status: string; video: string | null } | null;
}
export interface SessionSummary {
  id: string; course_id: string; course_title: string; completed: boolean; position: any; qa: QAItem[];
  mastery: { lesson_id: string; objective: string; attempts: number; correct: number; score: number }[];
  review_cards: { front: string; back: string; reason: string }[];
}

export interface CostEvent {
  id: number; at: string; operation: string; label: string; provider: string; model: string; units: Record<string, number>;
  cost_usd: number; cost_inr: number; usd_inr: number; detail: string; course_id: string | null; scene_id: string | null;
  session_id: string | null; course_title: string;
}
export interface CostReport {
  total_inr: number; total_usd: number; count: number; usd_inr: number; fx_source: string; notes: string[]; as_of: string;
  by_operation: { operation: string; label: string; count: number; cost_inr: number; cost_usd: number }[];
  courses: { course_id: string; title: string; cost_inr: number }[];
  events: CostEvent[];
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try {
      const j = await r.json();
      msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j);
    } catch { /* not json */ }
    throw new Error(msg);
  }
  return r.json();
}

export const api = {
  health: () => req<Health>("/api/health"),
  diagnose: (b: { topic: string; goal: string; minutes: number; language: string; brain: string }) => req<{ questions: DiagQ[]; cost_ref: string }>("/api/diagnose", { method: "POST", body: JSON.stringify(b) }),
  createCourse: (b: any) => req<CourseOut>("/api/courses", { method: "POST", body: JSON.stringify(b) }),
  courses: () => req<CourseListItem[]>("/api/courses"),
  course: (id: string) => req<CourseOut>(`/api/courses/${id}`),
  outline: (id: string, ops: any[]) => req<CourseOut>(`/api/courses/${id}/outline`, { method: "PATCH", body: JSON.stringify({ ops }) }),
  reflow: (lessonId: string, direction: "gentler" | "deeper") => req<CourseOut>(`/api/lessons/${lessonId}/reflow`, { method: "POST", body: JSON.stringify({ direction }) }),
  retry: (sceneId: string) => req<SceneOut>(`/api/scenes/${sceneId}/retry`, { method: "POST" }),
  scene: (id: string) => req<any>(`/api/scenes/${id}`),
  openSession: (courseId: string, fresh = false) => req<{ id: string; resumed: boolean }>(`/api/courses/${courseId}/sessions${fresh ? "?fresh=true" : ""}`, { method: "POST" }),
  session: (id: string) => req<SessionSummary>(`/api/sessions/${id}`),
  costs: (q: { course_id?: string; session_id?: string; limit?: number } = {}) =>
    req<CostReport>(`/api/costs?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]))}`),
};

/** Rupees, with enough precision for paise-sized model calls. */
export const fmtINR = (v: number) => {
  if (!Number.isFinite(v)) v = 0;
  if (v === 0) return "₹0";
  if (Math.abs(v) < 0.01) return "<₹0.01";
  if (Math.abs(v) < 10) return `₹${v.toFixed(2)}`;
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
};

const UNIT_NAMES: Record<string, string> = {
  in: "in", out: "out", cache_read: "cached", cache_write: "cache write", audio_in: "audio in", audio_out: "audio out", search: "searches",
};
export const fmtUnits = (u: Record<string, number>) =>
  Object.entries(u).filter(([, n]) => n).map(([k, n]) => `${k === "search" ? n : n.toLocaleString("en-IN")} ${UNIT_NAMES[k] ?? k}`).join(" · ");

export const fmtTime = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};
