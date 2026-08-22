# @dnd/bot. Build context is the repo root — pnpm needs the workspace manifests,
# so this cannot be built from bot/ (see docker-compose.yml).
#
# node:22-slim, same reasoning as the game server: better-sqlite3 publishes glibc
# prebuilds, so this image needs no compiler at all.
FROM node:22-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.7.0 --activate

# Manifests first so a source edit does not re-install. Every workspace manifest is copied,
# not just the bot's: `--frozen-lockfile` checks the lockfile against the workspace it can
# see, and a half-visible workspace reads as an outdated lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/mechanics/package.json ./packages/mechanics/
COPY canvas/package.json ./canvas/
COPY session/client/package.json ./session/client/
COPY session/server/package.json ./session/server/
COPY bot/package.json ./bot/
RUN pnpm install --frozen-lockfile --filter @dnd/bot...

COPY bot ./bot

# Overridable, but the compose volume mounts here: the SQLite file lives in this directory.
ENV BOT_DATA=/data
RUN mkdir -p /data && chown -R node:node /data /app
USER node

# tsx directly, not `pnpm start`: pnpm does not forward SIGTERM, so every `compose stop`
# would kill the bot before channel-log flushes its last batch.
WORKDIR /app/bot
CMD ["node_modules/.bin/tsx", "src/index.ts"]
