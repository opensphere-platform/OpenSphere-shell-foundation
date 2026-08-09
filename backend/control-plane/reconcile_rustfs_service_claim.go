package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

const (
	rustFSCredentialSuffix = "-rustfs-access"
	rustFSDefaultRegion    = "us-east-1"
)

var (
	rustFSBucketPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)
	rustFSHTTPClient    = &http.Client{Timeout: 10 * time.Second}
)

func (r *claimReconciler) resolveRustFSServiceBinding(
	ctx context.Context,
	claim, model *unstructured.Unstructured,
	contract serviceModuleContract,
) (serviceBindingProjection, string, error) {
	managed, err := r.foundationServiceNamespaceAccepted(ctx, claim.GetNamespace())
	if err != nil {
		return serviceBindingProjection{}, "", err
	}
	if !managed {
		return serviceBindingProjection{}, "NamespaceNotManaged", nil
	}
	namespace := dataNS(r.cfg, model)
	if !r.rustFSReady(ctx, namespace) {
		return serviceBindingProjection{}, "RustFSNotReady", nil
	}
	endpoint := fmt.Sprintf("http://%s.%s.svc:9000", rustfsName, namespace)
	projection := serviceBindingProjection{
		Module: contract.ID, Endpoint: endpoint, Probe: fmt.Sprintf("%s.%s.svc:9000", rustfsName, namespace),
		Capabilities: append([]string(nil), contract.Capabilities...),
		ResourceRef: map[string]interface{}{
			"apiVersion": "apps/v1", "kind": "StatefulSet", "name": rustfsName, "namespace": namespace,
		},
	}
	requestType := requestTypeOf(claim)
	if requestType == "Instance" {
		return projection, "", nil
	}
	if requestType != "Bucket" && requestType != "Access" {
		return serviceBindingProjection{}, "UnsupportedRequestType", nil
	}

	bucket := rustFSClaimBucket(claim)
	if !validRustFSBucket(bucket) {
		return serviceBindingProjection{}, "InvalidRequest", nil
	}
	rootAccess, rootSecret, reason, err := r.rustFSRootCredential(ctx, model, namespace)
	if err != nil || reason != "" {
		return serviceBindingProjection{}, reason, err
	}
	if requestType == "Bucket" {
		if err := ensureRustFSBucket(ctx, rustFSHTTPClient, endpoint, bucket, rootAccess, rootSecret); err != nil {
			return serviceBindingProjection{}, "RustFSBucketReconcileFailed", nil
		}
	} else {
		exists, err := rustFSBucketExists(ctx, rustFSHTTPClient, endpoint, bucket, rootAccess, rootSecret)
		if err != nil {
			return serviceBindingProjection{}, "RustFSBucketProbeFailed", nil
		}
		if !exists {
			return serviceBindingProjection{}, "RustFSBucketNotReady", nil
		}
	}

	credential, managedCredential, reason, err := r.ensureRustFSCredential(ctx, claim, endpoint, bucket)
	if err != nil || reason != "" {
		return serviceBindingProjection{}, reason, err
	}
	accessKey := rustFSSecretString(credential, "access_key", "AWS_ACCESS_KEY_ID")
	secretKey := rustFSSecretString(credential, "secret_key", "AWS_SECRET_ACCESS_KEY")
	access := serviceClaimString(claim, "ReadWrite", "access")
	policy, err := rustFSBucketPolicy(bucket, access)
	if err != nil {
		return serviceBindingProjection{}, "InvalidRequest", nil
	}
	if err := ensureRustFSServiceAccount(ctx, rustFSHTTPClient, endpoint, rootAccess, rootSecret, accessKey, secretKey, rustFSAccountName(claim), rustFSAccountDescription(claim), policy); err != nil {
		return serviceBindingProjection{}, "RustFSAccessReconcileFailed", nil
	}

	projection.Endpoint = strings.TrimRight(endpoint, "/") + "/" + url.PathEscape(bucket)
	projection.SecretRef = map[string]interface{}{"name": credential.GetName(), "namespace": credential.GetNamespace()}
	projection.ResourceRef = map[string]interface{}{
		"apiVersion": grp + "/" + ver, "kind": "FoundationClaim", "name": claim.GetName(), "namespace": claim.GetNamespace(),
	}
	projection.Capabilities = append(projection.Capabilities, "bucket:"+bucket, "access:"+strings.ToLower(access), "iam:service-account")
	if managedCredential {
		projection.Capabilities = append(projection.Capabilities, "credential:managed")
	}
	return projection, "", nil
}

func (r *claimReconciler) rustFSReady(ctx context.Context, namespace string) bool {
	statefulSet := gvkObj(statefulSetGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: namespace, Name: rustfsName}, statefulSet); err != nil {
		return false
	}
	desired, _, _ := unstructured.NestedInt64(statefulSet.Object, "spec", "replicas")
	ready, _, _ := unstructured.NestedInt64(statefulSet.Object, "status", "readyReplicas")
	return desired > 0 && ready >= desired
}

func (r *claimReconciler) rustFSRootCredential(ctx context.Context, model *unstructured.Unstructured, namespace string) (string, string, string, error) {
	name := dataEngineParams(model, r.cfg, "rustfs").authSecret
	if name == "" {
		return "", "", "RustFSRootCredentialNotReady", nil
	}
	secret := gvkObj(schema.GroupVersionKind{Version: "v1", Kind: "Secret"})
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: namespace, Name: name}, secret); err != nil {
		if apierrors.IsNotFound(err) {
			return "", "", "RustFSRootCredentialNotReady", nil
		}
		return "", "", "", err
	}
	accessKey, secretKey := rustFSSecretString(secret, "access_key", "AWS_ACCESS_KEY_ID"), rustFSSecretString(secret, "secret_key", "AWS_SECRET_ACCESS_KEY")
	if accessKey == "" || secretKey == "" {
		return "", "", "RustFSRootCredentialInvalid", nil
	}
	return accessKey, secretKey, "", nil
}

func rustFSClaimBucket(claim *unstructured.Unstructured) string {
	if bucket := serviceClaimString(claim, "", "bucket"); bucket != "" {
		return bucket
	}
	if requestTypeOf(claim) == "Access" {
		if target, ok := targetRefOf(claim)["name"].(string); ok && strings.TrimSpace(target) != "" {
			return strings.TrimSpace(target)
		}
	}
	return claim.GetName()
}

func validRustFSBucket(bucket string) bool {
	if !rustFSBucketPattern.MatchString(bucket) || strings.Contains(bucket, "..") {
		return false
	}
	return net.ParseIP(bucket) == nil
}

func rustFSCredentialName(claim *unstructured.Unstructured) string {
	raw := claim.GetName() + rustFSCredentialSuffix
	if len(raw) <= 63 {
		return raw
	}
	sum := sha256.Sum256([]byte(raw))
	return strings.TrimRight(raw[:54], "-") + "-" + hex.EncodeToString(sum[:4])
}

func rustFSAccessKey(claim *unstructured.Unstructured) string {
	identity := string(claim.GetUID())
	if identity == "" {
		identity = claim.GetNamespace() + "/" + claim.GetName()
	}
	sum := sha256.Sum256([]byte(identity))
	return "OSP" + strings.ToUpper(hex.EncodeToString(sum[:9]))[:17]
}

func rustFSAccountName(claim *unstructured.Unstructured) string {
	return "opensphere-" + strings.ToLower(rustFSAccessKey(claim))
}

func rustFSAccountDescription(claim *unstructured.Unstructured) string {
	return "OpenSphere FoundationClaim " + claim.GetNamespace() + "/" + claim.GetName()
}

func (r *claimReconciler) ensureRustFSCredential(ctx context.Context, claim *unstructured.Unstructured, endpoint, bucket string) (*unstructured.Unstructured, bool, string, error) {
	name, supplied, _ := unstructured.NestedString(claim.Object, "spec", "credentialSecretRef", "name")
	managed := !supplied || strings.TrimSpace(name) == ""
	if managed {
		name = rustFSCredentialName(claim)
	}
	secret := gvkObj(schema.GroupVersionKind{Version: "v1", Kind: "Secret"})
	nn := types.NamespacedName{Namespace: claim.GetNamespace(), Name: name}
	err := r.direct.Get(ctx, nn, secret)
	if err == nil {
		if rustFSSecretString(secret, "access_key", "AWS_ACCESS_KEY_ID") == "" || rustFSSecretString(secret, "secret_key", "AWS_SECRET_ACCESS_KEY") == "" {
			return nil, managed, "RustFSCredentialInvalid", nil
		}
		return secret, managed, "", nil
	}
	if !apierrors.IsNotFound(err) {
		return nil, managed, "", err
	}
	if !managed {
		return nil, false, "RustFSCredentialNotReady", nil
	}
	secretKey, err := randomServicePassword(36)
	if err != nil {
		return nil, true, "", err
	}
	accessKey := rustFSAccessKey(claim)
	values := map[string]string{
		"access_key": accessKey, "secret_key": secretKey, "endpoint": endpoint, "bucket": bucket, "region": rustFSDefaultRegion,
		"uri": "s3://" + bucket, "AWS_ACCESS_KEY_ID": accessKey, "AWS_SECRET_ACCESS_KEY": secretKey,
		"AWS_ENDPOINT_URL": endpoint, "AWS_REGION": rustFSDefaultRegion,
	}
	data := map[string]interface{}{}
	for key, value := range values {
		data[key] = base64.StdEncoding.EncodeToString([]byte(value))
	}
	secret = object(schema.GroupVersionKind{Version: "v1", Kind: "Secret"}, claim.GetNamespace(), name)
	secret.Object["type"] = "Opaque"
	secret.Object["data"] = data
	secret.SetLabels(map[string]string{
		lblManagedBy: cpManagedBy, lblPartOf: "foundation-data", lblModel: "data", lblEngine: "rustfs",
		"foundation.opensphere.io/service-claim": claim.GetName(),
	})
	_ = unstructured.SetNestedSlice(secret.Object, []interface{}{unstructuredOwnerReference(claim)}, "metadata", "ownerReferences")
	if err := applyObj(ctx, r.direct, secret); err != nil {
		return nil, true, "", err
	}
	if err := r.direct.Get(ctx, nn, secret); err != nil {
		return nil, true, "", err
	}
	return secret, true, "", nil
}

func rustFSSecretString(secret *unstructured.Unstructured, keys ...string) string {
	for _, key := range keys {
		if value := secretString(secret, key); value != "" {
			return value
		}
	}
	return ""
}

func rustFSBucketPolicy(bucket, access string) (map[string]interface{}, error) {
	actions := []interface{}{"s3:GetBucketLocation", "s3:ListBucket", "s3:GetObject", "s3:GetObjectVersion"}
	if access == "ReadWrite" {
		actions = append(actions, "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload", "s3:ListBucketMultipartUploads", "s3:ListMultipartUploadParts")
	} else if access != "ReadOnly" {
		return nil, fmt.Errorf("RustFS access must be ReadOnly or ReadWrite")
	}
	return map[string]interface{}{
		"Version": "2012-10-17",
		"Statement": []interface{}{map[string]interface{}{
			"Effect": "Allow", "Action": actions,
			"Resource": []interface{}{"arn:aws:s3:::" + bucket, "arn:aws:s3:::" + bucket + "/*"},
		}},
	}, nil
}

func rustFSBucketExists(ctx context.Context, client *http.Client, endpoint, bucket, accessKey, secretKey string) (bool, error) {
	status, body, err := rustFSSignedRequest(ctx, client, http.MethodHead, strings.TrimRight(endpoint, "/")+"/"+url.PathEscape(bucket), nil, accessKey, secretKey, rustFSDefaultRegion, time.Now().UTC())
	if err != nil {
		return false, err
	}
	switch status {
	case http.StatusOK, http.StatusNoContent:
		return true, nil
	case http.StatusNotFound:
		return false, nil
	default:
		return false, fmt.Errorf("RustFS bucket HEAD returned HTTP %d: %s", status, strings.TrimSpace(string(body)))
	}
}

func ensureRustFSBucket(ctx context.Context, client *http.Client, endpoint, bucket, accessKey, secretKey string) error {
	exists, err := rustFSBucketExists(ctx, client, endpoint, bucket, accessKey, secretKey)
	if err != nil || exists {
		return err
	}
	status, body, err := rustFSSignedRequest(ctx, client, http.MethodPut, strings.TrimRight(endpoint, "/")+"/"+url.PathEscape(bucket), nil, accessKey, secretKey, rustFSDefaultRegion, time.Now().UTC())
	if err != nil {
		return err
	}
	if status != http.StatusOK && status != http.StatusCreated && status != http.StatusNoContent && status != http.StatusConflict {
		return fmt.Errorf("RustFS bucket PUT returned HTTP %d: %s", status, strings.TrimSpace(string(body)))
	}
	exists, err = rustFSBucketExists(ctx, client, endpoint, bucket, accessKey, secretKey)
	if err != nil || !exists {
		if err == nil {
			err = fmt.Errorf("RustFS bucket %s was not observable after create", bucket)
		}
		return err
	}
	return nil
}

func ensureRustFSServiceAccount(ctx context.Context, client *http.Client, endpoint, rootAccess, rootSecret, accessKey, secretKey, name, description string, policy map[string]interface{}) error {
	infoURL := strings.TrimRight(endpoint, "/") + "/rustfs/admin/v3/info-service-account?accessKey=" + url.QueryEscape(accessKey)
	status, body, err := rustFSSignedRequest(ctx, client, http.MethodGet, infoURL, nil, rootAccess, rootSecret, rustFSDefaultRegion, time.Now().UTC())
	if err != nil {
		return err
	}
	if status == http.StatusOK {
		var info struct {
			Name        string `json:"name"`
			Description string `json:"description"`
		}
		if err := json.Unmarshal(body, &info); err != nil {
			return err
		}
		if info.Name != name || info.Description != description {
			return fmt.Errorf("RustFS access key %s is owned by another service account", accessKey)
		}
		payload, _ := json.Marshal(map[string]interface{}{
			"newPolicy": policy, "newSecretKey": secretKey, "newName": name, "newDescription": description,
		})
		updateURL := strings.TrimRight(endpoint, "/") + "/rustfs/admin/v3/update-service-account?accessKey=" + url.QueryEscape(accessKey)
		status, body, err = rustFSSignedRequest(ctx, client, http.MethodPost, updateURL, payload, rootAccess, rootSecret, rustFSDefaultRegion, time.Now().UTC())
		if err != nil {
			return err
		}
		if status != http.StatusOK && status != http.StatusNoContent {
			return fmt.Errorf("RustFS service-account update returned HTTP %d: %s", status, strings.TrimSpace(string(body)))
		}
		return nil
	}
	if status != http.StatusNotFound {
		return fmt.Errorf("RustFS service-account lookup returned HTTP %d: %s", status, strings.TrimSpace(string(body)))
	}
	payload, _ := json.Marshal(map[string]interface{}{
		"targetUser": rootAccess, "accessKey": accessKey, "secretKey": secretKey,
		"name": name, "description": description, "policy": policy,
	})
	createURL := strings.TrimRight(endpoint, "/") + "/rustfs/admin/v3/add-service-accounts"
	status, body, err = rustFSSignedRequest(ctx, client, http.MethodPut, createURL, payload, rootAccess, rootSecret, rustFSDefaultRegion, time.Now().UTC())
	if err != nil {
		return err
	}
	if status != http.StatusOK && status != http.StatusCreated {
		return fmt.Errorf("RustFS service-account create returned HTTP %d: %s", status, strings.TrimSpace(string(body)))
	}
	return nil
}

func deleteRustFSServiceAccount(ctx context.Context, client *http.Client, endpoint, rootAccess, rootSecret, accessKey string) error {
	requestURL := strings.TrimRight(endpoint, "/") + "/rustfs/admin/v3/delete-service-account?accessKey=" + url.QueryEscape(accessKey)
	status, body, err := rustFSSignedRequest(ctx, client, http.MethodDelete, requestURL, nil, rootAccess, rootSecret, rustFSDefaultRegion, time.Now().UTC())
	if err != nil {
		return err
	}
	if status != http.StatusOK && status != http.StatusNoContent && status != http.StatusNotFound {
		return fmt.Errorf("RustFS service-account delete returned HTTP %d: %s", status, strings.TrimSpace(string(body)))
	}
	return nil
}

func deleteRustFSBucket(ctx context.Context, client *http.Client, endpoint, bucket, rootAccess, rootSecret string) error {
	status, body, err := rustFSSignedRequest(ctx, client, http.MethodDelete, strings.TrimRight(endpoint, "/")+"/"+url.PathEscape(bucket), nil, rootAccess, rootSecret, rustFSDefaultRegion, time.Now().UTC())
	if err != nil {
		return err
	}
	if status != http.StatusOK && status != http.StatusNoContent && status != http.StatusNotFound {
		return fmt.Errorf("RustFS bucket delete returned HTTP %d: %s", status, strings.TrimSpace(string(body)))
	}
	return nil
}

func (r *claimReconciler) cleanupRustFSServiceClaim(ctx context.Context, claim, model *unstructured.Unstructured) (bool, error) {
	requestType := requestTypeOf(claim)
	if requestType != "Bucket" && requestType != "Access" {
		return true, nil
	}
	namespace := dataNS(r.cfg, model)
	rootAccess, rootSecret, reason, err := r.rustFSRootCredential(ctx, model, namespace)
	if err != nil {
		return false, err
	}
	if reason != "" {
		return false, nil
	}
	endpoint := fmt.Sprintf("http://%s.%s.svc:9000", rustfsName, namespace)
	credentialName, supplied, _ := unstructured.NestedString(claim.Object, "spec", "credentialSecretRef", "name")
	if !supplied || strings.TrimSpace(credentialName) == "" {
		credentialName = rustFSCredentialName(claim)
	}
	credential := gvkObj(schema.GroupVersionKind{Version: "v1", Kind: "Secret"})
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: claim.GetNamespace(), Name: credentialName}, credential); err == nil {
		if accessKey := rustFSSecretString(credential, "access_key", "AWS_ACCESS_KEY_ID"); accessKey != "" {
			if err := deleteRustFSServiceAccount(ctx, rustFSHTTPClient, endpoint, rootAccess, rootSecret, accessKey); err != nil {
				return false, err
			}
		}
	} else if !apierrors.IsNotFound(err) {
		return false, err
	}
	if requestType == "Bucket" && serviceClaimString(claim, "Retain", "deletionPolicy") == "Delete" {
		if err := deleteRustFSBucket(ctx, rustFSHTTPClient, endpoint, rustFSClaimBucket(claim), rootAccess, rootSecret); err != nil {
			return false, err
		}
	}
	if !supplied {
		secret := object(schema.GroupVersionKind{Version: "v1", Kind: "Secret"}, claim.GetNamespace(), credentialName)
		if err := r.direct.Delete(ctx, secret); err != nil && !apierrors.IsNotFound(err) {
			return false, err
		}
	}
	return true, nil
}

func rustFSSignedRequest(ctx context.Context, client *http.Client, method, requestURL string, body []byte, accessKey, secretKey, region string, now time.Time) (int, []byte, error) {
	u, err := url.Parse(requestURL)
	if err != nil {
		return 0, nil, err
	}
	request, err := http.NewRequestWithContext(ctx, method, requestURL, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	payloadHash := sha256.Sum256(body)
	payloadHex := hex.EncodeToString(payloadHash[:])
	amzDate, shortDate := now.UTC().Format("20060102T150405Z"), now.UTC().Format("20060102")
	request.Header.Set("x-amz-content-sha256", payloadHex)
	request.Header.Set("x-amz-date", amzDate)
	if len(body) > 0 {
		request.Header.Set("content-type", "application/json")
	}
	canonicalHeaders := "host:" + strings.ToLower(u.Host) + "\n" + "x-amz-content-sha256:" + payloadHex + "\n" + "x-amz-date:" + amzDate + "\n"
	signedHeaders := "host;x-amz-content-sha256;x-amz-date"
	canonicalQuery := canonicalRustFSQuery(u.Query())
	canonicalPath := u.EscapedPath()
	if canonicalPath == "" {
		canonicalPath = "/"
	}
	canonicalRequest := strings.Join([]string{method, canonicalPath, canonicalQuery, canonicalHeaders, signedHeaders, payloadHex}, "\n")
	canonicalHash := sha256.Sum256([]byte(canonicalRequest))
	scope := shortDate + "/" + region + "/s3/aws4_request"
	stringToSign := "AWS4-HMAC-SHA256\n" + amzDate + "\n" + scope + "\n" + hex.EncodeToString(canonicalHash[:])
	signingKey := hmacSHA256(hmacSHA256(hmacSHA256(hmacSHA256([]byte("AWS4"+secretKey), shortDate), region), "s3"), "aws4_request")
	signature := hex.EncodeToString(hmacSHA256(signingKey, stringToSign))
	request.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+accessKey+"/"+scope+", SignedHeaders="+signedHeaders+", Signature="+signature)
	response, err := client.Do(request)
	if err != nil {
		return 0, nil, err
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	return response.StatusCode, payload, err
}

func canonicalRustFSQuery(values url.Values) string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0)
	for _, key := range keys {
		items := append([]string(nil), values[key]...)
		if len(items) == 0 {
			items = []string{""}
		}
		sort.Strings(items)
		for _, value := range items {
			parts = append(parts, awsPercentEncode(key)+"="+awsPercentEncode(value))
		}
	}
	return strings.Join(parts, "&")
}

func awsPercentEncode(value string) string {
	encoded := url.QueryEscape(value)
	encoded = strings.ReplaceAll(encoded, "+", "%20")
	encoded = strings.ReplaceAll(encoded, "%7E", "~")
	return encoded
}

func hmacSHA256(key []byte, value string) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(value))
	return mac.Sum(nil)
}
