import { useState, useEffect, useMemo } from "react";
import {
  Search,
  Settings,
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  AlertCircle,
  Plus,
  Trash2,
  Info,
  ExternalLink,
  Sparkles,
  ChevronDown,
  ChevronUp,
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

// ---------------------------------------------------------------------------
// Default lexicon — VADER-inspired subset plus common multi-word product/forum
// phrases. Weights are in [-1, +1]. Users can edit this in the UI.
// ---------------------------------------------------------------------------
const DEFAULT_LEXICON = {
  // Strong positive (multi-word first so they match before their component words)
  "absolutely love": 0.9,
  "highly recommend": 0.85,
  "game changer": 0.8,
  "works flawlessly": 0.8,
  "best ever": 0.85,
  "blown away": 0.8,
  "love this": 0.85,
  "works well": 0.55,
  "pretty good": 0.4,
  "not bad": 0.3,

  // Positive single words
  amazing: 0.7,
  fantastic: 0.75,
  excellent: 0.7,
  awesome: 0.6,
  great: 0.5,
  good: 0.35,
  love: 0.6,
  loved: 0.6,
  like: 0.25,
  liked: 0.25,
  nice: 0.3,
  solid: 0.4,
  impressed: 0.55,
  impressive: 0.55,
  reliable: 0.45,
  smooth: 0.4,
  fast: 0.3,
  easy: 0.3,
  intuitive: 0.45,
  beautiful: 0.55,
  perfect: 0.75,
  recommend: 0.55,
  worth: 0.35,
  upgrade: 0.25,

  // Strong negative
  "total garbage": -0.9,
  "waste of money": -0.85,
  "piece of junk": -0.85,
  "doesn't work": -0.6,
  "does not work": -0.6,
  "not worth": -0.55,
  "not good": -0.4,
  "not great": -0.35,
  "stay away": -0.75,
  "avoid it": -0.65,
  "fell apart": -0.6,
  "stopped working": -0.55,

  // Negative single words
  terrible: -0.75,
  awful: -0.7,
  worst: -0.75,
  hate: -0.7,
  hated: -0.65,
  bad: -0.4,
  sucks: -0.6,
  disappointing: -0.55,
  disappointed: -0.55,
  broken: -0.5,
  buggy: -0.5,
  useless: -0.65,
  overpriced: -0.5,
  scam: -0.85,
  garbage: -0.7,
  trash: -0.65,
  junk: -0.6,
  horrible: -0.75,
  frustrating: -0.55,
  frustrated: -0.5,
  annoying: -0.45,
  slow: -0.3,
  clunky: -0.45,
  crash: -0.5,
  crashes: -0.5,
  glitchy: -0.5,
  regret: -0.6,
  refund: -0.45,
};

const AMBIGUITY_THRESHOLD = 0.15; // below this magnitude, LLM fallback considered
const MAX_LLM_CALLS = 20; // hard cap per analysis to bound cost/time

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

// Escape regex special chars so user-added phrases don't break the regex.
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Score a single text block against the lexicon.
// Returns { score, matches, totalHits, confidence }.
// - score: bounded [-1, +1], normalized by sqrt(hits) to dampen repeat spam
// - matches: [{phrase, weight, count}]
// - confidence: 0..1 based on how many hits we found
function scoreWithLexicon(text, lexicon) {
  const normalized = (text || "").toLowerCase();
  const matches = [];
  let totalWeighted = 0;
  let totalHits = 0;

  // Sort phrases by length desc so "not bad" matches before "bad".
  const phrases = Object.keys(lexicon).sort((a, b) => b.length - a.length);
  // Mask out spans already matched by a longer phrase, to avoid double-counting.
  const masked = normalized.split("");

  for (const phrase of phrases) {
    const weight = lexicon[phrase];
    const re = new RegExp(`\\b${escapeRegex(phrase)}\\b`, "gi");
    let m;
    let count = 0;
    while ((m = re.exec(masked.join(""))) !== null) {
      count += 1;
      // Mask this span with spaces so shorter overlapping phrases skip it.
      for (let i = m.index; i < m.index + phrase.length; i++) masked[i] = " ";
    }
    if (count > 0) {
      matches.push({ phrase, weight, count });
      totalWeighted += weight * count;
      totalHits += count;
    }
  }

  // Normalize: divide by sqrt(hits) so a post with 10 identical words doesn't
  // dominate, but a post with many varied signals still moves the score.
  const raw =
    totalHits > 0 ? totalWeighted / Math.max(1, Math.sqrt(totalHits)) : 0;
  const score = Math.max(-1, Math.min(1, raw));
  const confidence = Math.min(1, totalHits / 3);

  return { score, matches, totalHits, confidence };
}

// Attempt to score via Claude if the artifact sandbox exposes window.claude.
// Returns { score, reason } or null if unavailable / failed to parse.
async function scoreWithLLM(text) {
  if (typeof window === "undefined" || !window.claude?.complete) return null;
  const snippet = (text || "").slice(0, 1200);
  const prompt = `You are a sentiment analyst. Read the text below (from a public forum) and output a single JSON object on ONE line, no markdown, no code fences:

{"score": <number between -1 and 1>, "reason": "<1 short sentence>"}

Score guidelines:
- +1.0 very enthusiastic/positive
-  0.0 neutral, informational, or mixed
- -1.0 very negative, hostile, disappointed
Account for sarcasm and negation.

Text:
"""
${snippet}
"""`;

  try {
    const raw = await window.claude.complete(prompt);
    const match = raw.match(/\{[\s\S]*?\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    const s = Number(parsed.score);
    if (!isFinite(s)) return null;
    return {
      score: Math.max(-1, Math.min(1, s)),
      reason: String(parsed.reason || "").slice(0, 200),
    };
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Data fetchers — each returns an array of normalized Post objects:
//   { source, id, title, body, url, subreddit, author, created, score_votes }
// ---------------------------------------------------------------------------
async function fetchRedditSiteWide(keyword) {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(
    keyword
  )}&limit=25&sort=new&restrict_sr=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Reddit site-wide HTTP ${res.status}`);
  const data = await res.json();
  return (data.data?.children || []).map((c) => ({
    source: "reddit",
    id: c.data.id,
    title: c.data.title || "",
    body: c.data.selftext || "",
    url: `https://reddit.com${c.data.permalink}`,
    subreddit: c.data.subreddit_name_prefixed,
    author: c.data.author,
    created: (c.data.created_utc || 0) * 1000,
    score_votes: c.data.score || 0,
  }));
}

async function fetchRedditSubreddit(keyword, subreddit) {
  const sub = subreddit.replace(/^\/?r\//i, "").trim();
  if (!sub) return [];
  const url = `https://www.reddit.com/r/${encodeURIComponent(
    sub
  )}/search.json?q=${encodeURIComponent(
    keyword
  )}&limit=25&sort=new&restrict_sr=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`r/${sub} HTTP ${res.status}`);
  const data = await res.json();
  return (data.data?.children || []).map((c) => ({
    source: "reddit",
    id: c.data.id,
    title: c.data.title || "",
    body: c.data.selftext || "",
    url: `https://reddit.com${c.data.permalink}`,
    subreddit: c.data.subreddit_name_prefixed || `r/${sub}`,
    author: c.data.author,
    created: (c.data.created_utc || 0) * 1000,
    score_votes: c.data.score || 0,
  }));
}

async function fetchHackerNews(keyword) {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(
    keyword
  )}&tags=(story,comment)&hitsPerPage=25`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HN HTTP ${res.status}`);
  const data = await res.json();
  return (data.hits || []).map((h) => ({
    source: "hn",
    id: h.objectID,
    title: h.title || h.story_title || "(comment)",
    body: h.story_text || h.comment_text || "",
    url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    subreddit: "Hacker News",
    author: h.author,
    created: new Date(h.created_at).getTime(),
    score_votes: h.points || 0,
  }));
}

// ---------------------------------------------------------------------------
// Small UI helpers
// ---------------------------------------------------------------------------
function classify(score) {
  if (score > 0.1) return "positive";
  if (score < -0.1) return "negative";
  return "neutral";
}

function scoreColor(score) {
  if (score > 0.1) return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (score < -0.1) return "text-rose-700 bg-rose-50 border-rose-200";
  return "text-slate-700 bg-slate-50 border-slate-200";
}

function formatDate(ts) {
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function SentimentTracker() {
  const [keyword, setKeyword] = useState("");
  const [subredditInput, setSubredditInput] = useState("technology, gadgets");
  const [sources, setSources] = useState({
    redditSiteWide: true,
    redditSubs: false,
    hackerNews: true,
  });
  const [useLLMFallback, setUseLLMFallback] = useState(true);
  const [llmAvailable, setLlmAvailable] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("");
  const [error, setError] = useState(null);
  const [posts, setPosts] = useState([]);
  const [llmCallCount, setLlmCallCount] = useState(0);

  const [lexicon, setLexicon] = useState(DEFAULT_LEXICON);
  const [showLexiconEditor, setShowLexiconEditor] = useState(false);
  const [newPhrase, setNewPhrase] = useState("");
  const [newWeight, setNewWeight] = useState("0");

  // Feature-detect the in-artifact Claude API once on mount.
  useEffect(() => {
    setLlmAvailable(
      typeof window !== "undefined" && !!window.claude?.complete
    );
  }, []);

  async function analyze() {
    const kw = keyword.trim();
    if (!kw) {
      setError("Enter a keyword or product name first.");
      return;
    }
    if (!sources.redditSiteWide && !sources.redditSubs && !sources.hackerNews) {
      setError("Pick at least one source.");
      return;
    }

    setIsLoading(true);
    setLoadingLabel("Fetching posts…");
    setError(null);
    setPosts([]);
    setLlmCallCount(0);

    const errors = [];
    const fetchPromises = [];

    if (sources.redditSiteWide) {
      fetchPromises.push(
        fetchRedditSiteWide(kw).catch((e) => {
          errors.push(`Reddit site-wide: ${e.message}`);
          return [];
        })
      );
    }
    if (sources.redditSubs) {
      const subs = subredditInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const sub of subs) {
        fetchPromises.push(
          fetchRedditSubreddit(kw, sub).catch((e) => {
            errors.push(`r/${sub}: ${e.message}`);
            return [];
          })
        );
      }
    }
    if (sources.hackerNews) {
      fetchPromises.push(
        fetchHackerNews(kw).catch((e) => {
          errors.push(`Hacker News: ${e.message}`);
          return [];
        })
      );
    }

    const results = await Promise.all(fetchPromises);
    const all = [];
    for (const r of results) all.push(...r);

    // Dedupe by source+id
    const seen = new Set();
    const deduped = all.filter((p) => {
      const k = `${p.source}-${p.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // Score each post (lexicon first, LLM fallback if ambiguous and available).
    setLoadingLabel(`Scoring ${deduped.length} posts…`);
    let llmCalls = 0;
    const scored = [];
    for (const post of deduped) {
      const combined = `${post.title}\n${post.body}`.slice(0, 2000);
      const lex = scoreWithLexicon(combined, lexicon);
      let finalScore = lex.score;
      let method = "lexicon";
      let llmReason = null;

      const needsLLM =
        useLLMFallback &&
        llmAvailable &&
        llmCalls < MAX_LLM_CALLS &&
        (lex.totalHits === 0 || Math.abs(lex.score) < AMBIGUITY_THRESHOLD);

      if (needsLLM) {
        setLoadingLabel(
          `Scoring ${deduped.length} posts… (LLM ${llmCalls + 1}/${MAX_LLM_CALLS})`
        );
        const llmResult = await scoreWithLLM(combined);
        if (llmResult !== null) {
          finalScore = llmResult.score;
          method = "llm";
          llmReason = llmResult.reason;
          llmCalls += 1;
          setLlmCallCount(llmCalls);
        }
      }

      scored.push({
        ...post,
        lexScore: lex.score,
        matches: lex.matches,
        totalHits: lex.totalHits,
        confidence: lex.confidence,
        score: finalScore,
        method,
        llmReason,
      });
    }

    scored.sort((a, b) => b.created - a.created);
    setPosts(scored);

    if (errors.length && scored.length === 0) {
      setError(errors.join(" · "));
    } else if (errors.length) {
      setError(`Partial results — ${errors.join(" · ")}`);
    }
    setIsLoading(false);
    setLoadingLabel("");
  }

  // Aggregate stats for the dashboard.
  const stats = useMemo(() => {
    if (posts.length === 0) return null;
    const scores = posts.map((p) => p.score);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const pos = scores.filter((s) => s > 0.1).length;
    const neg = scores.filter((s) => s < -0.1).length;
    const neu = scores.length - pos - neg;

    // Time series: group posts by day, average their sentiment.
    const byDay = {};
    for (const p of posts) {
      if (!p.created) continue;
      const day = new Date(p.created).toISOString().slice(0, 10);
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

    // Top matched phrases across all posts.
    const phraseCounts = {};
    for (const p of posts) {
      for (const m of p.matches) {
        phraseCounts[m.phrase] = phraseCounts[m.phrase] || {
          phrase: m.phrase,
          weight: m.weight,
          count: 0,
        };
        phraseCounts[m.phrase].count += m.count;
      }
    }
    const topPositive = Object.values(phraseCounts)
      .filter((p) => p.weight > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
    const topNegative = Object.values(phraseCounts)
      .filter((p) => p.weight < 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    return {
      mean,
      pos,
      neg,
      neu,
      total: posts.length,
      timeSeries,
      topPositive,
      topNegative,
    };
  }, [posts]);

  function toggleSource(key) {
    setSources({ ...sources, [key]: !sources[key] });
  }

  function addPhrase() {
    const phrase = newPhrase.trim().toLowerCase();
    const weight = Number(newWeight);
    if (!phrase || !isFinite(weight)) return;
    setLexicon({
      ...lexicon,
      [phrase]: Math.max(-1, Math.min(1, weight)),
    });
    setNewPhrase("");
    setNewWeight("0");
  }

  function removePhrase(phrase) {
    const next = { ...lexicon };
    delete next[phrase];
    setLexicon(next);
  }

  function updateWeight(phrase, raw) {
    const w = Number(raw);
    if (!isFinite(w)) return;
    setLexicon({ ...lexicon, [phrase]: Math.max(-1, Math.min(1, w)) });
  }

  function resetLexicon() {
    setLexicon(DEFAULT_LEXICON);
  }

  const sortedLexiconEntries = useMemo(
    () =>
      Object.entries(lexicon).sort(
        (a, b) => b[1] - a[1] // highest weight first
      ),
    [lexicon]
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="mb-6">
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-indigo-500" />
            Forum Sentiment Tracker
          </h1>
          <p className="text-slate-600 mt-1 text-sm md:text-base">
            Search Reddit &amp; Hacker News for a keyword, score each post with
            a custom lexicon, and fall back to Claude for ambiguous posts.
          </p>
        </header>

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
                  if (e.key === "Enter" && !isLoading) analyze();
                }}
                placeholder='e.g. "Framework Laptop" or "Rabbit R1"'
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
              />
            </div>
            <button
              onClick={analyze}
              disabled={isLoading}
              className="px-5 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 whitespace-nowrap"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {loadingLabel || "Analyzing…"}
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
            <SourceToggle
              label="Reddit (site-wide)"
              checked={sources.redditSiteWide}
              onChange={() => toggleSource("redditSiteWide")}
            />
            <SourceToggle
              label="Reddit (specific subs)"
              checked={sources.redditSubs}
              onChange={() => toggleSource("redditSubs")}
            />
            <SourceToggle
              label="Hacker News"
              checked={sources.hackerNews}
              onChange={() => toggleSource("hackerNews")}
            />
          </div>

          {sources.redditSubs && (
            <div className="mt-3">
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Subreddits (comma-separated, without r/)
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

          {/* LLM fallback toggle */}
          <div className="mt-4 flex items-start gap-2 text-sm">
            <input
              id="llm-toggle"
              type="checkbox"
              checked={useLLMFallback}
              onChange={(e) => setUseLLMFallback(e.target.checked)}
              disabled={!llmAvailable}
              className="mt-1"
            />
            <label htmlFor="llm-toggle" className="text-slate-700">
              Use Claude to score ambiguous posts (hybrid mode)
              {!llmAvailable && (
                <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                  <Info className="w-3 h-3" />
                  Claude API not available in this sandbox — pure lexicon mode
                </span>
              )}
              {llmAvailable && llmCallCount > 0 && (
                <span className="ml-2 text-xs text-slate-500">
                  · {llmCallCount} LLM call{llmCallCount === 1 ? "" : "s"} this run
                </span>
              )}
            </label>
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Results */}
        {stats && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <StatCard
                label="Total posts"
                value={stats.total}
                icon={<Search className="w-4 h-4 text-slate-500" />}
              />
              <StatCard
                label="Mean sentiment"
                value={stats.mean.toFixed(2)}
                sub={classify(stats.mean)}
                icon={
                  stats.mean > 0.1 ? (
                    <TrendingUp className="w-4 h-4 text-emerald-600" />
                  ) : stats.mean < -0.1 ? (
                    <TrendingDown className="w-4 h-4 text-rose-600" />
                  ) : (
                    <Minus className="w-4 h-4 text-slate-500" />
                  )
                }
                tint={
                  stats.mean > 0.1
                    ? "emerald"
                    : stats.mean < -0.1
                    ? "rose"
                    : "slate"
                }
              />
              <StatCard
                label="% positive"
                value={`${Math.round((stats.pos / stats.total) * 100)}%`}
                sub={`${stats.pos} posts`}
                tint="emerald"
                icon={<TrendingUp className="w-4 h-4 text-emerald-600" />}
              />
              <StatCard
                label="% negative"
                value={`${Math.round((stats.neg / stats.total) * 100)}%`}
                sub={`${stats.neg} posts`}
                tint="rose"
                icon={<TrendingDown className="w-4 h-4 text-rose-600" />}
              />
            </div>

            {/* Time series chart */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-6 mb-6">
              <h2 className="text-sm font-semibold text-slate-700 mb-3">
                Sentiment over time
              </h2>
              {stats.timeSeries.length >= 2 ? (
                <div style={{ width: "100%", height: 240 }}>
                  <ResponsiveContainer>
                    <LineChart
                      data={stats.timeSeries}
                      margin={{ top: 5, right: 10, left: -20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis
                        dataKey="day"
                        tick={{ fontSize: 11, fill: "#64748b" }}
                      />
                      <YAxis
                        domain={[-1, 1]}
                        tick={{ fontSize: 11, fill: "#64748b" }}
                      />
                      <Tooltip
                        contentStyle={{ fontSize: 12 }}
                        formatter={(value, name) =>
                          name === "avg"
                            ? [Number(value).toFixed(2), "Avg sentiment"]
                            : [value, name]
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
                  Not enough date-spread for a trend line (results span a single day).
                </p>
              )}
            </div>

            {/* Top phrases */}
            {(stats.topPositive.length > 0 || stats.topNegative.length > 0) && (
              <div className="grid md:grid-cols-2 gap-4 mb-6">
                <PhraseList
                  title="Top positive phrases"
                  items={stats.topPositive}
                  tint="emerald"
                />
                <PhraseList
                  title="Top negative phrases"
                  items={stats.topNegative}
                  tint="rose"
                />
              </div>
            )}

            {/* Post list */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-6 mb-6">
              <h2 className="text-sm font-semibold text-slate-700 mb-3">
                Posts ({posts.length})
              </h2>
              <div
                className="space-y-3 overflow-y-auto pr-1"
                style={{ maxHeight: "600px" }}
              >
                {posts.map((p) => (
                  <PostCard key={`${p.source}-${p.id}`} post={p} />
                ))}
              </div>
            </div>
          </>
        )}

        {/* Lexicon editor */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-6 mb-6">
          <button
            onClick={() => setShowLexiconEditor(!showLexiconEditor)}
            className="w-full flex items-center justify-between text-left"
          >
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-700">
                Lexicon editor ({Object.keys(lexicon).length} phrases)
              </h2>
            </div>
            {showLexiconEditor ? (
              <ChevronUp className="w-4 h-4 text-slate-500" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-500" />
            )}
          </button>

          {showLexiconEditor && (
            <div className="mt-4">
              <p className="text-xs text-slate-600 mb-3">
                Each phrase matches as a whole word (case-insensitive). Weights
                are clamped to [-1, +1]. Longer phrases take priority, so e.g.{" "}
                <code className="bg-slate-100 px-1 rounded">not bad</code>{" "}
                scores before <code className="bg-slate-100 px-1 rounded">bad</code>.
              </p>

              {/* Add new phrase */}
              <div className="flex flex-col md:flex-row gap-2 mb-4">
                <input
                  type="text"
                  value={newPhrase}
                  onChange={(e) => setNewPhrase(e.target.value)}
                  placeholder="phrase (e.g., rock solid)"
                  className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <input
                  type="number"
                  step="0.05"
                  min="-1"
                  max="1"
                  value={newWeight}
                  onChange={(e) => setNewWeight(e.target.value)}
                  placeholder="weight -1..1"
                  className="w-32 px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <button
                  onClick={addPhrase}
                  className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" /> Add
                </button>
                <button
                  onClick={resetLexicon}
                  className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200"
                >
                  Reset defaults
                </button>
              </div>

              <div
                className="overflow-y-auto border border-slate-200 rounded-lg"
                style={{ maxHeight: "360px" }}
              >
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 sticky top-0 z-10">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-slate-600">
                        Phrase
                      </th>
                      <th className="text-left px-3 py-2 font-medium text-slate-600 w-32">
                        Weight
                      </th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedLexiconEntries.map(([phrase, weight]) => (
                      <tr
                        key={phrase}
                        className="border-t border-slate-100 hover:bg-slate-50"
                      >
                        <td className="px-3 py-1.5 font-mono text-xs text-slate-800">
                          {phrase}
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="number"
                            step="0.05"
                            min="-1"
                            max="1"
                            value={weight}
                            onChange={(e) =>
                              updateWeight(phrase, e.target.value)
                            }
                            className={`w-24 px-2 py-0.5 text-xs border rounded ${
                              weight > 0
                                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                : weight < 0
                                ? "border-rose-200 bg-rose-50 text-rose-800"
                                : "border-slate-200"
                            }`}
                          />
                        </td>
                        <td className="px-2">
                          <button
                            onClick={() => removePhrase(phrase)}
                            className="text-slate-400 hover:text-rose-600"
                            title="Remove"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <footer className="text-xs text-slate-500 text-center py-4">
          Prototype · Data pulled live from Reddit &amp; Hacker News public APIs
          · Lexicon editable above · Hybrid scoring uses Claude when available
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------
function SourceToggle({ label, checked, onChange }) {
  return (
    <button
      type="button"
      onClick={onChange}
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

function StatCard({ label, value, sub, icon, tint = "slate" }) {
  const tints = {
    slate: "bg-white border-slate-200",
    emerald: "bg-emerald-50/50 border-emerald-200",
    rose: "bg-rose-50/50 border-rose-200",
  };
  return (
    <div
      className={`rounded-xl border p-3 md:p-4 ${tints[tint] || tints.slate}`}
    >
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
                  className={`h-full ${
                    tint === "emerald" ? "bg-emerald-400" : "bg-rose-400"
                  }`}
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
  const color = scoreColor(post.score);
  const displayText = post.body
    ? post.body.slice(0, 280)
    : post.title.slice(0, 280);
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
            <span>· {formatDate(post.created)}</span>
            {typeof post.score_votes === "number" && (
              <span>· {post.score_votes} votes</span>
            )}
          </div>
          {displayText && (
            <p className="text-sm text-slate-700 mt-2 line-clamp-3">
              {displayText}
              {post.body && post.body.length > 280 ? "…" : ""}
            </p>
          )}
          {post.matches.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {post.matches.slice(0, 6).map((m) => (
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
          {post.method === "llm" && post.llmReason && (
            <div className="mt-2 text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-2 py-1 flex items-start gap-1">
              <Sparkles className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>
                <strong>Claude:</strong> {post.llmReason}
              </span>
            </div>
          )}
        </div>
        <div
          className={`text-sm font-semibold px-2 py-1 rounded border ${color} whitespace-nowrap`}
        >
          {post.score > 0 ? "+" : ""}
          {post.score.toFixed(2)}
          <div
            className="font-normal opacity-70"
            style={{ fontSize: "10px" }}
          >
            {post.method}
          </div>
        </div>
      </div>
    </div>
  );
}
