#!/bin/sh
set -e

# Auto-run drizzle migrations on container start. Disable with
# RUN_MIGRATIONS=false (e.g. for the worker service in compose, since the api
# service migrates first; or when running migrations as a separate K8s Job).
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] running drizzle migrations..."
  node /app/apps/api/dist/scripts/migrate.js
else
  echo "[entrypoint] skipping migrations (RUN_MIGRATIONS=${RUN_MIGRATIONS})"
fi

exec "$@"
