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
RUN pnpm --filter ./canvas build

# --- Runtime: nginx serving static build (default target) ---
FROM nginx:alpine AS runtime
COPY --from=build /app/canvas/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
