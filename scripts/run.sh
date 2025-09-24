#!/usr/bin/env bash
set -eo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
. "$ROOT_DIR/.venv/bin/activate" || {
    python3 -m venv "$ROOT_DIR/.venv"
    . "$ROOT_DIR/.venv/bin/activate"
}
python -m pip install --upgrade pip setuptools wheel >/dev/null || true
pip install -r "$ROOT_DIR/requirements.txt"

# Load environment variables from .env file if it exists
if [ -f "$ROOT_DIR/.env" ]; then
    echo "Loading environment variables from $ROOT_DIR/.env"
    set -a
    . "$ROOT_DIR/.env"
    set +a
fi

# Check for Tesseract OCR and install if not found (assumes Debian/Ubuntu-based system)
if ! command -v tesseract &> /dev/null
then
    echo "Tesseract OCR not found. Attempting to install..."
    if command -v apt-get &> /dev/null
    then
        sudo apt-get update && sudo apt-get install -y tesseract-ocr
    else
        echo "Could not automatically install Tesseract. Please install it manually using your system's package manager (e.g., 'sudo dnf install tesseract' for Fedora, 'sudo pacman -S tesseract' for Arch Linux)."
        exit 1
    fi
fi

export PYTHONPATH="$ROOT_DIR"
cd "$ROOT_DIR"
exec uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
