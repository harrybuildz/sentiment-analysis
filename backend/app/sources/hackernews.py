"""
Hacker News fetcher — via the Algolia search API.

Free, CORS-friendly (we're server-side anyway), no auth. Returns both stories
and comments matching the keyword. Comments have no title, so we synthesize
one from the first ~60 characters.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://hn.algolia.com/api/v1/search"


async def fetch_posts(keyword: str, limit: int = 25) -> list[dict]:
    """
    Fetch HN stories + comments matching `keyword`.

    Returns a list of normalized post dicts matching the Reddit fetcher's
    shape, for uniformity in downstream scoring/DB code.
    """
    params = {
        "query": keyword,
        "tags": "(story,comment)",  # OR — include both
        "hitsPerPage": str(limit),
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            r = await client.get(BASE_URL, params=params)
        except httpx.HTTPError as e:
            logger.warning("HN HTTP error: %s", e)
            return []

    if r.status_code != 200:
        logger.warning("HN HTTP %s: %s", r.status_code, r.text[:200])
        return []

    try:
        data = r.json()
    except ValueError:
        logger.warning("HN JSON parse failed")
        return []

    out: list[dict] = []
    for h in data.get("hits", []):
        object_id = h.get("objectID", "")
        body = h.get("story_text") or h.get("comment_text") or ""
        title = h.get("title") or h.get("story_title") or ""
        if not title and body:
            # Comments don't have titles; use a short excerpt.
            excerpt = body.strip().split("\n", 1)[0][:80]
            title = f"(comment) {excerpt}" if excerpt else "(comment)"

        created_at_str = h.get("created_at")
        created = None
        if created_at_str:
            try:
                # Algolia returns ISO 8601 with Z.
                created = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
                if created.tzinfo is None:
                    created = created.replace(tzinfo=timezone.utc)
            except ValueError:
                created = None

        out.append(
            {
                "source": "hn",
                "source_id": object_id,
                "title": title,
                "body": body,
                "url": h.get("url") or f"https://news.ycombinator.com/item?id={object_id}",
                "subreddit": "Hacker News",
                "author": h.get("author"),
                "created_utc": created,
                "votes": h.get("points"),
            }
        )

    return out
