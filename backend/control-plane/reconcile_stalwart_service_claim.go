package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

var (
	stalwartDomainPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$`)
	stalwartLocalPattern  = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$`)
	jobGVK                = schema.GroupVersionKind{Group: "batch", Version: "v1", Kind: "Job"}
)

func stalwartClaimResourceName(claim *unstructured.Unstructured, suffix string) string {
	sum := sha256.Sum256([]byte(claim.GetNamespace() + "/" + claim.GetName()))
	name := strings.Trim(strings.ToLower("stalwart-"+claim.GetName()+"-"+suffix), "-")
	name = regexp.MustCompile(`[^a-z0-9-]+`).ReplaceAllString(name, "-")
	if len(name) > 52 {
		name = strings.TrimRight(name[:52], "-")
	}
	return name + "-" + hex.EncodeToString(sum[:4])
}

func stalwartParameters(claim *unstructured.Unstructured) map[string]interface{} {
	values, _, _ := unstructured.NestedMap(claim.Object, "spec", "parameters")
	return values
}

func stalwartString(values map[string]interface{}, key string) string {
	value, found := values[key]
	if !found || value == nil {
		return ""
	}
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}

func validStalwartDomain(value string) bool {
	return len(value) <= 253 && stalwartDomainPattern.MatchString(value)
}

func validStalwartLocalPart(value string) bool {
	return len(value) <= 64 && stalwartLocalPattern.MatchString(value)
}

func stalwartPlan(claim *unstructured.Unstructured, password string) (string, string, string, bool) {
	requestType := requestTypeOf(claim)
	parameters := stalwartParameters(claim)
	domain := strings.ToLower(stalwartString(parameters, "domain"))
	if !validStalwartDomain(domain) {
		return "", "", "", false
	}
	domainBody := map[string]interface{}{"name": domain, "isEnabled": true, "description": "Managed by OpenSphere FoundationClaim " + claim.GetNamespace() + "/" + claim.GetName()}
	domainOp := map[string]interface{}{"@type": "upsert", "object": "Domain", "matchOn": []string{"name"}, "value": map[string]interface{}{"mail-domain": domainBody}}
	lines := []map[string]interface{}{domainOp}
	localPart := ""
	if requestType == "Mailbox" {
		localPart = strings.ToLower(stalwartString(parameters, "localPart"))
		if !validStalwartLocalPart(localPart) || len(password) < 24 {
			return "", "", "", false
		}
		account := map[string]interface{}{
			"@type": "User", "name": localPart, "domainId": "#mail-domain",
			"description": stalwartString(parameters, "displayName"),
			"credentials": map[string]interface{}{"0": map[string]interface{}{"@type": "Password", "secret": password}},
		}
		lines = append(lines, map[string]interface{}{"@type": "upsert", "object": "Account", "matchOn": []string{"name", "domainId"}, "value": map[string]interface{}{"mailbox": account}})
	} else if requestType != "MailDomain" {
		return "", "", "", false
	}
	encoded := make([]string, 0, len(lines))
	for _, line := range lines {
		value, err := json.Marshal(line)
		if err != nil {
			return "", "", "", false
		}
		encoded = append(encoded, string(value))
	}
	return strings.Join(encoded, "\n") + "\n", domain, localPart, true
}

func stalwartAccessSecretName(claimName string) string {
	name := strings.ToLower(claimName + "-stalwart-access")
	if len(name) > 63 {
		name = strings.TrimRight(name[:63], "-")
	}
	return name
}

func (r *claimReconciler) ensureStalwartMailboxSecret(ctx context.Context, claim *unstructured.Unstructured, domain, localPart string) (*unstructured.Unstructured, error) {
	name := stalwartAccessSecretName(claim.GetName())
	secret := gvkObj(coreSecretGVK)
	key := types.NamespacedName{Namespace: claim.GetNamespace(), Name: name}
	if err := r.direct.Get(ctx, key, secret); err == nil {
		return secret, nil
	} else if !apierrors.IsNotFound(err) {
		return nil, err
	}
	password, err := randomPassword(36)
	if err != nil {
		return nil, err
	}
	secret = object(coreSecretGVK, claim.GetNamespace(), name)
	secret.SetLabels(map[string]string{"app.kubernetes.io/managed-by": "foundation-control-plane", "foundation.opensphere.io/service-claim": claim.GetName(), "foundation.opensphere.io/module": "stalwart"})
	secret.Object["type"] = "Opaque"
	secret.Object["stringData"] = map[string]interface{}{
		"username": localPart, "password": password, "email": localPart + "@" + domain,
		"smtpHost": stalwartName + "." + r.cfg.managedNS + ".svc", "smtpPort": "587",
		"imapHost": stalwartName + "." + r.cfg.managedNS + ".svc", "imapPort": "993",
	}
	if err := applyObj(ctx, r.direct, secret); err != nil {
		return nil, err
	}
	if err := r.direct.Get(ctx, key, secret); err != nil {
		return nil, err
	}
	return secret, nil
}

func stalwartApplyJob(cfg *config, claim *unstructured.Unstructured, planSecret, digest string) *unstructured.Unstructured {
	name := stalwartClaimResourceName(claim, "apply")
	job := object(jobGVK, cfg.managedNS, name)
	labels := map[string]string{"app.kubernetes.io/managed-by": "foundation-control-plane", "foundation.opensphere.io/service-claim": claim.GetName(), "foundation.opensphere.io/service-namespace": claim.GetNamespace(), "foundation.opensphere.io/module": "stalwart"}
	job.SetLabels(labels)
	job.SetAnnotations(map[string]string{"foundation.opensphere.io/plan-digest": digest, "foundation.opensphere.io/data-retention": "retain-product-object-on-claim-release"})
	job.Object["spec"] = map[string]interface{}{
		"backoffLimit": int64(3),
		"template": map[string]interface{}{"metadata": map[string]interface{}{"labels": mapStringInterface(labels)}, "spec": map[string]interface{}{
			"restartPolicy": "Never", "automountServiceAccountToken": false,
			"imagePullSecrets": []interface{}{map[string]interface{}{"name": "opensphere-ghcr-pull"}},
			"securityContext":  map[string]interface{}{"runAsNonRoot": true, "seccompProfile": map[string]interface{}{"type": "RuntimeDefault"}},
			"containers": []interface{}{map[string]interface{}{
				"name": "stalwart-cli", "image": cfg.stalwartCLIImage,
				"args": []interface{}{"apply", "--file", "/plan/plan.ndjson", "--json"},
				"env": []interface{}{
					map[string]interface{}{"name": "STALWART_URL", "value": "http://" + stalwartName + "." + cfg.managedNS + ".svc:8080"},
					secretEnv("STALWART_USER", communicationRuntimeSecret, "stalwart-admin-user"),
					secretEnv("STALWART_PASSWORD", communicationRuntimeSecret, "stalwart-admin-password"),
					literalEnv("NO_COLOR", "1"),
				},
				"volumeMounts":    []interface{}{map[string]interface{}{"name": "plan", "mountPath": "/plan", "readOnly": true}},
				"resources":       map[string]interface{}{"requests": map[string]interface{}{"cpu": "10m", "memory": "24Mi"}, "limits": map[string]interface{}{"cpu": "250m", "memory": "128Mi"}},
				"securityContext": map[string]interface{}{"allowPrivilegeEscalation": false, "readOnlyRootFilesystem": true, "capabilities": map[string]interface{}{"drop": []interface{}{"ALL"}}},
			}},
			"volumes": []interface{}{map[string]interface{}{"name": "plan", "secret": map[string]interface{}{"secretName": planSecret}}},
		}},
	}
	return job
}

func mapStringInterface(values map[string]string) map[string]interface{} {
	result := make(map[string]interface{}, len(values))
	for key, value := range values {
		result[key] = value
	}
	return result
}

func (r *claimReconciler) reconcileStalwartPlan(ctx context.Context, claim *unstructured.Unstructured, plan string) (bool, string, error) {
	digestBytes := sha256.Sum256([]byte(plan))
	digest := "sha256:" + hex.EncodeToString(digestBytes[:])
	jobName := stalwartClaimResourceName(claim, "apply")
	planSecretName := stalwartClaimResourceName(claim, "plan")
	current := gvkObj(jobGVK)
	err := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: jobName}, current)
	if err == nil {
		if current.GetAnnotations()["foundation.opensphere.io/plan-digest"] != digest {
			if err := r.direct.Delete(ctx, current); err != nil && !apierrors.IsNotFound(err) {
				return false, "", err
			}
			return false, "StalwartPlanChanged", nil
		}
		succeeded, _, _ := unstructured.NestedInt64(current.Object, "status", "succeeded")
		if succeeded > 0 {
			planSecret := object(coreSecretGVK, r.cfg.managedNS, planSecretName)
			_ = r.direct.Delete(ctx, planSecret)
			return true, "", nil
		}
		failed, _, _ := unstructured.NestedInt64(current.Object, "status", "failed")
		if failed > 0 {
			return false, "StalwartApplyFailed", nil
		}
		return false, "StalwartApplyRunning", nil
	}
	if !apierrors.IsNotFound(err) {
		return false, "", err
	}
	planSecret := object(coreSecretGVK, r.cfg.managedNS, planSecretName)
	planSecret.SetLabels(map[string]string{"app.kubernetes.io/managed-by": "foundation-control-plane", "foundation.opensphere.io/service-claim": claim.GetName(), "foundation.opensphere.io/service-namespace": claim.GetNamespace(), "foundation.opensphere.io/module": "stalwart"})
	planSecret.Object["type"] = "Opaque"
	planSecret.Object["stringData"] = map[string]interface{}{"plan.ndjson": plan}
	if err := applyObj(ctx, r.direct, planSecret); err != nil {
		return false, "", err
	}
	if err := applyObj(ctx, r.direct, stalwartApplyJob(r.cfg, claim, planSecretName, digest)); err != nil {
		return false, "", err
	}
	return false, "StalwartApplyStarted", nil
}

func (r *claimReconciler) resolveStalwartServiceBinding(ctx context.Context, claim *unstructured.Unstructured, contract serviceModuleContract) (serviceBindingProjection, string, error) {
	requestType := requestTypeOf(claim)
	endpoint := "smtp://" + stalwartName + "." + r.cfg.managedNS + ".svc:587"
	probe := stalwartName + "." + r.cfg.managedNS + ".svc:587"
	if requestType == "Instance" {
		return serviceBindingProjection{Module: contract.ID, Endpoint: endpoint, Probe: probe, Capabilities: append([]string(nil), contract.Capabilities...), ResourceRef: map[string]interface{}{"apiVersion": grp + "/" + ver, "kind": "FoundationModel", "name": contract.Model}}, "", nil
	}
	if requestType == "Access" {
		target := targetRefOf(claim)
		name := strings.TrimSpace(fmt.Sprint(target["name"]))
		if name == "" {
			return serviceBindingProjection{}, "MailboxTargetRequired", nil
		}
		secretName := stalwartAccessSecretName(name)
		secret := gvkObj(coreSecretGVK)
		if err := r.direct.Get(ctx, types.NamespacedName{Namespace: claim.GetNamespace(), Name: secretName}, secret); err != nil {
			return serviceBindingProjection{}, "MailboxAccessNotReady", clientIgnoreNotFound(err)
		}
		return serviceBindingProjection{Module: contract.ID, Endpoint: endpoint, Probe: probe, Capabilities: append([]string(nil), contract.Capabilities...), SecretRef: map[string]interface{}{"name": secretName, "namespace": claim.GetNamespace()}, ResourceRef: map[string]interface{}{"apiVersion": "stalwart.opensphere.io/v1", "kind": "Mailbox", "name": name, "namespace": claim.GetNamespace()}}, "", nil
	}
	password := ""
	parameters := stalwartParameters(claim)
	domain := strings.ToLower(stalwartString(parameters, "domain"))
	localPart := strings.ToLower(stalwartString(parameters, "localPart"))
	var accessSecret *unstructured.Unstructured
	var err error
	if requestType == "Mailbox" {
		if !validStalwartDomain(domain) || !validStalwartLocalPart(localPart) {
			return serviceBindingProjection{}, "InvalidMailboxAddress", nil
		}
		accessSecret, err = r.ensureStalwartMailboxSecret(ctx, claim, domain, localPart)
		if err != nil {
			return serviceBindingProjection{}, "", err
		}
		password = secretString(accessSecret, "password")
	}
	plan, domain, localPart, valid := stalwartPlan(claim, password)
	if !valid {
		return serviceBindingProjection{}, "InvalidStalwartRequest", nil
	}
	ready, reason, err := r.reconcileStalwartPlan(ctx, claim, plan)
	if err != nil || !ready {
		return serviceBindingProjection{}, reason, err
	}
	kind, name := "MailDomain", domain
	projection := serviceBindingProjection{Module: contract.ID, Endpoint: endpoint, Probe: probe, Capabilities: append([]string(nil), contract.Capabilities...)}
	if requestType == "Mailbox" {
		kind, name = "Mailbox", localPart+"@"+domain
		projection.SecretRef = map[string]interface{}{"name": accessSecret.GetName(), "namespace": accessSecret.GetNamespace()}
	}
	projection.ResourceRef = map[string]interface{}{"apiVersion": "stalwart.opensphere.io/v1", "kind": kind, "name": name, "namespace": claim.GetNamespace()}
	return projection, "", nil
}

// Stalwart mailbox/domain objects are retained on claim release. Mail data is
// not a safe implicit-delete target; the operator revokes the generated access
// Secret and removes only its transient apply evidence. A separately governed
// data-erasure operation can destroy the product object after retention review.
func (r *claimReconciler) cleanupStalwartServiceClaim(ctx context.Context, claim *unstructured.Unstructured) (bool, error) {
	objects := []*unstructured.Unstructured{
		object(jobGVK, r.cfg.managedNS, stalwartClaimResourceName(claim, "apply")),
		object(coreSecretGVK, r.cfg.managedNS, stalwartClaimResourceName(claim, "plan")),
	}
	if requestTypeOf(claim) == "Mailbox" {
		objects = append(objects, object(coreSecretGVK, claim.GetNamespace(), stalwartAccessSecretName(claim.GetName())))
	}
	pending := false
	for _, value := range objects {
		err := r.direct.Delete(ctx, value)
		if err != nil && !apierrors.IsNotFound(err) {
			return false, err
		}
		if err == nil {
			pending = true
		}
	}
	return !pending, nil
}
