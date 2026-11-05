#!/usr/bin/env bash
# The mothership proof: run scripts/e2e/mothership-e2e.mjs in a container on
# the stack network, against bifrost and strut, with the org volume mounted
# read-only. The stack must be up (bootstrap done).
#
#   scripts/mothership-e2e.sh            # COMPOSE_PROJECT_NAME defaults to stadeum
#
# A real provider call is made only if ANTHROPIC_API_KEY is set in .env
# (bifrost holds it). Otherwise a fake Anthropic upstream in the container is
# wired into bifrost for the run and removed afterwards.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
PROJECT="${COMPOSE_PROJECT_NAME:-stadeum}"

val() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }

real=0
[ -n "$(val ANTHROPIC_API_KEY)" ] && real=1

exec docker run --rm \
  --network "${PROJECT}_default" \
  --network-alias fake-llm \
  -v "${PROJECT}_org:/org:ro" \
  -v "$ROOT/scripts/e2e:/e2e" \
  -w /e2e \
  -e SHARED_API_TOKEN="$(val SHARED_API_TOKEN)" \
  -e BIFROST_ADMIN_PASS="$(val BIFROST_ADMIN_PASS)" \
  -e STADEUM_ENCRYPTION_KEY="$(val STADEUM_ENCRYPTION_KEY)" \
  -e E2E_REAL_PROVIDER="$real" \
  -e E2E_MODEL="${E2E_MODEL:-}" \
  node:22.20.0-alpine \
  sh -c 'npm ci --no-audit --no-fund --loglevel=error >/dev/null && node mothership-e2e.mjs'
