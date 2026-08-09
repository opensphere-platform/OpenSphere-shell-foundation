package main

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"reflect"
	"regexp"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/util/retry"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

var dnsLabelPattern = regexp.MustCompile(`^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`)

var errPSMDBUserConflict = errors.New("PSMDB user is already owned by another credential")

func serviceClaimString(claim *unstructured.Unstructured, fallback string, fields ...string) string {
	path := append([]string{"spec", "parameters"}, fields...)
	value, found, _ := unstructured.NestedString(claim.Object, path...)
	if !found || strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}

func serviceClaimInt(claim *unstructured.Unstructured, fallback int64, fields ...string) int64 {
	path := append([]string{"spec", "parameters"}, fields...)
	value, found, _ := unstructured.NestedInt64(claim.Object, path...)
	if !found {
		return fallback
	}
	return value
}

func serviceClaimBool(claim *unstructured.Unstructured, fallback bool, fields ...string) bool {
	path := append([]string{"spec", "parameters"}, fields...)
	if value, found, _ := unstructured.NestedBool(claim.Object, path...); found {
		return value
	}
	if value, found, _ := unstructured.NestedString(claim.Object, path...); found {
		switch strings.ToLower(strings.TrimSpace(value)) {
		case "true":
			return true
		case "false":
			return false
		}
	}
	return fallback
}

func psmdbClaimTarget(claim *unstructured.Unstructured) (name, namespace string) {
	ref := targetRefOf(claim)
	name, _ = ref["name"].(string)
	namespace, _ = ref["namespace"].(string)
	if namespace == "" {
		namespace = claim.GetNamespace()
	}
	return name, namespace
}

func renderPSMDBServiceInstance(claim *unstructured.Unstructured, cfg *config) (*unstructured.Unstructured, error) {
	name, namespace := claim.GetName(), claim.GetNamespace()
	if !dnsLabelPattern.MatchString(name) || len(name) > 63 {
		return nil, fmt.Errorf("claim name %q is not a Kubernetes DNS label", name)
	}
	database := serviceClaimString(claim, "app", "database")
	owner := serviceClaimString(claim, strings.ReplaceAll(name, "-", "_"), "owner")
	if !postgresIdentifier.MatchString(database) || !postgresIdentifier.MatchString(owner) {
		return nil, fmt.Errorf("PSMDB database/owner must use the portable application identifier contract")
	}
	replicas := serviceClaimInt(claim, 3, "replicas")
	if replicas < 1 || replicas > 9 {
		return nil, fmt.Errorf("PSMDB replicas must be between 1 and 9")
	}
	storage := serviceClaimString(claim, "20Gi", "storage", "size")
	storageClass := serviceClaimString(claim, cfg.defaultStorageClass, "storage", "storageClass")
	user := map[string]interface{}{
		"name":  owner,
		"db":    database,
		"roles": []interface{}{map[string]interface{}{"name": "readWrite", "db": database}},
	}
	if secretName, found, _ := unstructured.NestedString(claim.Object, "spec", "credentialSecretRef", "name"); found && secretName != "" {
		user["passwordSecretRef"] = map[string]interface{}{"name": secretName, "key": "password"}
	}
	u := object(psmdbGVK, namespace, name)
	u.Object["spec"] = map[string]interface{}{
		"crVersion": "1.23.0", "image": cfg.psmdbImage,
		"imagePullSecrets": []interface{}{map[string]interface{}{"name": "opensphere-ghcr-pull"}},
		"updateStrategy":   "SmartUpdate", "upgradeOptions": map[string]interface{}{"apply": "Disabled"},
		"tls": map[string]interface{}{"mode": "preferTLS"}, "enableVolumeExpansion": true,
		"unsafeFlags": map[string]interface{}{"replsetSize": replicas < 3},
		"replsets": []interface{}{map[string]interface{}{
			"name": "rs0", "size": replicas,
			"resources":  map[string]interface{}{"requests": map[string]interface{}{"cpu": "500m", "memory": "1Gi"}, "limits": map[string]interface{}{"cpu": "2", "memory": "4Gi"}},
			"volumeSpec": map[string]interface{}{"persistentVolumeClaim": map[string]interface{}{"storageClassName": storageClass, "resources": map[string]interface{}{"requests": map[string]interface{}{"storage": storage}}}},
		}},
		"users": []interface{}{user}, "sharding": map[string]interface{}{"enabled": false},
		"pmm":    map[string]interface{}{"enabled": false, "image": psmdbPMMImage},
		"backup": map[string]interface{}{"enabled": false, "image": psmdbBackupImage},
	}
	labels := u.GetLabels()
	if labels == nil {
		labels = map[string]string{}
	}
	labels[lblManagedBy] = cpManagedBy
	labels[lblPartOf] = "foundation-data"
	labels[lblModel] = "data"
	labels[lblEngine] = "psmdb"
	labels["foundation.opensphere.io/service-claim"] = claim.GetName()
	u.SetLabels(labels)
	_ = unstructured.SetNestedSlice(u.Object, []interface{}{unstructuredOwnerReference(claim)}, "metadata", "ownerReferences")
	return u, nil
}

// unstructuredOwnerReference returns the map form required by an
// unstructured object while preserving the namespaced ownership boundary.
func unstructuredOwnerReference(claim *unstructured.Unstructured) map[string]interface{} {
	return map[string]interface{}{
		"apiVersion": grp + "/" + ver, "kind": "FoundationClaim", "name": claim.GetName(),
		"uid": string(claim.GetUID()), "controller": true, "blockOwnerDeletion": true,
	}
}

func (r *claimReconciler) resolvePSMDBServiceBinding(ctx context.Context, claim *unstructured.Unstructured, contract serviceModuleContract) (serviceBindingProjection, string, error) {
	requestType := requestTypeOf(claim)
	name, namespace := psmdbClaimTarget(claim)
	if requestType == "Instance" {
		managed, err := r.foundationServiceNamespaceAccepted(ctx, claim.GetNamespace())
		if err != nil {
			return serviceBindingProjection{}, "", err
		}
		if !managed {
			return serviceBindingProjection{}, "NamespaceNotManaged", nil
		}
		resource, err := renderPSMDBServiceInstance(claim, r.cfg)
		if err != nil {
			return serviceBindingProjection{}, "InvalidRequest", nil
		}
		if err := applyObj(ctx, r.direct, resource); err != nil {
			return serviceBindingProjection{}, "", err
		}
		name, namespace = claim.GetName(), claim.GetNamespace()
	} else if name == "" {
		return serviceBindingProjection{}, "PSMDBTargetRequired", nil
	}
	target := gvkObj(psmdbGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: namespace, Name: name}, target); err != nil {
		return serviceBindingProjection{}, "PSMDBNotReady", nil
	}
	if !psmdbResourceReady(target) {
		return serviceBindingProjection{}, "PSMDBNotReady", nil
	}
	database := serviceClaimString(claim, "app", "database")
	endpoint := fmt.Sprintf("mongodb://%s-rs0.%s.svc:27017/%s?replicaSet=rs0", name, namespace, database)
	secretName := name + "-custom-user-secret"
	capabilities := append([]string(nil), contract.Capabilities...)
	if requestType != "Instance" {
		if namespace != claim.GetNamespace() {
			return serviceBindingProjection{}, "PSMDBTargetNamespaceMismatch", nil
		}
		credential, username, reason, err := r.ensurePSMDBServiceUser(ctx, claim, target, endpoint)
		if err != nil || reason != "" {
			return serviceBindingProjection{}, reason, err
		}
		secretName = credential.GetName()
		endpoint = fmt.Sprintf("mongodb://%s-rs0.%s.svc:27017/%s?replicaSet=rs0", name, namespace, database)
		if username != "" {
			capabilities = append(capabilities, "user:"+username)
		}
	}
	return serviceBindingProjection{
		Module: contract.ID, Endpoint: endpoint, Probe: fmt.Sprintf("%s-rs0.%s.svc:27017", name, namespace),
		Capabilities: capabilities,
		SecretRef:    map[string]interface{}{"name": secretName, "namespace": namespace},
		ResourceRef:  map[string]interface{}{"apiVersion": "psmdb.percona.com/v1", "kind": "PerconaServerMongoDB", "name": name, "namespace": namespace},
	}, "", nil
}

func (r *claimReconciler) ensurePSMDBServiceUser(
	ctx context.Context,
	claim, target *unstructured.Unstructured,
	endpoint string,
) (*unstructured.Unstructured, string, string, error) {
	database := serviceClaimString(claim, "app", "database")
	username := serviceClaimString(claim, strings.ReplaceAll(claim.GetName(), "-", "_"), "owner")
	if !postgresIdentifier.MatchString(database) || !postgresIdentifier.MatchString(username) {
		return nil, "", "InvalidRequest", nil
	}
	access := serviceClaimString(claim, "ReadWrite", "access")
	role := "readWrite"
	if requestTypeOf(claim) == "Access" && access == "ReadOnly" {
		role = "read"
	} else if access != "ReadWrite" {
		return nil, "", "InvalidRequest", nil
	}
	credential, managed, reason, err := r.ensurePSMDBCredential(ctx, claim, endpoint, database, username)
	if err != nil || reason != "" {
		return nil, "", reason, err
	}
	desired := psmdbDesiredUser(username, database, role, credential.GetName())
	if err := r.updatePSMDBUser(ctx, target.GetNamespace(), target.GetName(), desired); err != nil {
		if errors.Is(err, errPSMDBUserConflict) {
			return nil, "", "PSMDBUserConflict", nil
		}
		return nil, "", "", err
	}
	current := gvkObj(psmdbGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: target.GetNamespace(), Name: target.GetName()}, current); err != nil {
		return nil, "", "PSMDBUserNotReady", nil
	}
	observed, observedFound, _ := unstructured.NestedInt64(current.Object, "status", "observedGeneration")
	if !psmdbResourceReady(current) || (observedFound && observed < current.GetGeneration()) {
		return nil, "", "PSMDBUserNotReady", nil
	}
	if managed {
		labels := credential.GetLabels()
		labels["foundation.opensphere.io/credential-mode"] = "managed"
		credential.SetLabels(labels)
	}
	return credential, username, "", nil
}

func psmdbDesiredUser(username, database, role, credentialSecret string) map[string]interface{} {
	return map[string]interface{}{
		"name": username, "db": database,
		"roles":             []interface{}{map[string]interface{}{"name": role, "db": database}},
		"passwordSecretRef": map[string]interface{}{"name": credentialSecret, "key": "password"},
	}
}

func psmdbUserCredentialName(user map[string]interface{}) string {
	ref, _ := user["passwordSecretRef"].(map[string]interface{})
	name, _ := ref["name"].(string)
	return name
}

func (r *claimReconciler) ensurePSMDBCredential(
	ctx context.Context,
	claim *unstructured.Unstructured,
	endpoint, database, username string,
) (*unstructured.Unstructured, bool, string, error) {
	name, supplied, _ := unstructured.NestedString(claim.Object, "spec", "credentialSecretRef", "name")
	managed := !supplied || strings.TrimSpace(name) == ""
	if managed {
		name = claim.GetName() + "-psmdb-access"
	}
	secret := gvkObj(schema.GroupVersionKind{Version: "v1", Kind: "Secret"})
	nn := types.NamespacedName{Namespace: claim.GetNamespace(), Name: name}
	err := r.direct.Get(ctx, nn, secret)
	if err == nil {
		if secretString(secret, "password") == "" || (!managed && secretString(secret, "username") != username) {
			return nil, managed, "PSMDBCredentialInvalid", nil
		}
		return secret, managed, "", nil
	}
	if !apierrors.IsNotFound(err) {
		return nil, managed, "", err
	}
	if !managed {
		return nil, false, "PSMDBCredentialNotReady", nil
	}
	password, err := randomServicePassword(32)
	if err != nil {
		return nil, true, "", err
	}
	parsed, _ := url.Parse(endpoint)
	uri := *parsed
	uri.User = url.UserPassword(username, password)
	secret = object(schema.GroupVersionKind{Version: "v1", Kind: "Secret"}, claim.GetNamespace(), name)
	secret.Object["type"] = "Opaque"
	secret.Object["data"] = map[string]interface{}{
		"username": base64.StdEncoding.EncodeToString([]byte(username)),
		"password": base64.StdEncoding.EncodeToString([]byte(password)),
		"database": base64.StdEncoding.EncodeToString([]byte(database)),
		"uri":      base64.StdEncoding.EncodeToString([]byte(uri.String())),
		"host":     base64.StdEncoding.EncodeToString([]byte(parsed.Hostname())),
		"port":     base64.StdEncoding.EncodeToString([]byte(parsed.Port())),
	}
	secret.SetLabels(map[string]string{
		lblManagedBy: cpManagedBy, lblPartOf: "foundation-data", lblModel: "data", lblEngine: "psmdb",
		"foundation.opensphere.io/service-claim": claim.GetName(), "foundation.opensphere.io/credential-mode": "managed",
	})
	_ = unstructured.SetNestedSlice(secret.Object, []interface{}{unstructuredOwnerReference(claim)}, "metadata", "ownerReferences")
	if err := applyObj(ctx, r.direct, secret); err != nil {
		return nil, true, "", err
	}
	if err := r.direct.Get(ctx, nn, secret); err != nil {
		return nil, true, "", err
	}
	return secret, true, "", nil
}

func (r *claimReconciler) updatePSMDBUser(ctx context.Context, namespace, name string, desired map[string]interface{}) error {
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		current := gvkObj(psmdbGVK)
		if err := r.direct.Get(ctx, types.NamespacedName{Namespace: namespace, Name: name}, current); err != nil {
			return err
		}
		users, _, _ := unstructured.NestedSlice(current.Object, "spec", "users")
		updated := false
		for index, item := range users {
			user, ok := item.(map[string]interface{})
			if !ok || user["name"] != desired["name"] {
				continue
			}
			if reflect.DeepEqual(user, desired) {
				return nil
			}
			if existingCredential := psmdbUserCredentialName(user); existingCredential != "" && existingCredential != psmdbUserCredentialName(desired) {
				return errPSMDBUserConflict
			}
			users[index], updated = desired, true
			break
		}
		if !updated {
			users = append(users, desired)
		}
		if err := unstructured.SetNestedSlice(current.Object, users, "spec", "users"); err != nil {
			return err
		}
		return r.direct.Update(ctx, current)
	})
}

func (r *claimReconciler) cleanupPSMDBServiceClaim(ctx context.Context, claim *unstructured.Unstructured) (bool, error) {
	if requestTypeOf(claim) == "Instance" {
		return true, nil
	}
	name, namespace := psmdbClaimTarget(claim)
	if name == "" || namespace != claim.GetNamespace() {
		return true, nil
	}
	username := serviceClaimString(claim, strings.ReplaceAll(claim.GetName(), "-", "_"), "owner")
	credentialName, supplied, _ := unstructured.NestedString(claim.Object, "spec", "credentialSecretRef", "name")
	if !supplied || credentialName == "" {
		credentialName = claim.GetName() + "-psmdb-access"
	}
	err := retry.RetryOnConflict(retry.DefaultRetry, func() error {
		current := gvkObj(psmdbGVK)
		if err := r.direct.Get(ctx, types.NamespacedName{Namespace: namespace, Name: name}, current); err != nil {
			return client.IgnoreNotFound(err)
		}
		users, _, _ := unstructured.NestedSlice(current.Object, "spec", "users")
		kept := make([]interface{}, 0, len(users))
		for _, item := range users {
			user, _ := item.(map[string]interface{})
			if user["name"] != username || psmdbUserCredentialName(user) != credentialName {
				kept = append(kept, item)
			}
		}
		if len(kept) == len(users) {
			return nil
		}
		if err := unstructured.SetNestedSlice(current.Object, kept, "spec", "users"); err != nil {
			return err
		}
		return r.direct.Update(ctx, current)
	})
	if err != nil {
		return false, err
	}
	if !supplied {
		secret := object(schema.GroupVersionKind{Version: "v1", Kind: "Secret"}, namespace, claim.GetName()+"-psmdb-access")
		if err := r.direct.Delete(ctx, secret); err != nil && !apierrors.IsNotFound(err) {
			return false, err
		}
	}
	return true, nil
}

func psmdbResourceReady(resource *unstructured.Unstructured) bool {
	for _, path := range [][]string{{"status", "state"}, {"status", "status"}} {
		value, found, _ := unstructured.NestedString(resource.Object, path...)
		if found && strings.EqualFold(value, "ready") {
			return true
		}
	}
	return false
}

func (r *claimReconciler) foundationServiceNamespaceAccepted(ctx context.Context, namespace string) (bool, error) {
	if namespace == r.cfg.managedNS {
		return true, nil
	}
	ns := gvkObj(schema.GroupVersionKind{Version: "v1", Kind: "Namespace"})
	if err := r.direct.Get(ctx, types.NamespacedName{Name: namespace}, ns); err != nil {
		return false, err
	}
	labels := ns.GetLabels()
	return labels["opensphere.io/managed-by"] == "foundation" && labels["opensphere.io/purpose"] == "pfss-service", nil
}
