package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"reflect"
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
	sgScriptGVK      = schema.GroupVersionKind{Group: "stackgres.io", Version: "v1", Kind: "SGScript"}
	podMonitorGVK    = schema.GroupVersionKind{Group: "monitoring.coreos.com", Version: "v1", Kind: "PodMonitor"}
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
	ProfileRefs                                                                            postgresProfileRefs
}

// postgresProfileRefs identifies the native StackGres configuration objects that
// an OpenSphere plan or claim adopts.  They are deliberately references rather
// than a second copy of StackGres settings: SG* resources remain the desired
// state authority and can be inspected with kubectl or the StackGres API.
type postgresProfileRefs struct {
	InstanceProfile string
	PostgresConfig  string
	PoolingConfig   string
	ObjectStorage   string
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
	managed, err := r.isPostgresFleetNamespace(ctx, claim.GetNamespace())
	if err != nil {
		return reconcile.Result{}, err
	}
	if !managed {
		return r.reject(ctx, nn, "NamespaceNotManaged", "StackGres PostgreSQL requires a Foundation-managed Namespace with purpose postgres-fleet")
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
	profileRefs := effectivePostgresProfileRefs(claim, plan)
	if err := r.validatePostgresProfileRefs(ctx, claim.GetNamespace(), plan, profileRefs); err != nil {
		return r.reject(ctx, nn, "InvalidProfileReference", err.Error())
	}
	resources := renderPostgresResources(claim, plan, profileRefs, password)
	for _, resource := range resources {
		if err := r.applyPostgresResource(ctx, resource); err != nil {
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
	if clusterErr == nil {
		_, bootstrapFailed, bootstrapMessage := stackGresBootstrapStatus(cluster)
		if bootstrapFailed {
			phase, reason, message = "Failed", "DatabaseBootstrapFailed", bootstrapMessage
		}
	}
	if ready {
		phase, conditionStatus, reason, message = "Ready", "True", "ClusterReady", "Dedicated StackGres cluster, application database, and binding are ready"
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
		previousPhase, _, _ := unstructured.NestedString(o.Object, "status", "phase")
		setNested(o, phase, "status", "phase")
		if previousPhase != phase {
			setNested(o, time.Now().UTC().Format(time.RFC3339), "status", "observedAt")
		}
	})
	ctrl.LoggerFrom(ctx).Info("postgres claim reconciled", "claim", req.NamespacedName, "plan", planName, "cluster", clusterName, "phase", phase)
	return reconcile.Result{RequeueAfter: 30 * time.Second}, nil
}

// applyPostgresResource keeps the SGCluster write path declarative without
// rewriting an unchanged object every polling cycle. StackGres 1.19 updates
// SGCluster status through the main resource endpoint, so an unnecessary SSA
// competes for resourceVersion and produces optimistic-lock 409 retries.
func (r *postgresClaimReconciler) applyPostgresResource(ctx context.Context, desired *unstructured.Unstructured) error {
	if desired.GroupVersionKind() != sgClusterGVK {
		return applyObj(ctx, r.direct, desired)
	}
	current := gvkObj(sgClusterGVK)
	nn := types.NamespacedName{Namespace: desired.GetNamespace(), Name: desired.GetName()}
	if err := r.direct.Get(ctx, nn, current); err != nil {
		if apierrors.IsNotFound(err) {
			return applyObj(ctx, r.direct, desired)
		}
		return err
	}
	if postgresManagedStateEqual(current, desired) {
		return nil
	}
	return applyObj(ctx, r.direct, desired)
}

// postgresManagedStateEqual compares only fields owned by the Foundation
// renderer. StackGres may add defaults and status fields that must not make the
// desired-state comparison look different.
func postgresManagedStateEqual(current, desired *unstructured.Unstructured) bool {
	currentLabels := current.GetLabels()
	for key, value := range desired.GetLabels() {
		if currentLabels[key] != value {
			return false
		}
	}
	return desiredSubsetEqual(current.Object["spec"], desired.Object["spec"])
}

func desiredSubsetEqual(current, desired interface{}) bool {
	switch wanted := desired.(type) {
	case map[string]interface{}:
		actual, ok := current.(map[string]interface{})
		if !ok {
			return false
		}
		for key, value := range wanted {
			actualValue, found := actual[key]
			if !found || !desiredSubsetEqual(actualValue, value) {
				return false
			}
		}
		return true
	case []interface{}:
		actual, ok := current.([]interface{})
		if !ok {
			return false
		}
		if desiredListHasIdentity(wanted) {
			for _, wantedItem := range wanted {
				wantedMap := wantedItem.(map[string]interface{})
				identityKey, identityValue := desiredListIdentity(wantedMap)
				matched := false
				for _, actualItem := range actual {
					actualMap, ok := actualItem.(map[string]interface{})
					if ok && reflect.DeepEqual(actualMap[identityKey], identityValue) && desiredSubsetEqual(actualMap, wantedMap) {
						matched = true
						break
					}
				}
				if !matched {
					return false
				}
			}
			return true
		}
		if len(actual) != len(wanted) {
			return false
		}
		for i := range wanted {
			if !desiredSubsetEqual(actual[i], wanted[i]) {
				return false
			}
		}
		return true
	default:
		return reflect.DeepEqual(current, desired)
	}
}

func desiredListHasIdentity(items []interface{}) bool {
	if len(items) == 0 {
		return false
	}
	for _, item := range items {
		value, ok := item.(map[string]interface{})
		if !ok {
			return false
		}
		key, _ := desiredListIdentity(value)
		if key == "" {
			return false
		}
	}
	return true
}

func desiredListIdentity(item map[string]interface{}) (string, interface{}) {
	for _, key := range []string{"id", "name"} {
		if value, found := item[key]; found {
			return key, value
		}
	}
	return "", nil
}

func postgresFleetNamespaceAccepted(namespace, fallbackNamespace string, labels map[string]string) bool {
	// The original Foundation namespace remains valid during the migration to a
	// namespace-first fleet. New namespaces must be explicitly created by the
	// Foundation flow and carry both labels; arbitrary namespaces are never
	// accepted merely because a caller can create a PostgresClaim there.
	if namespace == fallbackNamespace {
		return true
	}
	return labels["opensphere.io/managed-by"] == "foundation" && labels["opensphere.io/purpose"] == "postgres-fleet"
}

func (r *postgresClaimReconciler) isPostgresFleetNamespace(ctx context.Context, namespace string) (bool, error) {
	ns := object(schema.GroupVersionKind{Version: "v1", Kind: "Namespace"}, "", namespace)
	if err := r.direct.Get(ctx, types.NamespacedName{Name: namespace}, ns); err != nil {
		if apierrors.IsNotFound(err) {
			return false, nil
		}
		return false, err
	}
	return postgresFleetNamespaceAccepted(namespace, r.cfg.managedNS, ns.GetLabels()), nil
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
			sgScriptGVK,
			{Group: "stackgres.io", Version: "v1", Kind: "SGPoolingConfig"},
			{Group: "stackgres.io", Version: "v1", Kind: "SGPostgresConfig"},
			{Group: "stackgres.io", Version: "v1", Kind: "SGInstanceProfile"},
			addOnInstallGVK,
			{Version: "v1", Kind: "Secret"},
			{Group: "rbac.authorization.k8s.io", Version: "v1", Kind: "Role"},
			{Group: "rbac.authorization.k8s.io", Version: "v1", Kind: "RoleBinding"},
			podMonitorGVK,
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
	p.ProfileRefs.InstanceProfile, _, _ = unstructured.NestedString(o.Object, "spec", "profileRefs", "instanceProfile")
	p.ProfileRefs.PostgresConfig, _, _ = unstructured.NestedString(o.Object, "spec", "profileRefs", "postgresConfig")
	p.ProfileRefs.PoolingConfig, _, _ = unstructured.NestedString(o.Object, "spec", "profileRefs", "poolingConfig")
	p.ProfileRefs.ObjectStorage, _, _ = unstructured.NestedString(o.Object, "spec", "profileRefs", "objectStorage")
	if p.Version == "" || p.Instances < 1 || p.CPU == "" || p.Memory == "" || p.Size == "" {
		return postgresPlan{}, fmt.Errorf("plan has incomplete StackGres sizing")
	}
	if p.ProfileRefs.ObjectStorage != "" {
		p.ObjectStorage = p.ProfileRefs.ObjectStorage
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
	for _, field := range []string{"instanceProfile", "postgresConfig", "poolingConfig", "objectStorage"} {
		value, _, _ := unstructured.NestedString(claim.Object, "spec", "profileRefs", field)
		if value != "" && !postgresIdentifier.MatchString(value) {
			return fmt.Errorf("spec.profileRefs.%s is not a supported Kubernetes resource name", field)
		}
	}
	return nil
}

func effectivePostgresProfileRefs(claim *unstructured.Unstructured, plan postgresPlan) postgresProfileRefs {
	refs := plan.ProfileRefs
	if value, _, _ := unstructured.NestedString(claim.Object, "spec", "profileRefs", "instanceProfile"); value != "" {
		refs.InstanceProfile = value
	}
	if value, _, _ := unstructured.NestedString(claim.Object, "spec", "profileRefs", "postgresConfig"); value != "" {
		refs.PostgresConfig = value
	}
	if value, _, _ := unstructured.NestedString(claim.Object, "spec", "profileRefs", "poolingConfig"); value != "" {
		refs.PoolingConfig = value
	}
	if value, _, _ := unstructured.NestedString(claim.Object, "spec", "profileRefs", "objectStorage"); value != "" {
		refs.ObjectStorage = value
	}
	return refs
}

func (r *postgresClaimReconciler) validatePostgresProfileRefs(ctx context.Context, namespace string, plan postgresPlan, refs postgresProfileRefs) error {
	if !plan.Pooling && refs.PoolingConfig != "" {
		return fmt.Errorf("poolingConfig profile requires a pooling-enabled plan")
	}
	checks := []struct {
		name string
		kind schema.GroupVersionKind
	}{
		{refs.InstanceProfile, schema.GroupVersionKind{Group: "stackgres.io", Version: "v1", Kind: "SGInstanceProfile"}},
		{refs.PostgresConfig, schema.GroupVersionKind{Group: "stackgres.io", Version: "v1", Kind: "SGPostgresConfig"}},
		{refs.PoolingConfig, schema.GroupVersionKind{Group: "stackgres.io", Version: "v1", Kind: "SGPoolingConfig"}},
		{refs.ObjectStorage, schema.GroupVersionKind{Group: "stackgres.io", Version: "v1beta1", Kind: "SGObjectStorage"}},
	}
	for _, check := range checks {
		if check.name == "" {
			continue
		}
		obj := gvkObj(check.kind)
		if err := r.direct.Get(ctx, types.NamespacedName{Namespace: namespace, Name: check.name}, obj); err != nil {
			if apierrors.IsNotFound(err) {
				return fmt.Errorf("referenced %s %s/%s was not found", check.kind.Kind, namespace, check.name)
			}
			return err
		}
		if check.kind.Kind == "SGPostgresConfig" && plan.Version != "" {
			configuredVersion, _, _ := unstructured.NestedString(obj.Object, "spec", "postgresVersion")
			if configuredVersion != "" && configuredVersion != plan.Version {
				return fmt.Errorf("referenced SGPostgresConfig %s targets PostgreSQL %s, plan requires %s", check.name, configuredVersion, plan.Version)
			}
		}
	}
	if plan.Backup && refs.ObjectStorage == "" {
		// Legacy plans carry the object storage name in spec.backup.objectStorageRef.
		// The normal renderer keeps that contract until the catalog is migrated.
		return nil
	}
	return nil
}

func renderPostgresResources(claim *unstructured.Unstructured, plan postgresPlan, refs postgresProfileRefs, password string) []*unstructured.Unstructured {
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

	profileName := refs.InstanceProfile
	pgConfigName := refs.PostgresConfig
	poolingName := refs.PoolingConfig
	generated := make([]*unstructured.Unstructured, 0, 3)
	if profileName == "" {
		profile := object(schema.GroupVersionKind{Group: "stackgres.io", Version: "v1", Kind: "SGInstanceProfile"}, ns, clusterName+"-profile")
		profile.Object["spec"] = map[string]interface{}{"cpu": plan.CPU, "memory": plan.Memory}
		profileName = profile.GetName()
		generated = append(generated, profile)
	}
	if pgConfigName == "" {
		pgConfig := object(schema.GroupVersionKind{Group: "stackgres.io", Version: "v1", Kind: "SGPostgresConfig"}, ns, clusterName+"-postgres")
		pgConfig.Object["spec"] = map[string]interface{}{"postgresVersion": plan.Version, "postgresql.conf": map[string]interface{}{"password_encryption": "scram-sha-256", "wal_compression": "on"}}
		pgConfigName = pgConfig.GetName()
		generated = append(generated, pgConfig)
	}
	if plan.Pooling && poolingName == "" {
		pooling := object(schema.GroupVersionKind{Group: "stackgres.io", Version: "v1", Kind: "SGPoolingConfig"}, ns, clusterName+"-pooling")
		pooling.Object["spec"] = map[string]interface{}{"pgBouncer": map[string]interface{}{"pgbouncer.ini": map[string]interface{}{"pgbouncer": map[string]interface{}{"pool_mode": "transaction", "max_client_conn": "200"}}}}
		poolingName = pooling.GetName()
		generated = append(generated, pooling)
	}
	scriptSecret := object(schema.GroupVersionKind{Version: "v1", Kind: "Secret"}, ns, clusterName+"-bootstrap-sql")
	scriptSecret.Object["type"] = "Opaque"
	escapedPassword := strings.ReplaceAll(password, "'", "''")
	roleSQL := fmt.Sprintf("DO $opensphere$\nBEGIN\n  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '%s') THEN\n    ALTER ROLE %s LOGIN PASSWORD '%s';\n  ELSE\n    CREATE ROLE %s LOGIN PASSWORD '%s';\n  END IF;\nEND\n$opensphere$;\n", strings.ReplaceAll(owner, "'", "''"), quotePostgresIdentifier(owner), escapedPassword, quotePostgresIdentifier(owner), escapedPassword)
	databaseSQL := fmt.Sprintf("CREATE DATABASE %s OWNER %s;\n", quotePostgresIdentifier(database), quotePostgresIdentifier(owner))
	scriptSecret.Object["stringData"] = map[string]interface{}{"role.sql": roleSQL, "database.sql": databaseSQL}
	script := object(sgScriptGVK, ns, clusterName+"-bootstrap")
	script.Object["spec"] = map[string]interface{}{
		"managedVersions": false,
		"scripts": []interface{}{
			map[string]interface{}{"id": int64(1), "version": int64(2), "name": "reconcile-application-role", "retryOnError": true, "scriptFrom": map[string]interface{}{"secretKeyRef": map[string]interface{}{"name": scriptSecret.GetName(), "key": "role.sql"}}},
			map[string]interface{}{"id": int64(2), "version": int64(1), "name": "create-application-database", "retryOnError": true, "scriptFrom": map[string]interface{}{"secretKeyRef": map[string]interface{}{"name": scriptSecret.GetName(), "key": "database.sql"}}},
		},
	}
	cluster := object(sgClusterGVK, ns, clusterName)
	configurations := map[string]interface{}{
		"sgPostgresConfig": pgConfigName,
		"binding":          map[string]interface{}{"provider": "opensphere-stackgres", "database": database, "username": owner, "password": map[string]interface{}{"name": clusterName + "-app-credentials", "key": "password"}},
		"observability":    map[string]interface{}{"disableMetrics": false},
	}
	if plan.Pooling {
		configurations["sgPoolingConfig"] = poolingName
	}
	if plan.Backup {
		objectStorage := refs.ObjectStorage
		if objectStorage == "" {
			objectStorage = plan.ObjectStorage
		}
		configurations["backups"] = []interface{}{map[string]interface{}{"sgObjectStorage": objectStorage, "cronSchedule": plan.BackupSchedule}}
	}
	cluster.Object["spec"] = map[string]interface{}{
		"instances":         plan.Instances,
		"profile":           plan.Profile,
		"sgInstanceProfile": profileName,
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
	podMonitor := object(podMonitorGVK, ns, clusterName)
	podMonitor.Object["spec"] = map[string]interface{}{
		"selector":            map[string]interface{}{"matchLabels": map[string]interface{}{"stackgres.io/cluster-name": clusterName}},
		"podMetricsEndpoints": []interface{}{map[string]interface{}{"port": "pgexporter", "path": "/metrics", "interval": "15s"}},
	}
	podMonitor.SetLabels(map[string]string{"release": "kube-prometheus-stack"})
	resources := append(generated, scriptSecret, script, role, binding, podMonitor, cluster)
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
	profileRefs := effectivePostgresProfileRefs(claim, plan)
	install.Object["spec"] = map[string]interface{}{"planRef": plan.Name, "claimRef": map[string]interface{}{"apiVersion": postgresClaimGVK.GroupVersion().String(), "kind": "PostgresClaim", "name": claim.GetName(), "uid": string(claim.GetUID())}, "deletionPolicy": policy, "renderedResources": refs, "profileRefs": map[string]interface{}{"instanceProfile": profileRefs.InstanceProfile, "postgresConfig": profileRefs.PostgresConfig, "poolingConfig": profileRefs.PoolingConfig, "objectStorage": profileRefs.ObjectStorage}}
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
	coreReady, bootstrapped, componentsUpdated, failed := false, false, false, false
	for _, item := range conditions {
		condition, _ := item.(map[string]interface{})
		if (condition["type"] == "ClusterReady" || condition["type"] == "Ready") && condition["status"] == "True" {
			coreReady = true
		}
		if condition["type"] == "Bootstrapped" && condition["status"] == "True" {
			bootstrapped = true
		}
		if condition["type"] == "ComponentsUpdated" && condition["status"] == "True" {
			componentsUpdated = true
		}
		if condition["type"] == "Failed" && condition["status"] == "True" {
			failed = true
		}
	}
	bindingName, _, _ := unstructured.NestedString(cluster.Object, "status", "binding", "name")
	bootstrapReady, bootstrapFailed, _ := stackGresBootstrapStatus(cluster)
	coreReady = coreReady || (bootstrapped && componentsUpdated)
	return coreReady && !failed && bindingName != "" && bootstrapReady && !bootstrapFailed
}

func stackGresBootstrapStatus(cluster *unstructured.Unstructured) (ready, failed bool, message string) {
	entries, _, _ := unstructured.NestedSlice(cluster.Object, "status", "managedSql", "scripts")
	for _, item := range entries {
		entry, ok := item.(map[string]interface{})
		if !ok || fmt.Sprint(entry["id"]) != "1" {
			continue
		}
		failureDetail := ""
		if scripts, ok := entry["scripts"].([]interface{}); ok {
			for _, scriptItem := range scripts {
				if script, ok := scriptItem.(map[string]interface{}); ok {
					if detail, _ := script["failure"].(string); detail != "" {
						failureDetail = detail
						break
					}
				}
			}
		}
		if failureDetail != "" {
			return false, true, "StackGres application database bootstrap failed: " + failureDetail
		}
		if completedAt, _ := entry["completedAt"].(string); completedAt != "" {
			return true, false, ""
		}
		if failedAt, _ := entry["failedAt"].(string); failedAt != "" {
			return false, true, "StackGres application database bootstrap failed"
		}
		return false, false, "StackGres application database bootstrap is pending"
	}
	return false, false, "StackGres application database bootstrap is pending"
}

func setPostgresCondition(o *unstructured.Unstructured, conditionType, status, reason, message string) {
	lastTransitionTime := time.Now().UTC().Format(time.RFC3339)
	conditions, _, _ := unstructured.NestedSlice(o.Object, "status", "conditions")
	for _, item := range conditions {
		condition, ok := item.(map[string]interface{})
		if !ok || condition["type"] != conditionType || condition["status"] != status {
			continue
		}
		if previous, ok := condition["lastTransitionTime"].(string); ok && previous != "" {
			lastTransitionTime = previous
		}
		break
	}
	condition := map[string]interface{}{"type": conditionType, "status": status, "reason": reason, "message": message, "lastTransitionTime": lastTransitionTime}
	_ = unstructured.SetNestedSlice(o.Object, []interface{}{condition}, "status", "conditions")
}
