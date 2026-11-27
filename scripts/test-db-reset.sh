#!/usr/bin/env bash
# Puts the test database (aarisa_test, .env.test) back to the June 2026 sample data: drops its schemas,
# runs every migration and the seed. Never touches aarisa_dev (the test environment) or aarisa_db.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env.test ] || { echo ".env.test is missing"; exit 1; }
set -a; . ./.env.test; set +a
case "$DATABASE_URL" in *"/aarisa_test"*) ;; *) echo "refusing: .env.test is not aarisa_test"; exit 1;; esac
node -e '
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
(async () => { await sql.unsafe("drop schema if exists core cascade; drop schema if exists drizzle cascade;"); await sql.end(); })().catch((e) => { console.error(e); process.exit(1); });
'
pnpm -s db:migrate >/dev/null
pnpm -s db:seed >/dev/null
echo "aarisa_test reset to the sample data"
