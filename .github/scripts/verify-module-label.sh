#!/usr/bin/env bash
set -euo pipefail

image="${1:?image reference is required}"
expected_version="${2:?expected module version is required}"
expected_release_tag="${3:?expected official release tag is required}"

# GHCR can acknowledge the multi-platform push a few seconds before the
# repository's manifest endpoint can resolve the newly-created digest.  The
# label gate must tolerate that propagation window without weakening any of
# the descriptor checks below.
manifest=""
for attempt in {1..12}; do
  if manifest="$(crane manifest "$image" 2>/dev/null)"; then
    break
  fi
  if [[ "$attempt" -eq 12 ]]; then
    echo "module label gate: image manifest was not readable after 60 seconds: $image" >&2
    exit 1
  fi
  sleep 5
done

while IFS= read -r platform_digest; do
  config="$(crane config "${image%@*}@$platform_digest")"
  descriptor="$(jq -er '.config.Labels["io.opensphere.module.descriptor"]' <<<"$config")"
  signature="$(jq -er '.config.Labels["io.opensphere.module.descriptor.signature"]' <<<"$config")"
  key_id="$(jq -er '.config.Labels["io.opensphere.module.descriptor.key-id"]' <<<"$config")"
  oci_version="$(jq -er '.config.Labels["org.opencontainers.image.version"]' <<<"$config")"
  release_tag="$(jq -er '.config.Labels["io.opensphere.release-tag"]' <<<"$config")"
  compatibility_version="$(jq -er '.config.Labels["io.opensphere.compatibility-version"]' <<<"$config")"
  channel="$(jq -er '.config.Labels["io.opensphere.channel"]' <<<"$config")"
  build_authority="$(jq -er '.config.Labels["opensphere.io/build-authority"]' <<<"$config")"
  jq -e --arg version "$expected_version" '.version == $version' <<<"$descriptor" >/dev/null
  test "$oci_version" = "$expected_release_tag"
  test "$release_tag" = "$expected_release_tag"
  test "$compatibility_version" = "$expected_version"
  test "$channel" = "ga"
  test "$build_authority" = "github-actions"
  test -n "$signature"
  test -n "$key_id"
done < <(jq -er '.manifests[] | select(.platform.os == "linux" and (.platform.architecture == "amd64" or .platform.architecture == "arm64")) | .digest' <<<"$manifest")
