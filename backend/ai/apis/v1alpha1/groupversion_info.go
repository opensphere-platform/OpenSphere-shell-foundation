// +kubebuilder:object:generate=true
// +groupName=ai.foundation.opensphere.io
package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

var (
	GroupVersion  = schema.GroupVersion{Group: "ai.foundation.opensphere.io", Version: "v1alpha1"}
	SchemeBuilder = runtime.NewSchemeBuilder(addKnownTypes)
	AddToScheme   = SchemeBuilder.AddToScheme
)

func addKnownTypes(s *runtime.Scheme) error {
	s.AddKnownTypes(GroupVersion,
		&LLMRouteClaim{}, &LLMRouteClaimList{},
		&VectorRetrievalClaim{}, &VectorRetrievalClaimList{},
	)
	metav1.AddToGroupVersion(s, GroupVersion)
	return nil
}
