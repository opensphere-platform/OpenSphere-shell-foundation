package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

var certificateGVK = schema.GroupVersionKind{Group: "cert-manager.io", Version: "v1", Kind: "Certificate"}

func opaClaimStem(claim *unstructured.Unstructured) string {
	sum := sha256.Sum256([]byte(claim.GetNamespace() + "/" + claim.GetName()))
	return "opa-client-" + hex.EncodeToString(sum[:8])
}

func opaClientCertificate(cfg *config, claim *unstructured.Unstructured) *unstructured.Unstructured {
	stem := opaClaimStem(claim)
	certificate := object(certificateGVK, cfg.managedNS, stem)
	certificate.SetLabels(map[string]string{lblManagedBy: cpManagedBy, lblPartOf: "foundation-identity", lblModel: "identity", lblEngine: "opa", "foundation.opensphere.io/service-claim": claim.GetName(), "foundation.opensphere.io/service-namespace": claim.GetNamespace()})
	certificate.Object["spec"] = map[string]interface{}{
		"secretName": stem + "-tls", "commonName": stem,
		"duration": "2160h", "renewBefore": "360h", "usages": []interface{}{"client auth"},
		"issuerRef": map[string]interface{}{"name": "foundation-identity-opa-ca", "kind": "Issuer", "group": "cert-manager.io"},
	}
	return certificate
}

func opaPolicyPath(claim *unstructured.Unstructured) string {
	value := serviceClaimString(claim, "opensphere/authz/allow", "path")
	return strings.Trim(strings.TrimSpace(value), "/")
}

func (r *claimReconciler) opaReady(ctx context.Context) bool {
	for _, name := range []string{opaName, opaControlName} {
		deployment := gvkObj(schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"})
		if err := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: name}, deployment); err != nil {
			return false
		}
		desired, _, _ := unstructured.NestedInt64(deployment.Object, "spec", "replicas")
		ready, _, _ := unstructured.NestedInt64(deployment.Object, "status", "readyReplicas")
		if desired < 1 || ready < desired {
			return false
		}
	}
	return true
}

func (r *claimReconciler) resolveOPAServiceBinding(ctx context.Context, claim *unstructured.Unstructured, contract serviceModuleContract) (serviceBindingProjection, string, error) {
	managed, err := r.foundationServiceNamespaceAccepted(ctx, claim.GetNamespace())
	if err != nil {
		return serviceBindingProjection{}, "", err
	}
	if !managed {
		return serviceBindingProjection{}, "NamespaceNotManaged", nil
	}
	if !r.opaReady(ctx) {
		return serviceBindingProjection{}, "OPANotReady", nil
	}
	endpoint := "https://" + opaName + "." + r.cfg.managedNS + ".svc:8181"
	projection := serviceBindingProjection{Module: contract.ID, Endpoint: endpoint, Probe: opaName + "." + r.cfg.managedNS + ".svc:8181", Capabilities: append([]string(nil), contract.Capabilities...), ResourceRef: map[string]interface{}{"apiVersion": "apps/v1", "kind": "Deployment", "name": opaName, "namespace": r.cfg.managedNS}}
	switch requestTypeOf(claim) {
	case "Instance":
		return projection, "", nil
	case "Policy":
		path := opaPolicyPath(claim)
		if path != "opensphere/authz/allow" {
			return serviceBindingProjection{}, "OPAReviewedBundlePolicyRequired", nil
		}
		projection.Endpoint += "/v1/data/" + path
		projection.ResourceRef = map[string]interface{}{"apiVersion": "opa.opensphere.io/v1", "kind": "SignedBundlePolicy", "name": path, "namespace": opaProductionBundleRevision}
		projection.Capabilities = append(projection.Capabilities, "policy:"+path, "revision:"+opaProductionBundleRevision)
		return projection, "", nil
	case "Access":
		certificate := opaClientCertificate(r.cfg, claim)
		if err := applyObj(ctx, r.direct, certificate); err != nil {
			return serviceBindingProjection{}, "", err
		}
		stem := opaClaimStem(claim)
		source := gvkObj(coreSecretGVK)
		if err := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: stem + "-tls"}, source); err != nil {
			if apierrors.IsNotFound(err) {
				return serviceBindingProjection{}, "OPAClientCertificatePending", nil
			}
			return serviceBindingProjection{}, "", err
		}
		data, _, _ := unstructured.NestedMap(source.Object, "data")
		for _, key := range []string{"tls.crt", "tls.key", "ca.crt"} {
			if value, ok := data[key].(string); !ok || value == "" {
				return serviceBindingProjection{}, "OPAClientCertificateInvalid", nil
			}
		}
		outputName := stem + "-access"
		output := object(coreSecretGVK, claim.GetNamespace(), outputName)
		output.Object["type"] = "kubernetes.io/tls"
		output.Object["data"] = data
		output.SetLabels(map[string]string{lblManagedBy: cpManagedBy, lblPartOf: "foundation-identity", lblModel: "identity", lblEngine: "opa", "foundation.opensphere.io/service-claim": claim.GetName()})
		output.SetAnnotations(map[string]string{"foundation.opensphere.io/endpoint": endpoint, "foundation.opensphere.io/required-pod-label": "foundation.opensphere.io/opa-client=true"})
		_ = unstructured.SetNestedSlice(output.Object, []interface{}{unstructuredOwnerReference(claim)}, "metadata", "ownerReferences")
		if err := applyObj(ctx, r.direct, output); err != nil {
			return serviceBindingProjection{}, "", err
		}
		projection.SecretRef = map[string]interface{}{"name": outputName, "namespace": claim.GetNamespace()}
		projection.ResourceRef = map[string]interface{}{"apiVersion": "cert-manager.io/v1", "kind": "Certificate", "name": stem, "namespace": r.cfg.managedNS}
		projection.Capabilities = append(projection.Capabilities, "transport:mtls", "policy:opensphere/authz/allow")
		return projection, "", nil
	default:
		return serviceBindingProjection{}, "UnsupportedRequestType", nil
	}
}

func (r *claimReconciler) cleanupOPAServiceClaim(ctx context.Context, claim *unstructured.Unstructured) (bool, error) {
	if requestTypeOf(claim) != "Access" {
		return true, nil
	}
	stem := opaClaimStem(claim)
	objects := []*unstructured.Unstructured{
		object(certificateGVK, r.cfg.managedNS, stem),
		object(coreSecretGVK, r.cfg.managedNS, stem+"-tls"),
		object(coreSecretGVK, claim.GetNamespace(), stem+"-access"),
	}
	pending := false
	for _, value := range objects {
		if err := r.direct.Delete(ctx, value); err != nil {
			if !apierrors.IsNotFound(err) {
				return false, err
			}
		} else {
			pending = true
		}
	}
	return !pending, nil
}
