#!/bin/bash
set -e

echo "Running database migrations..."
cd apps/api
pnpm db:push
echo "Migrations complete."
