package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"regexp"
	"strings"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
)

var (
	postgresClaimGVK = schema.GroupVersionKind{Group: "provisioning.opensphere.io", Version: "v1beta1", Kind: "PostgresClaim"}
	addOnPlanGVK     = schema.GroupVersionKind{Group: "catalog.opensphere.io", Version: "v1alpha1", Kind: "AddOnPlan"}
	addOnInstallGVK  = schema.GroupVersionKind{Group: "catalog.opensphere.io", Version: "v1alpha1", Kind: "AddOnInstall"}
	sgClusterGVK     = schema.GroupVersionKind{Group: "stackgres.io", Version: "v1", Kind: "SGCluster"}
)

const postgresFleetFinalizer = "provisioning.opensphere.io/postgres-cluster-protect"

var postgresIdentifier = regexp.MustCompile("^[A-Za-z_][A-Za-z0-9_$-]{0,62}$")

type postgresClaimReconciler struct {
	cached client.Client
	direct client.Client
	cfg    *config
}

type postgresPlan struct {
	Name, Version, Profile, CPU, Memory, Size, StorageClass, ObjectStorage, BackupSchedule string
	Instances, Retention                                                                   int64
	Pooling, Backup                                                                        bool
}

func (r *postgresClaimReconciler) Reconcile(ctx context.Context, req reconcile.Request) (reconcile.Result, error) {
	claim := gvkObj(postgresClaimGVK)
	if err := r.cached.Get(ctx, req.NamespacedName, claim); err != nil {
		return reconcile.Result{}, client.IgnoreNotFound(err)
	}
	nn := types.NamespacedName{Namespace: claim.GetNamespace(), Name: claim.GetName()}
	if claim.GetDeletionTimestamp() != nil {
		return r.release(ctx, claim)
	}
	isolation, _, _ := unstructured.NestedString(claim.Object, "spec", "isolation")
	if isolation == "LegacyShared" {
		return reconcile.Result{}, updateStatusRetry(ctx, r.direct, postgresClaimGVK, nn, func(o *unstructured.Unstructured) {
			setNested(o, "LegacyShared", "status", "phase")
			setPostgresCondition(o, "Ready", "True", "LegacyShared", "Existing shared CNPG service remains authoritative")
		})
	}
	if claim.GetNamespace() != r.cfg.managedNS {
		return r.reject(ctx, nn, "NamespaceNotManaged", fmt.Sprintf("Dedicated PostgreSQL is currently limited to namespace %s", r.cfg.managedNS))
	}
	if !hasFinalizer(claim, postgresFleetFinalizer) {
		if err := updateMetaRetry(ctx, r.direct, postgresClaimGVK, nn, func(o *unstructured.Unstructured) { addFinalizer(o, postgresFleetFinalizer) }); err != nil {
			return reconcile.Result{}, err
		}
		return reconcile.Result{Requeue: true}, nil
	}

	planName, _, _ := unstructured.NestedString(claim.Object, "spec", "planRef", "name")
	if planName == "" {
		return r.reject(ctx, nn, "PlanRequired", "spec.planRef.name is required for Dedicated claims")
	}
	planObj := gvkObj(addOnPlanGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Name: planName}, planObj); err != nil {
		if apierrors.IsNotFound(err) {
			return r.reject(ctx, nn, "PlanNotFound", fmt.Sprintf("AddOnPlan %s was not found", planName))
		}
		return reconcile.Result{}, err
	}
	plan, err := parsePostgresPlan(planObj)
	if err != nil {
		return r.reject(ctx, nn, "InvalidPlan", err.Error())
	}
	if err := validatePostgresClaim(claim); err != nil {
		return r.reject(ctx, nn, "InvalidClaim", err.Error())
	}

	password, err := r.ensureApplicationSecret(ctx, claim)
	if err != nil {
		return reconcile.Result{}, err
	}
	resources := renderPostgresResources(claim, plan, password)
	for _, resource := range resources {
		if err := applyObj(ctx, r.direct, resource); err != nil {
			if strings.Contains(err.Error(), "no matches for kind") || strings.Contains(err.Error(), "requested resource") {
				_ = updateStatusRetry(ctx, r.direct, postgresClaimGVK, nn, func(o *unstructured.Unstructured) {
					setNested(o, "Pending", "status", "phase")
					setPostgresCondition(o, "Rendered", "False", "StackGresUnavailable", "StackGres 1.19 CRDs/operator are not installed")
				})
				return reconcile.Result{RequeueAfter: 30 * time.Second}, nil
			}
			return reconcile.Result{}, err
		}
	}

	install := renderAddOnInstall(claim, plan, resources)
	if err := applyObj(ctx, r.direct, install); err != nil {
		return reconcile.Result{}, err
	}
	clusterName := postgresClusterName(claim)
	cluster := gvkObj(sgClusterGVK)
	clusterErr := r.direct.Get(ctx, types.NamespacedName{Namespace: claim.GetNamespace(), Name: clusterName}, cluster)
	ready := clusterErr == nil && stackGresReady(cluster)
	phase := "Provisioning"
	conditionStatus, reason, message := "False", "StackGresReconciling", "Dedicated StackGres cluster is reconciling"
	if ready {
		phase, conditionStatus, reason, message = "Ready", "True", "ClusterReady", "Dedicated StackGres cluster and application binding are ready"
	}
	bindingName := clusterName + "-binding"
	if clusterErr == nil {
		if value, found, _ := unstructured.NestedString(cluster.Object, "status", "binding", "name"); found && value != "" {
			bindingName = value
		}
	}
	if err := updateStatusRetry(ctx, r.direct, postgresClaimGVK, nn, func(o *unstructured.Unstructured) {
		setNested(o, phase, "status", "phase")
		_ = unstructured.SetNestedMap(o.Object, map[string]interface{}{"apiVersion": "stackgres.io/v1", "kind": "SGCluster", "name": clusterName, "namespace": claim.GetNamespace()}, "status", "providerRef")
		_ = unstructured.SetNestedMap(o.Object, map[string]interface{}{"name": bindingName, "namespace": claim.GetNamespace()}, "status", "bindingRef")
		_ = unstructured.SetNestedMap(o.Object, map[string]interface{}{"name": claim.GetName() + "-install", "namespace": claim.GetNamespace()}, "status", "addOnInstallRef")
		setPostgresCondition(o, "Ready", conditionStatus, reason, message)
	}); err != nil {
		return reconcile.Result{}, err
	}
	_ = updateStatusRetry(ctx, r.direct, addOnInstallGVK, types.NamespacedName{Namespace: claim.GetNamespace(), Name: claim.GetName() + "-install"}, func(o *unstructured.Unstructured) {
		setNested(o, phase, "status", "phase")
		setNested(o, time.Now().UTC().Format(time.RFC3339), "status", "observedAt")
	})
	ctrl.LoggerFrom(ctx).Info("postgres claim reconciled", "claim", req.NamespacedName, "plan", planName, "cluster", clusterName, "phase", phase)
	return reconcile.Result{RequeueAfter: 30 * time.Second}, nil
}

func (r *postgresClaimReconciler) reject(ctx context.Context, nn types.NamespacedName, reason, message string) (reconcile.Result, error) {
	err := updateStatusRetry(ctx, r.direct, postgresClaimGVK, nn, func(o *unstructured.Unstructured) {
		setNested(o, "Rejected", "status", "phase")
		setPostgresCondition(o, "Accepted", "False", reason, message)
	})
	return reconcile.Result{}, err
}

func (r *postgresClaimReconciler) ensureApplicationSecret(ctx context.Context, claim *unstructured.Unstructured) (string, error) {
	name := postgresClusterName(claim) + "-app-credentials"
	existing := object(schema.GroupVersionKind{Version: "v1", Kind: "Secret"}, claim.GetNamespace(), name)
	err := r.direct.Get(ctx, types.NamespacedName{Namespace: claim.GetNamespace(), Name: name}, existing)
	if err == nil {
		encoded, _, _ := unstructured.NestedString(existing.Object, "data", "password")
		value, decodeErr := base64.StdEncoding.DecodeString(encoded)
		if decodeErr != nil || len(value) == 0 {
			return "", fmt.Errorf("Secret %s/%s has invalid password", claim.GetNamespace(), name)
		}
		return string(value), nil
	}
	if !apierrors.IsNotFound(err) {
		return "", err
	}
	password, err := randomPassword(32)
	if err != nil {
		return "", err
	}
	secret := object(schema.GroupVersionKind{Version: "v1", Kind: "Secret"}, claim.GetNamespace(), name)
	secret.Object["type"] = "Opaque"
	secret.Object["stringData"] = map[string]interface{}{"password": password}
	stampPostgresLabels(secret, claim)
	if err := applyObj(ctx, r.direct, secret); err != nil {
		return "", err
	}
	return password, nil
}

func (r *postgresClaimReconciler) release(ctx context.Context, claim *unstructured.Unstructured) (reconcile.Result, error) {
	policy, _, _ := unstructured.NestedString(claim.Object, "spec", "deletionPolicy")
	if policy == "Delete" {
		for _, gvk := range []schema.GroupVersionKind{
			sgClusterGVK,
			{Group: "stackgres.io", Version: "v1", Kind: "SGScript"},
			{Group: "stackgres.io", Version: "v1", Kind: "SGPoolingConfig"},
			{Group: "stackgres.io", Version: "v1", Kind: "SGPostgresConfig"},
			{Group: "stackgres.io", Version: "v1", Kind: "SGInstanceProfile"},
			addOnInstallGVK,
			{Version: "v1", Kind: "Secret"},
			{Group: "rbac.authorization.k8s.io", Version: "v1", Kind: "Role"},
			{Group: "rbac.authorization.k8s.io", Version: "v1", Kind: "RoleBinding"},
		} {
			if err := r.direct.DeleteAllOf(ctx, gvkObj(gvk), client.InNamespace(claim.GetNamespace()), client.MatchingLabels{"provisioning.opensphere.io/postgres-claim": claim.GetName()}); err != nil && !apierrors.IsNotFound(err) {
				return reconcile.Result{}, err
			}
		}
	}
	nn := types.NamespacedName{Namespace: claim.GetNamespace(), Name: claim.GetName()}
	return reconcile.Result{}, updateMetaRetry(ctx, r.direct, postgresClaimGVK, nn, func(o *unstructured.Unstructured) { removeFinalizer(o, postgresFleetFinalizer) })
}

func parsePostgresPlan(o *unstructured.Unstructured) (postgresPlan, error) {
	provider, _, _ := unstructured.NestedString(o.Object, "spec", "provider")
	if provider != "stackgres" {
		return postgresPlan{}, fmt.Errorf("plan provider %q is not stackgres", provider)
	}
	lifecycle, _, _ := unstructured.NestedString(o.Object, "spec", "lifecycle")
	if lifecycle == "Deprecated" {
		return postgresPlan{}, fmt.Errorf("plan is deprecated")
	}
	p := postgresPlan{Name: o.GetName()}
	p.Version, _, _ = unstructured.NestedString(o.Object, "spec", "postgresVersion")
	p.Profile, _, _ = unstructured.NestedString(o.Object, "spec", "profile")
	p.CPU, _, _ = unstructured.NestedString(o.Object, "spec", "resources", "cpu")
	p.Memory, _, _ = unstructured.NestedString(o.Object, "spec", "resources", "memory")
	p.Size, _, _ = unstructured.NestedString(o.Object, "spec", "storage", "size")
	p.StorageClass, _, _ = unstructured.NestedString(o.Object, "spec", "storage", "storageClass")
	p.Instances, _, _ = unstructured.NestedInt64(o.Object, "spec", "instances")
	p.Pooling, _, _ = unstructured.NestedBool(o.Object, "spec", "pooling")
	p.Backup, _, _ = unstructured.NestedBool(o.Object, "spec", "backup", "enabled")
	p.Retention, _, _ = unstructured.NestedInt64(o.Object, "spec", "backup", "retention")
	p.ObjectStorage, _, _ = unstructured.NestedString(o.Object, "spec", "backup", "objectStorageRef")
	p.BackupSchedule, _, _ = unstructured.NestedString(o.Object, "spec", "backup", "cronSchedule")
	if p.Version == "" || p.Instances < 1 || p.CPU == "" || p.Memory == "" || p.Size == "" {
		return postgresPlan{}, fmt.Errorf("plan has incomplete StackGres sizing")
	}
	if p.Backup && p.ObjectStorage == "" {
		return postgresPlan{}, fmt.Errorf("backup-enabled plan requires objectStorageRef")
	}
	return p, nil
}

func validatePostgresClaim(claim *unstructured.Unstructured) error {
	for _, field := range []string{"database", "owner"} {
		value, _, _ := unstructured.NestedString(claim.Object, "spec", field)
		if !postgresIdentifier.MatchString(value) {
			return fmt.Errorf("spec.%s is not a supported PostgreSQL identifier", field)
		}
	}
	return nil
}

func renderPostgresResources(claim *unstructured.Unstructured, plan postgresPlan, password string) []*unstructured.Unstructured {
	ns, clusterName := claim.GetNamespace(), postgresClusterName(claim)
	database, _, _ := unstructured.NestedString(claim.Object, "spec", "database")
	owner, _, _ := unstructured.NestedString(claim.Object, "spec", "owner")
	storageSize, _, _ := unstructured.NestedString(claim.Object, "spec", "storage", "size")
	storageClass, _, _ := unstructured.NestedString(claim.Object, "spec", "storage", "storageClass")
	if storageSize == "" {
		storageSize = plan.Size
	}
	if storageClass == "" {
		storageClass = plan.StorageClass
	}

	profile := object(schema.GroupVersionKind{Group: "stackgres.io", Version: "v1", Kind: "SGInstanceProfile"}, ns, clusterName+"-profile")
	profile.Object["spec"] = map[string]interface{}{"cpu": plan.CPU, "memory": plan.Memory}
	pgConfig := object(schema.GroupVersionKind{Group: "stackgres.io", Version: "v1", Kind: "SGPostgresConfig"}, ns, clusterName+"-postgres")
	pgConfig.Object["spec"] = map[string]interface{}{"postgresVersion": plan.Version, "postgresql.conf": map[string]interface{}{"password_encryption": "scram-sha-256", "wal_compression": "on"}}
	pooling := object(schema.GroupVersionKind{Group: "stackgres.io", Version: "v1", Kind: "SGPoolingConfig"}, ns, clusterName+"-pooling")
	pooling.Object["spec"] = map[string]interface{}{"pgBouncer": map[string]interface{}{"pgbouncer.ini": map[string]interface{}{"pool_mode": "transaction", "max_client_conn": "200"}}}
	scriptSecret := object(schema.GroupVersionKind{Version: "v1", Kind: "Secret"}, ns, clusterName+"-bootstrap-sql")
	scriptSecret.Object["type"] = "Opaque"
	scriptSecret.Object["stringData"] = map[string]interface{}{"bootstrap.sql": fmt.Sprintf("CREATE ROLE %s LOGIN PASSWORD '%s';\nCREATE DATABASE %s OWNER %s;\n", quotePostgresIdentifier(owner), strings.ReplaceAll(password, "'", "''"), quotePostgresIdentifier(database), quotePostgresIdentifier(owner))}
	script := object(schema.GroupVersionKind{Group: "stackgres.io", Version: "v1", Kind: "SGScript"}, ns, clusterName+"-bootstrap")
	script.Object["spec"] = map[string]interface{}{"managedVersions": false, "scripts": []interface{}{map[string]interface{}{"id": int64(1), "version": int64(1), "name": "create-application-database", "scriptFrom": map[string]interface{}{"secretKeyRef": map[string]interface{}{"name": scriptSecret.GetName(), "key": "bootstrap.sql"}}}}}
	cluster := object(sgClusterGVK, ns, clusterName)
	configurations := map[string]interface{}{
		"sgPostgresConfig": pgConfig.GetName(),
		"binding":          map[string]interface{}{"provider": "opensphere-stackgres", "database": database, "username": owner, "password": map[string]interface{}{"name": clusterName + "-app-credentials", "key": "password"}},
		"observability":    map[string]interface{}{"disableMetrics": false},
	}
	if plan.Pooling {
		configurations["sgPoolingConfig"] = pooling.GetName()
	}
	if plan.Backup {
		configurations["backups"] = []interface{}{map[string]interface{}{"sgObjectStorage": plan.ObjectStorage, "cronSchedule": plan.BackupSchedule}}
	}
	cluster.Object["spec"] = map[string]interface{}{
		"instances":         plan.Instances,
		"profile":           plan.Profile,
		"sgInstanceProfile": profile.GetName(),
		"postgres":          map[string]interface{}{"version": plan.Version},
		"pods":              map[string]interface{}{"persistentVolume": map[string]interface{}{"size": storageSize, "storageClass": storageClass}, "disableConnectionPooling": !plan.Pooling},
		"configurations":    configurations,
		"managedSql":        map[string]interface{}{"continueOnSGScriptError": false, "scripts": []interface{}{map[string]interface{}{"id": int64(1), "sgScript": script.GetName()}}},
	}
	role := object(schema.GroupVersionKind{Group: "rbac.authorization.k8s.io", Version: "v1", Kind: "Role"}, ns, clusterName+"-binding-reader")
	role.Object["rules"] = []interface{}{map[string]interface{}{"apiGroups": []interface{}{""}, "resources": []interface{}{"secrets"}, "resourceNames": []interface{}{clusterName + "-binding"}, "verbs": []interface{}{"get"}}}
	binding := object(schema.GroupVersionKind{Group: "rbac.authorization.k8s.io", Version: "v1", Kind: "RoleBinding"}, ns, clusterName+"-binding-reader")
	binding.Object["roleRef"] = map[string]interface{}{"apiGroup": "rbac.authorization.k8s.io", "kind": "Role", "name": role.GetName()}
	binding.Object["subjects"] = []interface{}{map[string]interface{}{"apiGroup": "rbac.authorization.k8s.io", "kind": "Group", "name": "opensphere-console-admins"}}
	resources := []*unstructured.Unstructured{profile, pgConfig}
	if plan.Pooling {
		resources = append(resources, pooling)
	}
	resources = append(resources, scriptSecret, script, role, binding, cluster)
	for _, resource := range resources {
		stampPostgresLabels(resource, claim)
		labels := resource.GetLabels()
		labels["catalog.opensphere.io/plan"] = plan.Name
		resource.SetLabels(labels)
	}
	return resources
}

func renderAddOnInstall(claim *unstructured.Unstructured, plan postgresPlan, resources []*unstructured.Unstructured) *unstructured.Unstructured {
	install := object(addOnInstallGVK, claim.GetNamespace(), claim.GetName()+"-install")
	refs := make([]interface{}, 0, len(resources))
	for _, resource := range resources {
		refs = append(refs, map[string]interface{}{"apiVersion": resource.GetAPIVersion(), "kind": resource.GetKind(), "name": resource.GetName(), "namespace": resource.GetNamespace()})
	}
	policy, _, _ := unstructured.NestedString(claim.Object, "spec", "deletionPolicy")
	if policy == "" {
		policy = "Retain"
	}
	install.Object["spec"] = map[string]interface{}{"planRef": plan.Name, "claimRef": map[string]interface{}{"apiVersion": postgresClaimGVK.GroupVersion().String(), "kind": "PostgresClaim", "name": claim.GetName(), "uid": string(claim.GetUID())}, "deletionPolicy": policy, "renderedResources": refs}
	stampPostgresLabels(install, claim)
	labels := install.GetLabels()
	labels["catalog.opensphere.io/plan"] = plan.Name
	install.SetLabels(labels)
	return install
}

func object(gvk schema.GroupVersionKind, namespace, name string) *unstructured.Unstructured {
	o := &unstructured.Unstructured{}
	o.SetGroupVersionKind(gvk)
	o.SetNamespace(namespace)
	o.SetName(name)
	return o
}

func postgresClusterName(claim *unstructured.Unstructured) string {
	return "pgc-" + claim.GetName()
}

func quotePostgresIdentifier(value string) string {
	return "\"" + strings.ReplaceAll(value, "\"", "\"\"") + "\""
}

func stampPostgresLabels(o, claim *unstructured.Unstructured) {
	o.SetLabels(map[string]string{"app.kubernetes.io/managed-by": cpManagedBy, "app.kubernetes.io/part-of": "pfss-postgresql", "provisioning.opensphere.io/postgres-claim": claim.GetName(), "catalog.opensphere.io/provider": "stackgres"})
}

func randomPassword(size int) (string, error) {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
	b := make([]byte, size)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b), nil
}

func stackGresReady(cluster *unstructured.Unstructured) bool {
	conditions, _, _ := unstructured.NestedSlice(cluster.Object, "status", "conditions")
	for _, item := range conditions {
		condition, _ := item.(map[string]interface{})
		if (condition["type"] == "ClusterReady" || condition["type"] == "Ready") && condition["status"] == "True" {
			return true
		}
	}
	return false
}

func setPostgresCondition(o *unstructured.Unstructured, conditionType, status, reason, message string) {
	condition := map[string]interface{}{"type": conditionType, "status": status, "reason": reason, "message": message, "lastTransitionTime": time.Now().UTC().Format(time.RFC3339)}
	_ = unstructured.SetNestedSlice(o.Object, []interface{}{condition}, "status", "conditions")
}
