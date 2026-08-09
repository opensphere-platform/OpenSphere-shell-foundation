[CmdletBinding()]
param(
  [string]$Namespace = 'opensphere-foundation'
)

$ErrorActionPreference = 'Stop'

function New-RandomUrlSecret([int]$ByteLength) {
  $bytes = [byte[]]::new($ByteLength)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function New-RandomHex([int]$ByteLength) {
  $bytes = [byte[]]::new($ByteLength)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return [Convert]::ToHexString($bytes)
}

function Decode-SecretValue($Secret, [string]$Key) {
  $encoded = $Secret.data.$Key
  if (-not $encoded) { return '' }
  return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
}

$existing = kubectl --context docker-desktop -n $Namespace get secret rustfs-credentials -o json 2>$null
if ($LASTEXITCODE -eq 0 -and $existing) {
  $secret = $existing | ConvertFrom-Json
  $accessKey = Decode-SecretValue $secret 'access_key'
  $secretKey = Decode-SecretValue $secret 'secret_key'
  if (-not $accessKey -or -not $secretKey) {
    throw "$Namespace/rustfs-credentials is missing access_key or secret_key; refusing credential replacement."
  }
  $rpcSecret = Decode-SecretValue $secret 'rpc_secret'
  $endpoint = Decode-SecretValue $secret 'endpoint'
  if (-not $rpcSecret) { $rpcSecret = New-RandomUrlSecret 48 }
  if (-not $endpoint) { $endpoint = "opensphere-rustfs.$Namespace.svc:9000" }
  if ($secretKey -eq $rpcSecret) { throw 'RustFS root secret and RPC secret must be distinct' }

  $manifest = [ordered]@{
    apiVersion = 'v1'
    kind = 'Secret'
    metadata = [ordered]@{ name = 'rustfs-credentials'; namespace = $Namespace; labels = [ordered]@{ 'opensphere.io/foundation-module' = 'rustfs' } }
    type = 'Opaque'
    stringData = [ordered]@{ access_key = $accessKey; secret_key = $secretKey; rpc_secret = $rpcSecret; endpoint = $endpoint }
  }
  $manifest | ConvertTo-Json -Depth 8 -Compress | kubectl --context docker-desktop apply -f - | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Failed to upgrade the existing RustFS credential Secret' }
  Write-Output "$Namespace/rustfs-credentials already existed; current keys were preserved and missing contract fields were added."
  exit 0
}

$accessKey = 'OSP' + (New-RandomHex 12).Substring(0, 17)
$secretKey = New-RandomUrlSecret 36
$rpcSecret = New-RandomUrlSecret 48
if ($secretKey -eq $rpcSecret) {
  throw 'RustFS root secret and RPC secret must be distinct'
}

$manifest = kubectl --context docker-desktop -n $Namespace create secret generic rustfs-credentials `
  --from-literal="access_key=$accessKey" `
  --from-literal="secret_key=$secretKey" `
  --from-literal="rpc_secret=$rpcSecret" `
  --from-literal="endpoint=opensphere-rustfs.$Namespace.svc:9000" `
  --dry-run=client -o yaml
if ($LASTEXITCODE -ne 0) {
  throw 'Failed to render the RustFS credential Secret'
}
$manifest | kubectl --context docker-desktop apply -f -
if ($LASTEXITCODE -ne 0) {
  throw 'Failed to apply the RustFS credential Secret'
}
kubectl --context docker-desktop -n $Namespace label secret rustfs-credentials opensphere.io/foundation-module=rustfs --overwrite | Out-Null
Write-Output "RustFS credentials are installed in Namespace $Namespace. Secret values were not printed."
