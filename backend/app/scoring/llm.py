"""
Claude-based sentiment scoring.

Calls the Anthropic API with a tight prompt and parses a single-line JSON
response. Safe to call with no credentials (returns None).
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass

from app.config import settings

logger = logging.getLogger(__name__)

# The Anthropic client is imported lazily so `pip install` failures on
# `anthropic` don't prevent the rest of the app from running.
_client = None


def _get_client():
    """Return a cached Anthropic client, or None if the SDK/key is missing."""
    global _client
    if not settings.has_anthropic_credentials:
        return None
    if _client is not None:
        return _client
    try:
        from anthropic import Anthropic  # local import to avoid hard dependency
    except ImportError:
        logger.warning("`anthropic` package not installed; LLM scoring disabled.")
        return None
    _client = Anthropic(api_key=settings.anthropic_api_key)
    return _client


@dataclass
class LLMScore:
    score: float  # in [-1, +1]
    reason: str


_PROMPT_TEMPLATE = """You are a sentiment analyst. Read the text below (from a public forum) and output a single JSON object on ONE line, no markdown, no code fences:

{{"score": <number between -1 and 1>, "reason": "<1 short sentence>"}}

Score guidelines:
- +1.0 very enthusiastic/positive
-  0.0 neutral, informational, or mixed
- -1.0 very negative, hostile, disappointed
Account for sarcasm and negation.

Text:
\"\"\"
{snippet}
\"\"\""""


def score_text(text: str) -> LLMScore | None:
    """
    Score `text` with Claude.

    Returns None if:
    - No Anthropic key configured
    - Anthropic SDK not installed
    - Response couldn't be parsed
    - API call failed

    Caller should treat None as "LLM unavailable for this post".
    """
    client = _get_client()
    if client is None:
        return None

    snippet = (text or "").strip()[:1200]
    if not snippet:
        return LLMScore(score=0.0, reason="empty text")

    prompt = _PROMPT_TEMPLATE.format(snippet=snippet)

    try:
        msg = client.messages.create(
            model=settings.anthropic_model,
            max_tokens=150,
            messages=[{"role": "user", "content": prompt}],
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("Anthropic API error: %s", e)
        return None

    # Extract plain text from response.
    raw_parts = []
    for block in msg.content:
        text_part = getattr(block, "text", None)
        if text_part:
            raw_parts.append(text_part)
    raw = "".join(raw_parts).strip()

    # Find the first {...} JSON object.
    match = re.search(r"\{[\s\S]*?\}", raw)
    if not match:
        logger.warning("Could not locate JSON object in Claude response: %r", raw[:200])
        return None

    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError as e:
        logger.warning("JSON parse failed: %s; raw=%r", e, match.group(0)[:200])
        return None

    try:
        score = float(parsed.get("score", 0.0))
    except (TypeError, ValueError):
        return None

    score = max(-1.0, min(1.0, score))
    reason = str(parsed.get("reason", "")).strip()[:300]

    return LLMScore(score=score, reason=reason)
