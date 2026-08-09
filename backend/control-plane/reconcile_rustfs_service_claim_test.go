package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestRustFSBucketValidationMatchesS3NamingBoundary(t *testing.T) {
	for _, name := range []string{"orders", "tenant-2026-data", "logs.eu-1"} {
		if !validRustFSBucket(name) {
			t.Errorf("valid bucket rejected: %q", name)
		}
	}
	for _, name := range []string{"", "UPPERCASE", "ab", "has space", "bad..dots", "192.168.0.1", "-prefix", "suffix-"} {
		if validRustFSBucket(name) {
			t.Errorf("invalid bucket accepted: %q", name)
		}
	}
}

func TestRustFSAccessKeyIsStableAndNonIdentifying(t *testing.T) {
	claim := object(fcGVK, "tenant-a", "customer-secret-project")
	claim.SetUID("ac79e681-c53c-4fb8-994f-a6b08ad455a7")
	first, second := rustFSAccessKey(claim), rustFSAccessKey(claim)
	if first != second || len(first) != 20 || !strings.HasPrefix(first, "OSP") || strings.Contains(strings.ToLower(first), "customer") {
		t.Fatalf("access key=%q second=%q", first, second)
	}
}

func TestRustFSBucketPolicyIsScopedAndReadOnlyIsActuallyReadOnly(t *testing.T) {
	readOnly, err := rustFSBucketPolicy("orders", "ReadOnly")
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(readOnly)
	text := string(encoded)
	if !strings.Contains(text, "arn:aws:s3:::orders/*") || strings.Contains(text, "PutObject") || strings.Contains(text, "DeleteBucket") {
		t.Fatalf("read-only policy=%s", text)
	}
	readWrite, err := rustFSBucketPolicy("orders", "ReadWrite")
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ = json.Marshal(readWrite)
	text = string(encoded)
	for _, action := range []string{"PutObject", "DeleteObject", "AbortMultipartUpload"} {
		if !strings.Contains(text, action) {
			t.Errorf("read-write policy missing %s: %s", action, text)
		}
	}
	if strings.Contains(text, "DeleteBucket") || strings.Contains(text, `"s3:*"`) {
		t.Fatalf("read-write policy is over-privileged: %s", text)
	}
}

func TestRustFSSignedRequestAddsSigV4Authorization(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if !strings.HasPrefix(request.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=ROOT/") {
			t.Errorf("authorization=%q", request.Header.Get("Authorization"))
		}
		if request.Header.Get("x-amz-date") != "20260810T010203Z" || len(request.Header.Get("x-amz-content-sha256")) != 64 {
			t.Errorf("sigv4 headers=%v", request.Header)
		}
		if request.URL.RawQuery != "b=2&a=1" {
			t.Errorf("request query unexpectedly changed: %s", request.URL.RawQuery)
		}
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	status, _, err := rustFSSignedRequest(context.Background(), server.Client(), http.MethodPost, server.URL+"/rustfs/admin/v3/test?b=2&a=1", []byte(`{"ok":true}`), "ROOT", "root-secret", rustFSDefaultRegion, time.Date(2026, 8, 10, 1, 2, 3, 0, time.UTC))
	if err != nil || status != http.StatusNoContent {
		t.Fatalf("status=%d err=%v", status, err)
	}
}

func TestEnsureRustFSBucketIsIdempotentAndObservedAfterCreate(t *testing.T) {
	var mutex sync.Mutex
	exists, createCalls := false, 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/orders" {
			http.NotFound(writer, request)
			return
		}
		mutex.Lock()
		defer mutex.Unlock()
		switch request.Method {
		case http.MethodHead:
			if exists {
				writer.WriteHeader(http.StatusOK)
			} else {
				writer.WriteHeader(http.StatusNotFound)
			}
		case http.MethodPut:
			exists = true
			createCalls++
			writer.WriteHeader(http.StatusOK)
		default:
			t.Errorf("method=%s", request.Method)
		}
	}))
	defer server.Close()
	for range 2 {
		if err := ensureRustFSBucket(context.Background(), server.Client(), server.URL, "orders", "ROOT", "secret"); err != nil {
			t.Fatal(err)
		}
	}
	if createCalls != 1 {
		t.Fatalf("bucket create calls=%d", createCalls)
	}
}

func TestEnsureRustFSServiceAccountCreatesThenUpdatesOwnedAccount(t *testing.T) {
	var mutex sync.Mutex
	created, createCalls, updateCalls := false, 0, 0
	name, description := "opensphere-osp123", "OpenSphere FoundationClaim tenant/orders"
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		mutex.Lock()
		defer mutex.Unlock()
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/rustfs/admin/v3/info-service-account":
			if !created {
				http.NotFound(writer, request)
				return
			}
			_ = json.NewEncoder(writer).Encode(map[string]interface{}{"name": name, "description": description})
		case request.Method == http.MethodPut && request.URL.Path == "/rustfs/admin/v3/add-service-accounts":
			var body map[string]interface{}
			_ = json.NewDecoder(request.Body).Decode(&body)
			if body["targetUser"] != "ROOT" || body["accessKey"] != "OSP123" || body["policy"] == nil {
				t.Errorf("create body=%v", body)
			}
			created = true
			createCalls++
			writer.WriteHeader(http.StatusOK)
		case request.Method == http.MethodPost && request.URL.Path == "/rustfs/admin/v3/update-service-account":
			var body map[string]interface{}
			_ = json.NewDecoder(request.Body).Decode(&body)
			if body["newPolicy"] == nil || body["newSecretKey"] != "consumer-secret" {
				t.Errorf("update body=%v", body)
			}
			updateCalls++
			writer.WriteHeader(http.StatusNoContent)
		default:
			t.Errorf("unexpected %s %s", request.Method, request.URL.String())
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()
	policy, _ := rustFSBucketPolicy("orders", "ReadWrite")
	for range 2 {
		if err := ensureRustFSServiceAccount(context.Background(), server.Client(), server.URL, "ROOT", "root-secret", "OSP123", "consumer-secret", name, description, policy); err != nil {
			t.Fatal(err)
		}
	}
	if createCalls != 1 || updateCalls != 1 {
		t.Fatalf("create=%d update=%d", createCalls, updateCalls)
	}
}

func TestEnsureRustFSServiceAccountRejectsForeignAccessKey(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_ = json.NewEncoder(writer).Encode(map[string]interface{}{"name": "foreign", "description": "not an OpenSphere claim"})
	}))
	defer server.Close()
	policy, _ := rustFSBucketPolicy("orders", "ReadOnly")
	err := ensureRustFSServiceAccount(context.Background(), server.Client(), server.URL, "ROOT", "root-secret", "OSP123", "consumer-secret", "ours", "OpenSphere FoundationClaim tenant/orders", policy)
	if err == nil || !strings.Contains(err.Error(), "owned by another") {
		t.Fatalf("foreign access key error=%v", err)
	}
}
