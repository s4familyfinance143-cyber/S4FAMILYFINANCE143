from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings


def build_engine_kwargs() -> dict:
    kwargs = {
        "pool_pre_ping": True,
        "future": True,
        "echo": settings.DATABASE_ECHO,
    }

    if settings.IS_SQLITE:
        kwargs["connect_args"] = {"check_same_thread": False}
        return kwargs

    kwargs["pool_size"] = settings.DB_POOL_SIZE
    kwargs["max_overflow"] = settings.DB_MAX_OVERFLOW
    kwargs["pool_recycle"] = settings.DB_POOL_RECYCLE_SECONDS
    return kwargs


engine = create_engine(
    settings.DATABASE_URL,
    **build_engine_kwargs(),
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    future=True,
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
