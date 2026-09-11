#!/bin/sh
# Compatibility wrapper. Install locked dependencies with npm ci first.
set -eu
cd "$(dirname "$0")"
exec node scripts/build.cjs
