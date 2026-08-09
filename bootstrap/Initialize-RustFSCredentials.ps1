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

$accessKey = 'OSP' + (New-RandomHex 12).Substring(0, 17)
$secretKey = New-RandomUrlSecret 36
$rpcSecret = New-RandomUrlSecret 48
if ($secretKey -eq $rpcSecret) {
  throw 'RustFS root secret and RPC secret must be distinct'
}

$manifest = kubectl -n $Namespace create secret generic rustfs-credentials `
  --from-literal="access_key=$accessKey" `
  --from-literal="secret_key=$secretKey" `
  --from-literal="rpc_secret=$rpcSecret" `
  --from-literal="endpoint=opensphere-rustfs.$Namespace.svc:9000" `
  --dry-run=client -o yaml
if ($LASTEXITCODE -ne 0) {
  throw 'Failed to render the RustFS credential Secret'
}
$manifest | kubectl apply -f -
if ($LASTEXITCODE -ne 0) {
  throw 'Failed to apply the RustFS credential Secret'
}
kubectl -n $Namespace label secret rustfs-credentials opensphere.io/foundation-module=rustfs --overwrite | Out-Null
Write-Output "RustFS credentials are installed in Namespace $Namespace. Secret values were not printed."
