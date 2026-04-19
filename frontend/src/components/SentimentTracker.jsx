import { useEffect, useMemo, useState } from "react";
import {
  Search,
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  AlertCircle,
  Info,
  ExternalLink,
  Sparkles,
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
 * Main analysis view. Submits an AnalyzeRequest to the backend and renders
 * the returned AnalysisDetailOut as a dashboard.
 */
export default function SentimentTracker({ config }) {
  const [keyword, setKeyword] = useState("");
  const [subredditInput, setSubredditInput] = useState("technology, gadgets");
  const [sources, setSources] = useState({
    reddit_sitewide: true,
    reddit_subs: false,
    hackernews: true,
  });
  const [scoringMethod, setScoringMethod] = useState("lexicon");
  const [useLLMFallback, setUseLLMFallback] = useState(true);
  // Matches the backend's schemas.AnalyzeRequest.max_posts_per_source cap (1..100).
  // Higher values return more posts per source but cost more API calls (and,
  // for lexicon + LLM-fallback mode, potentially more LLM calls up to the
  // max_llm_calls_per_analysis ceiling in the backend config).
  const [maxPosts, setMaxPosts] = useState(25);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null); // AnalysisDetailOut

  // Auto-disable unavailable scoring methods based on backend config
  useEffect(() => {
    if (!config) return;
    if (scoringMethod === "llm" && !config.has_anthropic) setScoringMethod("lexicon");
    if (scoringMethod === "transformer" && !config.transformer_enabled)
      setScoringMethod("lexicon");
    if (!config.has_anthropic) setUseLLMFallback(false);
  }, [config]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runAnalysis() {
    const kw = keyword.trim();
    if (!kw) {
      setError("Enter a keyword or product name first.");
      return;
    }
    const selectedSources = Object.entries(sources)
      .filter(([_, v]) => v)
      .map(([k]) => k);
    if (selectedSources.length === 0) {
      setError("Pick at least one source.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const payload = {
        keyword: kw,
        sources: selectedSources,
        subreddits: sources.reddit_subs
          ? subredditInput.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
        scoring_method: scoringMethod,
        use_llm_fallback: useLLMFallback,
        max_posts_per_source: maxPosts,
      };
      const data = await api.analyze(payload);
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const stats = useMemo(() => {
    if (!result || !result.posts || result.posts.length === 0) return null;
    const posts = result.posts;

    // Time series: group by ISO day.
    const byDay = {};
    for (const p of posts) {
      if (!p.created_utc) continue;
      const day = new Date(p.created_utc).toISOString().slice(0, 10);
      byDay[day] = byDay[day] || { day, scores: [], count: 0 };
      byDay[day].scores.push(p.score);
      byDay[day].count += 1;
    }
    const timeSeries = Object.values(byDay)
      .map((d) => ({
        day: d.day,
        avg: d.scores.reduce((a, b) => a + b, 0) / d.scores.length,
        count: d.count,
      }))
      .sort((a, b) => a.day.localeCompare(b.day));

    // Top phrases across all posts
    const phraseCounts = {};
    for (const p of posts) {
      for (const m of p.matched_phrases || []) {
        phraseCounts[m.phrase] = phraseCounts[m.phrase] || {
          phrase: m.phrase,
          weight: m.weight,
          count: 0,
        };
        phraseCounts[m.phrase].count += m.count;
      }
    }
    const topPositive = Object.values(phraseCounts)
      .filter((x) => x.weight > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
    const topNegative = Object.values(phraseCounts)
      .filter((x) => x.weight < 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    return { timeSeries, topPositive, topNegative };
  }, [result]);

  return (
    <div>
      <h2 className="text-xl md:text-2xl font-bold text-slate-900 mb-1 flex items-center gap-2">
        Analyze a keyword
      </h2>
      <p className="text-slate-600 text-sm mb-4">
        Search Reddit + Hacker News, score each post, and view the sentiment
        dashboard. All fetched posts are persisted — you can revisit any
        analysis later from the History tab.
      </p>

      {/* Input card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-6 mb-6">
        <div className="flex flex-col md:flex-row gap-3 md:items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Keyword or product name
            </label>
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !loading) runAnalysis();
              }}
              placeholder='e.g. "Framework Laptop"'
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
            />
          </div>
          <button
            onClick={runAnalysis}
            disabled={loading || !config}
            className="px-5 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 whitespace-nowrap"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Analyzing…
              </>
            ) : (
              <>
                <Search className="w-4 h-4" />
                Analyze
              </>
            )}
          </button>
        </div>

        {/* Source toggles */}
        <div className="mt-4 flex flex-wrap gap-2">
          <Toggle
            label="Reddit (site-wide)"
            checked={sources.reddit_sitewide}
            onChange={(v) => setSources({ ...sources, reddit_sitewide: v })}
          />
          <Toggle
            label="Reddit (specific subs)"
            checked={sources.reddit_subs}
            onChange={(v) => setSources({ ...sources, reddit_subs: v })}
          />
          <Toggle
            label="Hacker News"
            checked={sources.hackernews}
            onChange={(v) => setSources({ ...sources, hackernews: v })}
          />
        </div>

        {sources.reddit_subs && (
          <div className="mt-3">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Subreddits (comma-separated; "r/" optional)
            </label>
            <input
              type="text"
              value={subredditInput}
              onChange={(e) => setSubredditInput(e.target.value)}
              placeholder="technology, gadgets, stocks"
              className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
        )}

        {/* Posts-per-source slider.
            Renders an estimated "up to N posts total before dedup" beneath
            the slider so the user can see what they're actually about to
            request. The math mirrors analyze.py: site-wide is 1 call, HN is
            1 call, and reddit_subs fires 1 call per listed subreddit. */}
        <div className="mt-4">
          <div className="flex items-baseline justify-between mb-1">
            <label
              htmlFor="max-posts-slider"
              className="block text-sm font-medium text-slate-700"
            >
              Posts per source
              <span className="ml-2 font-normal text-slate-500">
                ({maxPosts})
              </span>
            </label>
            <span className="text-xs text-slate-500">
              {estimateTotalPosts(sources, subredditInput, maxPosts)}
            </span>
          </div>
          <input
            id="max-posts-slider"
            type="range"
            min={1}
            max={100}
            step={1}
            value={maxPosts}
            onChange={(e) => setMaxPosts(parseInt(e.target.value, 10))}
            className="w-full accent-indigo-600"
          />
          <div
            className="flex justify-between text-slate-400 mt-0.5"
            style={{ fontSize: "10px" }}
          >
            <span>1</span>
            <span>25 (default)</span>
            <span>100 (max)</span>
          </div>
        </div>

        {/* Scoring method radios */}
        <div className="mt-4">
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Scoring method
          </label>
          <div className="flex flex-wrap gap-2">
            <MethodRadio
              value="lexicon"
              checked={scoringMethod === "lexicon"}
              onChange={setScoringMethod}
              label="Lexicon"
              hint="Fast, transparent, editable"
              available
            />
            <MethodRadio
              value="llm"
              checked={scoringMethod === "llm"}
              onChange={setScoringMethod}
              label="Claude (LLM)"
              hint={config?.anthropic_model ? `via ${config.anthropic_model}` : "via Anthropic"}
              available={!!config?.has_anthropic}
            />
            <MethodRadio
              value="transformer"
              checked={scoringMethod === "transformer"}
              onChange={setScoringMethod}
              label="HuggingFace"
              hint="cardiffnlp/twitter-roberta"
              available={!!config?.transformer_enabled}
            />
          </div>
        </div>

        {/* LLM fallback toggle (only when method=lexicon) */}
        {scoringMethod === "lexicon" && (
          <div className="mt-4 flex items-start gap-2 text-sm">
            <input
              id="llm-toggle"
              type="checkbox"
              checked={useLLMFallback}
              onChange={(e) => setUseLLMFallback(e.target.checked)}
              disabled={!config?.has_anthropic}
              className="mt-1"
            />
            <label htmlFor="llm-toggle" className="text-slate-700">
              Fall back to Claude for ambiguous posts (hybrid mode)
              {!config?.has_anthropic && (
                <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                  <Info className="w-3 h-3" />
                  ANTHROPIC_API_KEY not configured
                </span>
              )}
            </label>
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Results */}
      {result && <ResultDashboard result={result} stats={stats} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Estimate the upper bound on posts a request will fetch, matching the
 * backend's fetch-dispatch logic in analyze.py:
 *   - reddit_sitewide  → 1 call of `limit` posts
 *   - reddit_subs      → 1 call per listed subreddit (each of `limit` posts)
 *   - hackernews       → 1 call of `limit` posts
 *
 * This is pre-dedup and pre-empty-result, so actual totals are usually lower.
 * Shown next to the slider purely as user-facing context so they can reason
 * about what they're about to kick off.
 */
function estimateTotalPosts(sources, subredditInput, maxPosts) {
  let calls = 0;
  if (sources.reddit_sitewide) calls += 1;
  if (sources.hackernews) calls += 1;
  if (sources.reddit_subs) {
    const subs = (subredditInput || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    calls += subs.length;
  }
  if (calls === 0) return "No sources selected";
  const total = calls * maxPosts;
  return `up to ~${total} post${total === 1 ? "" : "s"} (${calls} call${
    calls === 1 ? "" : "s"
  })`;
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------
function Toggle({ label, checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`px-3 py-1.5 rounded-full text-sm border transition ${
        checked
          ? "bg-indigo-50 border-indigo-300 text-indigo-800"
          : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"
      }`}
    >
      <span className="inline-flex items-center gap-1.5">
        <span
          className={`w-2 h-2 rounded-full ${
            checked ? "bg-indigo-500" : "bg-slate-300"
          }`}
        />
        {label}
      </span>
    </button>
  );
}

function MethodRadio({ value, checked, onChange, label, hint, available }) {
  return (
    <button
      type="button"
      onClick={() => available && onChange(value)}
      disabled={!available}
      className={`px-3 py-2 rounded-lg text-left border transition ${
        checked
          ? "bg-indigo-50 border-indigo-300 ring-1 ring-indigo-200"
          : "bg-white border-slate-300 hover:bg-slate-50"
      } ${!available ? "opacity-50 cursor-not-allowed" : ""}`}
      title={available ? "" : "Not available — see .env configuration"}
    >
      <div className={`text-sm font-medium ${checked ? "text-indigo-800" : "text-slate-800"}`}>
        {label}
      </div>
      <div className="text-xs text-slate-500 mt-0.5">{hint}</div>
    </button>
  );
}

function ResultDashboard({ result, stats }) {
  const mean = result.mean_score;
  const total = result.total_posts;
  return (
    <>
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total posts" value={total} icon={<Search className="w-4 h-4 text-slate-500" />} />
        <StatCard
          label="Mean sentiment"
          value={mean.toFixed(2)}
          sub={mean > 0.1 ? "positive" : mean < -0.1 ? "negative" : "neutral"}
          icon={
            mean > 0.1 ? (
              <TrendingUp className="w-4 h-4 text-emerald-600" />
            ) : mean < -0.1 ? (
              <TrendingDown className="w-4 h-4 text-rose-600" />
            ) : (
              <Minus className="w-4 h-4 text-slate-500" />
            )
          }
          tint={mean > 0.1 ? "emerald" : mean < -0.1 ? "rose" : "slate"}
        />
        <StatCard
          label="% positive"
          value={`${total ? Math.round((result.positive_count / total) * 100) : 0}%`}
          sub={`${result.positive_count} posts`}
          tint="emerald"
          icon={<TrendingUp className="w-4 h-4 text-emerald-600" />}
        />
        <StatCard
          label="% negative"
          value={`${total ? Math.round((result.negative_count / total) * 100) : 0}%`}
          sub={`${result.negative_count} posts`}
          tint="rose"
          icon={<TrendingDown className="w-4 h-4 text-rose-600" />}
        />
      </div>

      {result.notes && (
        <div className="mb-6 text-xs text-slate-500 italic">Notes: {result.notes}</div>
      )}
      {result.llm_calls_made > 0 && (
        <div className="mb-6 text-xs text-indigo-700">
          {result.llm_calls_made} LLM call{result.llm_calls_made === 1 ? "" : "s"} used in this analysis.
        </div>
      )}

      {/* Time series */}
      {stats && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-6 mb-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Sentiment over time</h3>
          {stats.timeSeries.length >= 2 ? (
            <div style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer>
                <LineChart
                  data={stats.timeSeries}
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
                  <Line type="monotone" dataKey="avg" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-slate-500 italic">
              Not enough date spread for a trend line (results span a single day).
            </p>
          )}
        </div>
      )}

      {/* Top phrases */}
      {stats && (stats.topPositive.length > 0 || stats.topNegative.length > 0) && (
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <PhraseList title="Top positive phrases" items={stats.topPositive} tint="emerald" />
          <PhraseList title="Top negative phrases" items={stats.topNegative} tint="rose" />
        </div>
      )}

      {/* Post list */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Posts ({result.posts.length})</h3>
        <div
          className="space-y-3 overflow-y-auto pr-1"
          style={{ maxHeight: "600px" }}
        >
          {result.posts.map((p) => (
            <PostCard key={`${p.source}-${p.source_id}`} post={p} />
          ))}
        </div>
      </div>
    </>
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
      <div className="text-xl md:text-2xl font-bold text-slate-900 mt-1">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5 capitalize">{sub}</div>}
    </div>
  );
}

function PhraseList({ title, items, tint }) {
  const textColor = tint === "emerald" ? "text-emerald-700" : "text-rose-700";
  const max = items[0]?.count || 1;
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-2">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400 italic">No matches.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it) => (
            <li key={it.phrase} className="text-sm">
              <div className="flex items-center justify-between">
                <span className={`font-medium ${textColor}`}>{it.phrase}</span>
                <span className="text-xs text-slate-500">
                  ×{it.count} · {it.weight > 0 ? "+" : ""}
                  {it.weight.toFixed(2)}
                </span>
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden">
                <div
                  className={`h-full ${tint === "emerald" ? "bg-emerald-400" : "bg-rose-400"}`}
                  style={{ width: `${(it.count / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
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
            <span className="font-medium">{post.subreddit || post.source}</span>
            {post.author && <span>· u/{post.author}</span>}
            {post.created_utc && (
              <span>· {new Date(post.created_utc).toLocaleDateString()}</span>
            )}
            {typeof post.votes === "number" && <span>· {post.votes} votes</span>}
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
        <div className={`text-sm font-semibold px-2 py-1 rounded border ${color} whitespace-nowrap`}>
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
