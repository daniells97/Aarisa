#!/usr/bin/env bash
# Runs Playwright inside the official image so the host needs no browser libraries.
# Start `pnpm dev` first; the tests reuse the server on 127.0.0.1:3100.
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p 'require("@playwright/test/package.json").version')
exec docker run --rm --network host --ipc host -v "$PWD":/work -w /work \
  -e CI=1 "mcr.microsoft.com/playwright:v${version}-noble" \
  npx playwright test "$@"
