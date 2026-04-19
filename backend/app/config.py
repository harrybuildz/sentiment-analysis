"""
Configuration loader.

Uses pydantic-settings to load values from environment variables (and from a
`.env` file if present). All values are validated at startup — the server
won't start if e.g. `DATABASE_URL` is malformed.

Import pattern:

    from app.config import settings
    print(settings.database_url)

The `settings` singleton is instantiated once at import time and reused
throughout the app.
"""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings sourced from environment variables / .env."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",  # silently ignore unknown env vars
    )

    # --- Anthropic / Claude ----------------------------------------------
    anthropic_api_key: str | None = Field(
        default=None, description="Anthropic API key; if None, LLM scoring is disabled."
    )
    anthropic_model: str = Field(default="claude-haiku-4-5-20251001")

    # --- Reddit ----------------------------------------------------------
    reddit_client_id: str | None = None
    reddit_client_secret: str | None = None
    reddit_user_agent: str = "sentiment-analysis/0.1 (by /u/anonymous)"

    # --- Database --------------------------------------------------------
    database_url: str = Field(default="sqlite:///./sentiment.db")

    # --- Server ----------------------------------------------------------
    cors_origins: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173",
        description="Comma-separated list of allowed origins for CORS.",
    )

    # --- Feature flags ---------------------------------------------------
    enable_transformer: bool = False
    max_llm_calls_per_analysis: int = 20
    ambiguity_threshold: float = 0.15

    # ---------------------------------------------------------------------
    # Computed helpers
    # ---------------------------------------------------------------------
    @property
    def cors_origin_list(self) -> list[str]:
        """Parse the comma-separated CORS_ORIGINS string into a list."""
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def has_reddit_credentials(self) -> bool:
        """True iff both praw credentials are set and look plausible."""
        return bool(self.reddit_client_id and self.reddit_client_secret)

    @property
    def has_anthropic_credentials(self) -> bool:
        """True iff an Anthropic API key is present."""
        return bool(self.anthropic_api_key)


# Singleton — import this anywhere.
settings = Settings()
