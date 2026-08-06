[CmdletBinding()]
param([string]$KubeContext = 'docker-desktop')

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

if ((kubectl config current-context).Trim() -ne $KubeContext) {
  throw "Migration preflight requires context $KubeContext"
}

$legacy = kubectl -n opensphere-foundation get cluster.postgresql.cnpg.io foundation-data-pg -o json | ConvertFrom-Json
$legacyClaim = kubectl -n opensphere-foundation get postgresclaim.provisioning.opensphere.io foundation-data-pg-legacy -o json | ConvertFrom-Json
$plans = kubectl get addonplans.catalog.opensphere.io -o json | ConvertFrom-Json
$dedicated = kubectl get postgresclaims.provisioning.opensphere.io -A -o json | ConvertFrom-Json

$image = [string]$legacy.spec.imageName
$sourceMatch = [regex]::Match($image, 'postgresql:(?<major>[0-9]+)')
$sourceMajor = if ($sourceMatch.Success) { [int]$sourceMatch.Groups['major'].Value } else { 0 }
$availableTargetMajors = @($plans.items | Where-Object {
    $_.spec.provider -eq 'stackgres' -and $_.spec.lifecycle -eq 'Available'
  } | ForEach-Object { [int]$_.spec.postgresVersion } | Sort-Object -Unique)
$eligibleTargetMajors = @($availableTargetMajors | Where-Object { $_ -ge $sourceMajor })
$legacyReady = @($legacyClaim.status.conditions | Where-Object { $_.type -eq 'Ready' -and $_.status -eq 'True' }).Count -gt 0
$unreadyDedicated = @($dedicated.items | Where-Object {
    $_.spec.isolation -eq 'Dedicated' -and
    @($_.status.conditions | Where-Object { $_.type -eq 'Ready' -and $_.status -eq 'True' }).Count -eq 0
  } | ForEach-Object { "$($_.metadata.namespace)/$($_.metadata.name)" })

$reasons = @()
if (-not $legacyReady) { $reasons += 'LegacyClaimNotReady' }
if ($sourceMajor -eq 0) { $reasons += 'SourceMajorUnknown' }
if ($eligibleTargetMajors.Count -eq 0) { $reasons += 'SourceMajorNewerThanAvailableTargets' }
if ($unreadyDedicated.Count -gt 0) { $reasons += 'DedicatedTargetsNotReady' }

[ordered]@{
  schema = 'foundation.postgres.migration-preflight/v1'
  observedAt = [DateTimeOffset]::UtcNow.ToString('o')
  context = $KubeContext
  source = [ordered]@{
    provider = 'cloudnativepg'; namespace = 'opensphere-foundation'; name = 'foundation-data-pg'
    uid = $legacy.metadata.uid; postgresMajor = $sourceMajor; phase = $legacy.status.phase
    readyInstances = [int]$legacy.status.readyInstances; instances = [int]$legacy.spec.instances
  }
  target = [ordered]@{ provider = 'stackgres'; availablePostgresMajors = $availableTargetMajors }
  legacyRegistered = $legacyReady
  unreadyDedicatedClaims = $unreadyDedicated
  migrationEligible = $reasons.Count -eq 0
  reasons = $reasons
} | ConvertTo-Json -Depth 8
