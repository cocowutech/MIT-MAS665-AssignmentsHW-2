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
export PYTHONPATH="$ROOT_DIR"
cd "$ROOT_DIR"
exec uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
