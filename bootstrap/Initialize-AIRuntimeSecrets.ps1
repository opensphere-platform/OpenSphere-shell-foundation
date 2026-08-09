param(
  [string]$Namespace = 'opensphere-foundation',
  [string]$SecretName = 'foundation-ai-runtime'
)

$ErrorActionPreference = 'Stop'

function New-RandomUrlToken([int]$ByteCount) {
  $bytes = New-Object byte[] $ByteCount
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
}

function New-RandomHex([int]$ByteCount) {
  $bytes = New-Object byte[] $ByteCount
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return [Convert]::ToHexString($bytes).ToLowerInvariant()
}

function Read-SecretValue([string]$Key) {
  $encoded = kubectl --context docker-desktop -n $Namespace get secret $SecretName -o "jsonpath={.data.$Key}"
  if ($LASTEXITCODE -ne 0 -or -not $encoded) {
    throw "$Namespace/$SecretName exists without required data.$Key; refusing partial credential rotation."
  }
  return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
}

$existing = kubectl --context docker-desktop -n $Namespace get secret $SecretName -o name 2>$null
if ($LASTEXITCODE -eq 0 -and $existing) {
  $liteLLMMasterKey = Read-SecretValue 'litellm-master-key'
  $nextAuthSecret = Read-SecretValue 'langfuse-nextauth-secret'
  $salt = Read-SecretValue 'langfuse-salt'
  $encryptionKey = Read-SecretValue 'langfuse-encryption-key'
  $clickhousePassword = Read-SecretValue 'clickhouse-password'

  $projectEncoded = kubectl --context docker-desktop -n $Namespace get secret $SecretName -o jsonpath='{.data.langfuse-init-project-id}'
  if ($projectEncoded) {
    foreach ($key in @('langfuse-init-org-id', 'langfuse-init-org-name', 'langfuse-init-project-id', 'langfuse-init-project-name', 'langfuse-init-project-public-key', 'langfuse-init-project-secret-key')) {
      $null = Read-SecretValue $key
    }
    Write-Host "$Namespace/$SecretName already contains the complete AI runtime contract; no credential was changed."
    exit 0
  }
} else {
  $liteLLMMasterKey = 'sk-' + (New-RandomUrlToken 32)
  $nextAuthSecret = New-RandomUrlToken 48
  $salt = New-RandomUrlToken 32
  $encryptionKey = New-RandomHex 32
  $clickhousePassword = New-RandomUrlToken 32
}

$langfuseOrgID = 'opensphere'
$langfuseOrgName = 'OpenSphere'
$langfuseProjectID = 'opensphere-platform'
$langfuseProjectName = 'OpenSphere Platform'
$langfuseProjectPublicKey = 'lf_pk_' + (New-RandomUrlToken 24)
$langfuseProjectSecretKey = 'lf_sk_' + (New-RandomUrlToken 32)

kubectl --context docker-desktop -n $Namespace create secret generic $SecretName `
  --from-literal="litellm-master-key=$liteLLMMasterKey" `
  --from-literal="langfuse-nextauth-secret=$nextAuthSecret" `
  --from-literal="langfuse-salt=$salt" `
  --from-literal="langfuse-encryption-key=$encryptionKey" `
  --from-literal="clickhouse-password=$clickhousePassword" `
  --from-literal="langfuse-init-org-id=$langfuseOrgID" `
  --from-literal="langfuse-init-org-name=$langfuseOrgName" `
  --from-literal="langfuse-init-project-id=$langfuseProjectID" `
  --from-literal="langfuse-init-project-name=$langfuseProjectName" `
  --from-literal="langfuse-init-project-public-key=$langfuseProjectPublicKey" `
  --from-literal="langfuse-init-project-secret-key=$langfuseProjectSecretKey" `
  --dry-run=client -o yaml | kubectl --context docker-desktop apply -f - | Out-Null

Write-Host "$Namespace/$SecretName created or upgraded. Credential values were not printed."
