[CmdletBinding()]
param(
  [string]$KubeContext = 'docker-desktop',
  [string]$ChartVersion = '1.19.0',
  [string]$PullSecretSourceNamespace = 'opensphere-console',
  [string]$OperatorDigest = 'sha256:919d7a9800997a63002e25c9350afd7b3a9119a41975159fd6e5880dac7e5031',
  [string]$KubectlDigest = 'sha256:df39a573c660e5f21cb73fd820b481c189abe5d9866bf2773a219d9d040c5a0d'
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$expectedChartSha256 = '355CAA7BCED88B52A57B44B3945C0F9F44F19C3A952F181D0BA5622558A0BDEB'
$operatorTag = 'ghcr.io/opensphere-platform/mirror/stackgres-operator:1.19.0'
$operatorExact = "ghcr.io/opensphere-platform/mirror/stackgres-operator@$OperatorDigest"
$kubectlTag = 'ghcr.io/opensphere-platform/mirror/ongres/kubectl:v1.33.13-build-6.53'
$kubectlExact = "ghcr.io/opensphere-platform/mirror/ongres/kubectl@$KubectlDigest"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$values = Join-Path $scriptRoot 'values-edge.yaml'

if ((kubectl config current-context).Trim() -ne $KubeContext) {
  throw "Refusing StackGres install: current kubectl context is not $KubeContext"
}
$nodeArchitectures = @(kubectl get nodes -o jsonpath='{range .items[*]}{.status.nodeInfo.architecture}{"\n"}{end}' | Sort-Object -Unique)
if ($nodeArchitectures.Count -ne 1 -or $nodeArchitectures[0] -ne 'amd64') {
  throw "StackGres edge package is linux/amd64 only; nodes=$($nodeArchitectures -join ',')"
}

$taskDir = Join-Path ([System.IO.Path]::GetTempPath()) "opensphere-stackgres-$ChartVersion"
New-Item -ItemType Directory -Path $taskDir -Force | Out-Null
$chart = Join-Path $taskDir 'stackgres-operator.tgz'
$rendered = Join-Path $taskDir 'stackgres-operator-exact.yaml'
Invoke-WebRequest -UseBasicParsing -Uri "https://stackgres.io/downloads/stackgres-k8s/stackgres/$ChartVersion/helm/stackgres-operator.tgz" -OutFile $chart
$actualChartSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $chart).Hash
if ($actualChartSha256 -ne $expectedChartSha256) {
  throw "StackGres chart checksum mismatch: expected=$expectedChartSha256 actual=$actualChartSha256"
}

$renderOutput = docker run --rm `
  -v "${taskDir}:/work" `
  -v "${scriptRoot}:/config:ro" `
  alpine/helm:3.17.3 template stackgres-operator /work/stackgres-operator.tgz `
  --namespace stackgres --include-crds -f /config/values-edge.yaml
if ($LASTEXITCODE -ne 0) { throw 'Helm rendering failed' }
$manifest = ($renderOutput -join "`n").Replace($operatorTag, $operatorExact).Replace($kubectlTag, $kubectlExact)
# `helm template` emits lifecycle hooks as ordinary YAML. kubectl must never
# execute Helm's post-delete SGConfig cleanup job during an install/update.
$manifest = ([regex]::Split($manifest, '(?m)^---\s*$') |
  Where-Object {
    $_ -notmatch 'name:\s+"?stackgres-operator-remove-sgconfig"?' -and
    $_ -notmatch 'name:\s+["'']?stackgres-operator-test-connection["'']?'
  }) -join "`n---`n"
if ($manifest.Contains('quay.io/') -or $manifest.Contains('registry.access.redhat.com/')) {
  throw 'Rendered StackGres manifest contains a direct upstream image reference'
}
if (!$manifest.Contains($operatorExact) -or !$manifest.Contains($kubectlExact)) {
  throw 'Rendered StackGres manifest is missing required exact image digests'
}
[System.IO.File]::WriteAllText($rendered, $manifest, [System.Text.UTF8Encoding]::new($false))

kubectl --context $KubeContext apply -f (Join-Path $scriptRoot 'namespace.yaml')
$sourcePullSecret = kubectl --context $KubeContext -n $PullSecretSourceNamespace get secret opensphere-ghcr-pull -o json | ConvertFrom-Json
$pullSecretProjection = [ordered]@{
  apiVersion = 'v1'; kind = 'Secret'
  metadata = [ordered]@{ name = 'opensphere-ghcr-pull'; namespace = 'stackgres'; labels = [ordered]@{ 'opensphere.io/managed-by' = 'stackgres-edge-installer' } }
  type = $sourcePullSecret.type; data = $sourcePullSecret.data
}
$pullSecretProjection | ConvertTo-Json -Depth 8 -Compress | kubectl --context $KubeContext apply -f - | Out-Null
kubectl --context $KubeContext apply --server-side --force-conflicts --field-manager=opensphere-stackgres-installer -f $rendered
kubectl --context $KubeContext wait -n stackgres --for=condition=complete job/stackgres-operator-install-sgconfig --timeout=300s
kubectl --context $KubeContext wait -n stackgres deployment/stackgres-operator --for=condition=Available --timeout=300s
kubectl --context $KubeContext get deployment,job,pod -n stackgres -o wide
