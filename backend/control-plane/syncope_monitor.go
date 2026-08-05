package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"time"

	_ "github.com/lib/pq"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

type syncopeMonitorOptions struct {
	listenAddress string
	syncopeURL    string
	caFile        string
	databaseURL   string
}

type syncopeMonitor struct {
	client        *http.Client
	syncopeURL    string
	db            *sql.DB
	ready         atomic.Bool
	up            prometheus.Gauge
	databaseUp    prometheus.Gauge
	users         prometheus.Gauge
	groups        prometheus.Gauge
	resources     prometheus.Gauge
	auditEvents   prometheus.Gauge
	lastAuditTime prometheus.Gauge
	probeDuration prometheus.Histogram
	probeErrors   prometheus.Counter
}

func newSyncopeMonitor(opts syncopeMonitorOptions, registry *prometheus.Registry) (*syncopeMonitor, error) {
	pool := x509.NewCertPool()
	ca, err := os.ReadFile(opts.caFile)
	if err != nil {
		return nil, fmt.Errorf("read Syncope CA: %w", err)
	}
	if !pool.AppendCertsFromPEM(ca) {
		return nil, fmt.Errorf("Syncope CA does not contain a PEM certificate")
	}
	db, err := sql.Open("postgres", opts.databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open Syncope database: %w", err)
	}
	m := &syncopeMonitor{
		client: &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{
			MinVersion: tls.VersionTLS12, RootCAs: pool,
		}}},
		syncopeURL:    opts.syncopeURL,
		db:            db,
		up:            prometheus.NewGauge(prometheus.GaugeOpts{Name: "opensphere_syncope_up", Help: "Whether the local Apache Syncope Core health endpoint is healthy."}),
		databaseUp:    prometheus.NewGauge(prometheus.GaugeOpts{Name: "opensphere_syncope_database_up", Help: "Whether the Syncope PostgreSQL database is queryable."}),
		users:         prometheus.NewGauge(prometheus.GaugeOpts{Name: "opensphere_syncope_users", Help: "Current number of Syncope users in the Master domain."}),
		groups:        prometheus.NewGauge(prometheus.GaugeOpts{Name: "opensphere_syncope_groups", Help: "Current number of Syncope groups in the Master domain."}),
		resources:     prometheus.NewGauge(prometheus.GaugeOpts{Name: "opensphere_syncope_external_resources", Help: "Current number of Syncope external resources/connectors."}),
		auditEvents:   prometheus.NewGauge(prometheus.GaugeOpts{Name: "opensphere_syncope_audit_events_total", Help: "Current durable AuditEvent row count."}),
		lastAuditTime: prometheus.NewGauge(prometheus.GaugeOpts{Name: "opensphere_syncope_last_audit_event_timestamp_seconds", Help: "Unix timestamp of the newest durable Syncope audit event."}),
		probeDuration: prometheus.NewHistogram(prometheus.HistogramOpts{Name: "opensphere_syncope_probe_duration_seconds", Help: "Duration of the local Syncope Core health probe.", Buckets: prometheus.DefBuckets}),
		probeErrors:   prometheus.NewCounter(prometheus.CounterOpts{Name: "opensphere_syncope_probe_errors_total", Help: "Cumulative failed Syncope Core health probes."}),
	}
	registry.MustRegister(m.up, m.databaseUp, m.users, m.groups, m.resources, m.auditEvents, m.lastAuditTime, m.probeDuration, m.probeErrors)
	return m, nil
}

func (m *syncopeMonitor) sample(ctx context.Context) {
	started := time.Now()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, m.syncopeURL, nil)
	resp, err := m.client.Do(req)
	healthy := err == nil && resp.StatusCode >= 200 && resp.StatusCode < 300
	if resp != nil {
		_ = resp.Body.Close()
	}
	m.probeDuration.Observe(time.Since(started).Seconds())
	if healthy {
		m.up.Set(1)
	} else {
		m.up.Set(0)
		m.probeErrors.Inc()
	}

	dbCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := m.db.PingContext(dbCtx); err != nil {
		m.databaseUp.Set(0)
		m.ready.Store(false)
		return
	}
	m.databaseUp.Set(1)
	m.users.Set(m.tableCount(dbCtx, "SyncopeUser"))
	m.groups.Set(m.tableCount(dbCtx, "SyncopeGroup"))
	m.resources.Set(m.tableCount(dbCtx, "ExternalResource"))
	m.auditEvents.Set(m.tableCount(dbCtx, "AuditEvent"))
	m.lastAuditTime.Set(m.lastAuditTimestamp(dbCtx))
	m.ready.Store(healthy)
}

func (m *syncopeMonitor) tableName(ctx context.Context, wanted string) (string, bool) {
	var table string
	err := m.db.QueryRowContext(ctx, `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND lower(table_name) = lower($1) LIMIT 1`, wanted).Scan(&table)
	return table, err == nil && table != ""
}

func quoteIdentifier(value string) string { return `"` + strings.ReplaceAll(value, `"`, `""`) + `"` }

func (m *syncopeMonitor) tableCount(ctx context.Context, wanted string) float64 {
	table, ok := m.tableName(ctx, wanted)
	if !ok {
		return 0
	}
	var count float64
	if err := m.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+quoteIdentifier(table)).Scan(&count); err != nil {
		return 0
	}
	return count
}

func (m *syncopeMonitor) lastAuditTimestamp(ctx context.Context) float64 {
	table, ok := m.tableName(ctx, "AuditEvent")
	if !ok {
		return 0
	}
	var ts sql.NullTime
	if err := m.db.QueryRowContext(ctx, "SELECT MAX(event_date) FROM "+quoteIdentifier(table)).Scan(&ts); err != nil || !ts.Valid {
		return 0
	}
	return float64(ts.Time.Unix())
}

func runSyncopeMonitorServer(ctx context.Context, opts syncopeMonitorOptions) error {
	registry := prometheus.NewRegistry()
	monitor, err := newSyncopeMonitor(opts, registry)
	if err != nil {
		return err
	}
	defer monitor.db.Close()

	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.HandlerFor(registry, promhttp.HandlerOpts{}))
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, _ *http.Request) {
		if !monitor.ready.Load() {
			http.Error(w, "Syncope Core or database is not ready", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	})
	server := &http.Server{Addr: opts.listenAddress, Handler: mux, ReadHeaderTimeout: 5 * time.Second}

	monitor.sample(ctx)
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				monitor.sample(ctx)
			}
		}
	}()
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}
