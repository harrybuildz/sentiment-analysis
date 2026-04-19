"""
SQLAlchemy engine, session factory, and declarative Base.

Uses synchronous SQLAlchemy 2.0 style. FastAPI runs synchronous dependencies
in a thread pool automatically, so this works fine for the request volume of
a personal tool. Swap to async (`asyncio`/`aiosqlite`) later if needed.
"""

from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

# SQLite needs `check_same_thread=False` because FastAPI's threadpool may
# dispatch requests across threads.
connect_args: dict = (
    {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
)

engine = create_engine(
    settings.database_url,
    connect_args=connect_args,
    # Echo SQL to stdout while developing? Set to True for debugging.
    echo=False,
    # Connection pool settings — small, since SQLite is single-writer anyway.
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """Declarative base class for all ORM models."""

    pass


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency that yields a session and closes it after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create all tables if they don't exist. Idempotent."""
    # Import models so they register against Base.metadata before create_all.
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
