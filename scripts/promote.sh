#!/usr/bin/env bash
# Moves a `stable` channel, which is what a box follows in its upkeep window:
# strut's or stadeum's to main's newest images, the Sphinx daemon's (the
# treasury) to stakwork/sphinx master's newest, sphinx-voice's to its newest
# release. It runs that repository's promote workflow (strut's
# promote-image.yml, stadeum's promote-images.yml, sphinx's
# promote-daemon.yml, sphinx-voice's promote-image.yml), waits for it, and
# checks the tags moved.
#
#   scripts/promote.sh strut|stadeum|daemon [commit] [--dry-run]
#   scripts/promote.sh voice [version] [--dry-run]
#
# strut, stadeum and daemon: it promotes the newest images at or before
# COMMIT (the default branch's newest without one: main, or master for
# stakwork/sphinx): each repository builds an image only when what goes into
# it changed. Without a commit it refuses while the branch's images are
# still being published, or when the newest publish failed: `stable` would
# move to an older image than the branch's. strut's workflow also moves
# strut-browser:stable to the Playwright version that commit pins.
#
# voice: sphinx-voice's images are its releases' (sphinxlightning/sphinx-voice
# on Docker Hub, built when a GitHub Release is published). It promotes
# VERSION (0.43 or v0.43), or the newest release, and without one refuses
# while that release's image is still being built, or when its build failed.
# The workflow refuses an image without both amd64 and arm64.
#
# --dry-run says what would move, and stops. Needs gh (signed in, allowed to
# run the workflow), curl and jq.
set -euo pipefail

usage() {
  echo "usage: $0 strut|stadeum|daemon [commit] [--dry-run]" >&2
  echo "       $0 voice [version] [--dry-run]" >&2
  exit 2
}

project="" at="" dry_run=""
for arg in "$@"; do
  case "$arg" in
    -n | --dry-run) dry_run=1 ;;
    -*) usage ;;
    *)
      if [ -z "$project" ]; then project=$arg
      elif [ -z "$at" ]; then at=$arg
      else usage; fi ;;
  esac
done

case "$project" in
  strut) repo=stakwork/strut branch=main promote=promote-image.yml publish=publish-image.yml images=(strut) ;;
  stadeum) repo=stakwork/stadeum branch=main promote=promote-images.yml publish=publish-images.yml images=(stadeum-ui stadeum-ops) ;;
  daemon) repo=stakwork/sphinx branch=master promote=promote-daemon.yml publish=publish-daemon.yml images=(sphinx-daemon) ;;
  voice) repo=stakwork/sphinx-voice branch=main promote=promote-image.yml publish=docker-release.yml images=(sphinx-voice) ;;
  *) usage ;;
esac

for tool in gh curl jq; do
  command -v "$tool" > /dev/null || { echo "$tool is not installed" >&2; exit 1; }
done

# The registries answer anonymous pulls of these public images: ghcr.io
# strut's, stadeum's and the daemon's, Docker Hub sphinx-voice's.
if [ "$project" = voice ]; then
  owner=sphinxlightning api=registry-1.docker.io
  token() { curl -fsS "https://auth.docker.io/token?service=registry.docker.io&scope=repository:$owner/$1:pull" | jq -r .token; }
  name() { echo "$owner/$1"; }
else
  owner=stakwork api=ghcr.io
  token() { curl -fsS "https://ghcr.io/token?scope=repository:$owner/$1:pull" | jq -r .token; }
  name() { echo "ghcr.io/$owner/$1"; }
fi
digest() { # IMAGE TAG TOKEN: the tag's digest, or nothing when there is no such tag
  curl -fsSI -H "Authorization: Bearer $3" \
    -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' \
    "https://$api/v2/$owner/$1/manifests/$2" 2> /dev/null |
    tr -d '\r' | awk 'tolower($1) == "docker-content-digest:" { print $2 }' || true
}

from=() want=() have=() moves=""

if [ "$project" = voice ]; then
  if [ -n "$at" ]; then
    version=${at#v}
  else
    tag=$(gh release list -R "$repo" --exclude-drafts --exclude-pre-releases --limit 1 --json tagName --jq '.[0].tagName // empty')
    [ -n "$tag" ] || { echo "$repo has no release" >&2; exit 1; }
    version=${tag#v}
    # Its image is built when the release is published.
    build=$(gh run list -R "$repo" --workflow "$publish" --event release --limit 20 \
      --json headBranch,status,conclusion,databaseId,url |
      jq -r --arg tag "$tag" 'map(select(.headBranch == $tag)) | first // empty | "\(.status) \(.conclusion) \(.databaseId) \(.url)"')
    case "$build" in
      "") ;; # built some other way: the image's digest below says whether it is there
      completed\ success\ *) ;;
      completed\ *)
        echo "the image of $tag, its newest release, was not built: ${build##* }" >&2
        echo "Fix it, or name an older version to promote." >&2
        exit 1 ;;
      *)
        id=${build#* * }
        echo "the image of $tag, its newest release, is still being built. Wait for it, then run this again:" >&2
        echo "  gh run watch ${id%% *} -R $repo" >&2
        exit 1 ;;
    esac
  fi
  tok=$(token sphinx-voice)
  want[0]=$(digest sphinx-voice "$version" "$tok")
  if [ -z "${want[0]}" ]; then
    echo "no $(name sphinx-voice):$version image: publish the release v$version first" >&2
    exit 1
  fi
  from[0]="$version (release v$version)"
  have[0]=$(digest sphinx-voice stable "$tok")
  [ "${have[0]}" = "${want[0]}" ] || moves=1
else
  if [ -n "$at" ]; then
    start=$(gh api "repos/$repo/commits/$at" --jq .sha 2> /dev/null) ||
      { echo "no commit '$at' in $repo" >&2; exit 1; }
    case "$(gh api "repos/$repo/compare/$start...$branch" --jq .status)" in
      ahead | identical) ;;
      *) echo "$at is not on $repo's $branch: only $branch's images are published" >&2; exit 1 ;;
    esac
  else
    runs=$(gh run list -R "$repo" --workflow "$publish" --branch "$branch" --limit 10 \
      --json databaseId,status,conclusion,headSha,url)
    # Only runs newer than the newest finished one count: a run left queued
    # behind newer finished ones (GitHub keeps such ghosts, and will not
    # cancel them) publishes nothing.
    busy=$(jq -r '(map(.status == "completed") | index(true)) as $done | .[0:($done // length)] | map(select(.status != "completed")) | first // empty | "\(.headSha[:7]) \(.databaseId)"' <<< "$runs")
    if [ -n "$busy" ]; then
      echo "$branch's images are still being published (${busy% *}). Wait for it, then run this again:" >&2
      echo "  gh run watch ${busy#* } -R $repo" >&2
      exit 1
    fi
    failed=$(jq -r 'map(select(.status == "completed")) | first // empty | select(.conclusion != "success") | "\(.headSha[:7]), ended \(.conclusion): \(.url)"' <<< "$runs")
    if [ -n "$failed" ]; then
      echo "$branch's newest publish, at $failed" >&2
      echo "Fix it, or name an older commit to promote." >&2
      exit 1
    fi
    start=$branch
  fi

  # The branch's commits from START, newest first, with their subjects.
  commits=$(gh api "repos/$repo/commits?sha=$start&per_page=100" --jq '.[] | "\(.sha) \(.commit.message | split("\n")[0])"')
  head_sha=${commits%% *}

  # For each image, the newest commit that has one: what the workflow will promote.
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
      echo "no $(name "$image") image at or before ${head_sha::7} in the last 100 commits" >&2
      exit 1
    fi
    have[i]=$(digest "$image" stable "$tok")
    [ "${have[i]}" = "${want[i]}" ] || moves=1
  done
fi

for i in "${!images[@]}"; do
  if [ "${have[i]}" = "${want[i]}" ]; then state="already stable"; else state="stable moves here"; fi
  printf '%-12s %s (%s)\n' "${images[$i]}" "${from[i]}" "$state"
done
if [ -z "$moves" ]; then
  echo "$project's stable is already there: nothing to promote."
  exit 0
fi
[ -z "$dry_run" ] || exit 0

# strut's and the daemon's workflows want the commit the image was built at;
# stadeum's finds each image at or before the commit it is given;
# sphinx-voice's takes the release's version.
case "$project" in
  strut | daemon) inputs=(-f commit="${from[0]%% *}") ;;
  stadeum) inputs=(-f commit="$head_sha") ;;
  voice) inputs=(-f version="$version") ;;
esac
out=$(gh workflow run "$promote" -R "$repo" --ref "$branch" "${inputs[@]}" -f channel=stable 2>&1) ||
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
    echo "$(name "${images[$i]}"):stable is ${now:-missing}, not ${want[i]}" >&2
    exit 1
  fi
  echo "$(name "${images[$i]}"):stable → ${from[i]%% *} ($now)"
done
