# ─── Stage 1: Base ────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# ─── Stage 2: Dependencies ───────────────────────────────────────────────────
FROM base AS deps

# Copy workspace structure files for dependency resolution
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/llm/package.json ./packages/llm/
COPY packages/search/package.json ./packages/search/
COPY packages/workflow/package.json ./packages/workflow/

RUN pnpm install --frozen-lockfile

# ─── Stage 3: Build ──────────────────────────────────────────────────────────
FROM deps AS build

# Copy all source code
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

# Build all packages in dependency order
RUN pnpm turbo build --filter=@contritas/api...

# ─── Stage 4: Production ─────────────────────────────────────────────────────
FROM base AS production

# Deploy with pruned dependencies (only production deps, flattened)
COPY --from=deps /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=deps /app/apps/api/package.json ./apps/api/
COPY --from=deps /app/packages/shared/package.json ./packages/shared/
COPY --from=deps /app/packages/llm/package.json ./packages/llm/
COPY --from=deps /app/packages/search/package.json ./packages/search/
COPY --from=deps /app/packages/workflow/package.json ./packages/workflow/

RUN pnpm install --frozen-lockfile --prod

# Copy built output
COPY --from=build /app/apps/api/dist/ ./apps/api/dist/
COPY --from=build /app/packages/shared/dist/ ./packages/shared/dist/
COPY --from=build /app/packages/llm/dist/ ./packages/llm/dist/
COPY --from=build /app/packages/search/dist/ ./packages/search/dist/
COPY --from=build /app/packages/workflow/dist/ ./packages/workflow/dist/

# Copy drizzle config for potential migrations
COPY --from=build /app/apps/api/drizzle.config.ts ./apps/api/

WORKDIR /app/apps/api

ENV NODE_ENV=production
EXPOSE 4000

# Drop privileges — node:alpine ships a "node" user (uid 1000)
RUN chown -R node:node /app
USER node

# Default: run API server. Override with CMD for worker.
CMD ["node", "dist/index.js"]
