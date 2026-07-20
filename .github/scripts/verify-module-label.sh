#!/usr/bin/env bash
set -euo pipefail

image="${1:?image reference is required}"
expected_version="${2:?expected module version is required}"
manifest="$(crane manifest "$image")"

while IFS= read -r platform_digest; do
  config="$(crane config "${image%@*}@$platform_digest")"
  descriptor="$(jq -er '.config.Labels["io.opensphere.module.descriptor"]' <<<"$config")"
  signature="$(jq -er '.config.Labels["io.opensphere.module.descriptor.signature"]' <<<"$config")"
  key_id="$(jq -er '.config.Labels["io.opensphere.module.descriptor.key-id"]' <<<"$config")"
  oci_version="$(jq -er '.config.Labels["org.opencontainers.image.version"]' <<<"$config")"
  jq -e --arg version "$expected_version" '.version == $version' <<<"$descriptor" >/dev/null
  test "$oci_version" = "$expected_version"
  test -n "$signature"
  test -n "$key_id"
done < <(jq -er '.manifests[] | select(.platform.os == "linux" and (.platform.architecture == "amd64" or .platform.architecture == "arm64")) | .digest' <<<"$manifest")
