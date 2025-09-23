# Adaptive English Placement Agent

FastAPI backend with a minimal web UI for login and a Gemini-powered test call. Includes product spec endpoints and idle auto-shutdown.

## Prerequisites (WSL Ubuntu)
- Python 3.12
- `python3-venv` installed (Ubuntu: `sudo apt-get install -y python3-venv`)

## Setup
```bash
cd ~/MIT-MAS665-AssignmentsHW-2
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

## Configure environment (.env)
Create or edit `.env` in the project root:
```bash
# Required
GEMINI_API_KEY=YOUR_KEY
GEMINI_MODEL=gemini-2.5-flash

# Provider: choose ONE
GEMINI_PROVIDER=vertex            # Vertex AI Express (recommended for AQ.* keys)
# or
# GEMINI_PROVIDER=ai_studio       # Google AI Studio (often keys start with AIza)

# Vertex settings (only if using provider=vertex)
GEMINI_VERTEX_REGION=us-central1
GEMINI_VERTEX_PROJECT=YOUR_GCP_PROJECT_ID

# Auth (seed user and JWT)
SEED_USERNAME=rong_wu
SEED_PASSWORD=mit!23456
JWT_SECRET_KEY=change-this-in-prod

# Idle shutdown (seconds with no requests before exit)
IDLE_SHUTDOWN_SECONDS=1200
```

Notes:
- For Vertex Express, enable Vertex AI API in `YOUR_GCP_PROJECT_ID` and ensure the API key is allowed for Vertex.
- For AI Studio, set `GEMINI_PROVIDER=ai_studio` and use a Studio key.

## Run the server
```bash
./scripts/run.sh
# or run in background (what the setup used):
./scripts/run.sh >/tmp/placement_api.log 2>&1 & echo $! > /tmp/placement_api.pid
```

Visit:
- Frontend: `http://127.0.0.1:8000/app`
- Health: `http://127.0.0.1:8000/health`
- Root: `http://127.0.0.1:8000/`

### Module UIs
- Reading page: `http://127.0.0.1:8000/app/read/`
  - Model: Gemini 2.0 Flash-Lite (passage + question generation)
  - Flow: 3 passages × 5 questions (15 total), default start B1, adaptive A1–C2
- Listening page: `http://127.0.0.1:8000/app/listen/`
  - Model: Gemini 2.5 Flash-Lite (clip scripts + MCQs)
  - Flow: 10 items served in pairs; difficulty adjusts after each pair
- Writing page: `http://127.0.0.1:8000/app/write/`
  - Model: Gemini 2.5 Flash-Lite (prompt generation and scoring)
- Vocabulary page: `http://127.0.0.1:8000/app/vocabulary/`
  - Model: Gemini 2.0 Flash-Lite
  - Default start level: A2 (adaptive A1–C2)
- Speaking page: `http://127.0.0.1:8000/app/speaking/`
  - Model: Gemini 2.5 Flash-Lite
## How it works

- **Architecture**: FastAPI backend mounts a static frontend at `/app`. JWT auth protects module APIs. A lightweight `GeminiClient` calls Google Gemini via Vertex AI or AI Studio depending on env.
- **Auth**: OAuth2 password flow at `/auth/token`. A seed dev user comes from `.env` (`SEED_USERNAME`/`SEED_PASSWORD`). Use the token as `Authorization: Bearer <token>`.
- **Models & providers**:
  - **Default**: `GEMINI_MODEL` (default `gemini-2.5-flash`).
  - **Listening override**: `GEMINI_MODEL_LISTEN` (defaults to `gemini-2.5-flash-lite` if unset).
  - **Per-module**: Reading/Vocabulary use `gemini-2.0-flash-lite`; Writing/Speaking use `gemini-2.5-flash-lite`.

### Module logic (adaptive rules)

- **Reading (`/read`)**
  - Start: `POST /read/session/start` with optional `start_level` (default B1). Generates a CEFR-aligned passage, then the first MCQ.
  - Length: 3 passages × 5 questions = 15 items.
  - Within-passage adaptation: +1 CEFR after 2 consecutive correct; −1 after 2 consecutive incorrect.
  - End-of-passage adjustment (out of 5): 5→+2, 4→+1 (no change if at C1), 3→0, 2→−1, 0–1→−2. Moves to next passage at the adjusted level.
  - Final smoothing: after the 3rd passage, adjust ±1 based on the last five outcomes (≥4 correct → +1; ≤1 → −1).
  - State is cached in memory during the session and summarized to DB (`read_module`) with `start_cefr`/`end_cefr` and counts.

- **Listening (`/listen`)**
  - Start: `POST /listen/session/start` (default B1). Generates an initial batch of 2 short clip scripts with MCQs; total target = 10.
  - Adaptation per pair: both correct → +1 CEFR; both incorrect → −1 CEFR. Special C2 rule: any mistake in a pair at C2 decreases level.
  - The API never returns `correct_index` until the end; it returns public clip fields only.
  - Finish: returns final CEFR, KET/PET/FCE mapping, and aggregated target vocabulary/structures across all seen clips.

- **Speaking (`/speaking`)**
  - Start: `POST /speaking/start` with optional `start_level` (default A2). Returns one `SpeakingItem` (prompt + guidance + timings) out of 15.
  - Adaptation: +1 after 2 consecutive correct; −1 after 2 consecutive incorrect (bounded A1–C2). For MVP, correctness is self-reported via `was_correct`.
  - Answer: `POST /speaking/answer` advances the session; on completion the session is cleared.

- **Vocabulary (`/vocabulary`)**
  - Start: `POST /vocabulary/start` begins at A2 by default (override with `start_level` as one of A1–C2). Each item is a short passage with a 4-option vocabulary/grammar MCQ and a brief rationale.
  - Adaptation: +1 after 2 consecutive correct; −1 after 2 consecutive incorrect; total of 15 items. Rationale is returned with feedback.

- **Writing (`/write`)**
  - Prompt: `POST /write/prompt` generates one CEFR-aligned prompt mapped to KET/PET/FCE targets.
  - Scoring (text): `POST /write/score/text` returns CEFR band, KET/PET/FCE mapping, rubric sub-scores, overall, word count, and comments (inline + global). Long inputs are clamped to ~8k chars.
  - Scoring (image): `POST /write/score/image` runs OCR (requires `tesseract-ocr`, `pytesseract`, `Pillow`) then scores as text.
  - Default band helper: `GET /write/default_band` suggests a band based on `read_module.end_cefr` when available.

### Persistence & cleanup

- DB: SQLite by default at `sqlite:///./app.db` (override with `DATABASE_URL`). Tables are created on startup. Minor dev migrations run via `ensure_schema()`.
- Models: `auth_users`, `user_accounts`, and per-module tables (`read_module`, `write_module`, `listen_module`, `vocabulary_module`, `speaking_module`). Modules store last-session metadata/snapshots.
- Cleanup: a background task purges module rows older than 7 days and removes dormant users without recent module rows.


## Login and talk
Default seed user (from `.env`):
- username: `rong_wu`
- password: `mit!23456`

## Writing module

- Endpoints (JWT required):
  - `POST /write/prompt` → body `{ "band": "A2|B1|B2|C1", "topic?": string }` → returns `{ prompt, band, exam_task, targets }` where targets include `target_vocab` and `target_structures` aligned to KET/PET/FCE.
  - `POST /write/score/text` → body `{ "text": string, "band_hint?": "A2|B1|B2|C1" }` → returns JSON with `band`, `exam_mapping`, `scores` (content, organization, language_control, range), `overall`, `word_count`, `comments` (global + inline annotations).
  - `POST /write/score/image` → multipart form with `file` (image) and optional `band_hint` → runs OCR then scores as above.

- Frontend at `/app/write/` supports:
  - Login → Generate prompt aligned to band (auto-generated by Gemini)
  - Type text and score OR upload an image (OCR + score)
  - Displays band estimate, rubric sub-scores, and inline comments

### OCR setup

Install system dependency for OCR (WSL/Ubuntu):
```bash
sudo apt-get update && sudo apt-get install -y tesseract-ocr
```

Python deps are in `requirements.txt`: `pytesseract`, `Pillow`, `python-multipart`.

Via frontend:
- Open `http://127.0.0.1:8000/app`, log in, and press Generate.

Via API (curl):
```bash
# Get token
curl -s -X POST http://127.0.0.1:8000/auth/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'username=rong_wu&password=mit!23456'

# Use token to call Gemini
TOKEN=... # paste access_token from previous step
curl -s -X POST http://127.0.0.1:8000/gemini/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"prompt":"Hi there, I am here to talk."}'
```

## Product spec endpoints
- JSON: `GET /spec`
- Markdown: `GET /spec/markdown`

## Idle auto-shutdown
- The server exits if no requests are received for `IDLE_SHUTDOWN_SECONDS` (default 1200s).

## Troubleshooting
- `gemini_configured: false` on `/`: ensure `.env` is in project root and server started from the root (the provided `scripts/run.sh` already does this).
- 401 from Gemini:
  - AI Studio: verify `GEMINI_PROVIDER=ai_studio` and the key is a Studio key.
  - Vertex: set `GEMINI_PROVIDER=vertex`, set `GEMINI_VERTEX_PROJECT`, enable Vertex AI API, and ensure the key is permitted for Vertex Express.
- Login fails: confirm `SEED_USERNAME` / `SEED_PASSWORD` in `.env` and restart the server.

## Project layout
```
backend/
  app/
    routers/
      auth.py        # OAuth2 password flow, JWT
      gemini.py      # Protected /gemini/generate
      health.py      # /health
      spec.py        # /spec, /spec/markdown
    gemini_client.py # Vertex/AI Studio client wrapper
    main.py          # FastAPI app, static mount, idle shutdown
    settings.py      # Pydantic settings from .env
frontend/
  index.html         # Minimal UI (login + generate)
scripts/
  run.sh             # Launch Uvicorn with .venv
requirements.txt
.env                 # Your secrets (gitignored)
```

