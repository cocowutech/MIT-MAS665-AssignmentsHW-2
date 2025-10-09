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
echo "[INFO] Installing python3-venv, tesseract-ocr..."

# Install Python and Tesseract
sudo apt-get install -y python3-venv tesseract-ocr

# Check if Node.js is already installed (via nvm or system)
if command -v node &> /dev/null; then
    echo "[INFO] Node.js is already installed: $(node --version)"
    echo "[INFO] npm version: $(npm --version)"
else
    echo "[INFO] Installing Node.js from NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
    echo "[INFO] Node.js installed: $(node --version)"
    echo "[INFO] npm version: $(npm --version)"
fi

# 3. Create and activate a Python virtual environment
echo "[INFO] Creating and activating Python virtual environment..."
python3 -m venv .venv
source .venv/bin/activate

# 4. Install Python dependencies
echo "[INFO] Installing Python dependencies from requirements.txt..."
.venv/bin/python -m pip install -r requirements.txt

# 5. Install frontend dependencies for each module
echo "[INFO] Installing frontend dependencies..."

# Install TypeScript globally for compilation
npm install -g typescript

# Install dependencies for each module that has a package.json
for module in frontend/*/; do
    if [ -f "$module/package.json" ]; then
        echo "[INFO] Installing dependencies for $(basename "$module") module..."
        cd "$module"
        npm install
        cd "$ROOT_DIR"
    fi
done

# 6. Compile TypeScript files
echo "[INFO] Compiling TypeScript files..."
for module in frontend/*/; do
    module_name=$(basename "$module")
    if [ -f "$module/${module_name}.ts" ]; then
        echo "[INFO] Compiling TypeScript for $module_name module..."
        cd "$module"
        npx tsc "${module_name}.ts" --target es2020 --lib es2020,dom --module amd --outDir . --outFile "${module_name}.js"
        cd "$ROOT_DIR"
    fi
done

echo "[INFO] All dependencies installed successfully!"
echo "[SUCCESS] To activate the virtual environment, run: source .venv/bin/activate"
echo "[SUCCESS] Frontend modules are ready with compiled JavaScript files"
