// +groupName=ai.foundation.opensphere.io
package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
)

// LLMRouteClaimSpec 는 Foundation AI 가 publish 할 LLM route capability 선언이다.
type LLMRouteClaimSpec struct {
	// Tier 는 라우팅 계층이다. basic 은 1-tier, standard 는 3-tier policy 를 의미한다.
	// +kubebuilder:validation:Enum=basic;standard;regulated
	// +kubebuilder:default=basic
	Tier string `json:"tier,omitempty"`

	// ProviderPolicy 는 허용 provider 정책이다.
	// +optional
	ProviderPolicy *ProviderPolicySpec `json:"providerPolicy,omitempty"`

	// ObservabilityRef 는 Langfuse/OTLP 같은 LLM observability capability 참조다.
	// +optional
	ObservabilityRef *CapabilityRef `json:"observabilityRef,omitempty"`
}

// ProviderPolicySpec 는 모델 provider 선택 정책이다.
type ProviderPolicySpec struct {
	// PreferDomestic=true 면 국내/내부 provider 를 우선한다.
	// +kubebuilder:default=false
	PreferDomestic bool `json:"preferDomestic,omitempty"`

	// AllowedProviders 는 route 가 사용할 수 있는 provider 이름 목록이다.
	// +optional
	AllowedProviders []string `json:"allowedProviders,omitempty"`
}

// VectorRetrievalClaimSpec 는 vector RAG retrieval capability 선언이다.
type VectorRetrievalClaimSpec struct {
	// IndexRef 는 foundation-data 의 Index capability 참조다.
	IndexRef CapabilityRef `json:"indexRef"`

	// EmbeddingRouteRef 는 embedding 모델 route 참조다.
	// +optional
	EmbeddingRouteRef *CapabilityRef `json:"embeddingRouteRef,omitempty"`
}

// CapabilityRef 는 다른 OpenSphere capability binding 참조다.
type CapabilityRef struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace,omitempty"`
}

// FoundationAIClaimStatus 는 published capability 상태다.
type FoundationAIClaimStatus struct {
	Ready bool `json:"ready,omitempty"`
	// Endpoint 는 내부 서비스 엔드포인트다.
	// +optional
	Endpoint string `json:"endpoint,omitempty"`
	// Conditions 는 상태 조건이다.
	// +optional
	Conditions []metav1.Condition `json:"conditions,omitempty"`
}

// LLMRouteClaim 은 P4 가 소비할 LLM route published capability 다.
//
// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Namespaced,shortName=llmroute
// +kubebuilder:printcolumn:name="Ready",type=boolean,JSONPath=`.status.ready`
type LLMRouteClaim struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`
	Spec              LLMRouteClaimSpec       `json:"spec,omitempty"`
	Status            FoundationAIClaimStatus `json:"status,omitempty"`
}

// LLMRouteClaimList 는 LLMRouteClaim 목록이다.
// +kubebuilder:object:root=true
type LLMRouteClaimList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []LLMRouteClaim `json:"items"`
}

// VectorRetrievalClaim 은 P4 가 소비할 vector retrieval capability 다.
//
// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Namespaced,shortName=vecret
// +kubebuilder:printcolumn:name="Ready",type=boolean,JSONPath=`.status.ready`
type VectorRetrievalClaim struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`
	Spec              VectorRetrievalClaimSpec `json:"spec,omitempty"`
	Status            FoundationAIClaimStatus  `json:"status,omitempty"`
}

// VectorRetrievalClaimList 는 VectorRetrievalClaim 목록이다.
// +kubebuilder:object:root=true
type VectorRetrievalClaimList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []VectorRetrievalClaim `json:"items"`
}

func (o *LLMRouteClaim) DeepCopyObject() runtime.Object {
	if o == nil {
		return nil
	}
	out := new(LLMRouteClaim)
	*out = *o
	o.ObjectMeta.DeepCopyInto(&out.ObjectMeta)
	return out
}

func (o *LLMRouteClaimList) DeepCopyObject() runtime.Object {
	if o == nil {
		return nil
	}
	out := new(LLMRouteClaimList)
	*out = *o
	o.ListMeta.DeepCopyInto(&out.ListMeta)
	if o.Items != nil {
		out.Items = make([]LLMRouteClaim, len(o.Items))
		copy(out.Items, o.Items)
	}
	return out
}

func (o *VectorRetrievalClaim) DeepCopyObject() runtime.Object {
	if o == nil {
		return nil
	}
	out := new(VectorRetrievalClaim)
	*out = *o
	o.ObjectMeta.DeepCopyInto(&out.ObjectMeta)
	return out
}

func (o *VectorRetrievalClaimList) DeepCopyObject() runtime.Object {
	if o == nil {
		return nil
	}
	out := new(VectorRetrievalClaimList)
	*out = *o
	o.ListMeta.DeepCopyInto(&out.ListMeta)
	if o.Items != nil {
		out.Items = make([]VectorRetrievalClaim, len(o.Items))
		copy(out.Items, o.Items)
	}
	return out
}
