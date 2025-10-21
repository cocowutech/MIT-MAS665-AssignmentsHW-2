#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e
set -o pipefail

run_apt() {
	if ! command -v apt-get >/dev/null 2>&1; then
		return 1
	fi

	if [ "$(id -u)" -eq 0 ]; then
		apt-get "$@"
	elif command -v sudo >/dev/null 2>&1; then
		sudo apt-get "$@"
	else
		return 1
	fi
}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

echo "[INFO] Starting dependency installation for Debian/Ubuntu..."

# 1. Update package lists
echo "[INFO] Updating apt package lists..."
if run_apt update; then
	echo "[INFO] apt package lists updated"
else
	echo "[WARNING] Could not update apt package lists automatically. Proceeding with existing package metadata..."
fi

# 2. Install system-level prerequisites
REQUIRED_PACKAGES=(
	python3
	python3-pip
	python3-venv
	python3-dev
	build-essential
	libffi-dev
	libssl-dev
	pkg-config
	curl
	tesseract-ocr
)

MISSING_PACKAGES=()
for pkg in "${REQUIRED_PACKAGES[@]}"; do
	if ! dpkg -s "$pkg" >/dev/null 2>&1; then
		MISSING_PACKAGES+=("$pkg")
	fi
done

if [ ${#MISSING_PACKAGES[@]} -gt 0 ]; then
	echo "[INFO] Installing required system packages: ${MISSING_PACKAGES[*]}"
	if ! run_apt install -y "${MISSING_PACKAGES[@]}"; then
		echo "[ERROR] Failed to install required system packages automatically."
		echo "[ERROR] Please install them manually, for example:"
		echo "        sudo apt-get install -y ${MISSING_PACKAGES[*]}"
		exit 1
	fi
else
	echo "[INFO] All required system packages are already installed."
fi

if ! command -v tesseract >/dev/null 2>&1; then
	echo "[ERROR] tesseract-ocr is required but not detected on PATH after installation."
	echo "[ERROR] Verify the package was installed correctly (e.g., sudo apt-get install -y tesseract-ocr)."
	exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
	echo "[ERROR] curl is required for downloading Node.js setup scripts."
	echo "[ERROR] Ensure curl is installed and re-run this script."
	exit 1
fi

# Check if Node.js is already installed (via nvm or system)
if command -v node &> /dev/null; then
    echo "[INFO] Node.js is already installed: $(node --version)"
    echo "[INFO] npm version: $(npm --version)"
else
    echo "[INFO] Installing Node.js from NodeSource..."
    if [ "$(id -u)" -eq 0 ]; then
        curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
        apt-get install -y nodejs
    elif command -v sudo >/dev/null 2>&1; then
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
        sudo apt-get install -y nodejs
    else
        echo "[ERROR] Installing Node.js requires root privileges. Install Node.js 20+ manually and re-run this script."
        exit 1
    fi
    echo "[INFO] Node.js installed: $(node --version)"
    echo "[INFO] npm version: $(npm --version)"
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
    if npm install -g typescript; then
        echo "[INFO] TypeScript installed globally."
    elif command -v sudo >/dev/null 2>&1 && sudo npm install -g typescript; then
        echo "[INFO] TypeScript installed globally with sudo."
    else
        echo "[WARNING] Cannot install TypeScript globally. It will be installed locally where required."
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
