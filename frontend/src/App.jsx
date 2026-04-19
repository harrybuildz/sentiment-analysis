import { useEffect, useState } from "react";
import { Sparkles, History, Settings as SettingsIcon, AlertCircle } from "lucide-react";
import { api } from "./api";
import SentimentTracker from "./components/SentimentTracker.jsx";
import AnalysisHistory from "./components/AnalysisHistory.jsx";
import LexiconEditor from "./components/LexiconEditor.jsx";

/**
 * Top-level app. Shows a tab bar and swaps between the three main views.
 * Fetches backend config on mount so child views know which scoring methods
 * are available.
 */
export default function App() {
  const [tab, setTab] = useState("analyze");
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState(null);

  useEffect(() => {
    api
      .getConfig()
      .then(setConfig)
      .catch((e) => setConfigError(e.message));
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 flex items-center justify-between">
          <h1 className="text-lg md:text-xl font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-500" />
            Sentiment Tracker
          </h1>

          <nav className="flex gap-1">
            <TabButton
              active={tab === "analyze"}
              onClick={() => setTab("analyze")}
              icon={<Sparkles className="w-4 h-4" />}
              label="Analyze"
            />
            <TabButton
              active={tab === "history"}
              onClick={() => setTab("history")}
              icon={<History className="w-4 h-4" />}
              label="History"
            />
            <TabButton
              active={tab === "lexicon"}
              onClick={() => setTab("lexicon")}
              icon={<SettingsIcon className="w-4 h-4" />}
              label="Lexicon"
            />
          </nav>
        </div>
      </header>

      {/* Connection error banner */}
      {configError && (
        <div className="max-w-6xl mx-auto px-4 md:px-6 pt-4">
          <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">Can't reach the backend.</div>
              <div className="text-xs mt-0.5">
                {configError}. Make sure the backend is running on{" "}
                <code className="bg-rose-100 px-1 rounded">
                  {import.meta.env.VITE_API_BASE || "http://localhost:8000"}
                </code>{" "}
                — e.g., <code className="bg-rose-100 px-1 rounded">cd backend && uvicorn app.main:app --reload --port 8000</code>.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-4 md:px-6 py-6">
        {tab === "analyze" && <SentimentTracker config={config} />}
        {tab === "history" && <AnalysisHistory />}
        {tab === "lexicon" && <LexiconEditor />}
      </main>

      <footer className="text-xs text-slate-500 text-center py-4 border-t border-slate-200 mt-8">
        Personal sentiment tracker · Lexicon + LLM + HuggingFace scoring
      </footer>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition ${
        active
          ? "bg-indigo-50 text-indigo-700"
          : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
