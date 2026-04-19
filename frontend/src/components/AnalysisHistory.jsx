import { useEffect, useMemo, useState } from "react";
import {
  History as HistoryIcon,
  Loader2,
  AlertCircle,
  Trash2,
  ChevronLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  ExternalLink,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { api } from "../api";

/**
 * History tab — browse past analyses.
 *
 * Two views:
 *   - list view: paginated summaries from GET /api/analyses
 *   - detail view: full AnalysisDetailOut from GET /api/analyses/{id},
 *     including a condensed sentiment dashboard and post list.
 *
 * Deleting cascades on the backend (the Analysis cascade-deletes its posts),
 * so after a successful DELETE we just refresh the list.
 */
export default function AnalysisHistory() {
  const [analyses, setAnalyses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // When non-null, we're viewing the detail for this analysis.
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null); // AnalysisDetailOut
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);

  // Tracks in-flight delete so we can disable the row button
  const [deletingId, setDeletingId] = useState(null);

  // ---- Initial list load -------------------------------------------------
  async function loadList() {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.listAnalyses(50, 0);
      setAnalyses(rows);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadList();
  }, []);

  // ---- Detail load (when the user clicks a row) --------------------------
  useEffect(() => {
    if (selectedId == null) {
      setSelected(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    setSelected(null);
    api
      .getAnalysis(selectedId)
      .then((data) => {
        if (!cancelled) setSelected(data);
      })
      .catch((e) => {
        if (!cancelled) setDetailError(e.message);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  async function handleDelete(id) {
    // Quick confirm — nothing fancy, but enough to prevent fat-finger loss.
    if (!window.confirm("Delete this analysis and all its posts?")) return;
    setDeletingId(id);
    try {
      await api.deleteAnalysis(id);
      // If the user is viewing the one that just got deleted, bounce back.
      if (selectedId === id) setSelectedId(null);
      // Optimistically remove from the list so the UI feels snappy.
      setAnalyses((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      setError(`Delete failed: ${e.message}`);
    } finally {
      setDeletingId(null);
    }
  }

  // -----------------------------------------------------------------------
  // Detail view
  // -----------------------------------------------------------------------
  if (selectedId != null) {
    return (
      <div>
        <button
          onClick={() => setSelectedId(null)}
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-indigo-700 mb-3"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to history
        </button>

        {detailLoading && (
          <div className="flex items-center gap-2 text-slate-600 text-sm py-8">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading analysis…
          </div>
        )}

        {detailError && (
          <ErrorBanner message={detailError} />
        )}

        {selected && <DetailView analysis={selected} onDelete={handleDelete} deleting={deletingId === selected.id} />}
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // List view
  // -----------------------------------------------------------------------
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl md:text-2xl font-bold text-slate-900 flex items-center gap-2">
          <HistoryIcon className="w-5 h-5 text-indigo-500" />
          Past analyses
        </h2>
        <button
          onClick={loadList}
          disabled={loading}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>
      <p className="text-slate-600 text-sm mb-4">
        Every analysis you run is saved here automatically — click any row to
        revisit the full post list and sentiment breakdown.
      </p>

      {error && <ErrorBanner message={error} />}

      {loading && analyses.length === 0 && (
        <div className="flex items-center gap-2 text-slate-600 text-sm py-8">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading history…
        </div>
      )}

      {!loading && analyses.length === 0 && !error && (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
          No analyses yet. Run one from the <strong>Analyze</strong> tab and
          it'll show up here.
        </div>
      )}

      {analyses.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <ul className="divide-y divide-slate-200">
            {analyses.map((a) => (
              <HistoryRow
                key={a.id}
                analysis={a}
                onClick={() => setSelectedId(a.id)}
                onDelete={() => handleDelete(a.id)}
                deleting={deletingId === a.id}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// List row
// ---------------------------------------------------------------------------
function HistoryRow({ analysis, onClick, onDelete, deleting }) {
  const mean = analysis.mean_score;
  const tint = sentimentTint(mean);
  return (
    <li className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/70 transition">
      <button
        onClick={onClick}
        className="flex-1 min-w-0 text-left"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-slate-900 truncate">
            {analysis.keyword}
          </span>
          <span
            className={`text-xs px-1.5 py-0.5 rounded border ${tint.badge}`}
          >
            {mean > 0 ? "+" : ""}
            {mean.toFixed(2)}
          </span>
          <span className="text-xs text-slate-500">
            {analysis.total_posts} post{analysis.total_posts === 1 ? "" : "s"}
          </span>
          <span className="text-xs text-slate-400">
            · {analysis.scoring_method}
            {analysis.use_llm_fallback && analysis.scoring_method === "lexicon"
              ? " + LLM"
              : ""}
          </span>
        </div>
        <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
          <span>{new Date(analysis.created_at).toLocaleString()}</span>
          <span>·</span>
          <span>{(analysis.sources || []).join(", ") || "—"}</span>
          {analysis.subreddits && analysis.subreddits.length > 0 && (
            <>
              <span>·</span>
              <span className="truncate">
                r/{analysis.subreddits.join(", r/")}
              </span>
            </>
          )}
          {analysis.llm_calls_made > 0 && (
            <>
              <span>·</span>
              <span className="text-indigo-700">
                {analysis.llm_calls_made} LLM call
                {analysis.llm_calls_made === 1 ? "" : "s"}
              </span>
            </>
          )}
        </div>
      </button>

      <div className="flex items-center gap-3 text-xs text-slate-500 whitespace-nowrap">
        <span className="hidden md:inline">
          <span className="text-emerald-700 font-medium">{analysis.positive_count}</span>
          <span className="mx-1">/</span>
          <span className="text-slate-600 font-medium">{analysis.neutral_count}</span>
          <span className="mx-1">/</span>
          <span className="text-rose-700 font-medium">{analysis.negative_count}</span>
        </span>
        <button
          onClick={onDelete}
          disabled={deleting}
          className="p-1.5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600 disabled:opacity-50"
          title="Delete analysis"
        >
          {deleting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4" />
          )}
        </button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Detail view — compact version of the Analyze-tab dashboard
// ---------------------------------------------------------------------------
function DetailView({ analysis, onDelete, deleting }) {
  const mean = analysis.mean_score;
  const total = analysis.total_posts;

  // Same time-series derivation as the Analyze tab, scoped to this analysis.
  const timeSeries = useMemo(() => {
    const byDay = {};
    for (const p of analysis.posts || []) {
      if (!p.created_utc) continue;
      const day = new Date(p.created_utc).toISOString().slice(0, 10);
      byDay[day] = byDay[day] || { day, scores: [], count: 0 };
      byDay[day].scores.push(p.score);
      byDay[day].count += 1;
    }
    return Object.values(byDay)
      .map((d) => ({
        day: d.day,
        avg: d.scores.reduce((a, b) => a + b, 0) / d.scores.length,
        count: d.count,
      }))
      .sort((a, b) => a.day.localeCompare(b.day));
  }, [analysis]);

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-xl md:text-2xl font-bold text-slate-900 truncate">
            {analysis.keyword}
          </h2>
          <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
            <span>{new Date(analysis.created_at).toLocaleString()}</span>
            <span>·</span>
            <span>{analysis.scoring_method}</span>
            {analysis.use_llm_fallback &&
              analysis.scoring_method === "lexicon" && (
                <>
                  <span>·</span>
                  <span>LLM fallback on</span>
                </>
              )}
            <span>·</span>
            <span>{(analysis.sources || []).join(", ")}</span>
            {analysis.subreddits && analysis.subreddits.length > 0 && (
              <>
                <span>·</span>
                <span>r/{analysis.subreddits.join(", r/")}</span>
              </>
            )}
          </div>
        </div>
        <button
          onClick={() => onDelete(analysis.id)}
          disabled={deleting}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-rose-200 text-rose-700 rounded-lg hover:bg-rose-50 disabled:opacity-50 whitespace-nowrap self-start"
        >
          {deleting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4" />
          )}
          Delete
        </button>
      </div>

      {/* Summary cards — same layout as the Analyze tab */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total posts" value={total} />
        <StatCard
          label="Mean sentiment"
          value={mean.toFixed(2)}
          sub={mean > 0.1 ? "positive" : mean < -0.1 ? "negative" : "neutral"}
          tint={mean > 0.1 ? "emerald" : mean < -0.1 ? "rose" : "slate"}
          icon={
            mean > 0.1 ? (
              <TrendingUp className="w-4 h-4 text-emerald-600" />
            ) : mean < -0.1 ? (
              <TrendingDown className="w-4 h-4 text-rose-600" />
            ) : (
              <Minus className="w-4 h-4 text-slate-500" />
            )
          }
        />
        <StatCard
          label="% positive"
          value={`${total ? Math.round((analysis.positive_count / total) * 100) : 0}%`}
          sub={`${analysis.positive_count} posts`}
          tint="emerald"
          icon={<TrendingUp className="w-4 h-4 text-emerald-600" />}
        />
        <StatCard
          label="% negative"
          value={`${total ? Math.round((analysis.negative_count / total) * 100) : 0}%`}
          sub={`${analysis.negative_count} posts`}
          tint="rose"
          icon={<TrendingDown className="w-4 h-4 text-rose-600" />}
        />
      </div>

      {analysis.notes && (
        <div className="mb-4 text-xs text-slate-500 italic">
          Notes: {analysis.notes}
        </div>
      )}
      {analysis.llm_calls_made > 0 && (
        <div className="mb-4 text-xs text-indigo-700">
          {analysis.llm_calls_made} LLM call
          {analysis.llm_calls_made === 1 ? "" : "s"} used in this analysis.
        </div>
      )}

      {/* Time series */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">
          Sentiment over time
        </h3>
        {timeSeries.length >= 2 ? (
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer>
              <LineChart
                data={timeSeries}
                margin={{ top: 5, right: 10, left: -20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#64748b" }} />
                <YAxis domain={[-1, 1]} tick={{ fontSize: 11, fill: "#64748b" }} />
                <Tooltip
                  contentStyle={{ fontSize: 12 }}
                  formatter={(v, n) =>
                    n === "avg" ? [Number(v).toFixed(2), "Avg sentiment"] : [v, n]
                  }
                />
                <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                <Line
                  type="monotone"
                  dataKey="avg"
                  stroke="#6366f1"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-slate-500 italic">
            Not enough date spread for a trend line.
          </p>
        )}
      </div>

      {/* Post list */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">
          Posts ({analysis.posts.length})
        </h3>
        <div
          className="space-y-3 overflow-y-auto pr-1"
          style={{ maxHeight: "600px" }}
        >
          {analysis.posts.map((p) => (
            <PostCard key={`${p.source}-${p.source_id}`} post={p} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small reusable bits (kept local so this file stays self-contained —
// SentimentTracker.jsx defines its own nearly-identical copies for its tab).
// ---------------------------------------------------------------------------
function ErrorBanner({ message }) {
  return (
    <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-sm mb-4">
      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  );
}

function StatCard({ label, value, sub, icon, tint = "slate" }) {
  const tints = {
    slate: "bg-white border-slate-200",
    emerald: "bg-emerald-50/50 border-emerald-200",
    rose: "bg-rose-50/50 border-rose-200",
  };
  return (
    <div className={`rounded-xl border p-3 md:p-4 ${tints[tint] || tints.slate}`}>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{label}</span>
        {icon}
      </div>
      <div className="text-xl md:text-2xl font-bold text-slate-900 mt-1">
        {value}
      </div>
      {sub && (
        <div className="text-xs text-slate-500 mt-0.5 capitalize">{sub}</div>
      )}
    </div>
  );
}

function PostCard({ post }) {
  const score = post.score;
  const color =
    score > 0.1
      ? "text-emerald-700 bg-emerald-50 border-emerald-200"
      : score < -0.1
        ? "text-rose-700 bg-rose-50 border-rose-200"
        : "text-slate-700 bg-slate-50 border-slate-200";
  const displayBody = (post.body || "").slice(0, 280);
  return (
    <div className="border border-slate-200 rounded-lg p-3 hover:bg-slate-50/50">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <a
            href={post.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-slate-900 hover:text-indigo-600 line-clamp-2 flex items-start gap-1"
          >
            <span>{post.title || "(untitled)"}</span>
            <ExternalLink className="w-3 h-3 mt-1 flex-shrink-0 text-slate-400" />
          </a>
          <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
            <span className="font-medium">
              {post.subreddit || post.source}
            </span>
            {post.author && <span>· u/{post.author}</span>}
            {post.created_utc && (
              <span>· {new Date(post.created_utc).toLocaleDateString()}</span>
            )}
            {typeof post.votes === "number" && (
              <span>· {post.votes} votes</span>
            )}
          </div>
          {displayBody && (
            <p className="text-sm text-slate-700 mt-2 line-clamp-3">
              {displayBody}
              {post.body && post.body.length > 280 ? "…" : ""}
            </p>
          )}
          {post.matched_phrases && post.matched_phrases.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {post.matched_phrases.slice(0, 6).map((m) => (
                <span
                  key={m.phrase}
                  className={`text-xs px-1.5 py-0.5 rounded border ${
                    m.weight > 0
                      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                      : "bg-rose-50 border-rose-200 text-rose-800"
                  }`}
                >
                  {m.phrase}
                  {m.count > 1 ? ` ×${m.count}` : ""}
                </span>
              ))}
            </div>
          )}
          {post.score_method === "llm" && post.llm_reason && (
            <div className="mt-2 text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-2 py-1 flex items-start gap-1">
              <Sparkles className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>
                <strong>Claude:</strong> {post.llm_reason}
              </span>
            </div>
          )}
        </div>
        <div
          className={`text-sm font-semibold px-2 py-1 rounded border ${color} whitespace-nowrap`}
        >
          {score > 0 ? "+" : ""}
          {score.toFixed(2)}
          <div
            className="font-normal opacity-70"
            style={{ fontSize: "10px" }}
          >
            {post.score_method}
          </div>
        </div>
      </div>
    </div>
  );
}

// Shared small helper for row/summary badges.
function sentimentTint(mean) {
  if (mean > 0.1) {
    return {
      badge: "bg-emerald-50 border-emerald-200 text-emerald-700",
    };
  }
  if (mean < -0.1) {
    return {
      badge: "bg-rose-50 border-rose-200 text-rose-700",
    };
  }
  return {
    badge: "bg-slate-50 border-slate-200 text-slate-600",
  };
}
