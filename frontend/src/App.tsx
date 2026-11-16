import { useEffect, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { api, Health } from "./lib/api";
import Home from "./pages/Home";
import CoursePage from "./pages/Course";
import Player from "./pages/Player";
import KitPage from "./pages/Kit";
import CostsPage from "./pages/Costs";

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [down, setDown] = useState(false);
  useEffect(() => {
    api.health().then(setHealth).catch(() => setDown(true));
  }, []);
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand" aria-label="LearnBuddha home">
          <span className="brand-dot" aria-hidden />
          LearnBuddha
        </Link>
        {down && <span className="pill bad">API offline</span>}
        {health && health.brain === "mock" && <span className="pill warn" title="Set ANTHROPIC_API_KEY and/or GOOGLE_CLOUD_PROJECT in backend/.env">Offline brain (mock content)</span>}
        {health && health.voice !== "gemini" && <span className="pill warn" title="Set GOOGLE_CLOUD_PROJECT (Vertex AI) or GEMINI_API_KEY in backend/.env for live voice and natural narration">Typed tutor · {health.tts} narration</span>}
        {health && health.google.backend === "vertex" && <span className="pill ok" title={`project ${health.google.project} · ${health.google.location} · live ${health.google.live_location}`}>Vertex AI</span>}
        <nav>
          <Link to="/">Learn</Link>
          <Link to="/costs">Costs</Link>
          <Link to="/kit">Style Kit</Link>
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/course/:id" element={<CoursePage />} />
        <Route path="/learn/:sessionId" element={<Player health={health} />} />
        <Route path="/costs" element={<CostsPage />} />
        <Route path="/kit" element={<KitPage />} />
      </Routes>
    </>
  );
}
