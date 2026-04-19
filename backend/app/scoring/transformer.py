"""
HuggingFace transformer-based sentiment scoring.

Uses `cardiffnlp/twitter-roberta-base-sentiment-latest`, a RoBERTa model
fine-tuned on ~58M tweets for 3-class sentiment (negative, neutral, positive).

Model is loaded lazily on first call to avoid a slow startup when the
transformer pipeline isn't used. The first call also downloads ~500MB of
weights into the HuggingFace cache (~/.cache/huggingface by default).

To enable: set ENABLE_TRANSFORMER=true in .env AND install optional deps:
    pip install -e ".[transformer]"
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from app.config import settings

logger = logging.getLogger(__name__)

_pipeline = None  # lazy-loaded

MODEL_ID = "cardiffnlp/twitter-roberta-base-sentiment-latest"


@dataclass
class TransformerScore:
    score: float  # in [-1, +1]
    positive_prob: float
    neutral_prob: float
    negative_prob: float


def _load_pipeline():
    """
    Lazy-import `transformers` and build a pipeline. Cached for future calls.

    Returns None if the library isn't installed (user hasn't run
    `pip install -e ".[transformer]"`).
    """
    global _pipeline
    if _pipeline is not None:
        return _pipeline
    try:
        from transformers import (  # local import; heavy
            AutoModelForSequenceClassification,
            AutoTokenizer,
            pipeline,
        )
    except ImportError:
        logger.warning(
            "`transformers` not installed. "
            "Install with `pip install -e \".[transformer]\"` to enable."
        )
        return None

    logger.info("Loading transformer model %s (first run downloads ~500MB)...", MODEL_ID)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_ID)
    _pipeline = pipeline(
        "sentiment-analysis",
        model=model,
        tokenizer=tokenizer,
        top_k=None,  # return all class probabilities
        truncation=True,
        max_length=512,
    )
    return _pipeline


def is_available() -> bool:
    """Cheap check: transformer feature-flagged on AND library importable."""
    if not settings.enable_transformer:
        return False
    try:
        import transformers  # noqa: F401
    except ImportError:
        return False
    return True


def score_text(text: str) -> TransformerScore | None:
    """
    Score `text` with the RoBERTa sentiment model.

    Returns None if the pipeline can't be loaded (feature flag off or
    library missing).
    """
    if not settings.enable_transformer:
        return None

    pipe = _load_pipeline()
    if pipe is None:
        return None

    snippet = (text or "").strip()
    if not snippet:
        return TransformerScore(score=0.0, positive_prob=0.0, neutral_prob=1.0, negative_prob=0.0)

    # The pipeline returns e.g.:
    #   [[{'label': 'positive', 'score': 0.87}, {'label': 'neutral', 'score': 0.10}, ...]]
    # Label names are 'positive', 'neutral', 'negative' (case varies by model
    # version — we normalize).
    try:
        results = pipe(snippet[:3000])  # safety cap before tokenization truncation
    except Exception as e:  # noqa: BLE001
        logger.warning("Transformer pipeline error: %s", e)
        return None

    if not results or not results[0]:
        return None
    probs = {r["label"].lower(): float(r["score"]) for r in results[0]}
    pos = probs.get("positive", 0.0)
    neu = probs.get("neutral", 0.0)
    neg = probs.get("negative", 0.0)

    # Convert 3-class probs to a single [-1, +1] score.
    # score = P(positive) - P(negative); neutral tugs toward 0 implicitly.
    score = max(-1.0, min(1.0, pos - neg))
    return TransformerScore(
        score=score, positive_prob=pos, neutral_prob=neu, negative_prob=neg
    )
