[CmdletBinding()]
param(
  [string]$Namespace = 'opensphere-foundation',
  [string]$Context = 'docker-desktop'
)

$ErrorActionPreference = 'Stop'

function New-RandomHex([int]$Bytes) {
  $buffer = [byte[]]::new($Bytes)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
  return [Convert]::ToHexString($buffer).ToLowerInvariant()
}

function Get-Sha256Hex([string]$Value) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
  $hash = [System.Security.Cryptography.SHA256]::HashData($bytes)
  return [Convert]::ToHexString($hash)
}

if ((& kubectl --context $Context get namespace $Namespace --ignore-not-found -o name) -ne "namespace/$Namespace") {
  throw "Namespace/$Namespace does not exist. Install the Foundation namespace first."
}

$dbPassword = New-RandomHex 24
$adminPassword = New-RandomHex 24
$anonymousKey = New-RandomHex 32
$jwsKey = New-RandomHex 48
$aesSecret = New-RandomHex 16
$keystorePassword = New-RandomHex 16
$databaseUri = "postgresql://syncope:$dbPassword@foundation-data-pg-rw.$Namespace.svc:5432/syncope?sslmode=require"

$dbYaml = & kubectl --context $Context -n $Namespace create secret generic foundation-identity-syncope-db-auth `
  --type=kubernetes.io/basic-auth `
  --from-literal=username=syncope `
  --from-literal=password=$dbPassword `
  --from-literal=uri=$databaseUri `
  --dry-run=client -o yaml
if ($LASTEXITCODE -ne 0) { throw 'Failed to render Syncope database Secret.' }
$dbYaml | & kubectl --context $Context apply -f - | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Failed to apply Syncope database Secret.' }

$runtimeYaml = & kubectl --context $Context -n $Namespace create secret generic foundation-identity-syncope-runtime `
  --type=Opaque `
  --from-literal=admin-password-sha256=$(Get-Sha256Hex $adminPassword) `
  --from-literal=anonymous-user=opensphere-internal `
  --from-literal=anonymous-key=$anonymousKey `
  --from-literal=jws-key=$jwsKey `
  --from-literal=aes-secret=$aesSecret `
  --from-literal=keystore-password=$keystorePassword `
  --dry-run=client -o yaml
if ($LASTEXITCODE -ne 0) { throw 'Failed to render Syncope runtime Secret.' }
$runtimeYaml | & kubectl --context $Context apply -f - | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Failed to apply Syncope runtime Secret.' }

Write-Host 'Syncope prerequisite Secrets are present. Values were not printed.'
Write-Host 'The one-time administrator plaintext was deliberately discarded; direct Syncope admin login is disabled after bootstrap.'
