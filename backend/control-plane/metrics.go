// metrics.go — 정직 신호 수집(읽기 전용 HTTP/TCP. k8s API도 명령형도 아님 → ADR-005R1 무관).
package main

import (
	"context"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// scrapeAcceptedSpans — collector 자가-메트릭(:8888/metrics)에서 otelcol_receiver_accepted_spans 합산.
// 타임아웃 2s로 묶어 reconcile 워크큐가 블로킹 I/O로 막히지 않게 한다.
// 반환: value(누적 spans), httpOk(엔드포인트 도달=200), metricFound(메트릭 존재 — 무트래픽이면 카운터가 아직 없음).
// httpOk=true·metricFound=false 는 "도달했으나 트래픽 0"(정직한 0)이며 "unreachable"과 구분한다.
func scrapeAcceptedSpans(ctx context.Context, svcDNS string) (value float64, httpOk bool, metricFound bool) {
	url := "http://" + svcDNS + ":8888/metrics"
	cctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, false, false
	}
	req.Header.Set("Accept", "text/plain") // exposition 포맷 고정(OpenMetrics _created 라인 혼입 차단)
	resp, err := (&http.Client{Timeout: 2 * time.Second}).Do(req)
	if err != nil {
		return 0, false, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, false, false
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return 0, false, false
	}
	var sum float64
	for _, line := range strings.Split(string(body), "\n") {
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		// 정확한 메트릭 이름만 합산(loose prefix 금지 — _created/_bucket/_sum/_count 혼입 차단).
		name := line
		if i := strings.IndexAny(name, "{ "); i >= 0 {
			name = name[:i]
		}
		if name != "otelcol_receiver_accepted_spans" && name != "otelcol_receiver_accepted_spans_total" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		if v, err := strconv.ParseFloat(fields[len(fields)-1], 64); err == nil {
			sum += v
			metricFound = true
		}
	}
	return sum, true, metricFound
}

// probeTCP — Binding 연결 도달성 RTT(ms, 정수). "controller→svc RTT"이며 소비자 RTT 아님(면책은 UI 툴팁/감사로그에).
func probeTCP(ctx context.Context, hostport string) (int, bool) {
	start := time.Now()
	d := net.Dialer{Timeout: 2 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", hostport)
	if err != nil {
		return 0, false
	}
	_ = conn.Close()
	ms := int(time.Since(start).Milliseconds())
	if ms < 0 {
		ms = 0
	}
	return ms, true
}

