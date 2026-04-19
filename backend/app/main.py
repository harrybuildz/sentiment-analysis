"""
FastAPI entrypoint.

Run locally with:
    cd backend
    uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.config import settings
from app.database import SessionLocal, init_db
from app.routes import analyses, analyze, lexicon
from app.schemas import ConfigOut
from app.scoring import transformer as tx_mod
from app.seed import seed_lexicon

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
)
logger = logging.getLogger("app.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create tables and seed the lexicon on startup."""
    logger.info("Starting sentiment-analysis backend v%s", __version__)
    logger.info("Reddit creds: %s", "yes" if settings.has_reddit_credentials else "no (JSON fallback)")
    logger.info("Anthropic creds: %s", "yes" if settings.has_anthropic_credentials else "no")
    logger.info("Transformer enabled: %s", settings.enable_transformer)

    init_db()
    with SessionLocal() as db:
        inserted = seed_lexicon(db)
        if inserted:
            logger.info("Seeded %d default lexicon entries.", inserted)
    yield
    logger.info("Shutting down.")


app = FastAPI(
    title="Sentiment Analysis",
    description="Multi-source forum sentiment analysis with lexicon, LLM, and transformer scoring.",
    version=__version__,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount resource routers
app.include_router(analyze.router)
app.include_router(analyses.router)
app.include_router(lexicon.router)


@app.get("/api/health", tags=["meta"])
def health() -> dict:
    return {"status": "ok", "version": __version__}


@app.get("/api/config", response_model=ConfigOut, tags=["meta"])
def get_config() -> ConfigOut:
    """
    Tell the frontend which capabilities are available.
    The frontend uses this to enable/disable UI options (e.g., the LLM
    toggle is disabled if no ANTHROPIC_API_KEY is configured).
    """
    return ConfigOut(
        has_anthropic=settings.has_anthropic_credentials,
        has_reddit_credentials=settings.has_reddit_credentials,
        transformer_enabled=tx_mod.is_available(),
        max_llm_calls_per_analysis=settings.max_llm_calls_per_analysis,
        ambiguity_threshold=settings.ambiguity_threshold,
        anthropic_model=settings.anthropic_model if settings.has_anthropic_credentials else None,
    )
