# Good Goblin

A browser-based dungeon and battle-map editor, plus the table your players join to play on those maps. See [canvas/README.md](canvas/README.md) for what the editor does.

## Run the latest build

Every push to `main` is checked and published as Docker images on GitHub Container Registry. All you need is [Docker](https://docs.docker.com/get-docker/) with Compose.

```bash
git clone https://github.com/psianion/map-goblin.git
cd map-goblin
docker compose pull
docker compose up -d
```

| What | Where |
| --- | --- |
| Editor | http://localhost:5621 (the redesigned editor is at `/v2`) |
| Table (players) | http://localhost:5622 |
| Game server | http://localhost:5620 (this machine only; the editor and table reach it inside Docker) |

The game server prints a one-time admin pass to its log the first time it starts. Read it with `docker compose logs game-server` and keep it: only its hash is stored, in the `game-server-data` volume.

To update, pull and start again. Your data lives in named volumes and survives both.

```bash
git pull
docker compose pull
docker compose up -d
```

Each build is also tagged with its commit, so you can run or roll back to an exact one:

```bash
MAP_GOBLIN_TAG=sha-1a2b3c4 docker compose up -d
```

Host ports can be moved with `DOCKER_EDITOR_PORT`, `DOCKER_TABLE_PORT` and `DOCKER_SERVER_PORT`. The Discord bot (`--profile bot`, needs `bot/.env`) and the Cloudflare Tunnel (`--profile public`, needs `TUNNEL_TOKEN`) are opt-in.

The server limits wrong guesses (invite codes, the admin pass) per visitor address. Each web container has two entrances for that: port `80`, published to your LAN, counts the connecting address and ignores any address headers; port `8080`, reachable only inside Docker, is for the tunnel and counts the address Cloudflare reports. If you run the tunnel, point its routes at `session-client:8080` and `map-goblin:8080` — routes at port `80` keep working, but every player through the tunnel then shares one address.

## Develop

Needs Node 22 and pnpm 10 (pnpm 12 skips the native builds for better-sqlite3, sharp and esbuild).

```bash
pnpm install
pnpm dev          # server :5600, editor :5601, table :5602
pnpm -r check     # typecheck, lint and tests in every package
```

`docker compose up -d --build` builds the images from your working tree instead of pulling them.
