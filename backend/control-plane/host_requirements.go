// host_requirements.go — PFS module이 소비하는 HIS 자원 요구 선언(CONSTITUTION-0004 §2.0.1).
// FoundationModuleDescriptor가 아직 Go 타입도 클러스터 인스턴스도 없어(§6 실측: CR 0개) 전체 CRD 스키마 레벨
// 선언은 이번 증분의 범위 밖이다. 대신 이미 실재하는 계약점(FoundationModel.spec.parameters, dataParams가 쓰는
// 것과 동일 경로)에 hostRequirements 서브필드를 추가해 "standard" 같은 리터럴 하드코딩을 걷어낸다.
// 전체 FoundationModuleDescriptor.spec.hostRequirements CRD 필드화는 후속 증분.
package main

import "k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

// HostRequirements — PFS 모듈이 Host Infrastructure Service Stack에 요구하는 자원.
type HostRequirements struct {
	// StorageClass — PVC가 참조할 HIS StorageClass 이름.
	StorageClass string
	// PrometheusDelegate — true면 자체 Prometheus를 배포하지 않고 ServiceMonitor로 HIS
	// kube-prometheus-stack에 위임한다.
	PrometheusDelegate bool
}

// readHostRequirements — FoundationModel.spec.parameters.hostRequirements를 읽고, 미선언 필드는
// cfg 기본값(cluster 운영자가 -default-storage-class 등으로 선언)으로 채운다.
// storageClass 우선순위: spec.parameters.storageClass(기존 평탄 필드, dataParams가 최종 override) >
// spec.parameters.hostRequirements.storageClass(여기) > cfg.defaultStorageClass(최종 기본값).
func readHostRequirements(fm *unstructured.Unstructured, cfg *config) HostRequirements {
	hr := HostRequirements{StorageClass: cfg.defaultStorageClass, PrometheusDelegate: true}
	p, _, _ := unstructured.NestedMap(fm.Object, "spec", "parameters", "hostRequirements")
	if p == nil {
		return hr
	}
	if sc, ok := p["storageClass"].(string); ok && sc != "" {
		hr.StorageClass = sc
	}
	if pd, ok := p["prometheusDelegate"].(bool); ok {
		hr.PrometheusDelegate = pd
	}
	return hr
}
