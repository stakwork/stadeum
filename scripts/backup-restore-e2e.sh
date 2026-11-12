#!/usr/bin/env bash
# Proves a backup restores (AGENTS.md rule 8). On a stack of its own
# (stack/dev.yml, project stadeum-restore-e2e, port 8089) it:
#
#   1. puts data in each place that keeps it: a strut workflow, a stadeum-ui
#      person, a Neo4j node, and notes the treasury's account (its seed,
#      made at its first start: a real, empty account on the broker);
#   2. backs up with `ops backup` to a local restic repository, through a
#      restore kit, as the Backups page gives one;
#   3. wipes every volume and replaces .env with fresh secrets, as on a new box;
#   4. restores with `ops restore`, the documented command;
#   5. starts the stack and checks the same data came back.
#
#   scripts/backup-restore-e2e.sh
#
# strut defaults to its `stable` channel; until strut promotes one, name a
# published pair: STRUT_IMAGE_TAG=2fe953a STRUT_BROWSER_TAG=1.63.0.
# KEEP=1 leaves the stack and the repository up for a look.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PROJECT=stadeum-restore-e2e
PORT="${E2E_HTTP_PORT:-8089}"
ENV_FILE="$ROOT/.env.restore-e2e"
NAME="restore-e2e-$(date +%s)"
KIT="$(mktemp -d)/restore.env"
MARKER="kept-$(openssl rand -hex 4)"
EMAIL="restore-e2e@example.test"

compose() { docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f stack/stadeum.yml -f stack/dev.yml "$@"; }
say() { printf '\n== %s\n' "$*"; }
value() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2-; }

# A new .env, as scripts/init-env.sh makes one on a fresh box, on our port and tags.
fresh_env() {
  rm -f "$ENV_FILE"
  scripts/init-env.sh "$ENV_FILE" > /dev/null
  {
    echo "HTTP_PORT=$PORT"
    echo "STRUT_IMAGE_TAG=${STRUT_IMAGE_TAG:-}"
    echo "STRUT_BROWSER_TAG=${STRUT_BROWSER_TAG:-}"
    echo "TREASURY_TAG=${TREASURY_TAG:-}"
    # Small, beside whatever else this machine runs.
    echo "NEO4J_HEAP_INITIAL=512m"
    echo "NEO4J_HEAP_MAX=512m"
    echo "NEO4J_PAGECACHE=256m"
    echo "NEO4J_TX_TOTAL_MAX=256m"
    echo "NEO4J_TX_MAX=128m"
  } >> "$ENV_FILE"
}

cleanup() {
  if [ "${KEEP:-}" = 1 ]; then
    echo "KEEP=1: left $PROJECT running, the repository at backups/$NAME, the kit at $KIT"
    return
  fi
  compose run --rm --no-deps --entrypoint sh ops -c "rm -rf /backups/$NAME" > /dev/null 2>&1 || true
  compose down -v --remove-orphans > /dev/null 2>&1 || true
  rm -f "$ENV_FILE" "$ENV_FILE.before-restore" "$ENV_FILE.backed-up"
  rm -rf "$(dirname "$KIT")"
}
trap cleanup EXIT

strut() { curl -fsS -H "Host: strut.stadeum.localhost" -H "Authorization: Bearer $(value SHARED_API_TOKEN)" "$@"; }
cypher() { compose exec -T neo4j cypher-shell -u neo4j -p "$(value NEO4J_PASSWORD)" --format plain "$1"; }
# The treasury's account, by its public key (GET /me, the admin token).
treasury_key() {
  compose exec -T treasury node -e "
    fetch('http://127.0.0.1:8095/me', { headers: { authorization: 'Bearer ' + process.env.DAEMON_ADMIN_TOKEN } })
      .then((r) => r.json()).then((j) => console.log(j.pubkey || ''));
  "
}
person() {
  compose exec -T stadeum-ui node -e "
    const { PrismaClient } = require('@prisma/client');
    const db = new PrismaClient();
    $1.then((r) => { console.log(JSON.stringify(r)); return db.\$disconnect(); });
  "
}

say "A stack of its own on :$PORT"
fresh_env
compose up -d --build --wait

say "Data in each place that keeps it (marker $MARKER)"
strut -X POST -H 'Content-Type: application/json' "http://127.0.0.1:$PORT/workflows" \
  -d "{\"name\":\"restore-e2e\",\"description\":\"$MARKER\",\"steps\":[{\"id\":\"pause\",\"type\":\"wait\",\"config\":{\"durationMs\":1}}]}" > /dev/null
person "db.user.create({ data: { id: 'restoree2e', email: '$EMAIL', name: '$MARKER', role: 'member', actor: 'restore-e2e-restoree2e' } })" > /dev/null
cypher "CREATE (:RestoreE2E {marker: '$MARKER'})" > /dev/null
TREASURY_KEY=$(treasury_key)
[ -n "$TREASURY_KEY" ] || { echo "the treasury has no account" >&2; exit 1; }
echo "a workflow, a person, a node, and the treasury's account ${TREASURY_KEY::16}…"

say "Back up with ops, through a restore kit"
{
  echo "RESTIC_REPOSITORY=/backups/$NAME"
  echo "RESTIC_PASSWORD=$(openssl rand -base64 24)"
} > "$KIT"
compose run --rm --no-deps --env-from-file "$KIT" ops backup
cp "$ENV_FILE" "$ENV_FILE.backed-up"

say "Wipe: every volume, and .env with fresh secrets"
compose down -v --remove-orphans
fresh_env
if cmp -s "$ENV_FILE" "$ENV_FILE.backed-up"; then echo "the fresh .env should differ" >&2; exit 1; fi

say "Restore onto the empty volumes"
compose run --rm --no-deps --env-from-file "$KIT" ops restore
cmp "$ENV_FILE" "$ENV_FILE.backed-up" && echo ".env is the backed-up one"

say "Start, and check the data came back"
compose up -d --wait
fail=0
if strut "http://127.0.0.1:$PORT/workflows/restore-e2e" > /dev/null; then echo "ok   strut workflow restore-e2e"; else echo "FAIL strut workflow restore-e2e"; fail=1; fi
if person "db.user.findUnique({ where: { email: '$EMAIL' } })" | grep -q "$MARKER"; then echo "ok   stadeum-ui person $EMAIL"; else echo "FAIL stadeum-ui person $EMAIL"; fail=1; fi
if cypher "MATCH (n:RestoreE2E {marker: '$MARKER'}) RETURN count(n)" | grep -qx 1; then echo "ok   Neo4j node $MARKER"; else echo "FAIL Neo4j node $MARKER"; fail=1; fi
if [ "$(treasury_key)" = "$TREASURY_KEY" ]; then echo "ok   treasury account ${TREASURY_KEY::16}…"; else echo "FAIL treasury account ${TREASURY_KEY::16}…"; fail=1; fi
[ "$fail" = 0 ] && say "Restored: the same data came back" || { say "Restore check failed"; exit 1; }
