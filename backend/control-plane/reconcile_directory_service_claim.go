package main

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf16"

	ldap "github.com/go-ldap/ldap/v3"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

const directoryCredentialSuffix = "-directory-access"

var (
	directoryAccountPattern  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$`)
	errDirectoryUserConflict = errors.New("directory account is owned by another claim")
)

type sambaLDAPClient interface {
	Bind(username, password string) error
	Search(searchRequest *ldap.SearchRequest) (*ldap.SearchResult, error)
	Add(addRequest *ldap.AddRequest) error
	Del(delRequest *ldap.DelRequest) error
	Close() error
}

var dialSambaLDAP = func(endpoint string, tlsConfig *tls.Config) (sambaLDAPClient, error) {
	return ldap.DialURL(endpoint, ldap.DialWithTLSConfig(tlsConfig))
}

func (r *claimReconciler) resolveDirectoryServiceBinding(ctx context.Context, claim, model *unstructured.Unstructured, contract serviceModuleContract) (serviceBindingProjection, string, error) {
	managed, err := r.foundationServiceNamespaceAccepted(ctx, claim.GetNamespace())
	if err != nil {
		return serviceBindingProjection{}, "", err
	}
	if !managed {
		return serviceBindingProjection{}, "NamespaceNotManaged", nil
	}
	if !r.directoryReady(ctx) {
		return serviceBindingProjection{}, "DirectoryNotReady", nil
	}
	realm, baseDN, valid := sambaRealmCoordinates(model)
	if !valid {
		return serviceBindingProjection{}, "DirectoryRealmInvalid", nil
	}
	endpoint := "ldaps://" + identityDirectoryDNS(r.cfg.managedNS) + ":636"
	projection := serviceBindingProjection{
		Module: contract.ID, Endpoint: endpoint, Probe: identityDirectoryDNS(r.cfg.managedNS) + ":636",
		Capabilities: append([]string(nil), contract.Capabilities...),
		ResourceRef:  map[string]interface{}{"apiVersion": "apps/v1", "kind": "Deployment", "name": sambaName, "namespace": r.cfg.managedNS},
	}
	requestType := requestTypeOf(claim)
	if requestType == "Instance" || requestType == "Directory" {
		projection.Capabilities = append(projection.Capabilities, "realm:"+realm, "base-dn:"+baseDN)
		return projection, "", nil
	}
	if requestType != "Access" {
		return serviceBindingProjection{}, "UnsupportedRequestType", nil
	}
	credential, managedCredential, reason, err := r.ensureDirectoryCredential(ctx, claim, endpoint, realm, baseDN)
	if err != nil || reason != "" {
		return serviceBindingProjection{}, reason, err
	}
	username, password := secretString(credential, "username"), secretString(credential, "password")
	if !directoryAccountPattern.MatchString(username) || password == "" {
		return serviceBindingProjection{}, "DirectoryCredentialInvalid", nil
	}
	client, reason, err := r.openSambaLDAP(ctx, model, endpoint, realm)
	if err != nil || reason != "" {
		return serviceBindingProjection{}, reason, err
	}
	defer client.Close()
	owner := directoryOwnerMarker(claim)
	dn, err := ensureSambaServiceAccount(client, baseDN, realm, username, password, owner)
	if err != nil {
		if errors.Is(err, errDirectoryUserConflict) {
			return serviceBindingProjection{}, "DirectoryAccountConflict", nil
		}
		return serviceBindingProjection{}, "DirectoryAccountReconcileFailed", nil
	}
	projection.SecretRef = map[string]interface{}{"name": credential.GetName(), "namespace": credential.GetNamespace()}
	projection.ResourceRef = map[string]interface{}{"apiVersion": "ldap.opensphere.io/v1", "kind": "ServiceAccount", "name": username, "namespace": realm}
	projection.Capabilities = append(projection.Capabilities, "account:"+username, "base-dn:"+baseDN)
	if managedCredential {
		projection.Capabilities = append(projection.Capabilities, "credential:managed")
	}
	_ = dn
	return projection, "", nil
}

func (r *claimReconciler) directoryReady(ctx context.Context) bool {
	deployment := gvkObj(schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"})
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: sambaName}, deployment); err != nil {
		return false
	}
	desired, _, _ := unstructured.NestedInt64(deployment.Object, "spec", "replicas")
	ready, _, _ := unstructured.NestedInt64(deployment.Object, "status", "readyReplicas")
	return desired > 0 && ready >= desired
}

func sambaRealmCoordinates(model *unstructured.Unstructured) (realm, baseDN string, valid bool) {
	realm = strings.ToUpper(strings.TrimSpace(configuredSambaRealm(model)))
	labels := strings.Split(strings.ToLower(realm), ".")
	if len(labels) < 2 {
		return "", "", false
	}
	parts := make([]string, 0, len(labels))
	for _, label := range labels {
		if !dnsLabelPattern.MatchString(label) {
			return "", "", false
		}
		parts = append(parts, "DC="+ldap.EscapeDN(label))
	}
	return realm, strings.Join(parts, ","), true
}

func (r *claimReconciler) openSambaLDAP(ctx context.Context, model *unstructured.Unstructured, endpoint, realm string) (sambaLDAPClient, string, error) {
	root := gvkObj(schema.GroupVersionKind{Version: "v1", Kind: "Secret"})
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: identityDirectorySecret}, root); err != nil {
		if apierrors.IsNotFound(err) {
			return nil, "DirectoryAdminCredentialNotReady", nil
		}
		return nil, "", err
	}
	password := secretString(root, "domain-password")
	if password == "" {
		return nil, "DirectoryAdminCredentialInvalid", nil
	}
	certificate := gvkObj(schema.GroupVersionKind{Version: "v1", Kind: "Secret"})
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: "foundation-identity-samba-ldaps"}, certificate); err != nil {
		if apierrors.IsNotFound(err) {
			return nil, "DirectoryCASecretNotReady", nil
		}
		return nil, "", err
	}
	caPEM := []byte(secretString(certificate, "ca.crt"))
	roots := x509.NewCertPool()
	if len(caPEM) == 0 || !roots.AppendCertsFromPEM(caPEM) {
		return nil, "DirectoryCASecretInvalid", nil
	}
	client, err := dialSambaLDAP(endpoint, &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: roots, ServerName: identityDirectoryDNS(r.cfg.managedNS)})
	if err != nil {
		return nil, "DirectoryLDAPSUnavailable", nil
	}
	select {
	case <-ctx.Done():
		client.Close()
		return nil, "", ctx.Err()
	default:
	}
	if err := client.Bind("Administrator@"+realm, password); err != nil {
		client.Close()
		return nil, "DirectoryAdminBindFailed", nil
	}
	_ = model
	return client, "", nil
}

func (r *claimReconciler) ensureDirectoryCredential(ctx context.Context, claim *unstructured.Unstructured, endpoint, realm, baseDN string) (*unstructured.Unstructured, bool, string, error) {
	name, supplied, _ := unstructured.NestedString(claim.Object, "spec", "credentialSecretRef", "name")
	managed := !supplied || strings.TrimSpace(name) == ""
	if managed {
		name = claim.GetName() + directoryCredentialSuffix
	}
	secret := gvkObj(schema.GroupVersionKind{Version: "v1", Kind: "Secret"})
	nn := types.NamespacedName{Namespace: claim.GetNamespace(), Name: name}
	if err := r.direct.Get(ctx, nn, secret); err == nil {
		if secretString(secret, "username") == "" || secretString(secret, "password") == "" {
			return nil, managed, "DirectoryCredentialInvalid", nil
		}
		return secret, managed, "", nil
	} else if !apierrors.IsNotFound(err) {
		return nil, managed, "", err
	}
	if !managed {
		return nil, false, "DirectoryCredentialNotReady", nil
	}
	password, err := randomServicePassword(32)
	if err != nil {
		return nil, true, "", err
	}
	username := serviceClaimString(claim, directoryUsername(claim), "username")
	if !directoryAccountPattern.MatchString(username) {
		return nil, true, "DirectoryCredentialInvalid", nil
	}
	secret = object(schema.GroupVersionKind{Version: "v1", Kind: "Secret"}, claim.GetNamespace(), name)
	secret.Object["type"] = "Opaque"
	secret.Object["data"] = map[string]interface{}{
		"username": base64.StdEncoding.EncodeToString([]byte(username)), "password": base64.StdEncoding.EncodeToString([]byte(password)),
		"uri": base64.StdEncoding.EncodeToString([]byte(endpoint)), "realm": base64.StdEncoding.EncodeToString([]byte(realm)), "base-dn": base64.StdEncoding.EncodeToString([]byte(baseDN)),
	}
	secret.SetLabels(map[string]string{lblManagedBy: cpManagedBy, lblPartOf: "foundation-identity", lblModel: "identity", lblEngine: "samba", "foundation.opensphere.io/service-claim": claim.GetName()})
	_ = unstructured.SetNestedSlice(secret.Object, []interface{}{unstructuredOwnerReference(claim)}, "metadata", "ownerReferences")
	if err := applyObj(ctx, r.direct, secret); err != nil {
		return nil, true, "", err
	}
	if err := r.direct.Get(ctx, nn, secret); err != nil {
		return nil, true, "", err
	}
	return secret, true, "", nil
}

func directoryUsername(claim *unstructured.Unstructured) string {
	identity := string(claim.GetUID())
	if identity == "" {
		identity = claim.GetNamespace() + "/" + claim.GetName()
	}
	sum := sha256.Sum256([]byte(identity))
	return "osp_" + fmt.Sprintf("%x", sum[:8])
}

func directoryOwnerMarker(claim *unstructured.Unstructured) string {
	uid := string(claim.GetUID())
	if uid == "" {
		uid = claim.GetNamespace() + "/" + claim.GetName()
	}
	return "OpenSphere FoundationClaim " + uid
}

func ensureSambaServiceAccount(client sambaLDAPClient, baseDN, realm, username, password, owner string) (string, error) {
	filter := "(&(objectClass=user)(sAMAccountName=" + ldap.EscapeFilter(username) + "))"
	result, err := client.Search(ldap.NewSearchRequest(baseDN, ldap.ScopeWholeSubtree, ldap.NeverDerefAliases, 2, 5, false, filter, []string{"distinguishedName", "description"}, nil))
	if err != nil {
		return "", err
	}
	if len(result.Entries) > 1 {
		return "", errDirectoryUserConflict
	}
	if len(result.Entries) == 1 {
		if result.Entries[0].GetAttributeValue("description") != owner {
			return "", errDirectoryUserConflict
		}
		return result.Entries[0].DN, nil
	}
	dn := "CN=" + ldap.EscapeDN(username) + ",CN=Users," + baseDN
	add := ldap.NewAddRequest(dn, nil)
	add.Attribute("objectClass", []string{"top", "person", "organizationalPerson", "user"})
	add.Attribute("cn", []string{username})
	add.Attribute("sn", []string{username})
	add.Attribute("displayName", []string{username})
	add.Attribute("sAMAccountName", []string{username})
	add.Attribute("userPrincipalName", []string{username + "@" + realm})
	add.Attribute("description", []string{owner})
	add.Attribute("unicodePwd", []string{string(sambaUnicodePassword(password))})
	add.Attribute("userAccountControl", []string{"512"})
	add.Attribute("pwdLastSet", []string{"-1"})
	if err := client.Add(add); err != nil {
		return "", err
	}
	return dn, nil
}

func sambaUnicodePassword(password string) []byte {
	encoded := utf16.Encode([]rune(`"` + password + `"`))
	result := make([]byte, len(encoded)*2)
	for i, value := range encoded {
		result[i*2], result[i*2+1] = byte(value), byte(value>>8)
	}
	return result
}

func (r *claimReconciler) cleanupDirectoryServiceClaim(ctx context.Context, claim, model *unstructured.Unstructured) (bool, error) {
	if requestTypeOf(claim) != "Access" {
		return true, nil
	}
	// The directory account is the authoritative remote resource.  Keep the
	// claim finalizer and its generated credential while the directory is
	// unavailable so a later reconcile can remove the account without leaving
	// an orphaned principal behind.
	if !r.directoryReady(ctx) {
		return false, nil
	}
	secretName, supplied, _ := unstructured.NestedString(claim.Object, "spec", "credentialSecretRef", "name")
	if !supplied {
		secretName = claim.GetName() + directoryCredentialSuffix
	}
	secret := gvkObj(schema.GroupVersionKind{Version: "v1", Kind: "Secret"})
	username := directoryUsername(claim)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: claim.GetNamespace(), Name: secretName}, secret); err == nil {
		username = secretString(secret, "username")
	}
	realm, baseDN, valid := sambaRealmCoordinates(model)
	if !valid {
		return false, nil
	}
	client, reason, err := r.openSambaLDAP(ctx, model, "ldaps://"+identityDirectoryDNS(r.cfg.managedNS)+":636", realm)
	if err != nil {
		return false, err
	}
	if reason != "" {
		return false, nil
	}
	defer client.Close()
	result, err := client.Search(ldap.NewSearchRequest(baseDN, ldap.ScopeWholeSubtree, ldap.NeverDerefAliases, 2, 5, false, "(&(objectClass=user)(sAMAccountName="+ldap.EscapeFilter(username)+"))", []string{"distinguishedName", "description"}, nil))
	if err != nil {
		return false, err
	}
	if len(result.Entries) == 1 && result.Entries[0].GetAttributeValue("description") == directoryOwnerMarker(claim) {
		if err := client.Del(ldap.NewDelRequest(result.Entries[0].DN, nil)); err != nil && !ldap.IsErrorWithCode(err, ldap.LDAPResultNoSuchObject) {
			return false, err
		}
	}
	if !supplied {
		if err := r.direct.Delete(ctx, object(schema.GroupVersionKind{Version: "v1", Kind: "Secret"}, claim.GetNamespace(), secretName)); err != nil && !apierrors.IsNotFound(err) {
			return false, err
		}
	}
	return true, nil
}
