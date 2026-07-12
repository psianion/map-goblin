FROM node:22-alpine

WORKDIR /app

RUN npm install -g pnpm@10

COPY . .

RUN pnpm install --frozen-lockfile

EXPOSE 5173

WORKDIR /app/canvas

CMD ["pnpm", "exec", "vite", "--host", "0.0.0.0"]
