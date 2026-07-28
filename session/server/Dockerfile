# @dnd/game-server. Build context is the repo root — pnpm needs the workspace manifests,
# so this cannot be built from session/server/ (see docker-compose.yml).
#
# node:22-slim, not the alpine the canvas image uses: better-sqlite3 publishes glibc
# prebuilds, so this image needs no compiler at all. On musl it would have to build from
# source, which means dragging python3/make/g++ into a server whose whole job is one file.
FROM node:22-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.7.0 --activate

# Manifests first so a source edit does not re-install. Every workspace manifest is copied,
# not just the server's: `--frozen-lockfile` checks the lockfile against the workspace it
# can see, and a half-visible workspace reads as an outdated lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/
COPY canvas/package.json ./canvas/
COPY session/client/package.json ./session/client/
COPY session/server/package.json ./session/server/
RUN pnpm install --frozen-lockfile --filter @dnd/game-server...

# The server runs from source under tsx; core is a type-only import (D3) that esbuild
# erases, but its sources are copied so `pnpm --filter @dnd/game-server typecheck` works
# in the image too.
COPY packages/core ./packages/core
COPY session/server ./session/server

# Overridable, but the compose volume mounts here: the SQLite file, the secrets and the
# admin-pass hash all live in this directory, and losing it invalidates every token.
ENV GAME_SERVER_DATA=/data
EXPOSE 8787
# tsx directly, not `pnpm start`: pnpm does not forward SIGTERM, so every `compose stop`
# would log a failed run. One less process between the container and the server.
WORKDIR /app/session/server
CMD ["node_modules/.bin/tsx", "src/index.ts"]
