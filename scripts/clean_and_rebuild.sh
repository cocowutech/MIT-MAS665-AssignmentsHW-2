#!/usr/bin/env bash
set -eo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "[INFO] Cleaning all built files..."

# Remove the build directory if it exists
if [ -d "$ROOT_DIR/frontend/build" ]; then
    echo "[INFO] Removing existing build directory..."
    rm -rf "$ROOT_DIR/frontend/build"
fi

# Remove any existing compiled JS files in module directories
for module in frontend/*/; do
    module_name=$(basename "$module")
    js_file="$module/${module_name}.js"
    
    if [ -f "$js_file" ]; then
        echo "[INFO] Removing $js_file..."
        rm "$js_file"
    fi
done

# Remove any existing compiled JS files in shared directory
for js_file in frontend/shared/js/*.js; do
    if [ -f "$js_file" ]; then
        echo "[INFO] Removing $js_file..."
        rm "$js_file"
    fi
done

echo "[INFO] Creating new build directories..."
mkdir -p "$ROOT_DIR/frontend/build/speaking"
mkdir -p "$ROOT_DIR/frontend/build/listen"
mkdir -p "$ROOT_DIR/frontend/build/read"
mkdir -p "$ROOT_DIR/frontend/build/vocabulary"
mkdir -p "$ROOT_DIR/frontend/build/write"
mkdir -p "$ROOT_DIR/frontend/build/shared/js"
mkdir -p "$ROOT_DIR/frontend/build/shared/css"

echo "[INFO] Rebuilding TypeScript files..."

# Compile TypeScript files for each module
for module in frontend/*/; do
    module_name=$(basename "$module")
    shopt -s nullglob
    ts_files=("$module"/*.ts)
    shopt -u nullglob

    if [ ${#ts_files[@]} -eq 0 ]; then
        continue
    fi

    for ts_path in "${ts_files[@]}"; do
        filename=$(basename "$ts_path" .ts)
        echo "[INFO] Compiling TypeScript for $module_name/$filename..."
        cd "$module"
        npx tsc "${filename}.ts" --target es2020 --lib es2020,dom --module amd --outFile "$ROOT_DIR/frontend/build/$module_name/${filename}.js"
        cd "$ROOT_DIR"
    done
done

# Compile TypeScript files for shared/js directory
for ts_file in frontend/shared/js/*.ts; do
    if [ -f "$ts_file" ]; then
        filename=$(basename "$ts_file" .ts)
        echo "[INFO] Compiling TypeScript for shared/js/$filename..."
        cd "$ROOT_DIR/frontend/shared/js"
        npx tsc "$filename.ts" --target es2020 --lib es2020,dom --module amd --outFile "$ROOT_DIR/frontend/build/shared/js/$filename.js"
        cd "$ROOT_DIR"
    fi
done

# Copy shared CSS files to build directory
echo "[INFO] Copying shared CSS files..."
if [ -d "$ROOT_DIR/frontend/shared/css" ] && [ "$(ls -A "$ROOT_DIR/frontend/shared/css")" ]; then
    cp -r "$ROOT_DIR/frontend/shared/css/"* "$ROOT_DIR/frontend/build/shared/css/"
else
    echo "[WARNING] No shared CSS files found to copy"
fi

# Copy module-specific CSS files to build directories
for module in frontend/*/; do
    module_name=$(basename "$module")
    css_file="$module/styles.css"
    
    if [ -f "$css_file" ]; then
        echo "[INFO] Copying CSS for $module_name module..."
        cp "$css_file" "$ROOT_DIR/frontend/build/$module_name/"
    fi
done

echo "[INFO] Build completed successfully!"
echo "[SUCCESS] Built files are located in: $ROOT_DIR/frontend/build/"
