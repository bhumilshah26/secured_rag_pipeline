"""SQLAlchemy engine, session factory, and Base."""
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker # declarative : base class for all ORM models (tables)

from app.config import settings


def _connect_args() -> dict:
    """connect_timeout keeps an unreachable host from hanging the process (a hung connect
    reads as 'container never became healthy'). sslmode is required by most hosted
    Postgres providers (Neon, Supabase, RDS)."""
    args: dict = {"connect_timeout": settings.postgres_connect_timeout}
    if settings.postgres_sslmode:
        args["sslmode"] = settings.postgres_sslmode
    return args


engine = create_engine(  # creates interface between sqlalchemy and postgres
    settings.database_url,
    pool_pre_ping=True,
    pool_recycle=300,  # hosted/pooled Postgres drops idle connections
    future=True,
    connect_args=_connect_args(),
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False) # creates a factory of sessions always bind to the above engine,
                                                                                  # autoflush = false: no auto updates by sqlalchemy, expire_on_commit = false: object remains usable wo another query


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal() # creates a session
    try:
        yield db # caller gets an open session; if `return db` used it runs the finally block and closes the session and returns from the function
    finally:
        db.close()


def init_db() -> None:
    """Create tables for the MVP. Replaced by Alembic migrations in production."""
    from app import models  # noqa: F401 (ignore unused imports)  (register models) (python needs to run the code to load all the models for Base)

    Base.metadata.create_all(bind=engine)
