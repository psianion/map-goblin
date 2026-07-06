# --- Stage 1: build canvas app ---
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.7.0 --activate

# Manifests first for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY canvas/package.json ./canvas/package.json
COPY packages/core/package.json ./packages/core/package.json
RUN pnpm install --frozen-lockfile

# Rest of the source
COPY . .
RUN pnpm --filter ./canvas build

# --- Stage 2: serve with nginx ---
FROM nginx:alpine AS runtime
COPY --from=build /app/canvas/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
