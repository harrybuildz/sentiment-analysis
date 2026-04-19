"""
Reddit fetchers.

Two paths:
1. `fetch_via_praw` — uses the official Reddit API via `praw`. Preferred
   when client ID + secret are configured. Higher rate limits, more
   reliable, ToS-friendly.
2. `fetch_via_json` — uses the public `*.reddit.com/search.json` endpoint.
   No credentials, but flakier and more aggressively rate-limited.

`fetch_posts` orchestrates: try praw first if creds exist, fall back to JSON
on any exception. Both paths return a list of dicts with the same shape so
callers don't care which was used.

praw is synchronous, so we run it in a worker thread via `asyncio.to_thread`
to avoid blocking the event loop.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# Public endpoint always uses an explicit UA so Reddit is less aggressive.
_JSON_HEADERS = {"User-Agent": settings.reddit_user_agent or "sentiment-analysis/0.1"}


# ---------------------------------------------------------------------------
# Normalized output shape
# ---------------------------------------------------------------------------
def _normalize_json_child(child: dict) -> dict[str, Any]:
    """Map a /search.json child entry to our internal post dict."""
    d = child.get("data", {})
    ts = d.get("created_utc")
    created = datetime.fromtimestamp(ts, tz=timezone.utc) if ts else None
    return {
        "source": "reddit",
        "source_id": d.get("id", ""),
        "title": d.get("title") or "",
        "body": d.get("selftext") or "",
        "url": "https://reddit.com" + d.get("permalink", ""),
        "subreddit": d.get("subreddit_name_prefixed") or "",
        "author": d.get("author"),
        "created_utc": created,
        "votes": d.get("score"),
    }


def _normalize_praw_submission(s, fallback_sub: str | None = None) -> dict[str, Any]:
    """Map a praw Submission object to our internal post dict."""
    return {
        "source": "reddit",
        "source_id": getattr(s, "id", "") or "",
        "title": getattr(s, "title", "") or "",
        "body": getattr(s, "selftext", "") or "",
        "url": "https://reddit.com" + getattr(s, "permalink", ""),
        "subreddit": (
            f"r/{s.subreddit.display_name}"
            if getattr(s, "subreddit", None)
            else (fallback_sub or "")
        ),
        "author": str(s.author) if getattr(s, "author", None) else None,
        "created_utc": datetime.fromtimestamp(s.created_utc, tz=timezone.utc)
        if getattr(s, "created_utc", None)
        else None,
        "votes": getattr(s, "score", None),
    }


# ---------------------------------------------------------------------------
# praw (official API)
# ---------------------------------------------------------------------------
def _build_reddit_client():
    """Build a praw.Reddit read-only client. Returns None if no creds."""
    if not settings.has_reddit_credentials:
        return None
    try:
        import praw
    except ImportError:
        logger.warning("`praw` not installed; falling back to JSON.")
        return None

    return praw.Reddit(
        client_id=settings.reddit_client_id,
        client_secret=settings.reddit_client_secret,
        user_agent=settings.reddit_user_agent,
        check_for_async=False,  # we're running praw in a thread, not async
    )


def _fetch_via_praw_sync(
    keyword: str, subreddits: list[str] | None, site_wide: bool, limit: int
) -> list[dict]:
    """Blocking praw fetch. Call via asyncio.to_thread."""
    reddit = _build_reddit_client()
    if reddit is None:
        raise RuntimeError("no praw client")

    posts: list[dict] = []

    if site_wide:
        for sub in reddit.subreddit("all").search(keyword, sort="new", limit=limit):
            posts.append(_normalize_praw_submission(sub))

    for sub_name in subreddits or []:
        try:
            for sub in reddit.subreddit(sub_name).search(
                keyword, sort="new", limit=limit, syntax="lucene"
            ):
                posts.append(_normalize_praw_submission(sub, fallback_sub=f"r/{sub_name}"))
        except Exception as e:  # noqa: BLE001
            # Don't let one bad subreddit kill the whole request.
            logger.warning("praw r/%s search failed: %s", sub_name, e)

    return posts


# ---------------------------------------------------------------------------
# Public JSON fallback
# ---------------------------------------------------------------------------
async def _fetch_via_json(
    keyword: str, subreddits: list[str] | None, site_wide: bool, limit: int
) -> list[dict]:
    """Use www.reddit.com/search.json. No auth required."""
    posts: list[dict] = []
    async with httpx.AsyncClient(
        headers=_JSON_HEADERS, timeout=20.0, follow_redirects=True
    ) as client:
        tasks = []

        if site_wide:
            url = "https://www.reddit.com/search.json"
            params = {
                "q": keyword,
                "limit": str(limit),
                "sort": "new",
                "restrict_sr": "false",
            }
            tasks.append(client.get(url, params=params))

        for sub_name in subreddits or []:
            url = f"https://www.reddit.com/r/{sub_name}/search.json"
            params = {
                "q": keyword,
                "limit": str(limit),
                "sort": "new",
                "restrict_sr": "true",
            }
            tasks.append(client.get(url, params=params))

        responses = await asyncio.gather(*tasks, return_exceptions=True)
        for r in responses:
            if isinstance(r, Exception):
                logger.warning("Reddit JSON error: %s", r)
                continue
            if r.status_code != 200:
                logger.warning("Reddit JSON HTTP %s: %s", r.status_code, r.text[:200])
                continue
            try:
                data = r.json()
            except ValueError:
                logger.warning("Reddit JSON parse failed")
                continue
            children = data.get("data", {}).get("children", [])
            for c in children:
                posts.append(_normalize_json_child(c))

    return posts


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------
async def fetch_posts(
    keyword: str,
    *,
    subreddits: list[str] | None = None,
    site_wide: bool = True,
    limit: int = 25,
) -> tuple[list[dict], str]:
    """
    Fetch posts from Reddit, trying praw first and falling back to JSON.

    Returns `(posts, method_used)` where `method_used` is "praw" or "json"
    or "none" if both failed. Caller can log the method on the Analysis row.
    """
    if settings.has_reddit_credentials:
        try:
            posts = await asyncio.to_thread(
                _fetch_via_praw_sync, keyword, subreddits, site_wide, limit
            )
            return posts, "praw"
        except Exception as e:  # noqa: BLE001
            logger.warning("praw fetch failed, falling back to JSON: %s", e)

    try:
        posts = await _fetch_via_json(keyword, subreddits, site_wide, limit)
        return posts, "json"
    except Exception as e:  # noqa: BLE001
        logger.warning("Reddit JSON fetch failed: %s", e)
        return [], "none"
