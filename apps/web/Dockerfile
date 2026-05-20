# ─── Stage 1: Base ────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# ─── Stage 2: Dependencies ───────────────────────────────────────────────────
FROM base AS deps

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/llm/package.json ./packages/llm/
COPY packages/search/package.json ./packages/search/
COPY packages/workflow/package.json ./packages/workflow/

RUN pnpm install --frozen-lockfile

# ─── Stage 3: Build ──────────────────────────────────────────────────────────
FROM deps AS build

# NEXT_PUBLIC_ vars must be set at build time (inlined by Next.js)
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# Copy source
COPY packages/shared/ ./packages/shared/
COPY apps/web/ ./apps/web/

# Build (Next.js standalone output)
RUN pnpm turbo build --filter=@contritas/web

# ─── Stage 4: Production ─────────────────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# Copy standalone server
COPY --from=build /app/apps/web/.next/standalone ./
# Copy static assets
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
# Copy public dir if present
COPY --from=build /app/apps/web/public ./apps/web/public

EXPOSE 3000

# Next.js standalone server entrypoint
CMD ["node", "apps/web/server.js"]
