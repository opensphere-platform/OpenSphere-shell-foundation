[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$Context = 'docker-desktop',
  [string]$Namespace = 'opensphere-foundation'
)

$ErrorActionPreference = 'Stop'
if ((kubectl config current-context) -ne $Context) {
  throw "Refusing removal: current kubectl context is not $Context"
}

$legacyClusters = @(kubectl get clusters.postgresql.cnpg.io -A -o name --ignore-not-found)
if ($legacyClusters.Count -gt 1 -or ($legacyClusters.Count -eq 1 -and $legacyClusters[0] -ne 'cluster.postgresql.cnpg.io/foundation-data-pg')) {
  throw "Unexpected legacy PostgreSQL targets: $($legacyClusters -join ', ')"
}

$stackGresReady = kubectl -n $Namespace get sgcluster pgc-platform-dev-pg -o jsonpath='{.status.conditions[?(@.type=="Bootstrapped")].status}'
if ($stackGresReady -ne 'True') {
  throw 'Refusing removal: canonical StackGres cluster is not bootstrapped'
}

if ($PSCmdlet.ShouldProcess("$Namespace/foundation-data-pg and CloudNativePG operator", 'Delete all CloudNativePG runtime and API resources')) {
  kubectl -n $Namespace delete postgresclaim foundation-data-pg-legacy --ignore-not-found --wait=true
  kubectl -n $Namespace delete database.postgresql.cnpg.io --all --ignore-not-found --wait=true
  kubectl -n $Namespace delete databaserole.postgresql.cnpg.io --all --ignore-not-found --wait=true
  kubectl -n $Namespace delete pooler.postgresql.cnpg.io --all --ignore-not-found --wait=true
  kubectl -n $Namespace delete cluster.postgresql.cnpg.io --all --ignore-not-found --wait=true --timeout=10m

  kubectl delete release.helm.crossplane.io cnpg --ignore-not-found --wait=true --timeout=5m
  kubectl delete namespace cnpg-system --ignore-not-found --wait=true --timeout=5m

  $crds = @(kubectl get crd -o name | Where-Object { $_ -match '\.postgresql\.cnpg\.io$' })
  if ($crds.Count) { kubectl delete $crds --wait=true --timeout=5m }

  kubectl delete clusterrole cnpg-cloudnative-pg cnpg-cloudnative-pg-edit cnpg-cloudnative-pg-view --ignore-not-found
  kubectl delete clusterrolebinding cnpg-cloudnative-pg --ignore-not-found
  kubectl delete validatingwebhookconfiguration cnpg-validating-webhook-configuration --ignore-not-found
  kubectl delete mutatingwebhookconfiguration cnpg-mutating-webhook-configuration --ignore-not-found
}

$remaining = @(
  kubectl get crd -o name | Where-Object { $_ -match '\.postgresql\.cnpg\.io$' }
  kubectl get namespace cnpg-system -o name --ignore-not-found
  kubectl get release.helm.crossplane.io cnpg -o name --ignore-not-found
  kubectl get clusterrole,clusterrolebinding,validatingwebhookconfiguration,mutatingwebhookconfiguration -o name | Where-Object { $_ -match 'cnpg|cloudnative' }
)
if ($remaining.Count) {
  throw "CloudNativePG removal incomplete: $($remaining -join ', ')"
}

Write-Host 'CloudNativePG removal verified: no runtime, operator, webhook, RBAC, namespace, release, or CRD remains.'
