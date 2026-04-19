"""
Lexicon CRUD endpoints:
- GET    /api/lexicon              — list all phrases
- PUT    /api/lexicon              — upsert (add or update weight)
- DELETE /api/lexicon/{phrase}     — remove a phrase
- POST   /api/lexicon/reset        — wipe and re-seed from defaults
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import asc
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import LexiconEntry
from app.schemas import LexiconEntryIn, LexiconEntryOut
from app.seed import reset_lexicon

router = APIRouter(prefix="/api/lexicon", tags=["lexicon"])


@router.get("", response_model=list[LexiconEntryOut])
def list_entries(db: Session = Depends(get_db)) -> list[LexiconEntryOut]:
    rows = db.query(LexiconEntry).order_by(asc(LexiconEntry.phrase)).all()
    return [LexiconEntryOut.model_validate(r) for r in rows]


@router.put("", response_model=LexiconEntryOut)
def upsert_entry(payload: LexiconEntryIn, db: Session = Depends(get_db)) -> LexiconEntryOut:
    existing = db.query(LexiconEntry).filter(LexiconEntry.phrase == payload.phrase).one_or_none()
    if existing:
        existing.weight = payload.weight
        db.commit()
        db.refresh(existing)
        return LexiconEntryOut.model_validate(existing)
    entry = LexiconEntry(phrase=payload.phrase, weight=payload.weight)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return LexiconEntryOut.model_validate(entry)


@router.delete("/{phrase}", status_code=204)
def delete_entry(phrase: str, db: Session = Depends(get_db)) -> Response:
    row = db.query(LexiconEntry).filter(LexiconEntry.phrase == phrase.lower()).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Phrase not found")
    db.delete(row)
    db.commit()
    return Response(status_code=204)


@router.post("/reset", response_model=list[LexiconEntryOut])
def reset(db: Session = Depends(get_db)) -> list[LexiconEntryOut]:
    reset_lexicon(db)
    rows = db.query(LexiconEntry).order_by(asc(LexiconEntry.phrase)).all()
    return [LexiconEntryOut.model_validate(r) for r in rows]
