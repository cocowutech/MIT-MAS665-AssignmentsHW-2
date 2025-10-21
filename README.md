# Adaptive English Placement Agent

This project is a web application designed to provide an AI-powered, adaptive English language proficiency assessment. It uses Google's Gemini API to dynamically generate questions and evaluate user responses across several key language skill modules.

The application features a FastAPI backend, a lightweight vanilla JavaScript frontend, and a set of adaptive learning modules for Reading, Listening, Writing, Vocabulary, and Speaking.

## ✨ Features

-   **AI-Powered Assessment**: Leverages the Google Gemini API for dynamic content generation and evaluation.
-   **Adaptive Modules**: Adjusts question difficulty in real-time based on user performance in five key areas:
    -   Reading Comprehension
    -   Listening Skills
    -   Written Expression (with optional OCR for handwritten text)
    -   Vocabulary and Grammar
    -   Spoken Fluency
-   **Secure Authentication**: JWT-based OAuth2 password flow for user management.
-   **Configurable AI Provider**: Supports both Google Vertex AI and AI Studio for flexibility.
-   **Persistent State**: Uses a SQLite database to store user and session data.
-   **Built-in Monitoring**: Includes a `/health` endpoint for health checks and `/spec` for product specifications.
-   **Automatic Cleanup**: Background tasks to purge old data and manage database size.
-   **Idle Shutdown**: Automatically shuts down the server after a configurable period of inactivity to conserve resources.

## 🛠️ Tech Stack

-   **Backend**: Python 3.12, FastAPI, Uvicorn
-   **AI Integration**: Google Gemini API
-   **Database**: SQLite
-   **Frontend**: HTML, Vanilla JavaScript
-   **Authentication**: JWT (OAuth2 Password Flow)
-   **OCR**: Tesseract-OCR (for the Writing module)
-   **Settings Management**: Pydantic

## 🚀 Getting Started

### Prerequisites

-   Developed and tested on Ubuntu/Debian. On other Linux distributions install the equivalent system packages.
-   Ability to install packages with `apt-get` (the setup script will prompt for sudo if needed).

If you prefer to install system packages manually, ensure the following baseline tools are present:

```bash
sudo apt-get update
sudo apt-get install -y \
    python3 python3-pip python3-venv python3-dev \
    build-essential libffi-dev libssl-dev pkg-config \
    curl tesseract-ocr
```

### 1. Clone the Project

```bash
# Navigate to the directory where you want the project to live
# git clone <your-repo-url>
# cd MIT-MAS665-AssignmentsHW-2
```

### 2. Install Dependencies (Recommended)

Run the automated installer from the project root:

```bash
./scripts/install_dependencies.sh
```

The script performs the following:

-   Installs required system packages on Debian/Ubuntu (Python toolchain, build essentials, libffi/libssl, curl, tesseract).
-   Installs Node.js 22.x from NodeSource if Node is not already present.
-   Creates a Python virtual environment in `.venv` and installs `requirements.txt`.
-   Runs `npm install` for each frontend module and compiles TypeScript sources.

You can rerun the script at any time; it only installs missing components.  
If your environment cannot use the script, replicate the same steps manually before proceeding.

**Manual alternative (outline)**

Ensure Node.js (version 20 or newer) and `npm` are available before running the manual commands below.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

for module in frontend/*/; do
    if [ -f "$module/package.json" ]; then
        (cd "$module" && npm install)
    fi
done

./scripts/clean_and_rebuild.sh
```

### 3. Configure Environment Variables

Create a `.env` file in the root of the project directory by copying the example below.

```bash
# --- .env file ---

# Required: Gemini API Configuration
GEMINI_API_KEY=replace-with-your-gemini-api-key
GEMINI_MODEL=gemini-2.5-flash

# Provider: Choose ONE ("vertex" or "ai_studio")
GEMINI_PROVIDER=ai_studio

# Vertex AI Settings (only required if GEMINI_PROVIDER=vertex)
GEMINI_VERTEX_REGION=us-central1
GEMINI_VERTEX_PROJECT=your-gcp-project-id

# Optional: module-specific overrides
# GEMINI_MODEL_LISTEN=

# Optional: OpenRouter fallback configuration
OPENROUTER_API_KEY=replace-with-your-openrouter-key
OPENROUTER_MODEL=z-ai/glm-4.6
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1/chat/completions
OPENROUTER_HTTP_REFERER=https://localhost
OPENROUTER_TITLE=AdaptiveEnglishPlacement

# Auth (seed user and JWT)
SEED_USERNAME=rong_wu
SEED_PASSWORD=mit!23456
JWT_SECRET_KEY=change-this-in-prod
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=120

# Database (optional, defaults to SQLite)
# DATABASE_URL=
```

**Note**: Make sure to replace placeholder values (`YOUR_GEMINI_API_KEY`, `your-gcp-project-id`, etc.) with your actual credentials.

If you rely on Google Cloud Speech-to-Text, also ensure `GOOGLE_APPLICATION_CREDENTIALS` points to a valid service account JSON file, or export the path before launching the app.

**Environment variable reference**
-   `GEMINI_API_KEY`: Primary Gemini API key; required when `GEMINI_PROVIDER` is set to either `ai_studio` or `vertex`.
-   `GEMINI_MODEL`: Default Gemini model (repository `.env` ships with `gemini-2.5-flash`; adjust for your account).
-   `GEMINI_PROVIDER`: Set to `ai_studio` (default in the provided `.env`) for AI Studio keys, or `vertex` when using Google Cloud Vertex AI.
-   `GEMINI_VERTEX_REGION`, `GEMINI_VERTEX_PROJECT`: Only required when `GEMINI_PROVIDER=vertex`; leave the defaults untouched if you stay on AI Studio.
-   `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`, `OPENROUTER_HTTP_REFERER`, `OPENROUTER_TITLE`: Optional OpenRouter fallback configuration present in `.env`. Remove or replace with your own values if you use OpenRouter as a secondary model provider.
-   `SEED_USERNAME`, `SEED_PASSWORD`: Credentials for the initial user inserted at startup. Customize before deploying; the sample file uses `rong_wu` / `mit!23456`.
-   `JWT_SECRET_KEY`: Symmetric key for signing access tokens; change for any non-local environment.
-   `JWT_ALGORITHM`: Signing algorithm (defaults to `HS256`).
-   `ACCESS_TOKEN_EXPIRE_MINUTES`: Access token lifetime in minutes (sample file uses 120).
-   `GOOGLE_APPLICATION_CREDENTIALS`: Optional environment variable (not set in `.env`) pointing to your Google Cloud service account JSON when using services like Speech-to-Text.
-   `DATABASE_URL`: Optional override for the default SQLite database (commented out in `.env`; supply a SQLAlchemy-compatible URL for Postgres, etc.).

### 4. Run the Application

You can run the server using the provided shell script.

**To run in the foreground:**

```bash
./scripts/run.sh
```

This script activates `.venv`, loads the `.env` file if present, builds missing frontend assets, and starts `uvicorn` with live reload.

**To run as a background process:**

```bash
./scripts/run.sh > /tmp/placement_api.log 2>&1 & echo $! > /tmp/placement_api.pid
```

The application will be available at `http://127.0.0.1:8000`.

If you want a single command that installs dependencies, rebuilds the frontend, and launches the app, use:

```bash
./scripts/run_all.sh
```

This wrapper will prompt for your sudo password when system packages need to be installed.

## 🌐 Accessing the Application

-   **Main Login Page**: `http://127.0.0.1:8000/app`
-   **Health Check**: `http://127.0.0.1:8000/health`
-   **API Specification (JSON)**: `http://127.0.0.1:8000/spec`
-   **API Specification (Markdown)**: `http://127.0.0.1:8000/spec/markdown`

### Module-Specific Pages

Once logged in, you can access the individual assessment modules:

-   **Reading**: `/app/read/`
-   **Listening**: `/app/listen/`
-   **Writing**: `/app/write/`
-   **Vocabulary**: `/app/vocabulary/`
-   **Speaking**: `/app/speaking/`

## ⚙️ How It Works

The application is built around a modular FastAPI backend that serves a static frontend. Each language skill is handled by a dedicated router that contains the logic for the adaptive assessment.

-   **Authentication**: A seed user is created from the `.env` file. You can log in with these credentials to receive a JWT access token, which must be included in the `Authorization` header for all protected API calls.
-   **Adaptive Logic**: Each module starts at a default proficiency level (e.g., B1). Based on the user's answers, the backend logic adjusts the difficulty of the next set of questions up or down the CEFR scale (A1-C2).
-   **Database**: User information and the results of each completed module session are stored in a local SQLite database file (`app.db`).

## Troubleshooting

-   **Installer cannot install system packages**: When `./scripts/install_dependencies.sh` reports missing apt privileges, manually install the listed packages (for example, `sudo apt-get install -y python3 python3-pip python3-venv python3-dev build-essential libffi-dev libssl-dev pkg-config curl tesseract-ocr`) and rerun the script.
-   **`gemini_configured: false` on `/`**: This means the server could not load the Gemini API key from the `.env` file. Ensure the `.env` file exists in the project root and that you started the server from the root directory.
-   **401 Unauthorized from Gemini API**:
    -   If using **AI Studio**, ensure `GEMINI_PROVIDER` is set to `ai_studio` and you are using a valid AI Studio key.
    -   If using **Vertex AI**, ensure `GEMINI_PROVIDER` is set to `vertex`, the `GEMINI_VERTEX_PROJECT` is correct, the Vertex AI API is enabled in your GCP project, and your API key is authorized for Vertex AI.
-   **Login Fails**: Double-check the `SEED_USERNAME` and `SEED_PASSWORD` in your `.env` file and restart the server to apply the changes.

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
