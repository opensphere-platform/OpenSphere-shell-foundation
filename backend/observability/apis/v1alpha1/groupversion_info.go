// +kubebuilder:object:generate=true
// +groupName=observability.opensphere.io
package v1alpha1

import (
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

var (
	GroupVersion  = schema.GroupVersion{Group: "observability.opensphere.io", Version: "v1alpha1"}
	SchemeBuilder = runtime.NewSchemeBuilder(addKnownTypes)
	AddToScheme   = SchemeBuilder.AddToScheme
)

func addKnownTypes(s *runtime.Scheme) error {
	s.AddKnownTypes(GroupVersion,
		&ObservabilityStack{}, &ObservabilityStackList{},
	)
	metav1.AddToGroupVersion(s, GroupVersion)
	return nil
}
