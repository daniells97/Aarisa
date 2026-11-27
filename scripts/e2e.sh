#!/usr/bin/env bash
# End-to-end tests against their own database: resets aarisa_test, starts a dev server on 127.0.0.1:3200 with it,
# runs Playwright in the official image, stops the server. The test environment (aarisa_dev) is never touched.
set -euo pipefail
cd "$(dirname "$0")/.."
scripts/test-db-reset.sh
set -a; . ./.env.test; set +a
export DEV_LOGIN=1
node_modules/.bin/vite dev --host 127.0.0.1 --port 3200 > /tmp/aarisa-e2e-server.log 2>&1 &
server=$!
trap 'kill $server 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:3200/login && break; sleep 2; done
version=$(node -p 'require("@playwright/test/package.json").version')
docker run --rm --network host --ipc host -v "$PWD":/work -w /work -e CI=1 -e DATABASE_URL -e E2E_BASE_URL=http://127.0.0.1:3200 \
  "mcr.microsoft.com/playwright:v${version}-noble" npx playwright test "$@"
