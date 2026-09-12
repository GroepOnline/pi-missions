#!/bin/sh
# Smoke-test the installed preview package: the exact entries pi loads plus
# the pi-missions CLI must work from the shipped artifact.
set -eu
PREFIX="${1:-./pkg}"
PKG="$PREFIX/node_modules/@groeponline/pi-missions"
fail() { echo "preview FAIL: $1" >&2; exit 1; }
test -f "$PKG/dist/index.js" || fail "missing pi extension entry dist/index.js"
test -f "$PKG/dist/cli/index.js" || fail "missing CLI entry dist/cli/index.js"
"$PREFIX/node_modules/.bin/pi-missions" --help >/dev/null 2>&1 || fail "pi-missions --help failed"
echo "preview OK: @groeponline/pi-missions (dist + CLI present)"
