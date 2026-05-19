#!/bin/bash
# Smoke test for pi-missions extension
# This script validates that the extension can be loaded by Pi

set -e

echo "🧪 Running pi-missions smoke test..."

# Check if dist directory exists
if [ ! -d "dist" ]; then
    echo "❌ dist/ directory not found. Run 'npm run build' first."
    exit 1
fi

# Check if main entry point exists
if [ ! -f "dist/index.js" ]; then
    echo "❌ dist/index.js not found."
    exit 1
fi

# Check if type definitions exist
if [ ! -f "dist/index.d.ts" ]; then
    echo "❌ dist/index.d.ts not found."
    exit 1
fi

echo "✅ Build output files exist"

# Verify the extension exports a default function
echo "🔍 Verifying extension exports..."

# Use Node.js to check if the module exports a default function
node --input-type=module -e "
import extension from './dist/index.js';

if (typeof extension !== 'function') {
    console.error('❌ Extension does not export a default function');
    process.exit(1);
}

console.log('✅ Extension exports a default function');
console.log('   Function name:', extension.name || '(anonymous)');
console.log('   Function length:', extension.length, 'parameters');
"

echo ""
echo "✅ Smoke test passed! Extension is ready for Pi."
echo ""
echo "To install in Pi:"
echo "  pi install ./pi-missions"
echo ""
echo "Or for local development:"
echo "  pi -e ./dist/index.js"
