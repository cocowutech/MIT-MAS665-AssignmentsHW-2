from pathlib import Path

from fastapi import FastAPI, Request
from sqlalchemy.orm import Session

from .db import Base, engine, get_db, ensure_schema
from .cleanup import purge_older_than_one_week
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
from .settings import settings
from .routers import health, gemini
from .routers import auth
from .routers import speaking
from .routers import spec
from .routers import listen
from .routers import write
from .routers import read
from .routers import vocabulary
import asyncio
import os
import signal

BASE_DIR = Path(__file__).resolve().parents[2]
FRONTEND_DIR = BASE_DIR / "frontend"

app = FastAPI(title="Placement Agent API")
app.include_router(health.router)
app.include_router(gemini.router)
app.include_router(auth.router)
app.include_router(spec.router)
app.include_router(listen.router)
app.include_router(write.router)
app.include_router(read.router)
app.include_router(vocabulary.router)
app.include_router(speaking.router)

# Static frontend at /app (use absolute paths so cwd doesn't matter when launching)
app.mount("/app", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
app.mount("/register", StaticFiles(directory=FRONTEND_DIR / "register", html=True), name="register")

@app.get("/", include_in_schema=False)
async def redirect_root_to_app():
	return RedirectResponse(url="/app")

@app.get("/info")
def root():
	return {"status": "ok", "gemini_configured": bool(settings.gemini_api_key)}

# ---- Idle shutdown watchdog has been removed to keep the app always on ----

async def _cleanup_watcher():
	# Run once at startup, then daily
	try:
		db = next(get_db())
		purge_older_than_one_week(db)
	except Exception:
		pass
	while True:
		await asyncio.sleep(24 * 60 * 60)
		try:
			db = next(get_db())
			purge_older_than_one_week(db)
		except Exception:
			pass

@app.on_event("startup")
async def startup_event():
	# Initialize DB schema
	Base.metadata.create_all(bind=engine)
	# Apply lightweight dev migrations
	try:
		ensure_schema()
	except Exception:
		pass
	# Best-effort weekly cleanup at startup
	try:
		db = next(get_db())
		purge_older_than_one_week(db)
	except Exception:
		pass
	# Start periodic cleanup loop
	asyncio.create_task(_cleanup_watcher())
