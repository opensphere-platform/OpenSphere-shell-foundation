package main

import (
	"compress/gzip"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	_ "github.com/lib/pq"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

//go:embed opa_production_bundle.tar.gz
var opaProductionBundle []byte

const opaProductionBundleRevision = "opensphere-prod-54418c8a00105447"

type opaControlOptions struct {
	listenAddress  string
	metricsAddress string
	databaseURL    string
	tlsCertFile    string
	tlsKeyFile     string
	tlsCAFile      string
	retentionDays  int
}

type opaDecisionEvent struct {
	DecisionID string                     `json:"decision_id"`
	Path       string                     `json:"path"`
	Result     json.RawMessage            `json:"result"`
	Timestamp  string                     `json:"timestamp"`
	Bundles    map[string]json.RawMessage `json:"bundles"`
	Erased     []string                   `json:"erased"`
	Masked     []string                   `json:"masked"`
	Labels     map[string]string          `json:"labels"`
	Input      json.RawMessage            `json:"input"`
}

type persistedDecision struct {
	decisionID, path, revision string
	observedAt                 time.Time
	allow                      bool
	erased, masked, labels     []byte
}

var (
	opaDecisionsTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "opensphere_opa_decisions_total", Help: "Durably persisted OPA decisions by outcome.",
	}, []string{"result"})
	opaDecisionRejected = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "opensphere_opa_decision_log_rejected_total", Help: "Decision log events rejected before persistence.",
	}, []string{"reason"})
	opaDecisionPersistErrors = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "opensphere_opa_decision_log_persist_errors_total", Help: "PostgreSQL decision log persistence failures.",
	})
	opaDecisionLastSuccess = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "opensphere_opa_decision_log_last_success_timestamp_seconds", Help: "Unix timestamp of the latest durable decision-log write.",
	})
	opaBundleRequests = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "opensphere_opa_bundle_requests_total", Help: "Signed OPA bundle requests by HTTP result.",
	}, []string{"result"})
)

func init() {
	prometheus.MustRegister(opaDecisionsTotal, opaDecisionRejected, opaDecisionPersistErrors, opaDecisionLastSuccess, opaBundleRequests)
}

type opaControlServer struct {
	db            *sql.DB
	bundleETag    string
	retentionDays int
	cleanupMu     sync.Mutex
	lastCleanup   time.Time
}

func runOPAControlServer(ctx context.Context, opts opaControlOptions) error {
	if opts.retentionDays < 1 {
		return errors.New("decision-log retention must be at least one day")
	}
	db, err := sql.Open("postgres", opts.databaseURL)
	if err != nil {
		return fmt.Errorf("open PostgreSQL: %w", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(30 * time.Minute)
	initCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if err := db.PingContext(initCtx); err != nil {
		return fmt.Errorf("ping PostgreSQL: %w", err)
	}
	if err := ensureOPADecisionSchema(initCtx, db); err != nil {
		return err
	}
	sum := sha256.Sum256(opaProductionBundle)
	server := &opaControlServer{db: db, bundleETag: `"sha256:` + hex.EncodeToString(sum[:]) + `"`, retentionDays: opts.retentionDays}

	caPEM, err := os.ReadFile(opts.tlsCAFile)
	if err != nil {
		return fmt.Errorf("read client CA: %w", err)
	}
	clientCAs := x509.NewCertPool()
	if !clientCAs.AppendCertsFromPEM(caPEM) {
		return errors.New("client CA did not contain a valid certificate")
	}
	tlsConfig := &tls.Config{MinVersion: tls.VersionTLS13, ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: clientCAs}
	controlHTTP := &http.Server{Addr: opts.listenAddress, Handler: server.controlMux(), TLSConfig: tlsConfig, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}
	metricsHTTP := &http.Server{Addr: opts.metricsAddress, Handler: server.metricsMux(), ReadHeaderTimeout: 5 * time.Second}

	errs := make(chan error, 2)
	go func() { errs <- controlHTTP.ListenAndServeTLS(opts.tlsCertFile, opts.tlsKeyFile) }()
	go func() { errs <- metricsHTTP.ListenAndServe() }()
	select {
	case <-ctx.Done():
		shutdown, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		_ = controlHTTP.Shutdown(shutdown)
		_ = metricsHTTP.Shutdown(shutdown)
		return nil
	case err := <-errs:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

func ensureOPADecisionSchema(ctx context.Context, db *sql.DB) error {
	const schema = `
CREATE TABLE IF NOT EXISTS opensphere_opa_decision_log (
  decision_id text PRIMARY KEY,
  observed_at timestamptz NOT NULL,
  decision boolean NOT NULL,
  path text NOT NULL CHECK (length(path) <= 512),
  bundle_revision text NOT NULL,
  erased jsonb NOT NULL DEFAULT '[]'::jsonb,
  masked jsonb NOT NULL DEFAULT '[]'::jsonb,
  labels jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS opensphere_opa_decision_log_observed_at_idx ON opensphere_opa_decision_log (observed_at DESC);
CREATE INDEX IF NOT EXISTS opensphere_opa_decision_log_outcome_idx ON opensphere_opa_decision_log (decision, observed_at DESC);`
	if _, err := db.ExecContext(ctx, schema); err != nil {
		return fmt.Errorf("initialize OPA decision-log schema: %w", err)
	}
	return nil
}

func (s *opaControlServer) controlMux() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /bundle.tar.gz", s.serveBundle)
	mux.HandleFunc("POST /logs", s.receiveLogs)
	mux.HandleFunc("POST /status", s.receiveStatus)
	mux.HandleFunc("GET /summary", s.summary)
	return mux
}

func (s *opaControlServer) metricsMux() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := s.db.PingContext(ctx); err != nil {
			http.Error(w, "database unavailable", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	return mux
}

func (s *opaControlServer) serveBundle(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("If-None-Match") == s.bundleETag {
		opaBundleRequests.WithLabelValues("not_modified").Inc()
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "application/gzip")
	w.Header().Set("Cache-Control", "private, max-age=10")
	w.Header().Set("ETag", s.bundleETag)
	w.Header().Set("X-OpenSphere-Bundle-Revision", opaProductionBundleRevision)
	opaBundleRequests.WithLabelValues("served").Inc()
	_, _ = w.Write(opaProductionBundle)
}

func decodeOPADecisions(reader io.Reader) ([]persistedDecision, error) {
	dec := json.NewDecoder(io.LimitReader(reader, 8<<20))
	var events []opaDecisionEvent
	if err := dec.Decode(&events); err != nil {
		return nil, fmt.Errorf("decode decision batch: %w", err)
	}
	if len(events) == 0 || len(events) > 10000 {
		return nil, fmt.Errorf("invalid decision batch size: %d", len(events))
	}
	out := make([]persistedDecision, 0, len(events))
	for _, event := range events {
		if len(event.Input) != 0 && string(event.Input) != "null" {
			return nil, errors.New("unmasked input present")
		}
		if strings.TrimSpace(event.DecisionID) == "" || len(event.DecisionID) > 128 {
			return nil, errors.New("invalid decision_id")
		}
		if event.Path == "" || len(event.Path) > 512 {
			return nil, errors.New("invalid decision path")
		}
		var allow bool
		if err := json.Unmarshal(event.Result, &allow); err != nil {
			return nil, errors.New("decision result must be boolean")
		}
		observedAt, err := time.Parse(time.RFC3339Nano, event.Timestamp)
		if err != nil {
			return nil, errors.New("invalid decision timestamp")
		}
		revision := "unknown"
		if raw, ok := event.Bundles["authz"]; ok {
			var bundle struct {
				Revision string `json:"revision"`
			}
			if json.Unmarshal(raw, &bundle) == nil && bundle.Revision != "" {
				revision = bundle.Revision
			}
		}
		erased, _ := json.Marshal(event.Erased)
		masked, _ := json.Marshal(event.Masked)
		labels, _ := json.Marshal(event.Labels)
		out = append(out, persistedDecision{decisionID: event.DecisionID, path: event.Path, revision: revision, observedAt: observedAt, allow: allow, erased: erased, masked: masked, labels: labels})
	}
	return out, nil
}

func (s *opaControlServer) receiveLogs(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Content-Encoding") != "gzip" {
		opaDecisionRejected.WithLabelValues("encoding").Inc()
		http.Error(w, "gzip encoding required", http.StatusUnsupportedMediaType)
		return
	}
	gz, err := gzip.NewReader(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		opaDecisionRejected.WithLabelValues("gzip").Inc()
		http.Error(w, "invalid gzip payload", http.StatusBadRequest)
		return
	}
	defer gz.Close()
	events, err := decodeOPADecisions(gz)
	if err != nil {
		reason := "schema"
		if strings.Contains(err.Error(), "unmasked input") {
			reason = "unmasked_input"
		}
		opaDecisionRejected.WithLabelValues(reason).Inc()
		http.Error(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		opaDecisionPersistErrors.Inc()
		http.Error(w, "database unavailable", http.StatusServiceUnavailable)
		return
	}
	defer tx.Rollback()
	inserted := map[bool]float64{}
	for _, event := range events {
		result, err := tx.ExecContext(r.Context(), `INSERT INTO opensphere_opa_decision_log(decision_id, observed_at, decision, path, bundle_revision, erased, masked, labels) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (decision_id) DO NOTHING`, event.decisionID, event.observedAt, event.allow, event.path, event.revision, event.erased, event.masked, event.labels)
		if err != nil {
			opaDecisionPersistErrors.Inc()
			http.Error(w, "decision persistence failed", http.StatusServiceUnavailable)
			return
		}
		if rows, _ := result.RowsAffected(); rows > 0 {
			inserted[event.allow] += float64(rows)
		}
	}
	if err := tx.Commit(); err != nil {
		opaDecisionPersistErrors.Inc()
		http.Error(w, "decision commit failed", http.StatusServiceUnavailable)
		return
	}
	if inserted[true] > 0 {
		opaDecisionsTotal.WithLabelValues("allow").Add(inserted[true])
	}
	if inserted[false] > 0 {
		opaDecisionsTotal.WithLabelValues("deny").Add(inserted[false])
	}
	opaDecisionLastSuccess.Set(float64(time.Now().Unix()))
	s.cleanup(r.Context())
	w.WriteHeader(http.StatusNoContent)
}

func (s *opaControlServer) cleanup(ctx context.Context) {
	s.cleanupMu.Lock()
	defer s.cleanupMu.Unlock()
	if time.Since(s.lastCleanup) < time.Hour {
		return
	}
	s.lastCleanup = time.Now()
	_, _ = s.db.ExecContext(ctx, `DELETE FROM opensphere_opa_decision_log WHERE observed_at < now() - ($1 * interval '1 day')`, s.retentionDays)
}

func (s *opaControlServer) receiveStatus(w http.ResponseWriter, r *http.Request) {
	_, err := io.Copy(io.Discard, http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		http.Error(w, "invalid status payload", http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *opaControlServer) summary(w http.ResponseWriter, r *http.Request) {
	var allow, deny int64
	var latest sql.NullTime
	err := s.db.QueryRowContext(r.Context(), `SELECT count(*) FILTER (WHERE decision), count(*) FILTER (WHERE NOT decision), max(observed_at) FROM opensphere_opa_decision_log WHERE observed_at >= now() - interval '1 hour'`).Scan(&allow, &deny, &latest)
	if err != nil {
		http.Error(w, "summary unavailable", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"allow": allow, "deny": deny, "latest": latest.Time, "bundleRevision": opaProductionBundleRevision, "inputStored": false})
}
