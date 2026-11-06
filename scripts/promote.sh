#!/usr/bin/env bash
# Moves `stable` to main's newest images, for strut or for stadeum, which is
# what a box follows in its upkeep window. It runs that repository's promote
# workflow (strut's promote-image.yml, stadeum's promote-images.yml), waits
# for it, and checks the tags moved.
#
#   scripts/promote.sh strut|stadeum [commit] [--dry-run]
#
# It promotes the newest images at or before COMMIT (main's newest without
# one): each repository builds an image only when what goes into it changed.
# Without a commit it refuses while main's images are still being published,
# or when the newest publish failed: `stable` would move to an older image
# than main's. strut's workflow also moves strut-browser:stable to the
# Playwright version that commit pins. --dry-run says what would move, and
# stops. Needs gh (signed in, allowed to run the workflow), curl and jq.
set -euo pipefail

usage() { echo "usage: $0 strut|stadeum [commit] [--dry-run]" >&2; exit 2; }

project="" commit="" dry_run=""
for arg in "$@"; do
  case "$arg" in
    -n | --dry-run) dry_run=1 ;;
    -*) usage ;;
    *)
      if [ -z "$project" ]; then project=$arg
      elif [ -z "$commit" ]; then commit=$arg
      else usage; fi ;;
  esac
done

case "$project" in
  strut) repo=stakwork/strut promote=promote-image.yml publish=publish-image.yml images=(strut) ;;
  stadeum) repo=stakwork/stadeum promote=promote-images.yml publish=publish-images.yml images=(stadeum-ui stadeum-ops) ;;
  *) usage ;;
esac

for tool in gh curl jq; do
  command -v "$tool" > /dev/null || { echo "$tool is not installed" >&2; exit 1; }
done

# ghcr.io answers anonymous pulls of these public images.
token() { curl -fsS "https://ghcr.io/token?scope=repository:stakwork/$1:pull" | jq -r .token; }
digest() { # IMAGE TAG TOKEN: the tag's digest, or nothing when there is no such tag
  curl -fsSI -H "Authorization: Bearer $3" \
    -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' \
    "https://ghcr.io/v2/stakwork/$1/manifests/$2" 2> /dev/null |
    tr -d '\r' | awk 'tolower($1) == "docker-content-digest:" { print $2 }' || true
}

if [ -n "$commit" ]; then
  start=$(gh api "repos/$repo/commits/$commit" --jq .sha 2> /dev/null) ||
    { echo "no commit '$commit' in $repo" >&2; exit 1; }
  case "$(gh api "repos/$repo/compare/$start...main" --jq .status)" in
    ahead | identical) ;;
    *) echo "$commit is not on $repo's main: only main's images are published" >&2; exit 1 ;;
  esac
else
  runs=$(gh run list -R "$repo" --workflow "$publish" --branch main --limit 10 \
    --json databaseId,status,conclusion,headSha,url)
  busy=$(jq -r 'map(select(.status != "completed")) | first // empty | "\(.headSha[:7]) \(.databaseId)"' <<< "$runs")
  if [ -n "$busy" ]; then
    echo "main's images are still being published (${busy% *}). Wait for it, then run this again:" >&2
    echo "  gh run watch ${busy#* } -R $repo" >&2
    exit 1
  fi
  failed=$(jq -r '.[0] // empty | select(.conclusion != "success") | "\(.headSha[:7]), ended \(.conclusion): \(.url)"' <<< "$runs")
  if [ -n "$failed" ]; then
    echo "main's newest publish, at $failed" >&2
    echo "Fix it, or name an older commit to promote." >&2
    exit 1
  fi
  start=main
fi

# Main's commits from START, newest first, with their subjects.
commits=$(gh api "repos/$repo/commits?sha=$start&per_page=100" --jq '.[] | "\(.sha) \(.commit.message | split("\n")[0])"')
head_sha=${commits%% *}

# For each image, the newest commit that has one: what the workflow will promote.
from=() want=() have=() moves=""
for i in "${!images[@]}"; do
  image=${images[$i]} tok=$(token "${images[$i]}")
  while read -r sha subject; do
    d=$(digest "$image" "${sha::7}" "$tok")
    if [ -n "$d" ]; then
      from[i]="${sha::7} $subject" want[i]=$d
      break
    fi
  done <<< "$commits"
  if [ -z "${want[i]:-}" ]; then
    echo "no ghcr.io/stakwork/$image image at or before ${head_sha::7} in the last 100 commits" >&2
    exit 1
  fi
  have[i]=$(digest "$image" stable "$tok")
  [ "${have[i]}" = "${want[i]}" ] || moves=1
done

for i in "${!images[@]}"; do
  if [ "${have[i]}" = "${want[i]}" ]; then state="already stable"; else state="stable moves here"; fi
  printf '%-12s %s (%s)\n' "${images[$i]}" "${from[i]}" "$state"
done
if [ -z "$moves" ]; then
  echo "$project's stable is already main's newest: nothing to promote."
  exit 0
fi
[ -z "$dry_run" ] || exit 0

# strut's workflow wants the commit its image was built at; stadeum's finds
# each image at or before the commit it is given.
if [ "$project" = strut ]; then dispatch=${from[0]%% *}; else dispatch=$head_sha; fi
out=$(gh workflow run "$promote" -R "$repo" --ref main -f commit="$dispatch" -f channel=stable 2>&1) ||
  { echo "$out" >&2; exit 1; }
run=$(grep -oE 'runs/[0-9]+' <<< "$out" | head -1 | cut -d/ -f2 || true)
if [ -z "$run" ]; then
  echo "$out"
  echo "started: follow it at https://github.com/$repo/actions/workflows/$promote"
  exit 0
fi
echo "promoting: https://github.com/$repo/actions/runs/$run"
if ! gh run watch "$run" -R "$repo" --exit-status --compact; then
  echo "the promote failed: https://github.com/$repo/actions/runs/$run" >&2
  exit 1
fi

for i in "${!images[@]}"; do
  now=$(digest "${images[$i]}" stable "$(token "${images[$i]}")")
  if [ "$now" != "${want[i]}" ]; then
    echo "ghcr.io/stakwork/${images[$i]}:stable is ${now:-missing}, not ${want[i]}" >&2
    exit 1
  fi
  echo "ghcr.io/stakwork/${images[$i]}:stable → ${from[i]%% *} ($now)"
done
