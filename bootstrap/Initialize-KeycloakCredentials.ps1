param(
  [string]$Namespace = 'opensphere-foundation',
  [string]$SecretName = 'foundation-identity-keycloak-admin'
)

$ErrorActionPreference = 'Stop'
$existing = kubectl --context docker-desktop -n $Namespace get secret $SecretName -o name 2>$null
if ($LASTEXITCODE -eq 0 -and $existing) {
  Write-Host "$Namespace/$SecretName already exists; no credential was changed."
  exit 0
}

$username = 'opensphere-admin'
$bytes = New-Object byte[] 36
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$password = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')

kubectl --context docker-desktop -n $Namespace create secret generic $SecretName `
  --from-literal="username=$username" `
  --from-literal="password=$password" `
  --dry-run=client -o yaml | kubectl --context docker-desktop apply -f - | Out-Null

Write-Host "$Namespace/$SecretName created. Credential values were not printed."
