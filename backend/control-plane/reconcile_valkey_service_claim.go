package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

const valkeyCredentialSuffix = "-valkey-access"

func (r *claimReconciler) resolveValkeyServiceBinding(
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
	if !r.valkeyReady(ctx, namespace) {
		return serviceBindingProjection{}, "ValkeyNotReady", nil
	}
	endpoint := fmt.Sprintf("redis://%s.%s.svc:6379", valkeyName, namespace)
	projection := serviceBindingProjection{
		Module: contract.ID, Endpoint: endpoint, Probe: fmt.Sprintf("%s.%s.svc:6379", valkeyName, namespace),
		Capabilities: append([]string(nil), contract.Capabilities...),
		ResourceRef: map[string]interface{}{
			"apiVersion": "apps/v1", "kind": "StatefulSet", "name": valkeyName, "namespace": namespace,
		},
	}
	if requestTypeOf(claim) == "Instance" {
		return projection, "", nil
	}
	if requestTypeOf(claim) != "Access" {
		return serviceBindingProjection{}, "UnsupportedRequestType", nil
	}

	rootSecretName := dataEngineParams(model, r.cfg, "valkey").authSecret
	rootSecret := gvkObj(schema.GroupVersionKind{Version: "v1", Kind: "Secret"})
	if rootSecretName == "" || r.direct.Get(ctx, types.NamespacedName{Namespace: namespace, Name: rootSecretName}, rootSecret) != nil {
		return serviceBindingProjection{}, "ValkeyRootCredentialNotReady", nil
	}
	rootPassword := secretString(rootSecret, "password")
	if rootPassword == "" {
		return serviceBindingProjection{}, "ValkeyRootCredentialNotReady", nil
	}
	credential, managedCredential, reason, err := r.ensureValkeyCredential(ctx, claim, valkeyName+"."+namespace+".svc", endpoint)
	if err != nil || reason != "" {
		return serviceBindingProjection{}, reason, err
	}
	username, password := secretString(credential, "username"), secretString(credential, "password")
	access := serviceClaimString(claim, "ReadWrite", "access")
	commands, err := valkeyACLCommands(username, password, claim.GetName()+":*", access)
	if err != nil {
		return serviceBindingProjection{}, "InvalidRequest", nil
	}
	if err := runValkeyCommands(ctx, projection.Probe, rootPassword, commands...); err != nil {
		return serviceBindingProjection{}, "ValkeyACLNotReady", nil
	}
	projection.SecretRef = map[string]interface{}{"name": credential.GetName(), "namespace": credential.GetNamespace()}
	projection.Capabilities = append(projection.Capabilities, "access:"+strings.ToLower(access))
	if managedCredential {
		projection.Capabilities = append(projection.Capabilities, "credential:managed")
	}
	return projection, "", nil
}

func (r *claimReconciler) valkeyReady(ctx context.Context, namespace string) bool {
	statefulSet := gvkObj(statefulSetGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: namespace, Name: valkeyName}, statefulSet); err != nil {
		return false
	}
	desired, _, _ := unstructured.NestedInt64(statefulSet.Object, "spec", "replicas")
	ready, _, _ := unstructured.NestedInt64(statefulSet.Object, "status", "readyReplicas")
	return desired > 0 && ready >= desired
}

func (r *claimReconciler) ensureValkeyCredential(
	ctx context.Context,
	claim *unstructured.Unstructured,
	host string,
	endpoint string,
) (*unstructured.Unstructured, bool, string, error) {
	name, supplied, _ := unstructured.NestedString(claim.Object, "spec", "credentialSecretRef", "name")
	managed := !supplied || strings.TrimSpace(name) == ""
	if managed {
		name = claim.GetName() + valkeyCredentialSuffix
	}
	secret := gvkObj(schema.GroupVersionKind{Version: "v1", Kind: "Secret"})
	nn := types.NamespacedName{Namespace: claim.GetNamespace(), Name: name}
	err := r.direct.Get(ctx, nn, secret)
	if err == nil {
		if secretString(secret, "username") == "" || secretString(secret, "password") == "" {
			return nil, managed, "ValkeyCredentialInvalid", nil
		}
		return secret, managed, "", nil
	}
	if !apierrors.IsNotFound(err) {
		return nil, managed, "", err
	}
	if !managed {
		return nil, false, "ValkeyCredentialNotReady", nil
	}
	password, err := randomServicePassword(32)
	if err != nil {
		return nil, true, "", err
	}
	username := valkeyUsername(claim)
	secret = object(schema.GroupVersionKind{Version: "v1", Kind: "Secret"}, claim.GetNamespace(), name)
	secret.Object["type"] = "Opaque"
	secret.Object["data"] = map[string]interface{}{
		"username": base64.StdEncoding.EncodeToString([]byte(username)),
		"password": base64.StdEncoding.EncodeToString([]byte(password)),
		"uri":      base64.StdEncoding.EncodeToString([]byte(endpoint)),
		"host":     base64.StdEncoding.EncodeToString([]byte(host)),
		"port":     base64.StdEncoding.EncodeToString([]byte("6379")),
	}
	secret.SetLabels(map[string]string{
		lblManagedBy: cpManagedBy, lblPartOf: "foundation-data", lblModel: "data", lblEngine: "valkey",
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

func valkeyUsername(claim *unstructured.Unstructured) string {
	identity := string(claim.GetUID())
	if identity == "" {
		identity = claim.GetNamespace() + "/" + claim.GetName()
	}
	sum := sha256.Sum256([]byte(identity))
	return "osp_" + fmt.Sprintf("%x", sum[:8])
}

func randomServicePassword(size int) (string, error) {
	data := make([]byte, size)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func valkeyACLCommands(username, password, keyPattern, access string) ([][]string, error) {
	if username == "" || password == "" || strings.ContainsAny(username+password+keyPattern, "\r\n\x00") {
		return nil, fmt.Errorf("invalid Valkey ACL credential")
	}
	permissions := []string{"reset", "on", ">" + password, "~" + keyPattern, "+@read", "+ping", "+info"}
	switch access {
	case "ReadOnly":
	case "ReadWrite":
		permissions = append(permissions, "+@write", "-flushall", "-flushdb", "-config", "-acl", "-shutdown", "-module", "-debug", "-save", "-bgrewriteaof", "-replicaof")
	default:
		return nil, fmt.Errorf("Valkey access must be ReadOnly or ReadWrite")
	}
	setUser := append([]string{"ACL", "SETUSER", username}, permissions...)
	return [][]string{setUser, {"ACL", "SAVE"}}, nil
}

func runValkeyCommands(ctx context.Context, address, rootPassword string, commands ...[]string) error {
	dialer := net.Dialer{Timeout: 4 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(8 * time.Second))
	reader := bufio.NewReader(conn)
	all := append([][]string{{"AUTH", "default", rootPassword}}, commands...)
	for _, command := range all {
		if err := writeRESPCommand(conn, command); err != nil {
			return err
		}
		if err := readRESPStatus(reader); err != nil {
			return err
		}
	}
	return nil
}

func writeRESPCommand(writer io.Writer, command []string) error {
	if _, err := fmt.Fprintf(writer, "*%d\r\n", len(command)); err != nil {
		return err
	}
	for _, part := range command {
		if _, err := fmt.Fprintf(writer, "$%d\r\n%s\r\n", len(part), part); err != nil {
			return err
		}
	}
	return nil
}

func readRESPStatus(reader *bufio.Reader) error {
	line, err := reader.ReadString('\n')
	if err != nil {
		return err
	}
	line = strings.TrimSuffix(strings.TrimSuffix(line, "\n"), "\r")
	if line == "" {
		return io.ErrUnexpectedEOF
	}
	switch line[0] {
	case '+':
		return nil
	case ':':
		_, err := strconv.ParseInt(line[1:], 10, 64)
		return err
	case '-':
		return fmt.Errorf("Valkey command rejected: %s", line[1:])
	default:
		return fmt.Errorf("unexpected Valkey response %q", line)
	}
}

func (r *claimReconciler) cleanupValkeyServiceClaim(ctx context.Context, claim *unstructured.Unstructured, model *unstructured.Unstructured) (bool, error) {
	if requestTypeOf(claim) != "Access" {
		return true, nil
	}
	namespace := dataNS(r.cfg, model)
	rootName := dataEngineParams(model, r.cfg, "valkey").authSecret
	root := gvkObj(schema.GroupVersionKind{Version: "v1", Kind: "Secret"})
	if rootName == "" || r.direct.Get(ctx, types.NamespacedName{Namespace: namespace, Name: rootName}, root) != nil {
		return false, nil
	}
	rootPassword := secretString(root, "password")
	if rootPassword == "" {
		return false, nil
	}
	probe := fmt.Sprintf("%s.%s.svc:6379", valkeyName, namespace)
	if err := runValkeyCommands(ctx, probe, rootPassword, []string{"ACL", "DELUSER", valkeyUsername(claim)}, []string{"ACL", "SAVE"}); err != nil {
		return false, err
	}
	if _, supplied, _ := unstructured.NestedString(claim.Object, "spec", "credentialSecretRef", "name"); !supplied {
		secret := object(schema.GroupVersionKind{Version: "v1", Kind: "Secret"}, claim.GetNamespace(), claim.GetName()+valkeyCredentialSuffix)
		if err := r.direct.Delete(ctx, secret); err != nil && !apierrors.IsNotFound(err) {
			return false, err
		}
	}
	return true, nil
}
