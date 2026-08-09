package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"hash/crc32"
	"net/url"
	"sort"
	"strings"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
)

const (
	postgresModeDedicated      = "Dedicated"
	postgresModeSharedDatabase = "SharedDatabase"
	postgresModeDatabaseAccess = "DatabaseAccess"
)

func postgresSharedApplyVersion(mode string) int64 {
	if mode == postgresModeDatabaseAccess {
		return 2
	}
	return 1
}

func postgresSharedRevokeVersion(mode string) int64 { return postgresSharedApplyVersion(mode) + 1 }

type postgresTarget struct {
	Claim       *unstructured.Unstructured
	Namespace   string
	ClaimName   string
	ClusterName string
}

func postgresClaimMode(claim *unstructured.Unstructured) string {
	mode, _, _ := unstructured.NestedString(claim.Object, "spec", "isolation")
	if mode == "" {
		return postgresModeDedicated
	}
	return mode
}

func (r *postgresClaimReconciler) reconcileSharedPostgresClaim(ctx context.Context, claim *unstructured.Unstructured, mode string) (reconcile.Result, error) {
	nn := types.NamespacedName{Namespace: claim.GetNamespace(), Name: claim.GetName()}
	if mode != postgresModeSharedDatabase && mode != postgresModeDatabaseAccess {
		return r.reject(ctx, nn, "UnsupportedRequestMode", fmt.Sprintf("spec.isolation %q is not supported", mode))
	}
	if !hasFinalizer(claim, postgresFleetFinalizer) {
		if err := updateMetaRetry(ctx, r.direct, postgresClaimGVK, nn, func(o *unstructured.Unstructured) { addFinalizer(o, postgresFleetFinalizer) }); err != nil {
			return reconcile.Result{}, err
		}
		return reconcile.Result{Requeue: true}, nil
	}
	if err := validatePostgresClaim(claim); err != nil {
		return r.reject(ctx, nn, "InvalidClaim", err.Error())
	}
	target, err := r.resolvePostgresTarget(ctx, claim)
	if err != nil {
		return r.reject(ctx, nn, "InvalidClusterReference", err.Error())
	}
	phase, _, _ := unstructured.NestedString(target.Claim.Object, "status", "phase")
	if phase != "Ready" {
		return r.setSharedPostgresStatus(ctx, claim, target, "Pending", "False", "TargetNotReady", "선택한 PostgreSQL 인스턴스가 Ready 상태가 될 때까지 기다립니다", 0, 0)
	}

	password, err := r.ensureApplicationSecret(ctx, claim)
	if err != nil {
		return reconcile.Result{}, err
	}
	databaseOwner, err := r.postgresDatabaseOwner(ctx, claim, target)
	if err != nil {
		return r.setSharedPostgresStatus(ctx, claim, target, "Pending", "False", "DatabaseOwnershipPending", err.Error(), 0, 0)
	}
	resources, scriptID, err := renderSharedPostgresResources(claim, target, mode, password, databaseOwner, false)
	if err != nil {
		return r.reject(ctx, nn, "InvalidAccessPolicy", err.Error())
	}
	bridgeTotal, bridgeReady := 0, 0
	for _, resource := range resources {
		ready, bridged, applyErr := r.applyPostgresResource(ctx, claim, resource)
		if bridged {
			bridgeTotal++
			if ready {
				bridgeReady++
			}
		}
		if applyErr != nil {
			return reconcile.Result{}, applyErr
		}
	}
	if err := r.syncTargetManagedSQL(ctx, target, ""); err != nil {
		return reconcile.Result{}, err
	}

	cluster := gvkObj(sgClusterGVK)
	clusterErr := r.direct.Get(ctx, types.NamespacedName{Namespace: target.Namespace, Name: target.ClusterName}, cluster)
	sqlReady, sqlFailed, sqlMessage := false, false, "StackGres가 데이터베이스 요청을 적용하고 있습니다"
	if clusterErr == nil {
		sqlReady, sqlFailed, sqlMessage = stackGresManagedSQLStatus(cluster, scriptID, postgresSharedApplyVersion(mode))
	}
	if sqlFailed {
		return r.setSharedPostgresStatus(ctx, claim, target, "Failed", "False", "DatabaseRequestFailed", sqlMessage, bridgeTotal, bridgeReady)
	}
	if bridgeTotal == 0 || bridgeReady != bridgeTotal || !sqlReady {
		return r.setSharedPostgresStatus(ctx, claim, target, "Provisioning", "False", "DatabaseRequestReconciling", sqlMessage, bridgeTotal, bridgeReady)
	}
	if err := r.ensureSharedBindingSecret(ctx, claim, target); err != nil {
		return reconcile.Result{}, err
	}
	return r.setSharedPostgresStatus(ctx, claim, target, "Ready", "True", "RequestReady", sharedReadyMessage(mode), bridgeTotal, bridgeReady)
}

func sharedReadyMessage(mode string) string {
	if mode == postgresModeSharedDatabase {
		return "기존 PostgreSQL 인스턴스에 전용 데이터베이스, 계정과 연결 Secret을 발급했습니다"
	}
	return "기존 데이터베이스에 정책 범위의 접근 계정과 연결 Secret을 발급했습니다"
}

func (r *postgresClaimReconciler) resolvePostgresTarget(ctx context.Context, claim *unstructured.Unstructured) (postgresTarget, error) {
	name, _, _ := unstructured.NestedString(claim.Object, "spec", "clusterRef", "name")
	namespace, _, _ := unstructured.NestedString(claim.Object, "spec", "clusterRef", "namespace")
	if name == "" || namespace == "" {
		return postgresTarget{}, fmt.Errorf("spec.clusterRef.name과 spec.clusterRef.namespace가 필요합니다")
	}
	managed, err := r.isPostgresFleetNamespace(ctx, namespace)
	if err != nil {
		return postgresTarget{}, err
	}
	if !managed {
		return postgresTarget{}, fmt.Errorf("대상 Namespace %s는 Foundation PostgreSQL fleet으로 관리되지 않습니다", namespace)
	}
	targetClaim := gvkObj(postgresClaimGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: namespace, Name: name}, targetClaim); err != nil {
		if apierrors.IsNotFound(err) {
			return postgresTarget{}, fmt.Errorf("대상 PostgresClaim %s/%s을 찾을 수 없습니다", namespace, name)
		}
		return postgresTarget{}, err
	}
	if postgresClaimMode(targetClaim) != postgresModeDedicated {
		return postgresTarget{}, fmt.Errorf("대상 PostgresClaim은 Dedicated 인스턴스여야 합니다")
	}
	return postgresTarget{Claim: targetClaim, Namespace: namespace, ClaimName: name, ClusterName: postgresClusterName(targetClaim)}, nil
}

func (r *postgresClaimReconciler) postgresDatabaseOwner(ctx context.Context, claim *unstructured.Unstructured, target postgresTarget) (string, error) {
	owner, _, _ := unstructured.NestedString(claim.Object, "spec", "owner")
	if postgresClaimMode(claim) == postgresModeSharedDatabase {
		return owner, nil
	}
	database, _, _ := unstructured.NestedString(claim.Object, "spec", "database")
	targetDatabase, _, _ := unstructured.NestedString(target.Claim.Object, "spec", "database")
	if database == targetDatabase {
		targetOwner, _, _ := unstructured.NestedString(target.Claim.Object, "spec", "owner")
		if targetOwner != "" {
			return targetOwner, nil
		}
	}
	claims := &unstructured.UnstructuredList{}
	claims.SetGroupVersionKind(schema.GroupVersionKind{Group: postgresClaimGVK.Group, Version: postgresClaimGVK.Version, Kind: "PostgresClaimList"})
	if err := r.direct.List(ctx, claims); err != nil {
		return "", err
	}
	for i := range claims.Items {
		candidate := &claims.Items[i]
		if postgresClaimMode(candidate) != postgresModeSharedDatabase {
			continue
		}
		candidateDatabase, _, _ := unstructured.NestedString(candidate.Object, "spec", "database")
		candidateTarget, _, _ := unstructured.NestedString(candidate.Object, "spec", "clusterRef", "name")
		candidateTargetNS, _, _ := unstructured.NestedString(candidate.Object, "spec", "clusterRef", "namespace")
		candidatePhase, _, _ := unstructured.NestedString(candidate.Object, "status", "phase")
		if candidateDatabase != database || candidateTarget != target.ClaimName || candidateTargetNS != target.Namespace || candidatePhase != "Ready" {
			continue
		}
		candidateOwner, _, _ := unstructured.NestedString(candidate.Object, "spec", "owner")
		if candidateOwner != "" {
			return candidateOwner, nil
		}
	}
	return "", fmt.Errorf("Database %s의 PFSS 관리 Owner를 확인할 수 없습니다. 전용 인스턴스 기본 DB 또는 SharedDatabase 요청으로 생성된 DB만 접근 계정을 발급할 수 있습니다", database)
}

func renderSharedPostgresResources(claim *unstructured.Unstructured, target postgresTarget, mode, password, databaseOwner string, cleanup bool) ([]*unstructured.Unstructured, int64, error) {
	stem := sharedPostgresResourceStem(claim)
	database, _, _ := unstructured.NestedString(claim.Object, "spec", "database")
	owner, _, _ := unstructured.NestedString(claim.Object, "spec", "owner")
	access, _, _ := unstructured.NestedString(claim.Object, "spec", "access")
	if access == "" {
		if mode == postgresModeSharedDatabase {
			access = "Owner"
		} else {
			access = "ReadOnly"
		}
	}
	if mode == postgresModeSharedDatabase && access != "Owner" {
		return nil, 0, fmt.Errorf("SharedDatabase 요청의 spec.access는 Owner여야 합니다")
	}
	if mode == postgresModeDatabaseAccess && access != "ReadOnly" && access != "ReadWrite" {
		return nil, 0, fmt.Errorf("DatabaseAccess 요청의 spec.access는 ReadOnly 또는 ReadWrite여야 합니다")
	}
	connectionLimit, found, _ := unstructured.NestedInt64(claim.Object, "spec", "connectionLimit")
	if !found || connectionLimit < 1 {
		connectionLimit = 20
	}
	escapedPassword := strings.ReplaceAll(password, "'", "''")
	escapedOwner := strings.ReplaceAll(owner, "'", "''")
	roleSQL := fmt.Sprintf("DO $opensphere$\nBEGIN\n  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '%s') THEN\n    ALTER ROLE %s LOGIN PASSWORD '%s' CONNECTION LIMIT %d;\n  ELSE\n    CREATE ROLE %s LOGIN PASSWORD '%s' CONNECTION LIMIT %d;\n  END IF;\nEND\n$opensphere$;\n", escapedOwner, quotePostgresIdentifier(owner), escapedPassword, connectionLimit, quotePostgresIdentifier(owner), escapedPassword, connectionLimit)
	actionSQL := ""
	if mode == postgresModeSharedDatabase {
		actionSQL = fmt.Sprintf("CREATE DATABASE %s OWNER %s;\n", quotePostgresIdentifier(database), quotePostgresIdentifier(owner))
	} else if access == "ReadOnly" {
		actionSQL = fmt.Sprintf("GRANT CONNECT ON DATABASE %s TO %s;\nGRANT USAGE ON SCHEMA public TO %s;\nGRANT SELECT ON ALL TABLES IN SCHEMA public TO %s;\nGRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %s;\nALTER DEFAULT PRIVILEGES FOR ROLE %s IN SCHEMA public GRANT SELECT ON TABLES TO %s;\nALTER DEFAULT PRIVILEGES FOR ROLE %s IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %s;\n", quotePostgresIdentifier(database), quotePostgresIdentifier(owner), quotePostgresIdentifier(owner), quotePostgresIdentifier(owner), quotePostgresIdentifier(owner), quotePostgresIdentifier(databaseOwner), quotePostgresIdentifier(owner), quotePostgresIdentifier(databaseOwner), quotePostgresIdentifier(owner))
	} else {
		actionSQL = fmt.Sprintf("GRANT CONNECT ON DATABASE %s TO %s;\nGRANT USAGE, CREATE ON SCHEMA public TO %s;\nGRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public TO %s;\nGRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO %s;\nALTER DEFAULT PRIVILEGES FOR ROLE %s IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO %s;\nALTER DEFAULT PRIVILEGES FOR ROLE %s IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %s;\n", quotePostgresIdentifier(database), quotePostgresIdentifier(owner), quotePostgresIdentifier(owner), quotePostgresIdentifier(owner), quotePostgresIdentifier(owner), quotePostgresIdentifier(databaseOwner), quotePostgresIdentifier(owner), quotePostgresIdentifier(databaseOwner), quotePostgresIdentifier(owner))
	}
	version := postgresSharedApplyVersion(mode)
	if cleanup {
		version = postgresSharedRevokeVersion(mode)
		roleSQL = fmt.Sprintf("ALTER ROLE %s NOLOGIN;\n", quotePostgresIdentifier(owner))
		if mode == postgresModeSharedDatabase {
			policy, _, _ := unstructured.NestedString(claim.Object, "spec", "deletionPolicy")
			if policy == "Delete" {
				actionSQL = fmt.Sprintf("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '%s' AND pid <> pg_backend_pid();\nDROP DATABASE IF EXISTS %s;\nDROP ROLE IF EXISTS %s;\n", strings.ReplaceAll(database, "'", "''"), quotePostgresIdentifier(database), quotePostgresIdentifier(owner))
			} else {
				actionSQL = fmt.Sprintf("ALTER DATABASE %s OWNER TO postgres;\nDROP ROLE IF EXISTS %s;\n", quotePostgresIdentifier(database), quotePostgresIdentifier(owner))
			}
		} else {
			actionSQL = fmt.Sprintf("REVOKE ALL PRIVILEGES ON DATABASE %s FROM %s;\nREASSIGN OWNED BY %s TO postgres;\nDROP OWNED BY %s;\nDROP ROLE IF EXISTS %s;\n", quotePostgresIdentifier(database), quotePostgresIdentifier(owner), quotePostgresIdentifier(owner), quotePostgresIdentifier(owner), quotePostgresIdentifier(owner))
		}
	}

	secret := object(schema.GroupVersionKind{Version: "v1", Kind: "Secret"}, target.Namespace, stem+"-sql")
	secret.Object["type"] = "Opaque"
	secret.Object["stringData"] = map[string]interface{}{"role.sql": roleSQL, "action.sql": actionSQL}
	stampSharedPostgresLabels(secret, claim)

	script := object(sgScriptGVK, target.Namespace, stem)
	action := map[string]interface{}{"id": int64(2), "version": version, "name": "apply-database-contract", "retryOnError": true, "scriptFrom": map[string]interface{}{"secretKeyRef": map[string]interface{}{"name": secret.GetName(), "key": "action.sql"}}}
	if mode == postgresModeDatabaseAccess || cleanup && mode == postgresModeDatabaseAccess {
		action["database"] = database
	}
	script.Object["spec"] = map[string]interface{}{
		"managedVersions": false,
		"scripts": []interface{}{
			map[string]interface{}{"id": int64(1), "version": version, "name": "apply-login-contract", "retryOnError": true, "scriptFrom": map[string]interface{}{"secretKeyRef": map[string]interface{}{"name": secret.GetName(), "key": "role.sql"}}},
			action,
		},
	}
	stampSharedPostgresLabels(script, claim)
	labels := script.GetLabels()
	labels["provisioning.opensphere.io/transient"] = "true"
	script.SetLabels(labels)

	bindingName := stem + "-binding"
	role := object(schema.GroupVersionKind{Group: "rbac.authorization.k8s.io", Version: "v1", Kind: "Role"}, claim.GetNamespace(), stem+"-binding-reader")
	role.Object["rules"] = []interface{}{map[string]interface{}{"apiGroups": []interface{}{string("")}, "resources": []interface{}{"secrets"}, "resourceNames": []interface{}{bindingName}, "verbs": []interface{}{"get"}}}
	stampSharedPostgresLabels(role, claim)
	binding := object(schema.GroupVersionKind{Group: "rbac.authorization.k8s.io", Version: "v1", Kind: "RoleBinding"}, claim.GetNamespace(), stem+"-binding-reader")
	binding.Object["roleRef"] = map[string]interface{}{"apiGroup": "rbac.authorization.k8s.io", "kind": "Role", "name": role.GetName()}
	binding.Object["subjects"] = []interface{}{map[string]interface{}{"apiGroup": "rbac.authorization.k8s.io", "kind": "Group", "name": "opensphere-console-admins"}}
	stampSharedPostgresLabels(binding, claim)
	return []*unstructured.Unstructured{secret, script, role, binding}, sharedPostgresScriptID(claim), nil
}

func stampSharedPostgresLabels(o, claim *unstructured.Unstructured) {
	stampPostgresLabels(o, claim)
	labels := o.GetLabels()
	labels["provisioning.opensphere.io/postgres-claim-namespace"] = claim.GetNamespace()
	o.SetLabels(labels)
}

func sharedPostgresResourceStem(claim *unstructured.Unstructured) string {
	hash := fmt.Sprintf("%08x", crc32.ChecksumIEEE([]byte(claim.GetNamespace()+"/"+claim.GetName())))
	base := "pgc-" + claim.GetName()
	if len(base) > 49 {
		base = base[:49]
	}
	return base + "-" + hash
}

func sharedPostgresScriptID(claim *unstructured.Unstructured) int64 {
	return int64(crc32.ChecksumIEEE([]byte(claim.GetNamespace()+"/"+claim.GetName()))%2000000000) + 1000
}

func (r *postgresClaimReconciler) postgresManagedSQLRefs(ctx context.Context, target types.NamespacedName, clusterName, exclude string) ([]interface{}, error) {
	refs := []interface{}{map[string]interface{}{"id": int64(1), "sgScript": clusterName + "-bootstrap"}}
	claims := &unstructured.UnstructuredList{}
	claims.SetGroupVersionKind(schema.GroupVersionKind{Group: postgresClaimGVK.Group, Version: postgresClaimGVK.Version, Kind: "PostgresClaimList"})
	if err := r.direct.List(ctx, claims); err != nil {
		return nil, err
	}
	type managedRef struct {
		id     int64
		script string
	}
	managed := make([]managedRef, 0)
	for i := range claims.Items {
		candidate := &claims.Items[i]
		if postgresClaimMode(candidate) == postgresModeDedicated || candidate.GetNamespace()+"/"+candidate.GetName() == exclude {
			continue
		}
		name, _, _ := unstructured.NestedString(candidate.Object, "spec", "clusterRef", "name")
		ns, _, _ := unstructured.NestedString(candidate.Object, "spec", "clusterRef", "namespace")
		if name != target.Name || ns != target.Namespace {
			continue
		}
		managed = append(managed, managedRef{id: sharedPostgresScriptID(candidate), script: sharedPostgresResourceStem(candidate)})
	}
	sort.Slice(managed, func(i, j int) bool { return managed[i].id < managed[j].id })
	for _, ref := range managed {
		refs = append(refs, map[string]interface{}{"id": ref.id, "sgScript": ref.script})
	}
	return refs, nil
}

func setRenderedClusterManagedSQL(resources []*unstructured.Unstructured, refs []interface{}) {
	for _, resource := range resources {
		if resource.GroupVersionKind() != sgClusterGVK {
			continue
		}
		_ = unstructured.SetNestedSlice(resource.Object, refs, "spec", "managedSql", "scripts")
	}
}

func (r *postgresClaimReconciler) syncTargetManagedSQL(ctx context.Context, target postgresTarget, exclude string) error {
	refs, err := r.postgresManagedSQLRefs(ctx, types.NamespacedName{Namespace: target.Namespace, Name: target.ClaimName}, target.ClusterName, exclude)
	if err != nil {
		return err
	}
	objectName := crossplaneObjectName(object(sgClusterGVK, target.Namespace, target.ClusterName))
	bridge := gvkObj(crossplaneObjectGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: target.Namespace, Name: objectName}, bridge); err != nil {
		return err
	}
	if err := unstructured.SetNestedSlice(bridge.Object, refs, "spec", "forProvider", "manifest", "spec", "managedSql", "scripts"); err != nil {
		return err
	}
	return applyObj(ctx, r.direct, bridge)
}

func stackGresManagedSQLStatus(cluster *unstructured.Unstructured, id, version int64) (bool, bool, string) {
	entries, _, _ := unstructured.NestedSlice(cluster.Object, "status", "managedSql", "scripts")
	for _, item := range entries {
		entry, ok := item.(map[string]interface{})
		if !ok || fmt.Sprint(entry["id"]) != fmt.Sprint(id) {
			continue
		}
		allVersioned := true
		versionedScripts := 0
		if scripts, ok := entry["scripts"].([]interface{}); ok {
			for _, scriptItem := range scripts {
				script, ok := scriptItem.(map[string]interface{})
				if !ok {
					continue
				}
				if failure, _ := script["failure"].(string); failure != "" {
					return false, true, "StackGres SQL 적용 실패: " + failure
				}
				if fmt.Sprint(script["version"]) != fmt.Sprint(version) {
					allVersioned = false
				} else {
					versionedScripts++
				}
			}
		}
		if failedAt, _ := entry["failedAt"].(string); failedAt != "" {
			return false, true, "StackGres SQL 적용이 실패했습니다"
		}
		if completedAt, _ := entry["completedAt"].(string); completedAt != "" && allVersioned && versionedScripts >= 2 {
			return true, false, ""
		}
		return false, false, "StackGres가 데이터베이스 요청을 적용하고 있습니다"
	}
	return false, false, "StackGres 관리 SQL 대기열에 요청을 연결하고 있습니다"
}

func (r *postgresClaimReconciler) ensureSharedBindingSecret(ctx context.Context, claim *unstructured.Unstructured, target postgresTarget) error {
	targetCluster := gvkObj(sgClusterGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: target.Namespace, Name: target.ClusterName}, targetCluster); err != nil {
		return err
	}
	targetBindingName, _, _ := unstructured.NestedString(targetCluster.Object, "status", "binding", "name")
	if targetBindingName == "" {
		targetBindingName = target.ClusterName + "-binding"
	}
	targetBinding := object(schema.GroupVersionKind{Version: "v1", Kind: "Secret"}, target.Namespace, targetBindingName)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: target.Namespace, Name: targetBindingName}, targetBinding); err != nil {
		return err
	}
	credential := object(schema.GroupVersionKind{Version: "v1", Kind: "Secret"}, claim.GetNamespace(), postgresClusterName(claim)+"-app-credentials")
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: claim.GetNamespace(), Name: credential.GetName()}, credential); err != nil {
		return err
	}
	decode := func(secret *unstructured.Unstructured, key string) string {
		encoded, _, _ := unstructured.NestedString(secret.Object, "data", key)
		value, _ := base64.StdEncoding.DecodeString(encoded)
		return string(value)
	}
	host, port := decode(targetBinding, "host"), decode(targetBinding, "port")
	if host == "" {
		host = target.ClusterName + "." + target.Namespace + ".svc"
	}
	if port == "" {
		port = "5432"
	}
	database, _, _ := unstructured.NestedString(claim.Object, "spec", "database")
	owner, _, _ := unstructured.NestedString(claim.Object, "spec", "owner")
	password := decode(credential, "password")
	uri := (&url.URL{Scheme: "postgresql", User: url.UserPassword(owner, password), Host: host + ":" + port, Path: database, RawQuery: "sslmode=require"}).String()
	binding := object(schema.GroupVersionKind{Version: "v1", Kind: "Secret"}, claim.GetNamespace(), sharedPostgresResourceStem(claim)+"-binding")
	binding.Object["type"] = "servicebinding.io/postgresql"
	binding.Object["stringData"] = map[string]interface{}{"type": "postgresql", "provider": "opensphere-stackgres", "host": host, "port": port, "database": database, "username": owner, "password": password, "uri": uri}
	stampSharedPostgresLabels(binding, claim)
	return applyObj(ctx, r.direct, binding)
}

func (r *postgresClaimReconciler) setSharedPostgresStatus(ctx context.Context, claim *unstructured.Unstructured, target postgresTarget, phase, readyStatus, reason, message string, bridgeTotal, bridgeReady int) (reconcile.Result, error) {
	nn := types.NamespacedName{Namespace: claim.GetNamespace(), Name: claim.GetName()}
	err := updateStatusRetry(ctx, r.direct, postgresClaimGVK, nn, func(o *unstructured.Unstructured) {
		setNested(o, phase, "status", "phase")
		_ = unstructured.SetNestedMap(o.Object, map[string]interface{}{"apiVersion": "stackgres.io/v1", "kind": "SGCluster", "name": target.ClusterName, "namespace": target.Namespace}, "status", "providerRef")
		_ = unstructured.SetNestedMap(o.Object, map[string]interface{}{"name": sharedPostgresResourceStem(claim) + "-binding", "namespace": claim.GetNamespace()}, "status", "bindingRef")
		_ = unstructured.SetNestedMap(o.Object, map[string]interface{}{"provider": "provider-kubernetes", "providerConfig": "opensphere-local-cluster", "objects": int64(bridgeTotal), "readyObjects": int64(bridgeReady)}, "status", "crossplaneRef")
		bridgeStatus := "False"
		bridgeReason := "CrossplaneReconciling"
		if bridgeTotal > 0 && bridgeReady == bridgeTotal {
			bridgeStatus, bridgeReason = "True", "CrossplaneConnected"
		}
		setPostgresCondition(o, "CrossplaneBridge", bridgeStatus, bridgeReason, fmt.Sprintf("Crossplane provider-kubernetes has reconciled %d/%d managed objects", bridgeReady, bridgeTotal))
		setPostgresCondition(o, "Ready", readyStatus, reason, message)
	})
	return reconcile.Result{RequeueAfter: 15 * time.Second}, err
}

func (r *postgresClaimReconciler) releaseSharedPostgresClaim(ctx context.Context, claim *unstructured.Unstructured) (reconcile.Result, error) {
	target, err := r.resolvePostgresTarget(ctx, claim)
	if err != nil {
		// The target has already disappeared. Releasing local bridge objects is the only safe action left.
		return r.finishSharedPostgresRelease(ctx, claim, postgresTarget{})
	}
	resources, scriptID, err := renderSharedPostgresResources(claim, target, postgresClaimMode(claim), "release-placeholder", "postgres", true)
	if err != nil {
		return reconcile.Result{}, err
	}
	for _, resource := range resources[:2] {
		if _, _, err := r.applyPostgresResource(ctx, claim, resource); err != nil {
			return reconcile.Result{}, err
		}
	}
	if err := r.syncTargetManagedSQL(ctx, target, ""); err != nil {
		return reconcile.Result{}, err
	}
	cluster := gvkObj(sgClusterGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: target.Namespace, Name: target.ClusterName}, cluster); err != nil {
		return reconcile.Result{}, err
	}
	ready, failed, message := stackGresManagedSQLStatus(cluster, scriptID, postgresSharedRevokeVersion(postgresClaimMode(claim)))
	if failed {
		return reconcile.Result{}, fmt.Errorf("PostgreSQL 연결 회수 실패: %s", message)
	}
	if !ready {
		return reconcile.Result{RequeueAfter: 5 * time.Second}, nil
	}
	return r.finishSharedPostgresRelease(ctx, claim, target)
}

func (r *postgresClaimReconciler) finishSharedPostgresRelease(ctx context.Context, claim *unstructured.Unstructured, target postgresTarget) (reconcile.Result, error) {
	exclude := claim.GetNamespace() + "/" + claim.GetName()
	if target.Claim != nil {
		if err := r.syncTargetManagedSQL(ctx, target, exclude); err != nil {
			return reconcile.Result{}, err
		}
	}
	if err := r.direct.DeleteAllOf(ctx, gvkObj(crossplaneObjectGVK), client.InNamespace(claim.GetNamespace()), client.MatchingLabels{"provisioning.opensphere.io/postgres-claim": claim.GetName()}); err != nil && !apierrors.IsNotFound(err) {
		return reconcile.Result{}, err
	}
	for _, secretName := range []string{postgresClusterName(claim) + "-app-credentials", sharedPostgresResourceStem(claim) + "-binding"} {
		secret := object(schema.GroupVersionKind{Version: "v1", Kind: "Secret"}, claim.GetNamespace(), secretName)
		if err := r.direct.Delete(ctx, secret); err != nil && !apierrors.IsNotFound(err) {
			return reconcile.Result{}, err
		}
	}
	if target.Namespace != "" {
		secret := object(schema.GroupVersionKind{Version: "v1", Kind: "Secret"}, target.Namespace, sharedPostgresResourceStem(claim)+"-sql")
		if err := r.direct.Delete(ctx, secret); err != nil && !apierrors.IsNotFound(err) {
			return reconcile.Result{}, err
		}
	}
	nn := types.NamespacedName{Namespace: claim.GetNamespace(), Name: claim.GetName()}
	return reconcile.Result{}, updateMetaRetry(ctx, r.direct, postgresClaimGVK, nn, func(o *unstructured.Unstructured) { removeFinalizer(o, postgresFleetFinalizer) })
}
