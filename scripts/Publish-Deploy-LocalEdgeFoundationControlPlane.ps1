#requires -Version 7.2

[CmdletBinding()]
param(
  [string]$Registry = 'ghcr.io/opensphere-platform',
  [switch]$UseExistingRegistryLogin,
  [switch]$Deploy
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-Checked {
  if ($args.Count -lt 1) { throw 'Invoke-Checked requires an executable.' }
  $program = [string]$args[0]
  $arguments = @($args | Select-Object -Skip 1)
  $result = & $program @arguments
  if ($LASTEXITCODE -ne 0) { throw "$program failed with exit code $LASTEXITCODE" }
  return $result
}

function Get-RemoteDigest {
  param([Parameter(Mandatory)][string]$Reference)
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & docker buildx imagetools inspect $Reference 2>$null
    $exitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousPreference }
  if ($exitCode -ne 0) { return $null }
  $line = $output | Where-Object { $_ -match '^Digest:\s+(sha256:[0-9a-f]{64})$' } | Select-Object -First 1
  if (-not $line) { throw "Could not parse registry digest for $Reference" }
  return ([regex]::Match($line, 'sha256:[0-9a-f]{64}')).Value
}

function Set-RemoteTag {
  param(
    [Parameter(Mandatory)][string]$Repository,
    [Parameter(Mandatory)][string]$Digest,
    [Parameter(Mandatory)][string]$Tag,
    [switch]$Immutable
  )
  $reference = "${Repository}:$Tag"
  $existing = Get-RemoteDigest -Reference $reference
  if ($Immutable -and $existing -and $existing -ne $Digest) {
    throw "Immutable tag collision: $reference is $existing, expected $Digest"
  }
  if ($existing -ne $Digest) {
    Invoke-Checked docker buildx imagetools create --prefer-index=false --tag $reference "${Repository}@${Digest}" | Out-Null
  }
  if ((Get-RemoteDigest -Reference $reference) -ne $Digest) { throw "Tag verification failed: $reference" }
}

if ($env:OS -ne 'Windows_NT') { throw 'Foundation control-plane local edge requires Windows.' }
if (((Invoke-Checked kubectl config current-context) -join '').Trim() -ne 'docker-desktop') {
  throw 'Foundation control-plane local edge requires Kubernetes context docker-desktop.'
}
$dockerOs = ((Invoke-Checked docker info --format '{{.OSType}}') -join '').Trim().ToLowerInvariant()
$dockerArch = ((Invoke-Checked docker info --format '{{.Architecture}}') -join '').Trim().ToLowerInvariant()
if ($dockerOs -ne 'linux' -or $dockerArch -notin @('amd64', 'x86_64')) {
  throw "Foundation control-plane local edge requires linux/amd64; received $dockerOs/$dockerArch"
}
if ($Registry -cne 'ghcr.io/opensphere-platform') { throw 'Registry must be the canonical OpenSphere GHCR namespace.' }

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$origin = ((Invoke-Checked git -C $repoRoot remote get-url origin) -join '').TrimEnd('/')
if ($origin -cne 'https://github.com/opensphere-platform/OpenSphere-shell-foundation.git') {
  throw 'Foundation origin is not canonical.'
}
if (((Invoke-Checked git -C $repoRoot branch --show-current) -join '').Trim() -cne 'main') {
  throw 'Foundation control-plane local edge runs only from canonical main.'
}
if (Invoke-Checked git -C $repoRoot status --porcelain=v1 --untracked-files=all) {
  throw 'Foundation main must be completely clean before publishing.'
}
Invoke-Checked git -C $repoRoot fetch --prune origin main | Out-Null
$sourceRevision = ((Invoke-Checked git -C $repoRoot rev-parse HEAD) -join '').Trim()
$originMain = ((Invoke-Checked git -C $repoRoot rev-parse refs/remotes/origin/main) -join '').Trim()
if ($sourceRevision -notmatch '^[a-f0-9]{40}$' -or $sourceRevision -cne $originMain) {
  throw 'Foundation main must equal fresh origin/main.'
}

$liveImage = ((Invoke-Checked kubectl -n opensphere-system get deployment foundation-control-plane `
  -o 'jsonpath={.spec.template.spec.containers[?(@.name=="manager")].image}') -join '').Trim()
if ($liveImage -notmatch '^ghcr\.io/opensphere-platform/opensphere-foundation-control-plane@sha256:[a-f0-9]{64}$') {
  throw 'Live Foundation control plane is not pinned to its canonical exact digest.'
}
$liveImageConfig = (Invoke-Checked docker buildx imagetools inspect --format '{{json .Image}}' $liveImage) -join "`n" | ConvertFrom-Json
$baseRevision = [string]$liveImageConfig.config.Labels.'io.opensphere.source-revision'
if ($baseRevision -notmatch '^[a-f0-9]{40}$') { throw 'Live control-plane image has no canonical source revision.' }
Invoke-Checked git -C $repoRoot fetch --no-tags origin $baseRevision | Out-Null
$changedPaths = @(Invoke-Checked git -C $repoRoot diff --name-only $baseRevision $sourceRevision -- `
  backend/control-plane bootstrap/opensearch-cluster.yaml scripts/Publish-Deploy-LocalEdgeFoundationControlPlane.ps1 | Where-Object { $_ })
if (-not $changedPaths.Count) { throw 'Foundation control-plane publication has no component source delta.' }

$epoch = [long](((Invoke-Checked git -C $repoRoot show -s --format=%ct $sourceRevision) -join '').Trim())
$releaseTag = [DateTimeOffset]::FromUnixTimeSeconds($epoch).ToOffset([TimeSpan]::FromHours(9)).ToString('yyyyMMddHHmm')
$repository = "$Registry/opensphere-foundation-control-plane"
$buildTag = "build-$($sourceRevision.Substring(0,12))"
$outputRootBase = Join-Path (Split-Path $repoRoot -Parent) ".codex-tmp\foundation-control-plane-edge-$($sourceRevision.Substring(0,12))"
$outputRoot = if (Test-Path -LiteralPath $outputRootBase) {
  "$outputRootBase-retry-$([DateTimeOffset]::UtcNow.ToString('yyyyMMddHHmmss'))"
} else { $outputRootBase }
$metadataFile = Join-Path $outputRoot 'metadata.json'
New-Item -ItemType Directory -Path $outputRoot | Out-Null

$controlPlane = Join-Path $repoRoot 'backend\control-plane'
$goImage = 'docker.io/library/golang:1.25-alpine@sha256:56961d79ea8129efddcc0b8643fd8a5416b4e6228cfd477e3fd61deb2672c587'
Invoke-Checked docker run --rm -v "${controlPlane}:/src" -w /src $goImage sh -ec `
  'test -z "$(gofmt -l *.go)" && GOFLAGS=-mod=readonly go test ./...' | Out-Null

if (-not $UseExistingRegistryLogin) {
  $token = ((Invoke-Checked gh auth token) -join '').Trim()
  try {
    $token | docker login ghcr.io -u opensphere-platform --password-stdin | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'GHCR login failed.' }
  } finally { $token = $null }
}

$arguments = @(
  'buildx','build','--platform','linux/amd64','--push','--provenance=mode=max',
  '--metadata-file',$metadataFile,'--tag',"${repository}:$buildTag",
  '--label','io.opensphere.channel=edge',
  '--label','io.opensphere.image-platform=linux/amd64',
  '--label',"io.opensphere.source-revision=$sourceRevision",
  '--label',"io.opensphere.release-tag=$releaseTag",
  '--label',"org.opencontainers.image.version=$releaseTag",
  '--label',"org.opencontainers.image.revision=$sourceRevision",
  '--label','org.opencontainers.image.source=https://github.com/opensphere-platform/OpenSphere-shell-foundation',
  '--label','opensphere.io/build-authority=localhost',
  '--label','opensphere.io/release-class=pre-ga',
  '--label','opensphere.io/ga-eligible=false',
  '--build-arg',"OS_RELEASE_TAG=$releaseTag",
  '--build-arg',"OS_SOURCE_REVISION=$sourceRevision",
  '--file',(Join-Path $controlPlane 'Dockerfile'),$controlPlane
)
Invoke-Checked docker @arguments | Out-Null
$digest = [string](Get-Content -Raw -LiteralPath $metadataFile | ConvertFrom-Json).'containerimage.digest'
if ($digest -notmatch '^sha256:[a-f0-9]{64}$') { throw 'Control-plane build did not produce an exact digest.' }
Set-RemoteTag -Repository $repository -Digest $digest -Tag $releaseTag -Immutable
Set-RemoteTag -Repository $repository -Digest $digest -Tag edge

$publication = [ordered]@{
  apiVersion = 'release.opensphere.io/v1alpha1'
  kind = 'OpenSphereEdgeComponentPublication'
  channel = 'edge'
  status = 'Active'
  requestIntent = 'Publish and optionally deploy the Foundation control-plane component required by the current local-edge repair.'
  changedPaths = @($changedPaths | Sort-Object -Unique)
  affectedImages = @($repository)
  releaseScope = 'component'
  fullReleaseJustification = $null
  releaseTag = $releaseTag
  source = 'https://github.com/opensphere-platform/OpenSphere-shell-foundation'
  sourceRevision = $sourceRevision
  buildAuthority = 'localhost'
  gaEligible = $false
  supportedPlatforms = @('linux/amd64')
  image = "${repository}@${digest}"
  verification = [ordered]@{ gofmt = 'PASS'; goTest = 'PASS'; exactDigest = $digest }
}

if ($Deploy) {
  Invoke-Checked kubectl -n opensphere-system set image deployment/foundation-control-plane `
    "manager=${repository}@${digest}" | Out-Null
  Invoke-Checked kubectl -n opensphere-system rollout status deployment/foundation-control-plane --timeout=5m | Out-Null
  $observed = ((Invoke-Checked kubectl -n opensphere-system get deployment foundation-control-plane `
    -o 'jsonpath={.spec.template.spec.containers[?(@.name=="manager")].image}') -join '').Trim()
  if ($observed -cne "${repository}@${digest}") { throw 'Foundation control-plane rollout did not retain the exact published digest.' }
  $publication.deployment = [ordered]@{
    namespace = 'opensphere-system'
    workload = 'deployment/foundation-control-plane'
    container = 'manager'
    image = $observed
    rollout = 'PASS'
    observedAt = [DateTimeOffset]::UtcNow.ToString('o')
  }
}

$evidencePath = Join-Path $outputRoot 'opensphere-foundation-control-plane-publication.json'
$publication | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $evidencePath -Encoding utf8
Write-Host '[success] Foundation control-plane component local edge completed'
Write-Host "[version] $releaseTag"
Write-Host "[digest] ${repository}@${digest}"
Write-Host "[deployed] $([bool]$Deploy)"
Write-Host "[evidence] $evidencePath"
Write-Output $evidencePath
