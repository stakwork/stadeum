#!/usr/bin/env bash
# Create .env from .env.example and fill the generated secrets.
# Never overwrites a value that is already set; safe to re-run.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${1:-$ROOT/.env}"

if [ ! -f "$ENV_FILE" ]; then
  cp "$ROOT/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "created $ENV_FILE"
fi

current() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }

set_if_empty() {
  local key="$1" value="$2"
  if [ -n "$(current "$key")" ]; then
    echo "kept      $key"
  elif grep -qE "^$key=" "$ENV_FILE"; then
    # Rewrite in place without sed -i (portable across BSD/GNU).
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k && !done {print k "=" v; done=1; next} {print}' \
      "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
    echo "generated $key"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
    echo "generated $key"
  fi
}

set_if_empty NEO4J_PASSWORD "$(openssl rand -hex 16)"
set_if_empty BIFROST_ADMIN_PASS "$(openssl rand -hex 16)"
set_if_empty SHARED_API_TOKEN "$(openssl rand -hex 16)"
set_if_empty STRUT_SECRET_KEY "$(openssl rand -hex 32)"
set_if_empty BROWSER_WS_PATH "$(openssl rand -hex 16)"
set_if_empty STADEUM_ENCRYPTION_KEY "$(openssl rand -hex 32)"
set_if_empty STRUT_VOICE_TOKEN "$(openssl rand -hex 32)"
set_if_empty AUTH_SECRET "$(openssl rand -base64 32)"
chmod 600 "$ENV_FILE"

echo "wrote $ENV_FILE: once the stack is up, an admin sets the provider keys on the Models page"
