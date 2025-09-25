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

Ensure you have the following installed on your system (instructions provided for Ubuntu/Debian):

-   **Python 3.12**
-   **Python Virtual Environment**:
    ```bash
    sudo apt-get update && sudo apt-get install -y python3-venv
    ```
-   **Tesseract OCR Engine** (required for the image-to-text feature in the Writing module):
    ```bash
    sudo apt-get install -y tesseract-ocr
    ```

### 1. Clone & Set Up the Environment

```bash
# Navigate to your desired project directory
# git clone <your-repo-url>
# cd MIT-MAS665-AssignmentsHW-2

# Create and activate a Python virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install the required Python packages
pip install -r requirements.txt
```

### 2. Configure Environment Variables

Create a `.env` file in the root of the project directory by copying the example below.

```bash
# --- .env file ---

# Required: Gemini API Configuration
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
GEMINI_MODEL=gemini-2.5-flash

# Provider: Choose ONE ("vertex" or "ai_studio")
GEMINI_PROVIDER=vertex

# Vertex AI Settings (only required if GEMINI_PROVIDER=vertex)
GEMINI_VERTEX_REGION=us-central1
GEMINI_VERTEX_PROJECT=your-gcp-project-id

# Auth (seed user and JWT)
SEED_USERNAME=rong_wu
SEED_PASSWORD=mit!23456
JWT_SECRET_KEY=change-this-in-prod
```

**Note**: Make sure to replace placeholder values (`YOUR_GEMINI_API_KEY`, `your-gcp-project-id`, etc.) with your actual credentials.

### 3. Running the Application

You can run the server using the provided shell script.

**To run in the foreground:**

```bash
./scripts/run.sh
```

**To run as a background process:**

```bash
./scripts/run.sh > /tmp/placement_api.log 2>&1 & echo $! > /tmp/placement_api.pid
```

The application will be available at `http://127.0.0.1:8000`.

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

-   **`gemini_configured: false` on `/`**: This means the server could not load the Gemini API key from the `.env` file. Ensure the `.env` file exists in the project root and that you started the server from the root directory.
-   **401 Unauthorized from Gemini API**:
    -   If using **AI Studio**, ensure `GEMINI_PROVIDER` is set to `ai_studio` and you are using a valid AI Studio key.
    -   If using **Vertex AI**, ensure `GEMINI_PROVIDER` is set to `vertex`, the `GEMINI_VERTEX_PROJECT` is correct, the Vertex AI API is enabled in your GCP project, and your API key is authorized for Vertex AI.
-   **Login Fails**: Double-check the `SEED_USERNAME` and `SEED_PASSWORD` in your `.env` file and restart the server to apply the changes.

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.