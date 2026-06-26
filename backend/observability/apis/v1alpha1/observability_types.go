// +groupName=observability.opensphere.io
package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
)

// ObservabilityStackSpec 는 관측성 스택 선언이다.
//
// D-2 운영 plane 신설(arch-001 §7 step 7):
// OTel Collector + Jaeger(추적) + Prometheus(메트릭) + Loki(로그) + Langfuse(LLM obs)
//
// Q7 결정 로그: 호스트 Prometheus 제공 시 게스트는 ServiceMonitor/OTLP export 만.
// HostDelegate=true 면 외부 엔드포인트만 선언하고 내부 operand 를 배포하지 않는다.
type ObservabilityStackSpec struct {
	// HostDelegate=true 면 호스트가 관측성 스택을 제공 → 게스트는 export 만 한다.
	// HostRequirements 에서 선언한 호스트 OTLP endpoint 를 사용.
	// +kubebuilder:default=false
	// +optional
	HostDelegate bool `json:"hostDelegate,omitempty"`

	// OTelCollector 는 OpenTelemetry Collector 설정이다.
	// +optional
	OTelCollector *OTelCollectorSpec `json:"otelCollector,omitempty"`

	// Tracing 은 분산 추적 backend 설정이다 (Jaeger/Tempo).
	// +optional
	Tracing *TracingSpec `json:"tracing,omitempty"`

	// Metrics 는 메트릭 backend 설정이다 (Prometheus).
	// +optional
	Metrics *MetricsSpec `json:"metrics,omitempty"`

	// Logging 은 로그 backend 설정이다 (Loki).
	// +optional
	Logging *LoggingSpec `json:"logging,omitempty"`

	// LLMObservability 는 LLM 관측성 설정이다 (Langfuse, ADR-084).
	// +optional
	LLMObservability *LLMObsSpec `json:"llmObservability,omitempty"`
}

// OTelCollectorSpec 은 OTel Collector operand 설정이다.
type OTelCollectorSpec struct {
	// Enabled=true 면 OTel Collector 를 배포한다.
	// +kubebuilder:default=true
	Enabled bool `json:"enabled,omitempty"`
	// ReceiverOTLP=true 면 OTLP gRPC/HTTP receiver 를 활성화한다.
	// +kubebuilder:default=true
	ReceiverOTLP bool `json:"receiverOtlp,omitempty"`
}

// TracingSpec 은 추적 backend 설정이다.
type TracingSpec struct {
	// Backend 는 추적 엔진이다 (jaeger/tempo).
	// +kubebuilder:validation:Enum=jaeger;tempo
	// +kubebuilder:default=jaeger
	Backend string `json:"backend,omitempty"`
	// RetentionDays 는 추적 데이터 보관 일수다.
	// +kubebuilder:default=7
	RetentionDays int `json:"retentionDays,omitempty"`
}

// MetricsSpec 은 메트릭 backend 설정이다.
type MetricsSpec struct {
	// Enabled=true 면 Prometheus 를 배포한다.
	// HostDelegate=true 이면 이 설정이 무시된다.
	// +kubebuilder:default=true
	Enabled bool `json:"enabled,omitempty"`
	// RetentionDays 는 메트릭 보관 일수다.
	// +kubebuilder:default=15
	RetentionDays int `json:"retentionDays,omitempty"`
}

// LoggingSpec 은 로그 backend 설정이다.
type LoggingSpec struct {
	// Enabled=true 면 Loki 를 배포한다.
	// +kubebuilder:default=true
	Enabled bool `json:"enabled,omitempty"`
	// RetentionDays 는 로그 보관 일수다.
	// +kubebuilder:default=30
	RetentionDays int `json:"retentionDays,omitempty"`
}

// LLMObsSpec 은 LLM 관측성(Langfuse) 설정이다.
type LLMObsSpec struct {
	// Enabled=true 면 Langfuse 를 배포한다.
	// +kubebuilder:default=false
	Enabled bool `json:"enabled,omitempty"`
}

// ObservabilityStackStatus 는 관측성 스택 상태다.
type ObservabilityStackStatus struct {
	// Ready=true 면 전체 스택 준비 완료.
	// +optional
	Ready bool `json:"ready,omitempty"`
	// OTLPEndpoint 는 내부 OTLP gRPC 엔드포인트다 (다른 서비스가 참조).
	// +optional
	OTLPEndpoint string `json:"otlpEndpoint,omitempty"`
	// PrometheusEndpoint 는 Prometheus HTTP 엔드포인트다.
	// +optional
	PrometheusEndpoint string `json:"prometheusEndpoint,omitempty"`
	// Conditions 는 상태 조건이다.
	// +optional
	Conditions []metav1.Condition `json:"conditions,omitempty"`
}

// ObservabilityStack 은 관측성 스택 선언 CR 이다.
//
// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Namespaced,shortName=obs
// +kubebuilder:printcolumn:name="Ready",type=boolean,JSONPath=`.status.ready`
// +kubebuilder:printcolumn:name="Delegate",type=boolean,JSONPath=`.spec.hostDelegate`
type ObservabilityStack struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`
	Spec   ObservabilityStackSpec   `json:"spec,omitempty"`
	Status ObservabilityStackStatus `json:"status,omitempty"`
}

// ObservabilityStackList 는 ObservabilityStack 목록이다.
// +kubebuilder:object:root=true
type ObservabilityStackList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []ObservabilityStack `json:"items"`
}

func (o *ObservabilityStack) DeepCopyObject() runtime.Object {
	if o == nil { return nil }
	out := new(ObservabilityStack); *out = *o
	o.ObjectMeta.DeepCopyInto(&out.ObjectMeta)
	return out
}
func (o *ObservabilityStackList) DeepCopyObject() runtime.Object {
	if o == nil { return nil }
	out := new(ObservabilityStackList); *out = *o
	o.ListMeta.DeepCopyInto(&out.ListMeta)
	if o.Items != nil {
		out.Items = make([]ObservabilityStack, len(o.Items))
		copy(out.Items, o.Items)
	}
	return out
}
