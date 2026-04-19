"""
Analysis history endpoints:
- GET    /api/analyses         — list recent analyses (paginated)
- GET    /api/analyses/{id}    — full detail including posts
- DELETE /api/analyses/{id}    — remove an analysis + cascade its posts
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Analysis
from app.schemas import AnalysisDetailOut, AnalysisSummaryOut

router = APIRouter(prefix="/api/analyses", tags=["analyses"])


@router.get("", response_model=list[AnalysisSummaryOut])
def list_analyses(
    db: Session = Depends(get_db),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[AnalysisSummaryOut]:
    rows = (
        db.query(Analysis)
        .order_by(desc(Analysis.created_at))
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [AnalysisSummaryOut.model_validate(r) for r in rows]


@router.get("/{analysis_id}", response_model=AnalysisDetailOut)
def get_analysis(analysis_id: int, db: Session = Depends(get_db)) -> AnalysisDetailOut:
    row = db.get(Analysis, analysis_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return AnalysisDetailOut.model_validate(row)


@router.delete("/{analysis_id}", status_code=204)
def delete_analysis(analysis_id: int, db: Session = Depends(get_db)) -> Response:
    row = db.get(Analysis, analysis_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Analysis not found")
    db.delete(row)  # cascade='all, delete-orphan' removes posts too
    db.commit()
    return Response(status_code=204)
