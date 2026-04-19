"""
Seed data — populates the lexicon table with default entries on first startup.

Idempotent: only seeds if the table is empty.
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from app.models import LexiconEntry

logger = logging.getLogger(__name__)


# Same lexicon as the original prototype. Multi-word phrases first so the
# scorer prefers them over their component single words.
DEFAULT_LEXICON: dict[str, float] = {
    # ---- Strong positive multi-word ----
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
    # ---- Positive single words ----
    "amazing": 0.7,
    "fantastic": 0.75,
    "excellent": 0.7,
    "awesome": 0.6,
    "great": 0.5,
    "good": 0.35,
    "love": 0.6,
    "loved": 0.6,
    "like": 0.25,
    "liked": 0.25,
    "nice": 0.3,
    "solid": 0.4,
    "impressed": 0.55,
    "impressive": 0.55,
    "reliable": 0.45,
    "smooth": 0.4,
    "fast": 0.3,
    "easy": 0.3,
    "intuitive": 0.45,
    "beautiful": 0.55,
    "perfect": 0.75,
    "recommend": 0.55,
    "worth": 0.35,
    "upgrade": 0.25,
    # ---- Strong negative multi-word ----
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
    # ---- Negative single words ----
    "terrible": -0.75,
    "awful": -0.7,
    "worst": -0.75,
    "hate": -0.7,
    "hated": -0.65,
    "bad": -0.4,
    "sucks": -0.6,
    "disappointing": -0.55,
    "disappointed": -0.55,
    "broken": -0.5,
    "buggy": -0.5,
    "useless": -0.65,
    "overpriced": -0.5,
    "scam": -0.85,
    "garbage": -0.7,
    "trash": -0.65,
    "junk": -0.6,
    "horrible": -0.75,
    "frustrating": -0.55,
    "frustrated": -0.5,
    "annoying": -0.45,
    "slow": -0.3,
    "clunky": -0.45,
    "crash": -0.5,
    "crashes": -0.5,
    "glitchy": -0.5,
    "regret": -0.6,
    "refund": -0.45,
}


def seed_lexicon(db: Session) -> int:
    """
    Populate the lexicon table with defaults if it's empty.

    Returns the number of rows inserted (0 if already seeded).
    """
    count = db.query(LexiconEntry).count()
    if count > 0:
        logger.info("Lexicon already has %d entries; skipping seed.", count)
        return 0

    rows = [LexiconEntry(phrase=p, weight=w) for p, w in DEFAULT_LEXICON.items()]
    db.add_all(rows)
    db.commit()
    logger.info("Seeded lexicon with %d default entries.", len(rows))
    return len(rows)


def reset_lexicon(db: Session) -> int:
    """Wipe and re-seed. Used by the POST /api/lexicon/reset endpoint."""
    db.query(LexiconEntry).delete()
    db.commit()
    return seed_lexicon(db)
