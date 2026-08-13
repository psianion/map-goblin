# --- Base: deps + source ---
FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.7.0 --activate

# Manifests first for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY canvas/package.json ./canvas/package.json
COPY packages/core/package.json ./packages/core/package.json
RUN pnpm install --frozen-lockfile

COPY . .

# --- Dev: vite dev server (docker build --target dev) ---
FROM base AS dev
EXPOSE 5173
WORKDIR /app/canvas
CMD ["pnpm", "exec", "vite", "--host", "0.0.0.0"]

# --- Build: production bundle ---
FROM base AS build
# Where the browser fetches asset packs from. Empty is the normal case: the bundled
# dungeon-classic pack is served from this image's own /packs, so no external origin is
# involved and the app works with no CDN at all. Point it at the pack bucket to publish
# art without rebuilding — see docs/2026-08-09-pack-cdn-plan.md.
#
# Vite inlines this at build time, so *changing the origin* still needs a rebuild.
# Changing what is *in* the bucket does not, which is the point.
ARG VITE_CDN_BASE_URL=""
ENV VITE_CDN_BASE_URL=$VITE_CDN_BASE_URL
RUN pnpm --filter ./canvas build

# --- Runtime: nginx serving static build (default target) ---
FROM nginx:alpine AS runtime
COPY --from=build /app/canvas/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
