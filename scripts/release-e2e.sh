#!/usr/bin/env bash
# Proves a release reaches a running box, and comes back off it when it
# fails (AGENTS.md rule 7). On a box of its own (project
# stadeum-release-e2e, port 8091) with a registry on localhost:5055 standing
# in for ghcr.io, four releases of stadeum-ops (and stadeum-ui) go out:
#
#   r1  this checkout. The box gets r1's stack files from the ops image, as
#       scripts/install.sh gets them, and a local.yml of its own: plain http
#       on its port, the dev login, the registry's images, strut held where
#       it is. It comes up healthy.
#   r2  a Caddy route, a setting on stadeum-ui, a new Caddy pin, and new
#       stadeum-ui and ops images. An update applies it all; .env and
#       local.yml are untouched.
#   r3  r2 with a broken Caddyfile: the update puts r2's files and images back.
#   r4  r2 with a new Neo4j: the update holds the whole release. Upgrade
#       Neo4j (the request the Updates page's button files) backs up first,
#       then applies it.
#
#   scripts/release-e2e.sh
#
# Each update is an admin's Update now, filed in stadeum-ui's database as
# the page files it. CONFIRM=page waits at r4 for someone to set a backup
# destination and press Upgrade Neo4j at http://stadeum.localhost:8091
# (the dev login) instead. KEEP=1 leaves it all up. The gateway's image is
# amd64 only: on an arm64 machine without amd64 emulation,
# E2E_BIFROST_IMAGE names an arm64 build of it, which the box's local.yml
# pins.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT=stadeum-release-e2e
PORT="${E2E_HTTP_PORT:-8091}"
REG="localhost:${E2E_REGISTRY_PORT:-5055}"
REGISTRY="$PROJECT-registry"
BOX="$(mktemp -d)"
BUILD="$(mktemp -d)"
NEO4J_NEXT=neo4j:5.26.33-e2e

say() { printf '\n== %s\n' "$*"; }
ok() { printf 'ok   %s\n' "$*"; }
fail() {
  printf 'FAIL %s\n' "$*" >&2
  exit 1
}
compose() { docker compose -p "$PROJECT" --env-file "$BOX/.env" -f "$BOX/stack/stadeum.yml" -f "$BOX/stack/local.yml" "$@"; }

# install.sh's own unpack: the release an ops image carries.
# shellcheck disable=SC2034 # read by unpack
RELEASE_DIR=/usr/local/share/stadeum
eval "$(sed -n '/^unpack() {/,/^}/p' "$ROOT/scripts/install.sh")"

cleanup() {
  if [ "${KEEP:-}" = 1 ]; then
    echo "KEEP=1: left $PROJECT, its registry and the box at $BOX"
    return
  fi
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  docker rm -f "$PROJECT-ops-handover" "$REGISTRY" >/dev/null 2>&1 || true
  # The containers wrote some of it (backups/, on Linux as root).
  docker run --rm -v "$BOX:/box" --entrypoint sh "$REG/stadeum-ops:e2e-r1" -c 'rm -rf /box/* /box/.env' >/dev/null 2>&1 || true
  rm -rf "$BOX" "$BUILD"
  docker images --format '{{.Repository}}:{{.Tag}}' | grep -E "^$REG/(stadeum-ops|stadeum-ui|caddy):" | xargs -r docker rmi -f >/dev/null 2>&1 || true
  docker rmi "$NEO4J_NEXT" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Run JS in stadeum-ui, with its database as `db`; what it returns is printed (JSON).
ui() {
  compose exec -T stadeum-ui node -e "
    const { PrismaClient } = require('@prisma/client');
    const db = new PrismaClient();
    (async () => { $1 })().then((r) => { if (r !== undefined) console.log(typeof r === 'string' ? r : JSON.stringify(r)); return db.\$disconnect(); });
  "
}
last_update() { ui "const e = await db.opsEvent.findFirst({ where: { kind: 'update' }, orderBy: { createdAt: 'desc' } }); return e ? e.id + ' ' + e.outcome + ' ' + e.detail : '-';" 2>/dev/null || echo "?"; }
release_status() { ui "const s = await db.opsStatus.findUnique({ where: { id: 'ops' } }); return s ? JSON.parse(s.state).release ?? {} : {};"; }

# Wait until the history has an update newer than $1, and no hand-over runs.
wait_update() {
  local before=$1 now
  for _ in $(seq 1 180); do
    now=$(last_update)
    if [ "$now" != "?" ] && [ "${now%% *}" != "${before%% *}" ] && [ -z "$(docker ps -q --filter "name=^$PROJECT-ops-handover$")" ]; then
      printf '%s\n' "${now#* }"
      return 0
    fi
    sleep 5
  done
  fail "no update recorded in 15 minutes (last: $now)"
}

ask() { ui "await db.opsRequest.create({ data: { kind: '$1'${2:+, target: '$2'} } });"; }

healthy() {
  local bad
  bad=$(compose ps -a --format '{{.Service}} {{.State}} {{.Health}}' | awk '$1 != "bootstrap" && ($2 != "running" || $3 == "unhealthy" || $3 == "starting")')
  [ -z "$bad" ] || fail "not healthy: $bad"
  ok "every service running and healthy"
}

route() { curl -s -H "Host: stadeum.localhost" "http://127.0.0.1:$PORT/release-e2e"; }
revision() { docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$(compose ps -q "$1")"; }
image_of() { docker inspect --format '{{.Config.Image}}' "$(compose ps -q "$1")"; }

# context REV: a build context for stadeum-ops, from this checkout.
context() {
  local dir=$BUILD/$1
  mkdir -p "$dir/scripts"
  cp -R "$ROOT/ops" "$ROOT/stack" "$ROOT/.env.example" "$dir/"
  cp "$ROOT/scripts/init-env.sh" "$dir/scripts/"
  rm -rf "$dir/ops/node_modules" "$dir/ops/dist"
  printf '%s' "$dir"
}

# edit FILE AWK: rewrite a file through awk.
edit() { awk "$2" "$1" >"$1.new" && mv "$1.new" "$1"; }

# publish REV DIR [ui]: build stadeum-ops from DIR (and stadeum-ui, derived
# from r1's) as REV, and move :stable to them.
publish() {
  local rev=$1 dir=$2
  docker build -q -f "$dir/ops/Dockerfile" --build-arg "STADEUM_VERSION=$rev" \
    --label "org.opencontainers.image.revision=$rev" -t "$REG/stadeum-ops:$rev" "$dir" >/dev/null
  docker tag "$REG/stadeum-ops:$rev" "$REG/stadeum-ops:stable"
  docker push -q "$REG/stadeum-ops:stable" >/dev/null
  if [ "${3:-}" = ui ]; then
    printf 'FROM %s\nLABEL org.opencontainers.image.revision=%s\n' "$REG/stadeum-ui:e2e-r1" "$rev" |
      docker build -q -t "$REG/stadeum-ui:$rev" - >/dev/null
    docker tag "$REG/stadeum-ui:$rev" "$REG/stadeum-ui:stable"
    docker push -q "$REG/stadeum-ui:stable" >/dev/null
  fi
  ok "published $rev"
}

say "A registry on $REG"
docker run -d --name "$REGISTRY" -p "127.0.0.1:${REG#localhost:}:5000" registry:2 >/dev/null
for _ in $(seq 1 20); do curl -fs "http://$REG/v2/" >/dev/null && break || sleep 1; done

say "r1: this checkout"
docker build -q --label org.opencontainers.image.revision=e2e-r1 -t "$REG/stadeum-ui:e2e-r1" "$ROOT/ui" >/dev/null
docker tag "$REG/stadeum-ui:e2e-r1" "$REG/stadeum-ui:stable"
docker push -q "$REG/stadeum-ui:stable" >/dev/null
publish e2e-r1 "$(context e2e-r1)"

say "The box, from r1's ops image"
mkdir -p "$BOX/release"
unpack "$REG/stadeum-ops:stable" "$BOX/release" || fail "r1's ops image carries no release"
mkdir -p "$BOX/stack"
cp -R "$BOX/release/stack/." "$BOX/stack/"
"$BOX/release/scripts/init-env.sh" "$BOX/.env" >/dev/null
rm -rf "$BOX/release"
{
  echo "NEO4J_HEAP_INITIAL=512m"
  echo "NEO4J_HEAP_MAX=512m"
  echo "NEO4J_PAGECACHE=256m"
  echo "NEO4J_TX_TOTAL_MAX=256m"
  echo "NEO4J_TX_MAX=128m"
} >>"$BOX/.env"
cat >"$BOX/stack/local.yml" <<EOF
# This box's own (release-e2e): a release never writes it.
services:
  caddy:
    environment:
      SCHEME: http
    ports: !override
      - "127.0.0.1:$PORT:80"
  # strut stays on the image this machine has: the test is stadeum's release.
  strut-browser:
    labels:
      stadeum.ops.update: ""
  strut:
    labels:
      stadeum.ops.update: ""
    environment:
      STRUT_PUBLIC_URL: http://strut.stadeum.localhost:$PORT
  stadeum-ui:
    image: $REG/stadeum-ui:stable
    environment:
      AUTH_URL: http://stadeum.localhost:$PORT
      STRUT_PUBLIC_URL: http://strut.stadeum.localhost:$PORT
      STADEUM_DEV_LOGIN: "1"
  ops:
    image: $REG/stadeum-ops:stable
EOF
if [ -n "${E2E_BIFROST_IMAGE:-}" ]; then
  printf '  bifrost:\n    image: %s\n' "$E2E_BIFROST_IMAGE" >>"$BOX/stack/local.yml"
fi
cp "$BOX/stack/local.yml" "$BUILD/local.yml"
cp "$BOX/.env" "$BUILD/env"
compose up -d --wait --wait-timeout 900 >/dev/null
healthy
[ "$(revision ops)" = e2e-r1 ] && ok "ops runs r1"
# Updates only when asked: the nightly window must not run in the middle.
ui "await db.opsSettings.upsert({ where: { id: 'ops' }, create: { id: 'ops', updatesEnabled: false }, update: { updatesEnabled: false } });"

say "r2: a Caddy route, a setting on stadeum-ui, a new Caddy pin, new images"
R2=$(context e2e-r2)
edit "$R2/stack/caddy/Caddyfile" '{ print } /respond \/api\/ops\/\* 404/ { print "\trespond /release-e2e \"r2\" 200" }'
edit "$R2/stack/stadeum.yml" '{ print } /^  stadeum-ui:/ { ui = 1 } ui && /^      PORT: "3000"/ { print "      STADEUM_RELEASE_E2E: r2"; ui = 0 }'
edit "$R2/stack/stadeum.yml" "{ sub(/image: caddy:2\\.11\\.8-alpine/, \"image: $REG/caddy:2.11.8-e2e\"); print }"
grep -q "$REG/caddy:2.11.8-e2e" "$R2/stack/stadeum.yml" && grep -q STADEUM_RELEASE_E2E "$R2/stack/stadeum.yml" || fail "r2's edits did not land"
# The new pin is in the registry and not on the box: ops must pull it.
docker tag caddy:2.11.8-alpine "$REG/caddy:2.11.8-e2e"
docker push -q "$REG/caddy:2.11.8-e2e" >/dev/null
docker rmi "$REG/caddy:2.11.8-e2e" >/dev/null
publish e2e-r2 "$R2" ui
before=$(last_update)
ask update
echo "update: $(wait_update "$before")"
[ "$(route)" = r2 ] && ok "Caddy serves r2's route" || fail "Caddy's route: $(route)"
docker inspect --format '{{json .Config.Env}}' "$(compose ps -q stadeum-ui)" | grep -q 'STADEUM_RELEASE_E2E=r2' && ok "stadeum-ui has r2's setting" || fail "stadeum-ui lacks r2's setting"
[ "$(revision ops)" = e2e-r2 ] && [ "$(revision stadeum-ui)" = e2e-r2 ] && ok "ops and stadeum-ui run r2's images" || fail "images: ops $(revision ops), ui $(revision stadeum-ui)"
[ "$(image_of caddy)" = "$REG/caddy:2.11.8-e2e" ] && ok "Caddy moved to r2's pin, pulled by ops" || fail "caddy runs $(image_of caddy)"
cmp -s "$BOX/stack/local.yml" "$BUILD/local.yml" && cmp -s "$BOX/.env" "$BUILD/env" && ok "local.yml and .env untouched" || fail "local.yml or .env changed"
cmp -s "$BOX/stack/stadeum.yml" "$R2/stack/stadeum.yml" && cmp -s "$BOX/stack/caddy/Caddyfile" "$R2/stack/caddy/Caddyfile" && ok "the box has r2's stack files" || fail "the stack files are not r2's"
healthy

say "r3: r2 with a broken Caddyfile"
R3=$(context e2e-r3)
cp -R "$R2/stack/." "$R3/stack/"
printf '\n{$SCHEME}://broken.{$HOST} {\n\trespond "unclosed"\n' >>"$R3/stack/caddy/Caddyfile"
publish e2e-r3 "$R3"
before=$(last_update)
ask update
result=$(wait_update "$before")
echo "update: $result"
case "$result" in rolled-back*) ok "rolled back" ;; *) fail "expected a rollback" ;; esac
cmp -s "$BOX/stack/caddy/Caddyfile" "$R2/stack/caddy/Caddyfile" && cmp -s "$BOX/stack/stadeum.yml" "$R2/stack/stadeum.yml" && ok "r2's stack files are back" || fail "the stack files are not r2's"
[ "$(revision ops)" = e2e-r2 ] && ok "ops runs r2's image again" || fail "ops runs $(revision ops)"
[ "$(docker image inspect --format '{{.Id}}' "$REG/stadeum-ops:stable")" = "$(docker image inspect --format '{{.Id}}' "$REG/stadeum-ops:e2e-r2")" ] && ok "stadeum-ops:stable names r2's image on the box" || fail "the tag was not put back"
[ "$(route)" = r2 ] && ok "Caddy serves r2's route" || fail "Caddy's route: $(route)"
healthy

say "r4: r2 with a new Neo4j"
docker tag neo4j:5.26.32 "$NEO4J_NEXT"
R4=$(context e2e-r4)
cp -R "$R2/stack/." "$R4/stack/"
edit "$R4/stack/stadeum.yml" "{ sub(/image: neo4j:5\\.26\\.32/, \"image: $NEO4J_NEXT\"); print }"
publish e2e-r4 "$R4"
before=$(last_update)
ask update
result=$(wait_update "$before")
echo "update: $result"
case "$result" in "skipped A release is waiting"*) ok "held" ;; *) fail "expected the release to be held" ;; esac
[ "$(image_of neo4j)" = neo4j:5.26.32 ] && [ "$(revision ops)" = e2e-r2 ] && ok "nothing moved: Neo4j 5.26.32, ops r2" || fail "something moved"
cmp -s "$BOX/stack/stadeum.yml" "$R2/stack/stadeum.yml" && ok "the stack files are still r2's" || fail "the stack files changed"
held=$(release_status)
echo "release: $held"
grep -q '"held":\[{"service":"neo4j","from":"neo4j:5.26.32","to":"'"$NEO4J_NEXT"'"}\]' <<<"$held" && ok "the Updates page shows the hold" || fail "no hold in the status"

before=$(last_update)
if [ "${CONFIRM:-}" = page ]; then
  say "Waiting for Upgrade Neo4j at http://stadeum.localhost:$PORT/updates (set a backup destination first, on Backups: /backups/e2e)"
else
  # What the Backups page saves for a folder on the box, encrypted as it encrypts.
  ui "
    const { createCipheriv, randomBytes } = require('node:crypto');
    const raw = process.env.STADEUM_ENCRYPTION_KEY;
    const key = /^[0-9a-fA-F]{64}\$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    const enc = (field, text) => {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      c.setAAD(Buffer.from(field, 'utf8'));
      const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
      return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
    };
    const data = { backupKind: 'local', backupFields: JSON.stringify({ path: '/backups/e2e' }), backupSecretsEnc: enc('backupSecrets', '{}'), resticPasswordEnc: enc('resticPassword', randomBytes(24).toString('base64url')), backupsEnabled: false };
    await db.opsSettings.update({ where: { id: 'ops' }, data });
  "
  ask confirm "$NEO4J_NEXT"
fi
result=$(wait_update "$before")
echo "update: $result"
case "$result" in ok*) ok "applied" ;; *) fail "expected the upgrade to apply" ;; esac
ui "const e = await db.opsEvent.findFirst({ where: { kind: 'backup' }, orderBy: { createdAt: 'desc' } }); return e ? e.outcome + ' ' + e.detail : '-';" | grep -q '^ok Snapshot' && ok "a backup was taken first" || fail "no backup before the upgrade"
[ "$(image_of neo4j)" = "$NEO4J_NEXT" ] && ok "Neo4j runs $NEO4J_NEXT" || fail "Neo4j runs $(image_of neo4j)"
[ "$(revision ops)" = e2e-r4 ] && ok "ops runs r4" || fail "ops runs $(revision ops)"
healthy

say "A release reached the box, came back off it, and waited for an admin"
