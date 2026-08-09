param(
  [string]$Namespace = 'opensphere-foundation',
  [string]$SecretName = 'foundation-communication-runtime'
)

$ErrorActionPreference = 'Stop'

function New-RandomUrlToken([int]$ByteCount) {
  $bytes = New-Object byte[] $ByteCount
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
}

function New-RandomAlphaNumeric([int]$Length) {
  $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  $bytes = New-Object byte[] $Length
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $chars = for ($i = 0; $i -lt $Length; $i++) { $alphabet[$bytes[$i] % $alphabet.Length] }
  return -join $chars
}

function Read-SecretValue([string]$Key) {
  $encoded = kubectl --context docker-desktop -n $Namespace get secret $SecretName -o "jsonpath={.data.$Key}"
  if ($LASTEXITCODE -ne 0 -or -not $encoded) {
    throw "$Namespace/$SecretName exists without required data.$Key; refusing to rotate or invent a partial runtime contract."
  }
  return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
}

$existing = kubectl --context docker-desktop -n $Namespace get secret $SecretName -o name 2>$null
if ($LASTEXITCODE -eq 0 -and $existing) {
  $recoveryEncoded = kubectl --context docker-desktop -n $Namespace get secret $SecretName -o jsonpath='{.data.stalwart-recovery-admin}'
  $userEncoded = kubectl --context docker-desktop -n $Namespace get secret $SecretName -o jsonpath='{.data.stalwart-admin-user}'
  $passwordEncoded = kubectl --context docker-desktop -n $Namespace get secret $SecretName -o jsonpath='{.data.stalwart-admin-password}'
  if ($recoveryEncoded -and $userEncoded -and $passwordEncoded) {
    Write-Host "$Namespace/$SecretName already contains the complete runtime contract; no credential was changed."
    exit 0
  }
  if (-not $recoveryEncoded) {
    throw "$Namespace/$SecretName exists without stalwart-recovery-admin; refusing to invent a replacement credential."
  }
  $stalwartRecoveryAdmin = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($recoveryEncoded))
  $separator = $stalwartRecoveryAdmin.IndexOf(':')
  if ($separator -lt 1 -or $separator -eq ($stalwartRecoveryAdmin.Length - 1)) {
    throw "$Namespace/$SecretName has an invalid stalwart-recovery-admin."
  }
  $stalwartAdminUser = $stalwartRecoveryAdmin.Substring(0, $separator)
  $stalwartAdminPassword = $stalwartRecoveryAdmin.Substring($separator + 1)
  $novuJWTSecret = Read-SecretValue 'novu-jwt-secret'
  $novuEncryptionKey = Read-SecretValue 'novu-encryption-key'
  $novuSecretKey = Read-SecretValue 'novu-secret-key'
} else {
  $stalwartAdminUser = 'opensphere-recovery'
  $stalwartAdminPassword = New-RandomUrlToken 32
  $stalwartRecoveryAdmin = $stalwartAdminUser + ':' + $stalwartAdminPassword
  $novuJWTSecret = New-RandomUrlToken 48
  $novuEncryptionKey = New-RandomAlphaNumeric 32
  $novuSecretKey = New-RandomUrlToken 48
}

kubectl --context docker-desktop -n $Namespace create secret generic $SecretName `
  --from-literal="stalwart-recovery-admin=$stalwartRecoveryAdmin" `
  --from-literal="stalwart-admin-user=$stalwartAdminUser" `
  --from-literal="stalwart-admin-password=$stalwartAdminPassword" `
  --from-literal="novu-jwt-secret=$novuJWTSecret" `
  --from-literal="novu-encryption-key=$novuEncryptionKey" `
  --from-literal="novu-secret-key=$novuSecretKey" `
  --dry-run=client -o yaml | kubectl --context docker-desktop apply -f - | Out-Null

Write-Host "$Namespace/$SecretName created. Credential values were not printed."
