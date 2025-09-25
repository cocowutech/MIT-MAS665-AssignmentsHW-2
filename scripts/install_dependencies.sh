#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

echo "[INFO] Starting dependency installation for Debian/Ubuntu..."

# 1. Update package lists
echo "[INFO] Updating apt package lists..."
sudo apt-get update

# 2. Install system-level prerequisites
echo "[INFO] Installing python3-venv and tesseract-ocr..."
sudo apt-get install -y python3-venv tesseract-ocr

# 3. Create and activate a Python virtual environment
echo "[INFO] Creating and activating Python virtual environment..."
python3 -m venv .venv
source .venv/bin/activate

# 4. Install Python dependencies
echo "[INFO] Installing Python dependencies from requirements.txt..."
.venv/bin/python -m pip install -r requirements.txt

echo "[INFO] All dependencies installed successfully!"
echo "[SUCCESS] To activate the virtual environment, run: source .venv/bin/activate"
