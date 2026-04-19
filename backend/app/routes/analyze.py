"""
POST /api/analyze — the core endpoint.

Workflow:
1. Validate request via AnalyzeRequest pydantic schema.
2. Fetch posts concurrently from each enabled source.
3. Dedupe by (source, source_id).
4. Load the current lexicon from the DB.
5. Score each post with the chosen primary method, optionally falling back
   to the LLM for ambiguous posts when scoring_method == "lexicon" and
   use_llm_fallback is true.
6. Persist Analysis + Posts in one transaction.
7. Return the full AnalysisDetailOut.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import Analysis, LexiconEntry, Post
from app.schemas import AnalysisDetailOut, AnalyzeRequest
from app.scoring import lexicon as lex_mod
from app.scoring import llm as llm_mod
from app.scoring import transformer as tx_mod
from app.sources import hackernews, reddit

router = APIRouter(prefix="/api", tags=["analyze"])
logger = logging.getLogger(__name__)


def _classify(score: float) -> str:
    if score > 0.1:
        return "positive"
    if score < -0.1:
        return "negative"
    return "neutral"


@router.post("/analyze", response_model=AnalysisDetailOut)
async def analyze(req: AnalyzeRequest, db: Session = Depends(get_db)) -> AnalysisDetailOut:
    """Run an analysis and persist its results."""
    # ---- Validate scoring availability ---------------------------------
    if req.scoring_method == "transformer" and not tx_mod.is_available():
        raise HTTPException(
            status_code=400,
            detail=(
                "Transformer scoring not available: set ENABLE_TRANSFORMER=true "
                'and install the optional dependency: pip install -e ".[transformer]"'
            ),
        )
    if req.scoring_method == "llm" and not settings.has_anthropic_credentials:
        raise HTTPException(
            status_code=400,
            detail="LLM scoring requires ANTHROPIC_API_KEY in .env",
        )

    # ---- Fetch from all enabled sources --------------------------------
    fetch_tasks: list = []
    notes: list[str] = []

    use_reddit_sw = "reddit_sitewide" in req.sources
    use_reddit_subs = "reddit_subs" in req.sources and bool(req.subreddits)
    use_hn = "hackernews" in req.sources

    if use_reddit_sw or use_reddit_subs:
        fetch_tasks.append(
            reddit.fetch_posts(
                req.keyword,
                subreddits=req.subreddits if use_reddit_subs else [],
                site_wide=use_reddit_sw,
                limit=req.max_posts_per_source,
            )
        )
    if use_hn:
        fetch_tasks.append(hackernews.fetch_posts(req.keyword, limit=req.max_posts_per_source))

    raw_results = await asyncio.gather(*fetch_tasks, return_exceptions=True)

    all_posts: list[dict] = []
    for r in raw_results:
        if isinstance(r, Exception):
            notes.append(f"fetch error: {r}")
            continue
        # Reddit returns (posts, method); HN returns plain list.
        if isinstance(r, tuple):
            posts, method = r
            notes.append(f"reddit via {method}")
            all_posts.extend(posts)
        else:
            all_posts.extend(r)

    # ---- Dedupe by (source, source_id) ---------------------------------
    seen: set[tuple[str, str]] = set()
    deduped: list[dict] = []
    for p in all_posts:
        key = (p.get("source", ""), p.get("source_id", ""))
        if key in seen or not key[1]:
            continue
        seen.add(key)
        deduped.append(p)

    # ---- Load lexicon --------------------------------------------------
    lex_dict = lex_mod.lexicon_dict_from_entries(db.query(LexiconEntry).all())

    # ---- Score each post ----------------------------------------------
    scored: list[dict] = []
    llm_calls = 0
    primary = req.scoring_method

    for raw_post in deduped:
        combined = f"{raw_post.get('title', '')}\n{raw_post.get('body', '')}".strip()[:4000]

        score: float
        method: str
        confidence: float
        matches: list[dict] = []
        llm_reason: str | None = None

        if primary == "lexicon":
            lex = lex_mod.score_text(combined, lex_dict)
            score, method, confidence, matches = (
                lex.score,
                "lexicon",
                lex.confidence,
                lex.matches,
            )

            # Optional hybrid fallback: ambiguous post + LLM available
            if (
                req.use_llm_fallback
                and settings.has_anthropic_credentials
                and llm_calls < settings.max_llm_calls_per_analysis
                and (lex.total_hits == 0 or abs(lex.score) < settings.ambiguity_threshold)
            ):
                llm_result = await asyncio.to_thread(llm_mod.score_text, combined)
                if llm_result is not None:
                    score = llm_result.score
                    method = "llm"
                    llm_reason = llm_result.reason
                    confidence = 1.0  # we trust the LLM more than ambiguous lexicon
                    llm_calls += 1

        elif primary == "llm":
            llm_result = await asyncio.to_thread(llm_mod.score_text, combined)
            if llm_result is None:
                # If LLM call fails on a single post, fall back to lexicon for THAT post.
                lex = lex_mod.score_text(combined, lex_dict)
                score, method, confidence, matches = (
                    lex.score,
                    "lexicon",
                    lex.confidence,
                    lex.matches,
                )
            else:
                score = llm_result.score
                method = "llm"
                confidence = 1.0
                llm_reason = llm_result.reason
                llm_calls += 1

        else:  # transformer
            tx_result = await asyncio.to_thread(tx_mod.score_text, combined)
            if tx_result is None:
                lex = lex_mod.score_text(combined, lex_dict)
                score, method, confidence, matches = (
                    lex.score,
                    "lexicon",
                    lex.confidence,
                    lex.matches,
                )
            else:
                score = tx_result.score
                method = "transformer"
                confidence = max(
                    tx_result.positive_prob, tx_result.neutral_prob, tx_result.negative_prob
                )

        scored.append(
            {
                **raw_post,
                "score": score,
                "score_method": method,
                "confidence": confidence,
                "matched_phrases": matches,
                "llm_reason": llm_reason,
            }
        )

    # ---- Aggregate stats -----------------------------------------------
    total = len(scored)
    if total > 0:
        scores_only = [p["score"] for p in scored]
        mean_score = sum(scores_only) / total
        positive_count = sum(1 for s in scores_only if s > 0.1)
        negative_count = sum(1 for s in scores_only if s < -0.1)
        neutral_count = total - positive_count - negative_count
    else:
        mean_score = 0.0
        positive_count = negative_count = neutral_count = 0

    # ---- Persist ------------------------------------------------------
    analysis = Analysis(
        keyword=req.keyword,
        sources=list(req.sources),
        subreddits=list(req.subreddits) if req.subreddits else None,
        scoring_method=req.scoring_method,
        use_llm_fallback=req.use_llm_fallback,
        total_posts=total,
        mean_score=mean_score,
        positive_count=positive_count,
        negative_count=negative_count,
        neutral_count=neutral_count,
        llm_calls_made=llm_calls,
        notes="; ".join(notes) if notes else None,
    )
    db.add(analysis)
    db.flush()  # populate analysis.id

    for p in scored:
        db.add(
            Post(
                analysis_id=analysis.id,
                source=p["source"],
                source_id=p["source_id"],
                url=p["url"],
                title=p["title"],
                body=p["body"],
                author=p.get("author"),
                subreddit=p.get("subreddit"),
                created_utc=p.get("created_utc"),
                votes=p.get("votes"),
                score=p["score"],
                score_method=p["score_method"],
                confidence=p["confidence"],
                matched_phrases=p["matched_phrases"],
                llm_reason=p["llm_reason"],
            )
        )

    db.commit()
    db.refresh(analysis)

    return AnalysisDetailOut.model_validate(analysis)
