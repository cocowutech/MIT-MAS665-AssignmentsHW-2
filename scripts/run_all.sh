#!/bin/bash 

# Exit immediately if a command exits with a non-zero status.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check if we can use sudo without a password prompt
if ! sudo -n true 2>/dev/null; then
    echo "[INFO] This script requires sudo privileges to install system dependencies."
    echo "[INFO] Please enter your password when prompted."
fi

# Run the install_dependencies script with proper sudo handling
$SCRIPT_DIR/install_dependencies.sh

# Clean and rebuild all frontend files
echo "[INFO] Cleaning and rebuilding all frontend files..."
$SCRIPT_DIR/clean_and_rebuild.sh

# Run the application
$SCRIPT_DIR/run.sh

exit 0