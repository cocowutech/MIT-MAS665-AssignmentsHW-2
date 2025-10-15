#!/bin/bash

# Script to remove CommonJS exports from compiled JavaScript files for browser compatibility

echo "Cleaning CommonJS exports from JavaScript files..."

# Function to clean exports from a file
clean_exports() {
    local file="$1"
    if [ -f "$file" ]; then
        echo "Cleaning exports from $file"
        
        # Remove "use strict" if it's the first line
        sed -i '1s/^"use strict";$//' "$file"
        
        # Remove Object.defineProperty(exports, "__esModule", { value: true });
        sed -i '/Object\.defineProperty(exports, "__esModule", { value: true });/d' "$file"
        
        # Remove exports.XXX = void 0; lines
        sed -i '/exports\.[A-Za-z_][A-Za-z0-9_]* = void 0;/d' "$file"
        
        # Remove exports.XXX = XXX; lines
        sed -i '/exports\.[A-Za-z_][A-Za-z0-9_]* = [A-Za-z_][A-Za-z0-9_]*;/d' "$file"
        
        # Remove export {}; lines
        sed -i '/^export {};$/d' "$file"

        # Remove export const/let/var statements
        sed -i '/^export const /d' "$file"
        sed -i '/^export let /d' "$file"
        sed -i '/^export var /d' "$file"

        # Clean up any empty lines at the beginning
        sed -i '/^$/N;/^\n$/d' "$file"
    fi
}

# Clean main.js
clean_exports "js/main.js"

# Clean shared files
clean_exports "shared/js/auth.js"
clean_exports "shared/js/api.js"

# Clean module files
for module in read vocabulary listen speaking write; do
    if [ -f "$module/$module.js" ]; then
        clean_exports "$module/$module.js"
    fi
done

echo "Export cleaning completed!"
