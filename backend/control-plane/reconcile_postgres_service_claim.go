package main

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

var postgresVersionPattern = regexp.MustCompile(`^[0-9]+(?:\.[0-9]+)?$`)

func (r *claimReconciler) postgresServiceNamespaceAccepted(ctx context.Context, namespace string) (bool, error) {
	if namespace == r.cfg.managedNS {
		return true, nil
	}
	ns := gvkObj(schema.GroupVersionKind{Version: "v1", Kind: "Namespace"})
	if err := r.direct.Get(ctx, types.NamespacedName{Name: namespace}, ns); err != nil {
		return false, err
	}
	return postgresFleetNamespaceAccepted(namespace, r.cfg.managedNS, ns.GetLabels()), nil
}

func postgresServiceTarget(claim *unstructured.Unstructured) (string, string) {
	ref := targetRefOf(claim)
	name, _ := ref["name"].(string)
	namespace, _ := ref["namespace"].(string)
	return strings.TrimSpace(name), strings.TrimSpace(namespace)
}

func renderPostgresServiceClaim(claim *unstructured.Unstructured) (*unstructured.Unstructured, error) {
	requestType := requestTypeOf(claim)
	name := claim.GetName()
	namespace := claim.GetNamespace()
	database := serviceClaimString(claim, strings.ReplaceAll(name, "-", "_"), "database")
	owner := serviceClaimString(claim, strings.ReplaceAll(name, "-", "_")+"_app", "owner")
	if !postgresIdentifier.MatchString(database) || !postgresIdentifier.MatchString(owner) {
		return nil, fmt.Errorf("PostgreSQL database/owner must use the portable identifier contract")
	}

	child := object(postgresClaimGVK, namespace, name)
	spec := map[string]interface{}{
		"database": database, "owner": owner,
	}
	switch requestType {
	case "Instance":
		plan := serviceClaimString(claim, "", "plan")
		if plan == "" {
			plan, _, _ = unstructured.NestedString(claim.Object, "spec", "profileRef", "name")
		}
		if strings.TrimSpace(plan) == "" {
			return nil, fmt.Errorf("PostgreSQL Instance plan is required")
		}
		postgresVersion := serviceClaimString(claim, "", "postgresVersion")
		if !postgresVersionPattern.MatchString(postgresVersion) {
			return nil, fmt.Errorf("PostgreSQL Instance postgresVersion is required")
		}
		deletionPolicy := serviceClaimString(claim, "Retain", "deletionPolicy")
		if deletionPolicy != "Retain" && deletionPolicy != "Delete" {
			return nil, fmt.Errorf("PostgreSQL deletionPolicy must be Retain or Delete")
		}
		spec["isolation"] = postgresModeDedicated
		spec["planRef"] = map[string]interface{}{"name": strings.TrimSpace(plan)}
		spec["postgresVersion"] = postgresVersion
		spec["deletionPolicy"] = deletionPolicy
		storage := map[string]interface{}{}
		if size := serviceClaimString(claim, "", "storage", "size"); size != "" {
			storage["size"] = size
		}
		if storageClass := serviceClaimString(claim, "", "storage", "storageClass"); storageClass != "" {
			storage["storageClass"] = storageClass
		}
		if len(storage) > 0 {
			spec["storage"] = storage
		}
		if extensions, found, _ := unstructured.NestedSlice(claim.Object, "spec", "parameters", "extensions"); found && len(extensions) > 0 {
			spec["extensions"] = extensions
		}
	case "Database", "Access":
		spec["deletionPolicy"] = "Delete"
		targetName, targetNamespace := postgresServiceTarget(claim)
		if targetName == "" {
			return nil, fmt.Errorf("target PostgresClaim is required")
		}
		if targetNamespace == "" {
			targetNamespace = namespace
		}
		spec["clusterRef"] = map[string]interface{}{"name": targetName, "namespace": targetNamespace}
		if requestType == "Database" {
			spec["isolation"] = postgresModeSharedDatabase
			spec["access"] = "Owner"
		} else {
			access := serviceClaimString(claim, "ReadWrite", "access")
			if access != "ReadOnly" && access != "ReadWrite" {
				return nil, fmt.Errorf("PostgreSQL Access must be ReadOnly or ReadWrite")
			}
			spec["isolation"] = postgresModeDatabaseAccess
			spec["access"] = access
		}
	default:
		return nil, fmt.Errorf("unsupported PostgreSQL request type %q", requestType)
	}

	if limit := serviceClaimInt(claim, 0, "connectionLimit"); limit > 0 {
		spec["connectionLimit"] = limit
	}
	profileRefs := map[string]interface{}{}
	for _, field := range []string{"instanceProfile", "postgresConfig", "poolingConfig", "objectStorage"} {
		if value := serviceClaimString(claim, "", "profileRefs", field); value != "" {
			profileRefs[field] = value
		}
	}
	if len(profileRefs) > 0 {
		spec["profileRefs"] = profileRefs
	}
	child.Object["spec"] = spec
	child.SetLabels(map[string]string{
		lblManagedBy:                             cpManagedBy,
		lblPartOf:                                "foundation-data",
		lblModel:                                 "data",
		lblEngine:                                "postgres",
		"foundation.opensphere.io/service-claim": claim.GetName(),
	})
	if alias := strings.TrimSpace(claim.GetAnnotations()["opensphere.io/display-name"]); alias != "" {
		child.SetAnnotations(map[string]string{"opensphere.io/display-name": alias})
	}
	_ = unstructured.SetNestedSlice(child.Object, []interface{}{unstructuredOwnerReference(claim)}, "metadata", "ownerReferences")
	return child, nil
}
