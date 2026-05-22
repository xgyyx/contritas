#!/bin/bash
set -e

echo "Starting Contritas development environment..."

# Start infrastructure
echo "Starting PostgreSQL and Redis..."
docker compose up -d

# Wait for services to be ready
echo "Waiting for services..."
sleep 3

# Run database migrations
echo "Running database migrations..."
(cd apps/api && pnpm db:push)

# Start API + Worker + Web in parallel; forward Ctrl-C to all children
pids=()
cleanup() {
  echo ""
  echo "Stopping dev processes..."
  for pid in "${pids[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "Starting API server (port 4000)..."
pnpm --filter @contritas/api dev &
pids+=($!)

echo "Starting Worker..."
pnpm --filter @contritas/api worker &
pids+=($!)

echo "Starting Web (port 3000)..."
pnpm --filter @contritas/web dev &
pids+=($!)

echo ""
echo "All processes started. Press Ctrl-C to stop."
echo "  API:    http://localhost:4000"
echo "  Web:    http://localhost:3000"
echo ""

wait -n
exit_code=$?
echo "A dev process exited (code=$exit_code), tearing down..."
exit "$exit_code"
