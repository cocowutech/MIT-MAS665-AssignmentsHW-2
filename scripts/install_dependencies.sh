#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

echo "[INFO] Starting dependency installation for Debian/Ubuntu..."

# 1. Update package lists
echo "[INFO] Updating apt package lists..."
if sudo -n true 2>/dev/null; then
    sudo apt-get update
else
    echo "[WARNING] Cannot update package lists without sudo privileges. Continuing with existing packages..."
fi

# 2. Install system-level prerequisites
echo "[INFO] Installing python3-venv, tesseract-ocr..."

# Check and install Python venv if not available
if ! python3 -m venv --help >/dev/null 2>&1; then
    echo "[INFO] Installing python3-venv..."
    if sudo -n true 2>/dev/null; then
        sudo apt-get install -y python3-venv
    else
        echo "[ERROR] Cannot install python3-venv without sudo privileges. Please install it manually."
        exit 1
    fi
else
    echo "[INFO] python3-venv is already installed"
fi

# Check and install Tesseract if not available
if ! command -v tesseract &> /dev/null; then
    echo "[INFO] Installing tesseract-ocr..."
    if sudo -n true 2>/dev/null; then
        sudo apt-get install -y tesseract-ocr
    else
        echo "[ERROR] Cannot install tesseract-ocr without sudo privileges. Please install it manually."
        exit 1
    fi
else
    echo "[INFO] tesseract-ocr is already installed: $(tesseract --version | head -n 1)"
fi

# Check if Node.js is already installed (via nvm or system)
if command -v node &> /dev/null; then
    echo "[INFO] Node.js is already installed: $(node --version)"
    echo "[INFO] npm version: $(npm --version)"
else
    echo "[INFO] Installing Node.js from NodeSource..."
    if sudo -n true 2>/dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
        sudo apt-get install -y nodejs
        echo "[INFO] Node.js installed: $(node --version)"
        echo "[INFO] npm version: $(npm --version)"
    else
        echo "[ERROR] Cannot install Node.js without sudo privileges. Please install it manually."
        exit 1
    fi
fi

# 3. Create and activate a Python virtual environment
echo "[INFO] Creating and activating Python virtual environment..."
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
    echo "[INFO] Virtual environment created"
else
    echo "[INFO] Virtual environment already exists"
fi
source .venv/bin/activate

# 4. Install Python dependencies
echo "[INFO] Installing Python dependencies from requirements.txt..."
.venv/bin/python -m pip install -r requirements.txt

# 5. Install frontend dependencies for each module
echo "[INFO] Installing frontend dependencies..."

# Install TypeScript globally for compilation
if ! command -v tsc &> /dev/null; then
    echo "[INFO] Installing TypeScript globally..."
    if sudo -n true 2>/dev/null; then
        npm install -g typescript
    else
        echo "[WARNING] Cannot install TypeScript globally without sudo privileges."
        echo "[INFO] TypeScript will be installed locally in each module that needs it."
    fi
else
    echo "[INFO] TypeScript is already installed: $(tsc --version)"
fi

# Install dependencies for each module that has a package.json
for module in frontend/*/; do
    if [ -f "$module/package.json" ]; then
        echo "[INFO] Installing dependencies for $(basename "$module") module..."
        cd "$module"
        npm install
        
        # If this module has TypeScript files and TypeScript isn't installed globally, install it locally
        module_name=$(basename "$module")
        if [ -f "$module/${module_name}.ts" ] && ! command -v tsc &> /dev/null; then
            echo "[INFO] Installing TypeScript locally for $module_name module..."
            npm install --save-dev typescript
        fi
        
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
