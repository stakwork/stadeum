#!/usr/bin/env bash
# The check_* functions are called by name, from setting().
# shellcheck disable=SC2329
#
# One command for a Stadeum box on a fresh Linux VM, on any cloud:
#
#   curl -fsSL https://raw.githubusercontent.com/stakwork/stadeum/main/scripts/install.sh | sudo bash
#
# or, from a clone, `sudo scripts/install.sh`. On Ubuntu 22.04, 24.04 or
# 26.04, or Debian 12 or 13, amd64 or arm64, it:
#
#   1. installs Docker Engine and its compose plugin from Docker's apt
#      repository, unless they are there;
#   2. puts a release's stack files in /opt/stadeum/stack (STADEUM_DIR):
#      stadeum-ops's image carries them. On a fresh box that is the stable
#      channel's; after, the release the box's ops runs. It makes .env with
#      the release's scripts/init-env.sh;
#   3. asks for what .env still lacks: the domain, an email for Let's
#      Encrypt, a sign-in provider and, the first time, the org's name and
#      the LiveKit keys calls need (both can be skipped).
#      Model keys are not asked for: an admin sets them on the Models page,
#      which writes them to the gateway and nowhere else (docs/models.md),
#      unless a host that pays for them gives them (STADEUM_MODEL_PROVIDERS);
#   4. checks that DNS points $HOST and strut.$HOST at this machine, which
#      the certificates need, and starts nothing until it does;
#   5. starts the stack, checks that both names answer over https, and says
#      what is left to do.
#
# The box needs no git checkout: each release brings its own stack files,
# and ops puts them in place when it applies one (docs/stack-spec.md,
# "ops"). The box's own changes go in stack/local.yml, which compose reads
# last when it is there, and .env; neither is ever written by a release.
#
# Re-running it is safe: it writes back the stack files of the release that
# runs, and starts the stack again with the same .env. It never changes a
# value .env has, and never re-pulls an image the box has: ops moves those
# in its nightly window, with a drain and a rollback. A Neo4j version change
# waits for a yes on the terminal.
#
# Restore onto a new box: save the Backups page's restore kit on it, then
#
#   curl -fsSL …/scripts/install.sh | sudo STADEUM_RESTORE=/root/restore.env bash
#
# puts the latest snapshot back (STADEUM_SNAPSHOT=<id> for another) before
# it starts: the volumes and the old box's .env. For another name than the
# old box's, pass STADEUM_HOST too. Stop the old box first: the treasury's
# account comes back too, and two boxes on one account knock each other off
# its broker.
#
# Prepare a box now and set it up later (a VM image, or a box kept ready
# to hand out):
#
#   curl -fsSL …/scripts/install.sh | sudo STADEUM_PREPARE=1 bash
#
# does steps 1 and 2 and pulls every image the release names, then stops.
# It asks nothing and starts nothing, and writes no .env: a prepared box
# holds no secret, so an image made of it is safe to copy. A later run, with
# the answers below or on a terminal, makes .env and does steps 3 to 5, as
# on a fresh box, without the long pull.
#
# A scripted install answers each question with STADEUM_ and the .env name.
# sudo drops the environment, so put them after it:
#
#   curl -fsSL …/scripts/install.sh | sudo STADEUM_HOST=stadeum1.example.com \
#     STADEUM_ACME_EMAIL=admin@example.com STADEUM_AUTH_GOOGLE_ID=… \
#     STADEUM_AUTH_GOOGLE_SECRET=… bash
#
#   STADEUM_HOST, STADEUM_ACME_EMAIL
#   STADEUM_AUTH_GOOGLE_ID, STADEUM_AUTH_GOOGLE_SECRET
#   STADEUM_AUTH_MICROSOFT_ENTRA_ID_ID, STADEUM_AUTH_MICROSOFT_ENTRA_ID_SECRET,
#   STADEUM_AUTH_MICROSOFT_ENTRA_ID_ISSUER (the issuer URL, or the tenant ID)
#   STADEUM_ADMIN_EMAIL (optional: the first admin; blank, whoever signs in
#                             first becomes admin)
#   STADEUM_ORG_NAME (optional)
#   STADEUM_LIVEKIT_API_KEY, STADEUM_LIVEKIT_API_SECRET (optional: calls stay
#                             off without them; STADEUM_LIVEKIT_URL for a
#                             LiveKit server other than the central one)
#   STADEUM_SKIP_DNS_CHECK=1  start without the DNS check, when a load
#                             balancer or proxy sits in front of the box
#   STADEUM_DIR               the box's directory (default /opt/stadeum)
#   STADEUM_PREPARE=1         prepare only (above)
#   STADEUM_MODEL_PROVIDERS   optional, never asked: the model providers a
#                             host that pays for them gives, a JSON list of
#                             { provider, key, url? } (.env.example)
#
# It refuses STADEUM_DEV_LOGIN: on a public host the password-less dev login
# lets anyone sign in as anyone, and the first to sign in becomes admin.
set -euo pipefail

DEFAULT_BOX=/opt/stadeum
OPS_IMAGE=ghcr.io/stakwork/stadeum-ops
# Where stadeum-ops's image keeps its release (ops/Dockerfile).
RELEASE_DIR=/usr/local/share/stadeum
SUPPORTED="Ubuntu 22.04, 24.04 or 26.04, or Debian 12 or 13, on amd64 or arm64"

say() { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
# Why an answer was turned down.
note() { printf '    %s\n' "$*" >&2; }
die() {
  printf '\nstadeum install: %s\n' "$*" >&2
  exit 1
}

# --- The machine ---

# shellcheck source=/dev/null
os_field() { (. /etc/os-release && printf '%s' "${!1:-}"); }

check_system() {
  [ "$(id -u)" = 0 ] || die "run it as root: curl … | sudo bash, or sudo scripts/install.sh"
  [ -r /etc/os-release ] || die "this system has no /etc/os-release; the install supports $SUPPORTED."
  OS_ID=$(os_field ID)
  OS_CODENAME=$(os_field VERSION_CODENAME)
  case "$OS_ID $(os_field VERSION_ID)" in
    "ubuntu 22.04" | "ubuntu 24.04" | "ubuntu 26.04" | "debian 12" | "debian 13") ;;
    *) die "this is $(os_field PRETTY_NAME), and the install supports $SUPPORTED. Anywhere else Docker runs, start the stack by hand: README.md, \"Run the stack\"." ;;
  esac
  ARCH=$(dpkg --print-architecture)
  case "$ARCH" in
    amd64 | arm64) ;;
    *) die "this machine is $ARCH, and the install supports $SUPPORTED." ;;
  esac
  # Questions go to the terminal: under `curl … | bash` the script is stdin.
  TTY=0
  if (: </dev/tty) 2>/dev/null; then TTY=1; fi
}

# No questions from apt or needrestart; wait out a first boot's
# unattended-upgrades rather than fail on its lock.
apt_get() {
  DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1 \
    apt-get -qq -o DPkg::Lock::Timeout=300 "$@" >/dev/null
}

install_docker() {
  step "Docker"
  local tools=() docker=()
  command -v curl >/dev/null || tools+=(curl)
  command -v openssl >/dev/null || tools+=(openssl)
  [ -e /etc/ssl/certs/ca-certificates.crt ] || tools+=(ca-certificates)
  if ! docker compose version >/dev/null 2>&1; then
    command -v docker >/dev/null || docker+=(docker-ce docker-ce-cli containerd.io)
    docker+=(docker-compose-plugin)
  fi
  if [ ${#tools[@]} -gt 0 ] || [ ${#docker[@]} -gt 0 ]; then
    say "updating the package lists"
    apt_get update
  fi
  if [ ${#tools[@]} -gt 0 ]; then
    say "installing ${tools[*]}"
    apt_get install -y --no-install-recommends "${tools[@]}"
  fi
  if [ ${#docker[@]} -gt 0 ]; then
    # Docker's own repository, as docs.docker.com/engine/install/ sets it up.
    if ! grep -rqs download.docker.com /etc/apt/sources.list /etc/apt/sources.list.d; then
      install -m 0755 -d /etc/apt/keyrings
      curl -fsSL "https://download.docker.com/linux/$OS_ID/gpg" -o /etc/apt/keyrings/docker.asc
      chmod a+r /etc/apt/keyrings/docker.asc
      printf 'Types: deb\nURIs: https://download.docker.com/linux/%s\nSuites: %s\nComponents: stable\nSigned-By: /etc/apt/keyrings/docker.asc\n' \
        "$OS_ID" "$OS_CODENAME" >/etc/apt/sources.list.d/docker.sources
      apt_get update
    fi
    say "installing ${docker[*]} from download.docker.com"
    apt_get install -y "${docker[@]}"
  fi
  if ! docker info >/dev/null 2>&1 && command -v systemctl >/dev/null; then
    systemctl enable --now docker >/dev/null 2>&1 || true
  fi
  docker info >/dev/null 2>&1 || die "Docker is installed but its daemon does not answer (systemctl status docker)."
  say "Docker $(docker version --format '{{.Server.Version}}'), compose $(docker compose version --short)"
}

# --- The release ---

locate_box() {
  BOX=${STADEUM_DIR:-$DEFAULT_BOX}
  ENV_FILE=$BOX/.env
}

# unpack IMAGE DIR: the release IMAGE carries (stack/, .env.example,
# scripts/init-env.sh), into DIR. Fails when it carries none.
unpack() {
  local c ok=1
  c=$(docker create "$1") || return 1
  if docker cp "$c:$RELEASE_DIR/." "$2" >/dev/null 2>&1 && [ -f "$2/stack/stadeum.yml" ]; then ok=0; fi
  docker rm "$c" >/dev/null
  return $ok
}

# The release the box gets: the one its ops runs, so a re-run writes back
# what ops last put in place; on a fresh box, or one older than releases,
# the channel's (STADEUM_IMAGE_TAG, default stable).
put_release() {
  step "Stack files: $BOX/stack"
  local ops tag ref
  RELEASE=$(mktemp -d)
  ops=$(docker ps -aq --filter label=com.docker.compose.project=stadeum --filter label=com.docker.compose.service=ops \
    --filter label=com.docker.compose.oneoff=False | head -n 1)
  if [ -n "$ops" ] && unpack "$(docker inspect --format '{{.Image}}' "$ops")" "$RELEASE"; then
    say "the release ops runs ($(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$ops" | cut -c1-7))"
  else
    tag=""
    [ ! -f "$ENV_FILE" ] || tag=$(env_get STADEUM_IMAGE_TAG)
    ref=$OPS_IMAGE:${tag:-stable}
    if ! docker image inspect "$ref" >/dev/null 2>&1 || ! unpack "$ref" "$RELEASE"; then
      say "pulling $ref"
      docker pull --quiet "$ref" >/dev/null || die "could not pull $ref"
      unpack "$ref" "$RELEASE" || die "$ref carries no stack files: it is older than releases. Set STADEUM_IMAGE_TAG in $ENV_FILE to a newer one."
    fi
    say "$ref"
  fi
  [ ! -e "$BOX/.git" ] || say "$BOX is a git checkout: git no longer updates it. Each release brings its own stack files."
  install -d -m 0755 "$BOX" "$BOX/stack"
  cp -R "$RELEASE/stack/." "$BOX/stack/"
}

# --- .env ---

env_get() {
  local v
  v=$(grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2-) || true
  if [[ $v == \'*\' || $v == \"*\" ]]; then v=${v:1:${#v}-2}; fi
  printf '%s' "$v"
}

# Write KEY=VALUE, in place of KEY's line, or at the end. Single-quoted when
# it needs to be: compose reads a single-quoted value as is (no `$`, no `#`).
env_set() {
  local key=$1 value=$2
  case "$value" in *"'"* | *$'\n'*) die "$key: a value with a ' or a line break cannot go in .env this way." ;; esac
  [[ $value =~ ^[A-Za-z0-9_./:@+=,-]*$ ]] || value="'$value'"
  (
    umask 077
    KEY=$key VALUE=$value awk '
      BEGIN { k = ENVIRON["KEY"]; v = ENVIRON["VALUE"] }
      index($0, k "=") == 1 { if (!done) print k "=" v; done = 1; next }
      { print }
      END { if (!done) print k "=" v }' "$ENV_FILE" >"$ENV_FILE.tmp"
  )
  mv "$ENV_FILE.tmp" "$ENV_FILE"
}

refuse_dev_login() {
  local where=""
  [ -z "${STADEUM_DEV_LOGIN:-}" ] || where="the environment"
  if [ -f "$ENV_FILE" ] && [ -n "$(env_get STADEUM_DEV_LOGIN)" ]; then where=$ENV_FILE; fi
  [ -z "$where" ] || die "STADEUM_DEV_LOGIN is set (in $where), and this install refuses it: on a public host the password-less dev login lets anyone sign in as anyone, and the first to sign in becomes admin. Remove it, and sign in with Google or Microsoft."
}

# ask VAR QUESTION [secret]: ANSWER is $VAR when set, else what the terminal
# answers (secrets unechoed), else empty.
ask() {
  local var=$1 question=$2 secret=${3:-}
  ANSWER=${!var:-}
  if [ -n "$ANSWER" ] || [ "$TTY" != 1 ]; then return 0; fi
  printf '%s: ' "$question" >/dev/tty
  if [ -n "$secret" ]; then
    IFS= read -rs ANSWER </dev/tty || die "no answer for $var"
    printf '\n' >/dev/tty
  else
    IFS= read -r ANSWER </dev/tty || die "no answer for $var"
  fi
  ANSWER=${ANSWER#"${ANSWER%%[![:space:]]*}"}
  ANSWER=${ANSWER%"${ANSWER##*[![:space:]]}"}
}

# setting KEY QUESTION CHECK [secret]: keep KEY when .env has it; else take
# STADEUM_<KEY>, or ask, until CHECK accepts ANSWER (it may tidy it, and
# notes why it does not), and write it. CHECK decides whether blank will do.
setting() {
  local key=$1 question=$2 check=$3 secret=${4:-} var=STADEUM_${1#STADEUM_}
  if [ -n "$(env_get "$key")" ]; then
    say "kept $key"
    return 0
  fi
  while :; do
    ask "$var" "$question" "$secret"
    if [[ $ANSWER == *"'"* ]]; then
      note "a value with a ' cannot go in .env this way: write it in $ENV_FILE by hand"
    elif "$check"; then
      break
    fi
    [ -z "${!var:-}" ] || die "$var is not a valid $key (above)."
    [ "$TTY" = 1 ] || die "$key is not set, and there is no terminal to ask on: pass $var=…"
  done
  if [ -z "$ANSWER" ]; then
    say "left $key blank"
  else
    env_set "$key" "$ANSWER"
    if [ -n "$secret" ]; then say "set $key"; else say "set $key=$ANSWER"; fi
  fi
}

# An optional setting is asked the first time only (and taken from the
# environment any time).
optional() {
  local var=STADEUM_${1#STADEUM_}
  if [ "$FRESH" = 1 ] || [ -n "${!var:-}" ]; then setting "$@"; fi
}

any() { :; }

given() {
  [ -n "$ANSWER" ] && return 0
  note "it is needed"
  return 1
}

check_host() {
  ANSWER=${ANSWER,,}
  ANSWER=${ANSWER#*://}
  ANSWER=${ANSWER%%/*}
  ANSWER=${ANSWER%.}
  if [ -z "$ANSWER" ]; then
    note "the box needs a domain name"
  elif [[ $ANSWER =~ ^[0-9.]+$ ]]; then
    note "a domain name, not an address: the certificates are for names"
  elif [[ $ANSWER == localhost || $ANSWER == *.localhost ]]; then
    note "a public domain name, not $ANSWER"
  elif [[ ! $ANSWER =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$ ]]; then
    note "not a domain name: $ANSWER"
  else
    return 0
  fi
  return 1
}

check_email() {
  [[ $ANSWER =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] && return 0
  note "an email address, e.g. admin@example.com"
  return 1
}

check_admin_email() {
  [ -z "$ANSWER" ] && return 0
  ANSWER=${ANSWER,,}
  check_email
}

# A JSON list: stadeum-ui reads each entry, and logs any it can't use.
check_model_providers() {
  [[ $ANSWER == \[*\] ]] && return 0
  note 'a JSON list, e.g. [{"provider":"anthropic","key":"sk-…"}]'
  return 1
}

check_google_id() {
  [[ -z $ANSWER || $ANSWER == *.apps.googleusercontent.com ]] && return 0
  note "a Google client ID ends in .apps.googleusercontent.com"
  return 1
}

check_microsoft_id() {
  [[ -z $ANSWER || $ANSWER =~ ^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$ ]] && return 0
  note "the Application (client) ID, a GUID"
  return 1
}

check_issuer() {
  if [[ $ANSWER == https://* ]]; then
    return 0
  elif [[ $ANSWER =~ ^[A-Za-z0-9.-]+$ ]]; then
    ANSWER=https://login.microsoftonline.com/$ANSWER/v2.0
    return 0
  fi
  note "the Directory (tenant) ID on the app's Overview, or https://login.microsoftonline.com/<tenant-id>/v2.0"
  return 1
}

signin_ids() { printf '%s' "$(env_get AUTH_GOOGLE_ID)$(env_get AUTH_MICROSOFT_ENTRA_ID_ID)"; }

signin_help() {
  if [ "$TTY" != 1 ] || [ -n "${SIGNIN_HELP:-}" ]; then return 0; fi
  SIGNIN_HELP=1
  say ""
  say "Sign-in: Google, Microsoft, or both (Enter skips one). Each needs an OAuth client:"
  say "  Google     console.cloud.google.com → APIs & Services → Credentials → Create"
  say "             credentials → OAuth client ID → Web application, with the redirect URI"
  say "             https://$HOST_NAME/api/auth/callback/google"
  say "  Microsoft  entra.microsoft.com → App registrations → New registration → Web,"
  say "             with the redirect URI"
  say "             https://$HOST_NAME/api/auth/callback/microsoft-entra-id"
  say "             then Certificates & secrets → New client secret"
}

# provider NAME CHECK ID SECRET [ISSUER]: its client, asked when nothing can
# sign in yet, the first time, or when the environment names one.
provider() {
  local name=$1 check=$2 id=$3 secret=$4 issuer=${5:-} var=STADEUM_$3
  if [ -z "$(env_get "$id")" ]; then
    [ "$FRESH" = 1 ] || [ -z "$(signin_ids)" ] || [ -n "${!var:-}" ] || return 0
    [ -n "${!var:-}" ] || signin_help
  fi
  setting "$id" "$name client ID" "$check"
  [ -n "$(env_get "$id")" ] || return 0
  setting "$secret" "$name client secret" given secret
  [ -z "$issuer" ] || setting "$issuer" "Microsoft Directory (tenant) ID" check_issuer
}

configure() {
  step "Settings: $ENV_FILE"
  # .env.example's HOST is a laptop's (stack/dev.yml): on a server it is unset.
  case "$(env_get HOST)" in localhost | *.localhost) env_set HOST "" ;; esac
  setting HOST "Domain name for this box (e.g. stadeum1.example.com)" check_host
  HOST_NAME=$(env_get HOST)
  setting ACME_EMAIL "Email for Let's Encrypt" check_email
  while :; do
    provider Google check_google_id AUTH_GOOGLE_ID AUTH_GOOGLE_SECRET
    provider Microsoft check_microsoft_id AUTH_MICROSOFT_ENTRA_ID_ID AUTH_MICROSOFT_ENTRA_ID_SECRET AUTH_MICROSOFT_ENTRA_ID_ISSUER
    [ -z "$(signin_ids)" ] || break
    [ "$TTY" = 1 ] || die "no sign-in provider: pass STADEUM_AUTH_GOOGLE_ID and STADEUM_AUTH_GOOGLE_SECRET, or Microsoft's STADEUM_AUTH_MICROSOFT_ENTRA_ID_*."
    note "one sign-in provider is needed: a server has no other way in"
  done
  optional STADEUM_ADMIN_EMAIL "The first admin's email (Enter: whoever signs in first becomes admin)" check_admin_email
  optional STADEUM_ORG_NAME "Your organisation's name, shown beside the logo (Enter to skip)" any
  [ -z "${STADEUM_MODEL_PROVIDERS:-}" ] || setting STADEUM_MODEL_PROVIDERS "Model providers" check_model_providers secret
  # Calls: the LiveKit server's keys. Without them the box runs with calls off.
  optional LIVEKIT_URL "LiveKit server for calls (Enter for wss://livekit.sphinx.chat)" any
  optional LIVEKIT_API_KEY "LiveKit API key for calls (Enter to skip: calls stay off)" any
  [ -z "$(env_get LIVEKIT_API_KEY)" ] || setting LIVEKIT_API_SECRET "LiveKit API secret" given secret
}

# --- DNS ---

public_ipv4() {
  local url ip
  for url in https://api.ipify.org https://ipv4.icanhazip.com; do
    ip=$(curl -4 -fsS --max-time 5 "$url" 2>/dev/null | tr -d '[:space:]') || continue
    if [[ $ip =~ ^[0-9]+(\.[0-9]+){3}$ ]]; then
      printf '%s' "$ip"
      return 0
    fi
  done
}

# A DNS answer from a public resolver, over https: what the world (and Let's
# Encrypt) sees, past /etc/hosts and any local cache.
doh() {
  curl -fsS --max-time 5 -H 'accept: application/dns-json' "https://cloudflare-dns.com/dns-query?name=$1&type=$2" 2>/dev/null ||
    curl -fsS --max-time 5 "https://dns.google/resolve?name=$1&type=$2" 2>/dev/null
}

# The addresses in a DNS answer that match PATTERN (a CNAME's is a name).
answers() { printf '%s\n' "$1" | grep -oE '"data": ?"[^"]*"' | cut -d'"' -f4 | grep -E "$2" || true; }

dns_addresses() {
  local a aaaa
  if a=$(doh "$1" A) && aaaa=$(doh "$1" AAAA); then
    { answers "$a" '^[0-9]+(\.[0-9]+){3}$'; answers "$aaaa" ':'; } | tr 'A-F' 'a-f' | sort -u
  else
    # No public resolver answers: the system's.
    getent ahosts "$1" | awk '{ print $1 }' | sort -u || true
  fi
}

# A line for each name that does not point at this machine alone.
dns_problems() {
  local mine=$1 name addrs addr wrong
  for name in "$HOST_NAME" "strut.$HOST_NAME"; do
    addrs=$(dns_addresses "$name")
    wrong=""
    for addr in $addrs; do
      grep -qxF "$addr" <<<"$mine" || wrong+=" $addr"
    done
    if [ -z "$addrs" ]; then
      printf '  %s has no address\n' "$name"
    elif [ -n "$wrong" ]; then
      printf '  %s points at%s: not this machine\n' "$name" "$wrong"
    fi
  done
}

check_dns() {
  step "DNS"
  if [ "${STADEUM_SKIP_DNS_CHECK:-}" = 1 ]; then
    say "not checked (STADEUM_SKIP_DNS_CHECK=1)"
    return 0
  fi
  local public mine problems shown=""
  public=$(public_ipv4)
  mine=$({ printf '%s\n' "$public"; hostname -I 2>/dev/null | tr ' ' '\n'; } | grep . | tr 'A-F' 'a-f' | sort -u || true)
  while :; do
    problems=$(dns_problems "$mine")
    if [ -z "$problems" ]; then
      say "$HOST_NAME and strut.$HOST_NAME point here${public:+ ($public)}"
      return 0
    fi
    if [ "$problems" != "$shown" ]; then
      say "$problems"
      if [ -z "$shown" ]; then
        say ""
        say "The certificates need both names to point at this machine. At your DNS provider, create:"
        say "  A  $HOST_NAME        ${public:-<the public IPv4 address of this machine>}"
        say "  A  strut.$HOST_NAME  ${public:-<the same address>}"
        say "and remove any other A or AAAA record on the two names."
        [ "$TTY" != 1 ] || say "Waiting for them, checking every 15 s (Ctrl-C stops; run this again later). Nothing starts until then."
      fi
      shown=$problems
    fi
    [ "$TTY" = 1 ] || die "DNS does not point here yet, so nothing was started: run this again once it does. Behind a load balancer or proxy, STADEUM_SKIP_DNS_CHECK=1 skips the check."
    sleep 15
  done
}

# --- The stack ---

# The compose files: the release's, then the box's own local.yml when it is there.
compose_files() {
  printf '%s' "-f stack/stadeum.yml"
  [ ! -f "$BOX/stack/local.yml" ] || printf '%s' " -f stack/local.yml"
}

# compose on .env alone: a variable in this shell must not override it.
# STACK_ENV names another env file (prepare's, when the box has no .env).
compose() {
  local files
  read -ra files <<<"$(compose_files)"
  (cd "$BOX" && env -i PATH="$PATH" HOME="${HOME:-/root}" docker compose --env-file "${STACK_ENV:-.env}" "${files[@]}" "$@")
}

# The command a person runs, for the messages.
compose_cmd() { printf 'cd %s && docker compose --env-file .env %s' "$BOX" "$(compose_files)"; }

# STADEUM_RESTORE: a snapshot back onto this box, before it starts.
restore() {
  [ -n "${STADEUM_RESTORE:-}" ] || return 0
  step "Restore"
  [ -f "$STADEUM_RESTORE" ] || die "STADEUM_RESTORE names no file: $STADEUM_RESTORE (the Backups page's restore kit)"
  [ -z "$(compose ps -q)" ] || die "the stack is running here: a restore is for a new box (or stop it first: $(compose_cmd) down)."
  say "The treasury's account comes back with it: stop the box this backup came from, if it still runs, or the two knock each other off the wallet's broker."
  compose run --rm --no-deps --env-from-file "$STADEUM_RESTORE" ops restore ${STADEUM_SNAPSHOT:+"$STADEUM_SNAPSHOT"} ||
    die "the restore failed (above): nothing was started."
  # The snapshot's .env names the old box: STADEUM_HOST names this one (configure checks it).
  [ -z "${STADEUM_HOST:-}" ] || env_set HOST ""
}

# Neo4j cannot open a store a newer version wrote: it moves only when a
# person says so, after a backup (AGENTS.md, rule 7).
neo4j_guard() {
  local running wanted reply
  running=$(compose ps -a --format '{{.Image}}' neo4j 2>/dev/null | head -n 1) || true
  wanted=$(compose config --images neo4j)
  if [ -z "$running" ] || [ "$running" = "$wanted" ]; then return 0; fi
  say "Neo4j would move from $running to $wanted."
  say "It cannot open a store a newer version wrote: back up first (Organisation → Backups)."
  [ "$TTY" = 1 ] || die "not started: Neo4j moves only on a yes, so run this on a terminal."
  printf 'Move Neo4j to %s now? [y/N] ' "$wanted" >/dev/tty
  IFS= read -r reply </dev/tty || reply=""
  [[ $reply == [yY]* ]] || die "not started: Neo4j stays on $running."
}

# Pull only what is missing: ops moves the rest, in its window. Each image
# must be built for this machine.
pull_images() {
  local arch img built bad=""
  arch=$(docker version --format '{{.Server.Arch}}')
  for img in $(compose config --images | sort -u); do
    if ! docker image inspect "$img" >/dev/null 2>&1; then
      say "pulling $img"
      docker pull --quiet "$img" >/dev/null || die "could not pull $img"
    fi
    built=$(docker image inspect --format '{{.Architecture}}' "$img")
    [ "$built" = "$arch" ] || bad+=" $img ($built)"
  done
  [ -z "$bad" ] || die "this machine is $arch, and these images have no $arch build:$bad. Run the box on a machine they are built for."
}

# STADEUM_PREPARE=1: the images too, then stop. A box with no .env keeps
# none: a throwaway one, with the release's defaults, names the images.
prepare() {
  local env=$ENV_FILE had=1
  if [ ! -f "$env" ]; then
    had=0
    env=$RELEASE/.env
    "$RELEASE/scripts/init-env.sh" "$env" >/dev/null
  fi
  step "Images"
  STACK_ENV=$env pull_images
  rm -rf "$RELEASE"
  step "Prepared: $BOX"
  say "Docker, the release's stack files and its images are here. Nothing was asked, started or stopped."
  [ "$had" = 1 ] || say "There is no .env yet, so nothing here is secret: an image of this machine is safe to copy."
  say "Run this again without STADEUM_PREPARE, with the answers or on a terminal, to set the box up and start it."
}

start() {
  step "Stack"
  pull_images
  neo4j_guard
  say "starting: the first start seeds the graph and fetches strut's models, a few minutes"
  compose up -d --wait ||
    die "the stack did not come up healthy. See: $(compose_cmd) ps (then … logs <service>)"
}

# Caddy on this machine answers NAME with a trusted certificate.
answers_https() {
  curl -fsS --max-time 10 -o /dev/null --resolve "$1:$HTTPS_PORT:127.0.0.1" "https://$1:$HTTPS_PORT$2" 2>/dev/null
}

check_https() {
  local i
  HTTPS_PORT=$(env_get HTTPS_PORT)
  HTTPS_PORT=${HTTPS_PORT:-443}
  say "waiting for the certificates"
  for i in $(seq 1 36); do
    if answers_https "$HOST_NAME" /api/health && answers_https "strut.$HOST_NAME" /health; then return 0; fi
    [ "$i" = 36 ] || sleep 5
  done
  return 1
}

finish() {
  local ok=1 admin
  check_https || ok=0
  if [ "$ok" = 1 ]; then
    step "Stadeum is up: https://$HOST_NAME"
  else
    step "Stadeum is running, but https://$HOST_NAME has no certificate yet"
    say "Caddy keeps trying. Open ports 80 and 443, then see what it says:"
    say "  $(compose_cmd) logs caddy"
  fi
  say ""
  say "  Register the sign-in redirect URLs, in each provider's OAuth client:"
  say "    Google     https://$HOST_NAME/api/auth/callback/google"
  say "    Microsoft  https://$HOST_NAME/api/auth/callback/microsoft-entra-id"
  say "  Keep ports 80 and 443 (TCP, and 443 UDP) open to the internet, in the cloud's"
  say "  firewall or security group: Caddy renews the certificates through them."
  admin=$(env_get STADEUM_ADMIN_EMAIL)
  if [ -n "$admin" ]; then
    say "  Sign in as $admin: that person becomes admin, and nobody else can."
  else
    say "  Sign in first: the first person to sign in becomes admin."
  fi
  if [ -n "$(env_get STADEUM_MODEL_PROVIDERS)" ]; then
    say "  The model keys are given (STADEUM_MODEL_PROVIDERS): pick the models people may use"
    say "  on Organisation → Models."
  else
    say "  Then set the model keys and the models people may use: Organisation → Models."
  fi
  say "  And set up backups: Organisation → Backups."
  say ""
  say "  The settings are in $ENV_FILE, and the box's own compose changes go in"
  say "  $BOX/stack/local.yml: a release never touches either. ops keeps the rest"
  say "  current (Organisation → Updates). Run this again to restart with them."
  [ "$ok" = 1 ] || exit 1
}

main() {
  check_system
  locate_box
  refuse_dev_login
  if [ "${STADEUM_PREPARE:-}" = 1 ] && [ -n "${STADEUM_RESTORE:-}" ]; then
    die "STADEUM_PREPARE and STADEUM_RESTORE together: a restore starts the box. Prepare first, then run again with STADEUM_RESTORE alone."
  fi
  install_docker
  put_release
  if [ "${STADEUM_PREPARE:-}" = 1 ]; then
    prepare
    return 0
  fi
  FRESH=0
  [ -f "$ENV_FILE" ] || FRESH=1
  "$RELEASE/scripts/init-env.sh" "$ENV_FILE" >/dev/null
  rm -rf "$RELEASE"
  restore
  configure
  check_dns
  start
  finish
}

# The whole script is read before anything runs: under `curl … | bash` a
# half-downloaded script must do nothing.
main "$@"
exit
