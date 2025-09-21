#!/usr/bin/env bash
set -eo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
. "$ROOT_DIR/.venv/bin/activate"
export PYTHONPATH="$ROOT_DIR"
cd "$ROOT_DIR"
exec uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
