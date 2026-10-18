# Good Goblin on a Windows laptop — production runbook

Goal: one Windows laptop runs the whole stack (canvas, table, game server, Discord bot)
in Docker Desktop, reachable at canvas.goodgobl.in and table.goodgobl.in through a
Cloudflare Tunnel. No router ports opened, no certs on the laptop. Tailscale is for
admin access only.

## 1. Install on the laptop (in this order)

1. **BIOS:** confirm virtualization (Intel VT-x / AMD-V) is enabled. Docker Desktop won't start without it.
2. **Windows features:** `wsl --install` in an admin PowerShell, reboot. Windows 11 Home supports WSL2, which is Docker's backend.
3. **Docker Desktop** — docker.com. In Settings: General → "Start Docker Desktop when you sign in"; Resources → WSL integration on. Optional `%USERPROFILE%\.wslconfig` to cap RAM so the laptop stays usable:
   ```
   [wsl2]
   memory=8GB
   ```
4. **Git for Windows** — git-scm.com. Nothing else builds on the host: Node and pnpm run inside the images.
5. **Tailscale** — tailscale.com, sign in to the same tailnet. For remote admin either enable RDP (Settings → System → Remote Desktop) or add the **OpenSSH Server** optional feature (Settings → Apps → Optional features) so `ssh laptop-name` works over Tailscale.
6. Nothing for Cloudflare: `cloudflared` runs as a container in the compose file.

## 2. Laptop settings so it stays up

- `powercfg /change standby-timeout-ac 0` and `powercfg /change hibernate-timeout-ac 0`; lid close → Do nothing (Control Panel → Power Options → Choose what closing the lid does).
- Auto sign-in after reboot: Sysinternals **Autologon** (or `netplwiz`). Without it a Windows Update reboot leaves Docker down until someone logs in.
- Windows Update → Active hours covering game nights; pause updates for the week before a session.
- Keep it on mains, on Ethernet if possible.

## 3. Cloudflare Tunnel (one-time, in the browser)

1. Cloudflare dashboard → Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared. Name it `goblin-laptop`. Copy the tunnel **token** (long string after `--token`).
2. Public hostnames tab, add two routes:
   | Hostname | Service |
   |---|---|
   | canvas.goodgobl.in | `http://map-goblin:80` |
   | table.goodgobl.in | `http://session-client:80` |
   Cloudflare creates the DNS records. WebSockets are on by default; nothing else to change.
3. Optional: Zero Trust → Access → Applications → protect `canvas.goodgobl.in` with an email allow-list. The editor is the DM's tool; publishing already needs the admin pass, so this is belt and braces.

## 4. Compose change (DONE — on main, PR #121, commit 0c5e7e7)

`cloudflared` is a service in docker-compose.yml behind the `public` profile, so dev boxes
without a token are unaffected. It reads `TUNNEL_TOKEN` from the root `.env` and shares the
compose network, so the service names in step 3 resolve. Start it with
`docker compose --profile public up -d`.

## 5. Files to create on the laptop (all gitignored)

Repo root `.env` (compose interpolation):
```
TUNNEL_TOKEN=<from step 3>
PUBLIC_TABLE_URL=https://table.goodgobl.in
```

`bot/.env` — copy from this box (Discord token, app id, guild id, owner id, channel ids).

`bot/.env.docker` — `GOBLIN_ADMIN_PASS=<this server's admin pass>` (see step 7).

## 6. Bring the data across (recommended: keep the demo table and admin pass)

On this box, export the game-server volume — db, WAL and shm together, never the db alone:
```
docker run --rm -v map-goblin_game-server-data:/data -v D:\backups:/out alpine tar czf /out/gsdata.tgz -C /data .
docker run --rm -v map-goblin_bot-data:/data -v D:\backups:/out alpine tar czf /out/botdata.tgz -C /data .
```
Send both to the laptop (`tailscale file cp D:\backups\gsdata.tgz laptop-name:`). On the laptop, before the first `up`:
```
docker volume create map-goblin_game-server-data
docker run --rm -v map-goblin_game-server-data:/data -v C:\backups:/in alpine tar xzf /in/gsdata.tgz -C /data
```
(same for `map-goblin_bot-data`). The volume name must match `<compose project>_<volume>`, and the project name is the repo folder name, so clone into a folder called `map-goblin`.

Restoring the volume keeps the existing admin pass, HMAC secret, the Goblin Warren demo table and its invite code. Skip this step only if you want a clean server, in which case a new admin pass is printed on first boot.

## 7. First boot

```
git clone <repo> D:\map-goblin && cd D:\map-goblin
docker compose --profile public up -d --build
docker compose logs game-server
```
Fresh volume only: the log shows `admin pass (first run): …` exactly once — write it down, only the hash is stored. Put it in `bot/.env.docker`.

Check: `https://canvas.goodgobl.in` and `https://table.goodgobl.in` load from a phone on mobile data. Table → join with the demo invite code.

Bot, only after the bot on this box is stopped (two instances on one token answer every command twice):
```
docker compose --profile bot up -d bot
```

## 8. Backups (Task Scheduler, nightly)

```
docker run --rm -v map-goblin_game-server-data:/data -v C:\backups:/out alpine tar czf /out/gsdata-%DATE%.tgz -C /data .
```
Sync `C:\backups` somewhere off the laptop (OneDrive, or `tailscale file cp` to this box). Losing this volume locks the DM out of every campaign.

## 9. Updating to a new main

From here over Tailscale:
```
git pull
docker compose --profile public up -d --build
```
A full image rebuild took ~23 minutes on this box. Players on an open table get disconnected during the swap, so do it between sessions.

## Known limits

- Rate limit on join/resolve is per source address and all players arrive from the tunnel through nginx, so a whole table shares one 10-per-minute bucket. Pre-existing in Docker, not new; watch for 429s on a big table.
- Home upload bandwidth: fine for a few tables, not a fleet.
- No hostname for the bot (no inbound port) or the demo (same server, invite code). packs.goodgobl.in is a separate R2 custom-domain job, optional.
