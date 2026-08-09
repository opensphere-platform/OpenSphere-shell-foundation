package main

import (
	"strings"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

// foundationDependencyClaim expresses an operand dependency through the same
// northbound contract exposed to every other consumer. Domain bundles never
// reach into another PFS module's implementation or reuse its root credential.
func foundationDependencyClaim(namespace, name, ownerModel, ownerEngine, targetModel, module, requestType string, parameters map[string]interface{}) *unstructured.Unstructured {
	u := object(fcGVK, namespace, name)
	u.Object["spec"] = map[string]interface{}{
		"model":  targetModel,
		"module": module,
		"request": map[string]interface{}{
			"type": requestType,
		},
		"parameters": parameters,
	}
	stampLabels(u, ownerModel, ownerModel)
	labels := u.GetLabels()
	labels[lblEngine] = ownerEngine
	labels["foundation.opensphere.io/dependency"] = strings.ToLower(module + "-" + requestType)
	u.SetLabels(labels)
	return u
}

func postgresDependencyClaim(namespace, name, ownerModel, ownerEngine, database, owner string) *unstructured.Unstructured {
	u := object(postgresClaimGVK, namespace, name)
	u.Object["spec"] = map[string]interface{}{
		"database":       database,
		"owner":          owner,
		"isolation":      "Dedicated",
		"planRef":        map[string]interface{}{"name": "postgresql-dev-single"},
		"deletionPolicy": "Retain",
	}
	stampLabels(u, ownerModel, ownerModel)
	u.SetLabels(mergeStringMap(u.GetLabels(), map[string]string{
		lblEngine:                             ownerEngine,
		"catalog.opensphere.io/provider":      "stackgres",
		"foundation.opensphere.io/dependency": "postgres-instance",
	}))
	return u
}

func mergeStringMap(base, extra map[string]string) map[string]string {
	if base == nil {
		base = map[string]string{}
	}
	for key, value := range extra {
		base[key] = value
	}
	return base
}
