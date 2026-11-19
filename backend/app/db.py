from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


_engine = None
_Session: sessionmaker | None = None


def engine():
    global _engine, _Session
    if _engine is None:
        _engine = create_engine(get_settings().database_url, pool_size=10, max_overflow=20, pool_pre_ping=True)
        _Session = sessionmaker(_engine, expire_on_commit=False)
    return _engine


def init_db() -> None:
    from . import models  # noqa: F401  (register tables)

    Base.metadata.create_all(engine())
    # lightweight additive migrations (no Alembic yet)
    from sqlalchemy import text

    with engine().begin() as conn:
        conn.execute(text("ALTER TABLE courses ADD COLUMN IF NOT EXISTS brain varchar(32) DEFAULT ''"))
        conn.execute(text("ALTER TABLE courses ADD COLUMN IF NOT EXISTS direction jsonb DEFAULT '{}'::jsonb"))
        conn.execute(text("ALTER TABLE scenes ADD COLUMN IF NOT EXISTS direction jsonb DEFAULT '{}'::jsonb"))
        # Courses used to store only the provider ("gemini"); store the model that wrote the plan, so follow-up scenes,
        # answers and the tutor keep using it whichever model is the default now.
        conn.execute(text(
            "UPDATE courses c SET brain = u.model FROM ("
            "  SELECT DISTINCT ON (course_id) course_id, model FROM usage_events"
            "  WHERE operation = 'plan' AND course_id IS NOT NULL ORDER BY course_id, created_at"
            ") u WHERE u.course_id = c.id AND c.brain IN ('gemini', 'anthropic') AND length(u.model) <= 32"
        ))


@contextmanager
def session() -> Iterator[Session]:
    engine()
    assert _Session is not None
    s = _Session()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def get_db() -> Iterator[Session]:
    """FastAPI dependency."""
    with session() as s:
        yield s
