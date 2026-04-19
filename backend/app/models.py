"""
SQLAlchemy ORM models.

Three tables:
- analyses: one row per "Analyze" click — captures the request and aggregate stats
- posts: one row per fetched post, joined to its analysis
- lexicon_entries: editable phrase -> weight map
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _utcnow() -> datetime:
    """Helper for default timestamps. Always UTC-aware."""
    return datetime.now(timezone.utc)


class Analysis(Base):
    """A single 'Analyze' invocation — the user submitted a keyword and got results back."""

    __tablename__ = "analyses"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    keyword: Mapped[str] = mapped_column(String(200), index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False, index=True
    )

    # Request settings (kept for replay / display)
    sources: Mapped[list] = mapped_column(JSON, nullable=False)  # ["reddit_sitewide", ...]
    subreddits: Mapped[list | None] = mapped_column(JSON, nullable=True)
    scoring_method: Mapped[str] = mapped_column(String(20), nullable=False)  # lexicon|llm|transformer
    use_llm_fallback: Mapped[bool] = mapped_column(default=False, nullable=False)

    # Aggregate stats (denormalized so we don't recompute on list endpoints)
    total_posts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    mean_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    positive_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    negative_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    neutral_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    llm_calls_made: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Free-text notes / errors (e.g., "praw failed, fell back to JSON")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    posts: Mapped[list[Post]] = relationship(
        "Post",
        back_populates="analysis",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class Post(Base):
    """One fetched + scored post, joined to an Analysis."""

    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    analysis_id: Mapped[int] = mapped_column(
        ForeignKey("analyses.id", ondelete="CASCADE"), index=True, nullable=False
    )

    # Source attribution
    source: Mapped[str] = mapped_column(String(20), nullable=False)  # 'reddit'|'hn'
    source_id: Mapped[str] = mapped_column(String(100), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, default="", nullable=False)
    body: Mapped[str] = mapped_column(Text, default="", nullable=False)
    author: Mapped[str | None] = mapped_column(String(100), nullable=True)
    subreddit: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    votes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Scoring outputs
    score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    score_method: Mapped[str] = mapped_column(String(20), nullable=False)  # 'lexicon'|'llm'|'transformer'
    confidence: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    matched_phrases: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    llm_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    analysis: Mapped[Analysis] = relationship("Analysis", back_populates="posts")


class LexiconEntry(Base):
    """A phrase -> weight pair. Weights are clamped to [-1, 1] in the API layer."""

    __tablename__ = "lexicon_entries"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    phrase: Mapped[str] = mapped_column(String(200), unique=True, nullable=False, index=True)
    weight: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )
