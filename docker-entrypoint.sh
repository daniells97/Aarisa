#!/bin/sh
# Applies pending migrations (forward-only) before starting the server.
set -e
node_modules/.bin/tsx src/db/migrate.ts
exec "$@"
