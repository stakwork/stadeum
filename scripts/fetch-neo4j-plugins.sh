#!/usr/bin/env bash
# Download the Neo4j plugins sphinx-swarm installs (src/images/neo4j.rs:65-161)
# into stack/neo4j/plugins, which stack/stadeum.yml bind-mounts at /plugins.
# apoc.conf (neo4j.rs:276-294) is set as NEO4J_apoc_* env in stack/stadeum.yml:
# the neo4j entrypoint rewrites conf/apoc.conf from them, so it is not mounted.
#
# Idempotent: a jar already present is left alone. --force re-downloads.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/stack/neo4j/plugins"
FORCE="${1:-}"

APOC_CORE_URL="https://github.com/neo4j/apoc/releases/download/5.19.0/apoc-5.19.0-core.jar"
APOC_EXT_URL="https://github.com/neo4j-contrib/neo4j-apoc-procedures/releases/download/5.19.0/apoc-5.19.0-extended.jar"
GDS_URL="https://github.com/neo4j/graph-data-science/releases/download/2.9.0/neo4j-graph-data-science-2.9.0.zip"

for bin in curl zip unzip; do
  command -v "$bin" >/dev/null || { echo "missing: $bin" >&2; exit 1; }
done

mkdir -p "$DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

need() { [ "$FORCE" = "--force" ] || [ ! -s "$DIR/$1" ]; }

fetch() { echo "=> $2"; curl -fsSL --retry 3 -o "$1" "$2"; }

if need apoc-5.19.0-core.jar; then
  fetch "$TMP/apoc-core.jar" "$APOC_CORE_URL"
  # APOC core bundles a stale commons-lang3 (3.12.0) that shadows Neo4j's and
  # breaks startup while reading apoc.conf (NoSuchMethodError). Strip it, as
  # neo4j.rs strip_bundled_lang3 does.
  zip -q -d "$TMP/apoc-core.jar" 'org/apache/commons/lang3/*' 'META-INF/maven/org.apache.commons/commons-lang3/*'
  if unzip -l "$TMP/apoc-core.jar" | grep -q 'org/apache/commons/lang3/'; then
    echo "commons-lang3 still present in apoc core" >&2; exit 1
  fi
  mv "$TMP/apoc-core.jar" "$DIR/apoc-5.19.0-core.jar"
fi

if need apoc-5.19.0-extended.jar; then
  fetch "$TMP/apoc-ext.jar" "$APOC_EXT_URL"
  mv "$TMP/apoc-ext.jar" "$DIR/apoc-5.19.0-extended.jar"
fi

if need neo4j-graph-data-science-2.9.0.jar; then
  # The release asset is a zip holding the jar. (sphinx-swarm saves the zip
  # itself under a .jar name; the GDS it actually loads comes from
  # NEO4J_PLUGINS. Stadeum unpacks the real jar and drops NEO4J_PLUGINS.)
  fetch "$TMP/gds.zip" "$GDS_URL"
  unzip -q -o "$TMP/gds.zip" -d "$TMP/gds"
  jar="$(find "$TMP/gds" -name 'neo4j-graph-data-science-2.9.0*.jar' | head -1)"
  [ -n "$jar" ] || { echo "no GDS jar in $GDS_URL" >&2; exit 1; }
  mv "$jar" "$DIR/neo4j-graph-data-science-2.9.0.jar"
fi

ls -l "$DIR"
