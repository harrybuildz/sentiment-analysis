"""
Lexicon-based sentiment scoring.

Same algorithm as the original prototype:
- Match phrases as whole words (case-insensitive).
- Longer phrases match first; matched spans are masked so shorter overlapping
  phrases don't double-count (e.g., "not bad" prevents a "bad" hit).
- Total weighted score is normalized by sqrt(hits) so a post repeating one
  word ten times doesn't dominate, but a varied post with many signals does.
- Final score is clamped to [-1, +1].
- Confidence is hits / 3, capped at 1.0 — used to decide whether to fall
  back to LLM scoring.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable


@dataclass
class LexiconScore:
    """Result of scoring one text block against a lexicon."""

    score: float  # in [-1, +1]
    matches: list[dict]  # [{phrase, weight, count}, ...]
    total_hits: int
    confidence: float  # in [0, 1]


def _escape(s: str) -> str:
    """Escape regex metacharacters so user phrases don't blow up the matcher."""
    return re.escape(s)


def score_text(text: str, lexicon: dict[str, float]) -> LexiconScore:
    """
    Score a single text block against `lexicon`.

    Args:
        text: arbitrary string (post title + body, typically).
        lexicon: phrase (lowercased) -> weight in [-1, +1].

    Returns:
        A LexiconScore. Empty text or empty lexicon returns score=0, confidence=0.
    """
    if not text or not lexicon:
        return LexiconScore(score=0.0, matches=[], total_hits=0, confidence=0.0)

    normalized = text.lower()
    # Mask spans already matched by a longer phrase. We work on a list of
    # characters so we can replace matched spans with whitespace cheaply.
    masked = list(normalized)

    # Longest-first: ensures multi-word phrases beat their components.
    phrases = sorted(lexicon.keys(), key=len, reverse=True)

    matches: list[dict] = []
    total_weighted = 0.0
    total_hits = 0

    for phrase in phrases:
        weight = lexicon[phrase]
        pattern = re.compile(rf"\b{_escape(phrase)}\b", re.IGNORECASE)
        haystack = "".join(masked)
        count = 0
        for m in pattern.finditer(haystack):
            count += 1
            for i in range(m.start(), m.end()):
                masked[i] = " "
        if count > 0:
            matches.append({"phrase": phrase, "weight": weight, "count": count})
            total_weighted += weight * count
            total_hits += count

    if total_hits == 0:
        return LexiconScore(score=0.0, matches=[], total_hits=0, confidence=0.0)

    raw = total_weighted / max(1.0, total_hits**0.5)
    score = max(-1.0, min(1.0, raw))
    confidence = min(1.0, total_hits / 3.0)

    return LexiconScore(score=score, matches=matches, total_hits=total_hits, confidence=confidence)


def lexicon_dict_from_entries(entries: Iterable) -> dict[str, float]:
    """Convenience: convert ORM LexiconEntry rows into the dict our scorer wants."""
    return {e.phrase: e.weight for e in entries}
