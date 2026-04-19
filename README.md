# sentiment-analysis

A prototype sentiment tracker for public forums.

## What's in here

- **`SentimentTracker.jsx`** — single-file React artifact. Takes a keyword or
  product name, fetches recent posts from Reddit (site-wide and/or specific
  subreddits) and Hacker News (via Algolia), scores each post with a
  VADER-style lexicon of custom phrase weights, and optionally falls back to
  Claude for ambiguous or low-confidence posts (hybrid mode).

## Features

- Three sources: Reddit site-wide search, Reddit specific subreddits,
  Hacker News (via the Algolia HN search API)
- Lexicon-based scoring with ~70 preset phrases; editable in the UI
- Hybrid scoring: lexicon first; Claude fallback (via
  `window.claude.complete()`) for posts where lexicon confidence is low
- Summary cards, sentiment-over-time line chart, top positive/negative
  phrases, and a scrollable post list with per-post score and matched
  phrases highlighted
- Graceful degradation: if Claude API isn't available in the sandbox, it
  falls back to pure lexicon mode and shows a notice; if Reddit CORS-blocks,
  Hacker News still works

## Caveats to know

- **Reddit CORS**: `www.reddit.com/search.json` historically allows
  browser-side access but Reddit has been tightening its anti-scraping
  posture. If it blocks, you'd need a tiny backend proxy to forward
  requests. HN Algolia reliably CORS-allows browser access.
- **LLM cost**: hybrid mode caps at 20 Claude calls per analysis to bound
  cost. Adjust `MAX_LLM_CALLS` in the source if you want more.
- **Lexicon limits**: phrase-based scoring misses sarcasm and heavy slang.
  The LLM fallback helps, but for production-grade accuracy you'd want a
  fine-tuned transformer (e.g., `cardiffnlp/twitter-roberta-base-sentiment`)
  behind a backend.

## Other free forum APIs you could add

| Source | API | Notes |
|---|---|---|
| Lemmy | `/api/v3/search` per instance | Reddit-alternative, good CORS |
| Mastodon | `/api/v2/search` per instance | Fragmented by instance |
| Bluesky | `public.api.bsky.app/xrpc/app.bsky.feed.searchPosts` | Growing volume |
| Lobsters | `lobste.rs/search.json` | High-signal tech discussion |
| Stack Exchange | `api.stackexchange.com/2.3/search` | Free tier, tech Q&A |
| GitHub Issues | `api.github.com/search/issues` | Dev-product feedback |
