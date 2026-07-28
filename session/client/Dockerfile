# @dnd/session-client. Build context is the repo root, same as the game server's
# Dockerfile — pnpm needs the workspace manifests, and the build needs @dnd/core's
# *sources* (core has no dist; its package.json main points at src/index.ts).
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.7.0 --activate

# Manifests first so a source edit does not re-install. Every workspace manifest is
# copied, not just the client's: `--frozen-lockfile` checks the lockfile against the
# workspace it can see, and a half-visible workspace reads as an outdated lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/
COPY canvas/package.json ./canvas/
COPY session/client/package.json ./session/client/
COPY session/server/package.json ./session/server/
RUN pnpm install --frozen-lockfile --filter @dnd/session-client...

COPY packages/core ./packages/core
COPY session/client ./session/client
# vite.config.ts points publicDir at canvas/public for the bundled texture packs
# (`/packs/…`, hardcoded in @dnd/core). `vite build` copies publicDir into dist, so
# this is what puts the pack files in the nginx image.
COPY canvas/public ./canvas/public
RUN pnpm --filter @dnd/session-client build

FROM nginx:alpine AS runtime
COPY --from=build /app/session/client/dist /usr/share/nginx/html
COPY session/client/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
