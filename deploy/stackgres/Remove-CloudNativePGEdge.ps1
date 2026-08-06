[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$Context = 'docker-desktop',
  [string]$Namespace = 'opensphere-foundation'
)

$ErrorActionPreference = 'Stop'
if ((kubectl config current-context) -ne $Context) {
  throw "Refusing removal: current kubectl context is not $Context"
}

$cnpgAPIResources = @(kubectl api-resources --api-group=postgresql.cnpg.io -o name 2>$null)
$legacyClusters = @()
if ($cnpgAPIResources -contains 'clusters.postgresql.cnpg.io') {
  $legacyClusters = @(kubectl get clusters.postgresql.cnpg.io -A -o name --ignore-not-found)
}
if ($legacyClusters.Count -gt 1 -or ($legacyClusters.Count -eq 1 -and $legacyClusters[0] -ne 'cluster.postgresql.cnpg.io/foundation-data-pg')) {
  throw "Unexpected legacy PostgreSQL targets: $($legacyClusters -join ', ')"
}

$stackGresReady = kubectl -n $Namespace get sgcluster pgc-platform-dev-pg -o jsonpath='{.status.conditions[?(@.type=="Bootstrapped")].status}'
if ($stackGresReady -ne 'True') {
  throw 'Refusing removal: canonical StackGres cluster is not bootstrapped'
}

# Capture the exact CNPG storage objects before removing their owner CR. The
# legacy cluster used Retain, so relying on owner-reference garbage collection
# alone can leave both Kubernetes PVs and Ceph RBD images behind.
$legacyPVCs = @(kubectl -n $Namespace get pvc -l cnpg.io/cluster=foundation-data-pg -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' --ignore-not-found | Where-Object { $_ })
$legacyPVs = @(
  foreach ($pvc in $legacyPVCs) {
    kubectl -n $Namespace get pvc $pvc -o jsonpath='{.spec.volumeName}' --ignore-not-found
  }
) | Where-Object { $_ }

foreach ($pv in $legacyPVs) {
  kubectl patch pv $pv --type=merge -p '{"spec":{"persistentVolumeReclaimPolicy":"Delete"}}'
}

if ($PSCmdlet.ShouldProcess("$Namespace/foundation-data-pg and CloudNativePG operator", 'Delete all CloudNativePG runtime and API resources')) {
  kubectl -n $Namespace delete postgresclaim foundation-data-pg-legacy --ignore-not-found --wait=true
  if ($cnpgAPIResources.Count) {
    kubectl -n $Namespace delete database.postgresql.cnpg.io --all --ignore-not-found --wait=true
    kubectl -n $Namespace delete databaserole.postgresql.cnpg.io --all --ignore-not-found --wait=true
    kubectl -n $Namespace delete pooler.postgresql.cnpg.io --all --ignore-not-found --wait=true
    kubectl -n $Namespace delete cluster.postgresql.cnpg.io --all --ignore-not-found --wait=true --timeout=10m
  }

  # A CNPG instance defaults to a 30-minute termination grace period. Shorten
  # it after the owner CR is gone so CSI can unstage the volume and delete the
  # captured Ceph-backed PV instead of leaving a terminating Pod indefinitely.
  $legacyPods = @(kubectl -n $Namespace get pod -l cnpg.io/cluster=foundation-data-pg -o name --ignore-not-found)
  if ($legacyPods.Count) {
    kubectl -n $Namespace delete $legacyPods --grace-period=30 --wait=true --timeout=2m
  }
  foreach ($pvc in $legacyPVCs) {
    kubectl -n $Namespace delete pvc $pvc --ignore-not-found --wait=true --timeout=5m
  }
  foreach ($pv in $legacyPVs) {
    kubectl delete pv $pv --ignore-not-found --wait=true --timeout=5m
  }

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
  kubectl -n $Namespace get pod,pvc,service,secret,configmap -o json | Select-String -Pattern 'cnpg\.io|cloudnative-pg|postgresql\.cnpg\.io'
  foreach ($pv in $legacyPVs) { kubectl get pv $pv -o name --ignore-not-found }
)
if ($remaining.Count) {
  throw "CloudNativePG removal incomplete: $($remaining -join ', ')"
}

Write-Host 'CloudNativePG removal verified: no runtime, operator, webhook, RBAC, namespace, release, or CRD remains.'
