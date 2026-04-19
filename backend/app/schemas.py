"""
Pydantic schemas for API request/response validation.

Kept separate from ORM models so the wire format is decoupled from the
database schema (lets us change columns without breaking the API contract).
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# ---------------------------------------------------------------------------
# Analyze request
# ---------------------------------------------------------------------------
ScoringMethod = Literal["lexicon", "llm", "transformer"]
SourceName = Literal["reddit_sitewide", "reddit_subs", "hackernews"]


class AnalyzeRequest(BaseModel):
    keyword: str = Field(min_length=1, max_length=200)
    sources: list[SourceName] = Field(min_length=1)
    subreddits: list[str] = Field(default_factory=list)
    scoring_method: ScoringMethod = "lexicon"
    use_llm_fallback: bool = True
    max_posts_per_source: int = Field(default=25, ge=1, le=100)

    @field_validator("subreddits")
    @classmethod
    def _strip_subreddits(cls, v: list[str]) -> list[str]:
        # strip whitespace and leading "r/" so the user can paste either form
        out = []
        for s in v:
            s = (s or "").strip()
            if s.lower().startswith("r/"):
                s = s[2:]
            if s:
                out.append(s)
        return out


# ---------------------------------------------------------------------------
# Post + Analysis responses
# ---------------------------------------------------------------------------
class MatchedPhrase(BaseModel):
    phrase: str
    weight: float
    count: int


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source: str
    source_id: str
    url: str
    title: str
    body: str
    author: str | None
    subreddit: str | None
    created_utc: datetime | None
    votes: int | None
    score: float
    score_method: str
    confidence: float
    matched_phrases: list[MatchedPhrase]
    llm_reason: str | None


class AnalysisSummaryOut(BaseModel):
    """Light-weight version for list endpoints (no posts)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    keyword: str
    created_at: datetime
    sources: list[str]
    subreddits: list[str] | None
    scoring_method: str
    use_llm_fallback: bool
    total_posts: int
    mean_score: float
    positive_count: int
    negative_count: int
    neutral_count: int
    llm_calls_made: int
    notes: str | None


class AnalysisDetailOut(AnalysisSummaryOut):
    """Full version for the GET /analyses/{id} endpoint."""

    posts: list[PostOut]


# ---------------------------------------------------------------------------
# Lexicon
# ---------------------------------------------------------------------------
class LexiconEntryIn(BaseModel):
    phrase: str = Field(min_length=1, max_length=200)
    weight: float = Field(ge=-1.0, le=1.0)

    @field_validator("phrase")
    @classmethod
    def _normalize_phrase(cls, v: str) -> str:
        return v.strip().lower()


class LexiconEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    phrase: str
    weight: float
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Config (frontend feature-detect endpoint)
# ---------------------------------------------------------------------------
class ConfigOut(BaseModel):
    """What the frontend needs to know about the backend's capabilities."""

    has_anthropic: bool
    has_reddit_credentials: bool
    transformer_enabled: bool
    max_llm_calls_per_analysis: int
    ambiguity_threshold: float
    anthropic_model: str | None
