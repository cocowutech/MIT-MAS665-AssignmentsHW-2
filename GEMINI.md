# Project Overview: Adaptive English Placement Agent

This project is an "Adaptive English Placement Agent," a web application designed to provide Gemini-powered language learning assessments. It features a FastAPI backend and a minimal web UI for user login and various adaptive language modules (Reading, Listening, Writing, Vocabulary, Speaking). The system includes product specification endpoints and an idle auto-shutdown mechanism.

## Main Technologies

*   **Backend:** Python 3.12, FastAPI, Uvicorn, Pydantic for settings.
*   **AI Integration:** Google Gemini API (configurable via Vertex AI or Google AI Studio).
*   **Database:** SQLite (default, configurable via `DATABASE_URL`).
*   **Frontend:** HTML, JavaScript (minimal web UI).
*   **Authentication:** JWT-based OAuth2 password flow.
*   **OCR:** Tesseract-OCR (for the Writing module's image scoring).

## Building and Running

### Prerequisites

*   Python 3.12
*   `python3-venv` (install via `sudo apt-get install -y python3-venv` on Ubuntu/WSL)
*   `tesseract-ocr` (for Writing module image scoring, install via `sudo apt-get update && sudo apt-get install -y tesseract-ocr` on Ubuntu/WSL)

### Setup

1.  Navigate to the project root directory:
    ```bash
    cd ~/MIT-MAS665-AssignmentsHW-2
    ```
2.  Create and activate a Python virtual environment:
    ```bash
    python3 -m venv .venv
    . .venv/bin/activate
    ```
3.  Install Python dependencies:
    ```bash
    pip install -r requirements.txt
    ```

### Configuration (`.env` file)

Create or edit a `.env` file in the project root with the following environment variables:

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

### Running the Server

To start the server:

```bash
./scripts/run.sh
```

To run in the background:

```bash
./scripts/run.sh >/tmp/placement_api.log 2>&1 & echo $! > /tmp/placement_api.pid
```

### Accessing the Application

*   **Frontend:** `http://127.0.0.1:8000/app`
*   **Health Check:** `http://127.0.0.1:8000/health`
*   **Root:** `http://127.0.0.1:8000/`

**Module UIs:**

*   **Reading:** `http://127.0.0.1:8000/app/read/`
*   **Listening:** `http://127.0.0.1:8000/app/listen/`
*   **Writing:** `http://127.0.0.1:8000/app/write/`
*   **Vocabulary:** `http://127.0.0.1:8000/app/vocabulary/`
*   **Speaking:** `http://127.0.0.1:8000/app/speaking/`

## Development Conventions

*   **Backend Structure:** FastAPI application with routers for different functionalities (auth, Gemini interaction, health, spec, and individual language modules).
*   **API Interaction:** A `GeminiClient` wrapper handles communication with Google Gemini.
*   **Authentication:** OAuth2 password flow for user login, issuing JWT tokens for API access. A seed user (`rong_wu`/`mit!23456`) is provided for development.
*   **Data Persistence:** Uses SQLite by default, with tables created on startup and minor migrations handled by `ensure_schema()`. Module-specific tables store session metadata.
*   **Adaptive Logic:** Each language module implements adaptive difficulty rules based on user performance.
*   **Cleanup:** A background task purges old module data and dormant user accounts.
*   **Product Specification:** Endpoints `/spec` (JSON) and `/spec/markdown` provide product specifications.
