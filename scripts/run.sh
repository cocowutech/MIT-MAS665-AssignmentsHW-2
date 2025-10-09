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

# Check if TypeScript files need compilation
echo "[INFO] Checking TypeScript compilation status..."
for module in frontend/*/; do
    module_name=$(basename "$module")
    ts_file="$module/${module_name}.ts"
    js_file="$module/${module_name}.js"
    
    if [ -f "$ts_file" ]; then
        if [ ! -f "$js_file" ] || [ "$ts_file" -nt "$js_file" ]; then
            echo "[INFO] Compiling TypeScript for $module_name module..."
            cd "$module"
            npx tsc "${module_name}.ts" --target es2020 --lib es2020,dom --module amd --outDir . --outFile "${module_name}.js"
            cd "$ROOT_DIR"
        fi
    fi
done

export PYTHONPATH="$ROOT_DIR"
cd "$ROOT_DIR"

echo "[INFO] Starting ESL Assessment System..."
echo "[INFO] Backend will be available at: http://127.0.0.1:8000"
echo "[INFO] Frontend modules:"
echo "  - Listening: http://127.0.0.1:8000/app/listen/"
echo "  - Speaking: http://127.0.0.1:8000/app/speaking/"
echo "  - Reading: http://127.0.0.1:8000/app/read/"
echo "  - Vocabulary: http://127.0.0.1:8000/app/vocabulary/"
echo "  - Writing: http://127.0.0.1:8000/app/write/"

exec "$ROOT_DIR/.venv/bin/python" -m uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
