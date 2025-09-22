from __future__ import annotations
from sqlalchemy import create_engine, inspect
from sqlalchemy.sql import text
from sqlalchemy.orm import sessionmaker, declarative_base
from .settings import settings


DATABASE_URL = settings.database_url or "sqlite:///./app.db"

_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=_connect_args, future=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)
Base = declarative_base()


def get_db():
	db = SessionLocal()
	try:
		yield db
	finally:
		db.close()


# Best-effort lightweight migrations for development (SQLite-friendly)
def ensure_schema() -> None:
	try:
		inspector = inspect(engine)
		tables = set(inspector.get_table_names())
	except Exception:
		return
	if "auth_users" in tables:
		cols = {c["name"] for c in inspector.get_columns("auth_users")}
		with engine.begin() as conn:
			if "email" not in cols:
				conn.exec_driver_sql("ALTER TABLE auth_users ADD COLUMN email VARCHAR(256)")
			if "phone" not in cols:
				conn.exec_driver_sql("ALTER TABLE auth_users ADD COLUMN phone VARCHAR(32)")
			if "requests_used" not in cols:
				conn.exec_driver_sql("ALTER TABLE auth_users ADD COLUMN requests_used INTEGER DEFAULT 0 NOT NULL")
			if "requests_limit" not in cols:
				conn.exec_driver_sql("ALTER TABLE auth_users ADD COLUMN requests_limit INTEGER DEFAULT 1000 NOT NULL")

