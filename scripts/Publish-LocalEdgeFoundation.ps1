#requires -Version 7.2

[CmdletBinding()]
param(
  [string]$Registry = 'ghcr.io/opensphere-platform',
  [string]$SdkSourcePath = 'D:\@PROJECT\OpenSphere\OpenSphere-SDK',
  [string]$SigningKey = (Join-Path $env:USERPROFILE '.opensphere\keys\edge-local-v1-p256.pem'),
  [string]$SigningKeyId = 'opensphere-edge-local-v1',
  [switch]$UseExistingRegistryLogin
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
  } finally {
    $ErrorActionPreference = $previousPreference
  }
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
  if ((Get-RemoteDigest -Reference $reference) -ne $Digest) {
    throw "Tag verification failed: $reference"
  }
}

if ($env:OS -ne 'Windows_NT') { throw 'Foundation edge publishing requires Windows.' }
if (((Invoke-Checked kubectl config current-context) -join '').Trim() -ne 'docker-desktop') {
  throw 'Foundation edge publishing requires Kubernetes context docker-desktop.'
}
$dockerOs = ((Invoke-Checked docker info --format '{{.OSType}}') -join '').Trim().ToLowerInvariant()
$dockerArch = ((Invoke-Checked docker info --format '{{.Architecture}}') -join '').Trim().ToLowerInvariant()
if ($dockerOs -ne 'linux' -or $dockerArch -notin @('amd64', 'x86_64')) {
  throw "Foundation edge publishing requires Linux containers on amd64; received $dockerOs/$dockerArch"
}
if ($Registry -cne 'ghcr.io/opensphere-platform') { throw 'Registry must be the canonical OpenSphere GHCR namespace.' }
if (-not (Test-Path -LiteralPath $SigningKey -PathType Leaf)) { throw 'The local edge signing key does not exist.' }

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$origin = ((Invoke-Checked git -C $repoRoot remote get-url origin) -join '').TrimEnd('/')
if ($origin -cne 'https://github.com/opensphere-platform/OpenSphere-shell-foundation.git') {
  throw 'Foundation origin is not canonical.'
}
if (((Invoke-Checked git -C $repoRoot branch --show-current) -join '').Trim() -cne 'main') {
  throw 'Foundation edge publishing runs only from canonical main.'
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

$sdkRoot = (Resolve-Path -LiteralPath $SdkSourcePath).Path
if (((Invoke-Checked git -C $sdkRoot remote get-url origin) -join '').TrimEnd('/') -cne 'https://github.com/opensphere-platform/OpenSphere-SDK.git') {
  throw 'SDK origin is not canonical.'
}
if (Invoke-Checked git -C $sdkRoot status --porcelain=v1 --untracked-files=all) { throw 'SDK source must be clean.' }
$sdkRevision = ((Invoke-Checked git -C $sdkRoot rev-parse HEAD) -join '').Trim()
if ($sdkRevision -notmatch '^[a-f0-9]{40}$' -or -not (Test-Path -LiteralPath (Join-Path $sdkRoot 'dist\index.js'))) {
  throw 'SDK source must resolve to a built canonical revision.'
}

$livePackage = (Invoke-Checked kubectl -n opensphere-console get uipluginpackage foundation -o json) -join "`n" | ConvertFrom-Json
$liveDigest = [string]$livePackage.spec.image.digest
if ($liveDigest -notmatch '^sha256:[a-f0-9]{64}$') { throw 'Live Foundation package is not exact-digest pinned.' }
$repository = "$Registry/opensphere-shell-foundation"
$liveImage = "${repository}@$liveDigest"
$liveImageJson = (Invoke-Checked docker buildx imagetools inspect --format '{{json .Image}}' $liveImage) -join "`n" | ConvertFrom-Json
$baseRevision = [string]$liveImageJson.config.Labels.'io.opensphere.source-revision'
if ($baseRevision -notmatch '^[a-f0-9]{40}$') { throw 'Live Foundation image has no canonical source revision.' }
Invoke-Checked git -C $repoRoot fetch --no-tags origin $baseRevision | Out-Null
$changedPaths = @(Invoke-Checked git -C $repoRoot diff --name-only $baseRevision $sourceRevision | Where-Object { $_ })
if (-not $changedPaths.Count) { throw 'Foundation publication has no source delta.' }

$epoch = [long](((Invoke-Checked git -C $repoRoot show -s --format=%ct $sourceRevision) -join '').Trim())
$releaseTag = [DateTimeOffset]::FromUnixTimeSeconds($epoch).ToOffset([TimeSpan]::FromHours(9)).ToString('yyyyMMddHHmm')
$buildTag = "build-$($sourceRevision.Substring(0,12))"
$outputRootBase = Join-Path (Split-Path $repoRoot -Parent) ".codex-tmp\foundation-edge-$($sourceRevision.Substring(0,12))"
$outputRoot = if (Test-Path -LiteralPath $outputRootBase) {
  "$outputRootBase-retry-$([DateTimeOffset]::UtcNow.ToString('yyyyMMddHHmmss'))"
} else { $outputRootBase }
$buildRoot = Join-Path ([IO.Path]::GetTempPath()) "opensphere-foundation-edge-$([Guid]::NewGuid().ToString('N'))"
$checkout = Join-Path $buildRoot 'OpenSphere-shell-foundation'
$metadataFile = Join-Path $buildRoot 'metadata.json'
New-Item -ItemType Directory -Path $buildRoot, $outputRoot | Out-Null

try {
  Invoke-Checked git -C $repoRoot worktree add --detach $checkout $sourceRevision | Out-Null
  Invoke-Checked npm --prefix $checkout ci --ignore-scripts --no-audit --no-fund | Out-Null
  Invoke-Checked npm --prefix $checkout run build | Out-Null
  Invoke-Checked node --test (Join-Path $checkout 'test\view-router.test.ts') | Out-Null

  $env:DUPA_SIGNING_KEY = $SigningKey
  $env:DUPA_SIGNING_KEY_ID = $SigningKeyId
  $env:OPENSPHERE_SDK = $sdkRoot
  Invoke-Checked npm --prefix $checkout run package:module | Out-Null
  $descriptor = (Get-Content -Raw -LiteralPath (Join-Path $checkout 'module-package.json')).Trim()
  $signature = (Get-Content -Raw -LiteralPath (Join-Path $checkout 'module-package.json.sig')).Trim()

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
    '--build-arg',"OS_MODULE_DESCRIPTOR=$descriptor",
    '--build-arg',"OS_MODULE_SIGNATURE=$signature",
    '--build-arg',"OS_RELEASE_TAG=$releaseTag",
    '--build-arg',"OS_SOURCE_REVISION=$sourceRevision",
    '--build-arg',"OS_MODULE_KEY_ID=$SigningKeyId",
    '--file',(Join-Path $checkout 'Dockerfile'),$checkout
  )
  Invoke-Checked docker @arguments | Out-Null
  $digest = [string](Get-Content -Raw -LiteralPath $metadataFile | ConvertFrom-Json).'containerimage.digest'
  if ($digest -notmatch '^sha256:[a-f0-9]{64}$') { throw 'Foundation build did not produce an exact digest.' }
  Set-RemoteTag -Repository $repository -Digest $digest -Tag $releaseTag -Immutable
  Set-RemoteTag -Repository $repository -Digest $digest -Tag edge

  $publication = [ordered]@{
    apiVersion = 'release.opensphere.io/v1alpha1'
    kind = 'OpenSphereEdgeExtensionPublication'
    channel = 'edge'
    status = 'Active'
    requestIntent = 'Publish the Foundation subShell component required by the current local-edge release.'
    changedPaths = @($changedPaths | Sort-Object -Unique)
    affectedImages = @($repository)
    releaseScope = 'component'
    fullReleaseJustification = $null
    releaseTag = $releaseTag
    source = 'https://github.com/opensphere-platform/OpenSphere-shell-foundation'
    sourceRevision = $sourceRevision
    sdkSourceRevision = $sdkRevision
    buildAuthority = 'localhost'
    gaEligible = $false
    supportedPlatforms = @('linux/amd64')
    image = "${repository}@${digest}"
    trustKeyId = $SigningKeyId
    verification = [ordered]@{ productionBuild = 'PASS'; routingTests = 'PASS'; signedModulePackage = 'PASS'; exactDigest = $digest }
  }
  $evidencePath = Join-Path $outputRoot 'opensphere-foundation-publication.json'
  $publication | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $evidencePath -Encoding utf8
  Write-Host '[success] Foundation-only local edge publication completed'
  Write-Host "[version] $releaseTag"
  Write-Host "[digest] ${repository}@${digest}"
  Write-Host "[evidence] $evidencePath"
  Write-Output $evidencePath
} finally {
  Remove-Item Env:DUPA_SIGNING_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:DUPA_SIGNING_KEY_ID -ErrorAction SilentlyContinue
  Remove-Item Env:OPENSPHERE_SDK -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $checkout) {
    & git -C $repoRoot worktree remove --force $checkout 2>$null | Out-Null
  }
  $resolvedBuildRoot = [IO.Path]::GetFullPath($buildRoot)
  $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if ($resolvedBuildRoot.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -and
      (Split-Path $resolvedBuildRoot -Leaf) -like 'opensphere-foundation-edge-*' -and
      (Test-Path -LiteralPath $resolvedBuildRoot)) {
    Remove-Item -LiteralPath $resolvedBuildRoot -Recurse -Force
  }
}
