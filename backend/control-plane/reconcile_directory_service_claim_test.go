package main

import (
	"testing"
	"unicode/utf16"

	ldap "github.com/go-ldap/ldap/v3"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

type fakeSambaLDAP struct {
	entries []*ldap.Entry
	adds    int
	dels    int
}

func (f *fakeSambaLDAP) Bind(string, string) error { return nil }
func (f *fakeSambaLDAP) Close() error              { return nil }
func (f *fakeSambaLDAP) Search(*ldap.SearchRequest) (*ldap.SearchResult, error) {
	return &ldap.SearchResult{Entries: f.entries}, nil
}
func (f *fakeSambaLDAP) Add(request *ldap.AddRequest) error {
	f.adds++
	attributes := make([]*ldap.EntryAttribute, 0, len(request.Attributes))
	for _, attribute := range request.Attributes {
		attributes = append(attributes, &ldap.EntryAttribute{Name: attribute.Type, Values: append([]string(nil), attribute.Vals...)})
	}
	f.entries = []*ldap.Entry{{DN: request.DN, Attributes: attributes}}
	return nil
}
func (f *fakeSambaLDAP) Del(*ldap.DelRequest) error { f.dels++; return nil }

func TestSambaRealmCoordinatesProducePortableBaseDN(t *testing.T) {
	model := gvkObj(fmGVK)
	model.Object["spec"] = map[string]interface{}{"parameters": map[string]interface{}{"samba": map[string]interface{}{"domain": "corp.example.com"}}}
	realm, baseDN, valid := sambaRealmCoordinates(model)
	if !valid || realm != "CORP.EXAMPLE.COM" || baseDN != "DC=corp,DC=example,DC=com" {
		t.Fatalf("realm coordinates=%q/%q/%v", realm, baseDN, valid)
	}
}

func TestSambaUnicodePasswordIsQuotedUTF16LittleEndian(t *testing.T) {
	encoded := sambaUnicodePassword("S3cret!")
	if len(encoded)%2 != 0 {
		t.Fatal("unicodePwd must contain complete UTF-16 code units")
	}
	units := make([]uint16, len(encoded)/2)
	for i := range units {
		units[i] = uint16(encoded[i*2]) | uint16(encoded[i*2+1])<<8
	}
	if got := string(utf16.Decode(units)); got != `"S3cret!"` {
		t.Fatalf("decoded unicodePwd=%q", got)
	}
}

func TestEnsureSambaServiceAccountIsIdempotentAndClaimOwned(t *testing.T) {
	client := &fakeSambaLDAP{}
	owner := "OpenSphere FoundationClaim uid-1"
	dn, err := ensureSambaServiceAccount(client, "DC=example,DC=com", "EXAMPLE.COM", "osp_1234", "S3cret!", owner)
	if err != nil {
		t.Fatal(err)
	}
	if dn != "CN=osp_1234,CN=Users,DC=example,DC=com" || client.adds != 1 {
		t.Fatalf("created account=%q adds=%d", dn, client.adds)
	}
	if _, err := ensureSambaServiceAccount(client, "DC=example,DC=com", "EXAMPLE.COM", "osp_1234", "S3cret!", owner); err != nil {
		t.Fatal(err)
	}
	if client.adds != 1 {
		t.Fatalf("idempotent reconcile created %d accounts", client.adds)
	}
	client.entries[0].Attributes = []*ldap.EntryAttribute{{Name: "description", Values: []string{"another owner"}}}
	if _, err := ensureSambaServiceAccount(client, "DC=example,DC=com", "EXAMPLE.COM", "osp_1234", "S3cret!", owner); err != errDirectoryUserConflict {
		t.Fatalf("foreign account must be rejected, got %v", err)
	}
}

func TestTypedDirectoryBindingDoesNotLeakDomainAdminSecret(t *testing.T) {
	claim := gvkObj(idcGVK)
	claim.SetName("consumer")
	claim.SetNamespace("app")
	binding := (&identityDirectoryReconciler{cfg: &config{managedNS: "opensphere-foundation"}}).buildBinding(claim, "consumer-binding")
	if _, found, _ := unstructured.NestedMap(binding.Object, "spec", "secretRef"); found {
		t.Fatal("shared directory binding leaked the domain administrator Secret")
	}
}
