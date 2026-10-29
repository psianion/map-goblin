#!/usr/bin/env bash
# Brings up a throwaway copy of the stack and checks, end to end, that the game server
# counts each request against the right address (see session/client/nginx.conf):
#
#   - through :80, the LAN entrance, address claims in headers change nothing;
#   - through :8080, the tunnel entrance, CF-Connecting-IP is the address that is counted;
#   - a whole party joining from one address is never rate limited;
#   - the game server's host port is bound to loopback and :8080 is not published at all.
#
# Everything runs under its own project name, image tag, volumes and host ports, so it
# can run next to a live stack and leaves nothing behind. CI runs it on every PR.
set -euo pipefail
cd "$(dirname "$0")/.."

export COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-map-goblin-smoke}
export MAP_GOBLIN_TAG=${MAP_GOBLIN_TAG:-smoke}
export DOCKER_SERVER_PORT=${DOCKER_SERVER_PORT:-5630}
export DOCKER_EDITOR_PORT=${DOCKER_EDITOR_PORT:-5631}
export DOCKER_TABLE_PORT=${DOCKER_TABLE_PORT:-5632}
# Git Bash would otherwise rewrite container paths like /etc/nginx/... into Windows ones.
export MSYS_NO_PATHCONV=1

CURL_IMAGE=curlimages/curl:8.23.0
PROBE=${COMPOSE_PROJECT_NAME}-probe

cleanup() {
  docker rm -f "$PROBE" >/dev/null 2>&1 || true
  docker compose down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

# ─── nginx -t on both configs, before spending minutes on a build ────────────
# Static upstreams are resolved at config test, hence the host entry.
for conf in nginx.conf session/client/nginx.conf; do
  docker run --rm --add-host game-server:127.0.0.1 \
    -v "$(pwd -W 2>/dev/null || pwd)/$conf:/etc/nginx/conf.d/default.conf:ro" \
    nginx:alpine nginx -t >/dev/null 2>&1 || fail "nginx -t: $conf"
  pass "nginx -t $conf"
done

# ─── Up ───────────────────────────────────────────────────────────────────────
docker compose up -d --build
for _ in $(seq 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$DOCKER_SERVER_PORT/api/resolve/ZZZZZZ" || true)
  [ "$code" = 404 ] && break
  sleep 1
done
[ "$code" = 404 ] || fail "game-server did not come up on :$DOCKER_SERVER_PORT"

# ─── Host side ────────────────────────────────────────────────────────────────
case "$(docker compose port game-server 8787)" in
  127.0.0.1:*) pass "game-server host port is loopback only" ;;
  *) fail "game-server host port is not bound to 127.0.0.1" ;;
esac
# Asked of the engine, not `compose port`: Compose versions disagree on what that prints
# for a port that is exposed but not published. A published port lists a HostPort.
bindings() { docker inspect -f "{{index .NetworkSettings.Ports \"$2/tcp\"}}" "$(docker compose ps -q "$1")"; }
case "$(bindings session-client 8080)" in *HostPort*) fail "session-client :8080 is published: $(bindings session-client 8080)" ;; esac
case "$(bindings map-goblin 8080)" in *HostPort*) fail "map-goblin :8080 is published: $(bindings map-goblin 8080)" ;; esac
pass "the tunnel entrances are not published"
[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$DOCKER_TABLE_PORT/")" = 200 ] || fail "table :$DOCKER_TABLE_PORT"
[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$DOCKER_EDITOR_PORT/")" = 200 ] || fail "editor :$DOCKER_EDITOR_PORT"
pass "editor and table answer on the LAN ports"

# ─── Inside the Docker network ────────────────────────────────────────────────
# One long-lived probe container rather than one per request: its address must stay the
# same across the whole run, since that is the address :80 counts against.
network=$(docker inspect -f '{{range $k, $_ := .NetworkSettings.Networks}}{{$k}}{{end}}' "$(docker compose ps -q game-server)")
docker run -d --rm --name "$PROBE" --network "$network" --entrypoint sleep "$CURL_IMAGE" 600 >/dev/null
probe() { docker exec "$PROBE" curl -s "$@"; }
status() { probe -o /dev/null -w '%{http_code}' "$@"; }

# :80 — ten misses under ten different claimed addresses are still ten misses from the
# probe, and an eleventh under a fresh claim is refused.
for i in $(seq 10); do
  [ "$(status -H "X-Real-IP: 9.9.9.$i" -H "CF-Connecting-IP: 9.9.9.$i" http://session-client:80/api/resolve/ZZZZZZ)" = 404 ] \
    || fail ":80 miss $i was not a 404"
done
[ "$(status -H 'X-Real-IP: 9.9.10.1' -H 'CF-Connecting-IP: 9.9.10.1' http://session-client:80/api/resolve/ZZZZZZ)" = 429 ] \
  || fail ":80 honoured an address header"
pass ":80 ignores address headers"

# :8080 — CF-Connecting-IP is the address: one address runs out, the next is untouched.
for i in $(seq 10); do
  [ "$(status -H 'CF-Connecting-IP: 203.0.113.1' http://session-client:8080/api/resolve/ZZZZZZ)" = 404 ] \
    || fail ":8080 miss $i was not a 404"
done
[ "$(status -H 'CF-Connecting-IP: 203.0.113.1' http://session-client:8080/api/resolve/ZZZZZZ)" = 429 ] \
  || fail ":8080 did not refuse the eleventh miss"
[ "$(status -H 'CF-Connecting-IP: 203.0.113.2' http://session-client:8080/api/resolve/ZZZZZZ)" = 404 ] \
  || fail ":8080 charged a second address for the first one's misses"
pass ":8080 counts per CF-Connecting-IP"

# A party of eight joins through the tunnel from one address: sixteen correct answers.
# The campaign is created through the editor's tunnel entrance, so both proxies are
# exercised with the admin pass. It is the first-run pass this throwaway server printed.
admin=$(docker compose logs --no-log-prefix game-server | sed -n 's/.*admin pass (first run): \([A-Za-z0-9_-]*\).*/\1/p' | head -1)
[ -n "$admin" ] || fail "no admin pass in the game-server log"
field() { sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p"; }
created=$(probe -H "Authorization: $admin" -H 'content-type: application/json' -H 'CF-Connecting-IP: 203.0.113.9' \
  -d '{"name":"Smoke"}' http://map-goblin:8080/api/campaigns)
campaign=$(echo "$created" | field campaignId)
dm=$(echo "$created" | field token)
[ -n "$campaign" ] && [ -n "$dm" ] || fail "could not create a campaign through map-goblin:8080: $created"
code=$(probe -H "Authorization: Bearer $dm" -H 'content-type: application/json' -H 'CF-Connecting-IP: 203.0.113.9' \
  -d "{\"campaignId\":\"$campaign\"}" http://session-client:8080/api/sessions | field inviteCode)
[ -n "$code" ] || fail "could not open a session"
for seat in $(seq 8); do
  [ "$(status -H 'CF-Connecting-IP: 203.0.113.9' "http://session-client:8080/api/resolve/$code")" = 200 ] \
    || fail "resolve for player $seat was refused"
  [ "$(status -H 'CF-Connecting-IP: 203.0.113.9' -H 'content-type: application/json' \
      -d "{\"code\":\"$code\",\"name\":\"Player $seat\"}" http://session-client:8080/api/join)" = 200 ] \
    || fail "join for player $seat was refused"
done
pass "eight players joined from one address"

echo "smoke: all passed"
