#!/bin/bash

set -x

# Build script for TypeScript to JavaScript compilation
# This script compiles the TypeScript files to JavaScript for browser compatibility

echo "Building TypeScript files..."

# Check if TypeScript is installed
if ! command -v tsc &> /dev/null; then
    echo "TypeScript compiler not found. Installing TypeScript..."
    npm install -g typescript
fi

# Clean previous build
echo "Cleaning previous build..."
rm -rf dist/

# Compile TypeScript to JavaScript
echo "Compiling TypeScript files..."
cd frontend
tsc -p .
cd -

if [ $? -eq 0 ]; then
    echo "TypeScript compilation successful!"
    echo "Generated JavaScript files in dist/ directory"
    
    # Copy compiled files to appropriate locations
    echo "Copying compiled files..."
    
    # Copy main.js to js/ directory for index.html
    if [ -f "dist/js/main.js" ]; then
        cp dist/js/main.js js/main.js
        echo "Copied main.js to js/ directory"
    fi
    
    # Copy shared files to shared/js/ directory (but skip .map files)
    if [ -d "dist/shared/js" ]; then
        cp dist/shared/js/*.js shared/js/
        echo "Copied shared JavaScript files"
    fi
    
    # Copy module files to their respective directories
    for module in read vocabulary listen speaking write; do
        if [ -f "dist/$module/$module.js" ]; then
            cp "dist/$module/$module.js" "$module/$module.js"
            echo "Copied $module.js to $module/ directory"
        fi
    done
    
    echo "Build completed successfully!"
else
    echo "TypeScript compilation failed!"
    exit 1
fi
