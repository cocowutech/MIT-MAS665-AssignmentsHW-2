#!/bin/bash 

# Exit immediately if a command exits with a non-zero status.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
$SCRIPT_DIR/install_dependencies.sh
$SCRIPT_DIR/run.sh

exit 0