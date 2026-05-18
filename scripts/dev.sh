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
cd apps/api && pnpm db:push && cd ../..

# Start API and Worker in parallel
echo "Starting API server and Worker..."
pnpm turbo dev --filter=@contritas/api
