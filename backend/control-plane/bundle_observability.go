// bundle_observability.go — 제네릭 번들 빌더 + observability operand(OTel Collector) 정의·관측.
package main

import (
	"context"
	_ "embed"
	"fmt"
	"strconv"
	"strings"
	"time"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"sigs.k8s.io/yaml"
)

//go:embed bundle_observability.yaml
var observabilityBundleYAML string

const collectorName = "foundation-observability-collector"

// buildBundle — 임베드 YAML(__NAMESPACE__/__IMAGE__ 치환)을 unstructured로 파싱 + 소유 라벨 스탬프(모든 모델 공용).
func buildBundle(doc, ns, image, model, ownerFM string) ([]*unstructured.Unstructured, error) {
	doc = strings.ReplaceAll(doc, "__NAMESPACE__", ns)
	doc = strings.ReplaceAll(doc, "__IMAGE__", image)
	doc = strings.ReplaceAll(doc, "\r\n", "\n") // CRLF(Windows 체크아웃) 정규화 — 멀티문서 분할 보장(아니면 첫 문서만 파싱됨).
	var objs []*unstructured.Unstructured
	for _, part := range strings.Split(doc, "\n---\n") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		m := map[string]interface{}{}
		if err := yaml.Unmarshal([]byte(part), &m); err != nil {
			return nil, fmt.Errorf("번들 파싱 실패: %w", err)
		}
		if len(m) == 0 {
			continue
		}
		u := &unstructured.Unstructured{Object: m}
		stampLabels(u, model, ownerFM)
		objs = append(objs, u)
	}
	return objs, nil
}

// imageTag — operand 이미지의 태그(status.operator.version 표기용).
func imageTag(img string) string {
	if i := strings.LastIndex(img, ":"); i >= 0 && i < len(img)-1 {
		return img[i+1:]
	}
	return img
}

// ensureNamespace — 공유 ns 보장(SSA, 멱등). 공유 자원이라 owner-fm 라벨 미부착·절대 삭제 안 함.
func ensureNamespace(name string) *unstructured.Unstructured {
	return &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "v1",
		"kind":       "Namespace",
		"metadata": map[string]interface{}{
			"name":   name,
			"labels": map[string]interface{}{lblManagedBy: cpManagedBy},
		},
	}}
}

func buildObservabilityBundle(cfg *config, fm *unstructured.Unstructured) ([]*unstructured.Unstructured, error) {
	objs, err := buildBundle(observabilityBundleYAML, cfg.managedNS, cfg.collectorImage, "observability", fm.GetName())
	if err != nil {
		return nil, err
	}
	if !engineEnabled(fm, "otel") {
		kept := objs[:0]
		for _, o := range objs {
			if o.GetLabels()[lblEngine] != "otel" {
				kept = append(kept, o)
			}
		}
		objs = kept
	} else {
		configureCollectorPipeline(objs, cfg.managedNS, engineEnabled(fm, "tempo"), engineEnabled(fm, "loki"))
	}
	if engineEnabled(fm, "tempo") {
		objs = append(objs, buildTempoBundle(cfg, fm)...)
	}
	if engineEnabled(fm, "loki") {
		objs = append(objs, buildLokiBundle(cfg, fm)...)
	}
	if engineEnabled(fm, "tempo") || engineEnabled(fm, "loki") {
		objs = append(objs, buildObservabilityGatewayBundle(cfg, fm)...)
	}
	if engineEnabled(fm, "grafana-operator") {
		objs = append(objs, buildGrafanaBundle(cfg, fm)...)
	}
	// PrometheusDelegate=false(HostRequirements, §1.2)면 Basic Prometheus 위임을 원치 않는 것이므로
	// ServiceMonitor를 아예 선언하지 않는다(기본=true라 통상 경로는 영향 없음).
	if !readHostRequirements(fm, cfg).PrometheusDelegate {
		kept := objs[:0]
		for _, o := range objs {
			if o.GetKind() != "ServiceMonitor" {
				kept = append(kept, o)
			}
		}
		objs = kept
	}
	return objs, nil
}

// configureCollectorPipeline turns the bundled collector from a debug-only
// receiver into the shared PFSS telemetry bridge.  The generated exporters
// follow the native OTLP endpoints documented by Tempo and Loki; disabled
// stores are never referenced so a partial observability profile stays valid.
func configureCollectorPipeline(objs []*unstructured.Unstructured, ns string, tempoEnabled, lokiEnabled bool) {
	for _, obj := range objs {
		if obj.GetKind() != "ConfigMap" || obj.GetName() != collectorName+"-config" {
			continue
		}
		data, _, _ := unstructured.NestedStringMap(obj.Object, "data")
		if data == nil {
			data = map[string]string{}
		}
		data["config.yaml"] = collectorPipelineConfig(ns, tempoEnabled, lokiEnabled)
		_ = unstructured.SetNestedStringMap(obj.Object, data, "data")
	}
}

func collectorPipelineConfig(ns string, tempoEnabled, lokiEnabled bool) string {
	traceExporters := "[debug]"
	logExporters := "[debug]"
	extraExporters := ""
	if tempoEnabled {
		traceExporters = "[otlp/tempo]"
		extraExporters += fmt.Sprintf(`
  otlp/tempo:
    endpoint: %s.%s.svc:4317
    headers:
      x-scope-orgid: opensphere-platform
    tls:
      insecure: true`, tempoName, ns)
	}
	if lokiEnabled {
		logExporters = "[otlphttp/loki]"
		extraExporters += fmt.Sprintf(`
  otlphttp/loki:
    endpoint: http://%s.%s.svc:3100/otlp
    headers:
      x-scope-orgid: opensphere-platform`, lokiName, ns)
	}
	return fmt.Sprintf(`receivers:
  otlp:
    protocols:
      grpc: { endpoint: 0.0.0.0:4317 }
      http: { endpoint: 0.0.0.0:4318 }
processors:
  memory_limiter:
    check_interval: 5s
    limit_percentage: 80
    spike_limit_percentage: 25
  batch: {}
exporters:
  debug:
    verbosity: basic
  prometheus:
    endpoint: 0.0.0.0:8889%s
extensions:
  health_check:
    endpoint: 0.0.0.0:13133
service:
  extensions: [health_check]
  telemetry:
    metrics:
      address: 0.0.0.0:8888
  pipelines:
    traces:  { receivers: [otlp], processors: [memory_limiter, batch], exporters: %s }
    metrics: { receivers: [otlp], processors: [memory_limiter, batch], exporters: [debug, prometheus] }
    logs:    { receivers: [otlp], processors: [memory_limiter, batch], exporters: %s }
`, extraExporters, traceExporters, logExporters)
}

// collectorSvcDNS — Binding endpoint·probe·metric 스크레이프의 단일 좌표(번들 Service 이름과 일치).
func collectorSvcDNS(ns string) string {
	return fmt.Sprintf("%s.%s.svc", collectorName, ns)
}

// observeObservability — collector_up=readyReplicas, otlp_ingest_rate=실 스크레이프 2샘플 차분(정직 n/a/0).
func observeObservability(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured, ready bool) ([]interface{}, map[string]interface{}) {
	up := map[string]interface{}{"id": "collector_up", "unit": "bool", "source": "Deployment.status.readyReplicas"}
	if ready {
		up["value"], up["healthy"] = "1", true
	} else {
		up["value"], up["healthy"] = "0", false
	}

	rate := map[string]interface{}{"id": "otlp_ingest_rate", "unit": "spans/s", "source": "otelcol self-metrics :8888"}
	var sample map[string]interface{}
	if !ready {
		rate["value"], rate["healthy"], rate["note"] = "0", false, "collector not ready"
		return append([]interface{}{up, rate}, observeObservabilityEngines(ctx, r, fm)...), sample
	}
	cur, httpOk, found := scrapeAcceptedSpans(ctx, collectorSvcDNS(r.cfg.managedNS))
	if !httpOk {
		rate["value"], rate["healthy"] = "n/a", false
		rate["source"], rate["note"] = "n/a (no scrape)", "collector metrics unreachable"
		return append([]interface{}{up, rate}, observeObservabilityEngines(ctx, r, fm)...), sample
	}
	now := time.Now().UTC()
	last, lastTs, hasLast := readSample(fm)
	if !found {
		rate["value"], rate["healthy"], rate["note"] = "0", false, "수신 트래픽 없음(0 spans)"
	} else if hasLast && now.After(lastTs) && cur >= last {
		if dt := now.Sub(lastTs).Seconds(); dt > 0 {
			v := (cur - last) / dt
			rate["value"], rate["healthy"] = fmt.Sprintf("%.2f", v), v > 0
			if v == 0 {
				rate["note"] = "수신 트래픽 없음(0 spans)"
			}
		} else {
			rate["value"], rate["healthy"], rate["note"] = "0", false, "baseline"
		}
	} else {
		rate["value"], rate["healthy"], rate["note"] = "0", false, "baseline"
	}
	sample = map[string]interface{}{
		"acceptedSpans": strconv.FormatFloat(cur, 'f', -1, 64),
		"ts":            now.Format(time.RFC3339),
	}
	return append([]interface{}{up, rate}, observeObservabilityEngines(ctx, r, fm)...), sample
}
