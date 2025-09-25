#!/usr/bin/env bash
set -eo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Activate the Python virtual environment
. "$ROOT_DIR/.venv/bin/activate"

# Load environment variables from .env file if it exists
if [ -f "$ROOT_DIR/.env" ]; then
    echo "Loading environment variables from $ROOT_DIR/.env"
    set -a
    . "$ROOT_DIR/.env"
    set +a
fi

export PYTHONPATH="$ROOT_DIR"
cd "$ROOT_DIR"
exec "$ROOT_DIR/.venv/bin/python" -m uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
