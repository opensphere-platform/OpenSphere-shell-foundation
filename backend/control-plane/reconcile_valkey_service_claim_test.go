package main

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func TestValkeyACLCommandsKeepConsumersInsideClaimKeyspace(t *testing.T) {
	commands, err := valkeyACLCommands("osp_1234", "secret", "orders:*", "ReadWrite")
	if err != nil || len(commands) != 2 {
		t.Fatalf("commands=%v err=%v", commands, err)
	}
	joined := strings.Join(commands[0], " ")
	for _, required := range []string{"ACL SETUSER osp_1234", "~orders:*", "+@read", "+@write", "-flushall", "-acl"} {
		if !strings.Contains(joined, required) {
			t.Errorf("ACL command %q missing %q", joined, required)
		}
	}
	readOnly, err := valkeyACLCommands("osp_ro", "secret", "reports:*", "ReadOnly")
	if err != nil || strings.Contains(strings.Join(readOnly[0], " "), "+@write") {
		t.Fatalf("read-only ACL=%v err=%v", readOnly, err)
	}
}

func TestValkeyUsernameIsStableAndDoesNotExposeClaimName(t *testing.T) {
	claim := object(fcGVK, "tenant-a", "customer-secret-project")
	claim.SetUID("91e8aa2c-4511-4adb-9a48-d594cb3781f3")
	first, second := valkeyUsername(claim), valkeyUsername(claim)
	if first != second || !strings.HasPrefix(first, "osp_") || strings.Contains(first, claim.GetName()) {
		t.Fatalf("username=%q second=%q", first, second)
	}
}

func TestRunValkeyCommandsUsesRESPAndAuthenticatesFirst(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	received := make(chan [][]string, 1)
	go func() {
		connection, acceptErr := listener.Accept()
		if acceptErr != nil {
			received <- nil
			return
		}
		defer connection.Close()
		reader := bufio.NewReader(connection)
		commands := make([][]string, 0, 3)
		for range 3 {
			command, readErr := readTestRESPCommand(reader)
			if readErr != nil {
				received <- nil
				return
			}
			commands = append(commands, command)
			_, _ = connection.Write([]byte("+OK\r\n"))
		}
		received <- commands
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	err = runValkeyCommands(ctx, listener.Addr().String(), "root-password", []string{"ACL", "SETUSER", "osp_test", "on"}, []string{"ACL", "SAVE"})
	if err != nil {
		t.Fatal(err)
	}
	commands := <-received
	want := [][]string{{"AUTH", "default", "root-password"}, {"ACL", "SETUSER", "osp_test", "on"}, {"ACL", "SAVE"}}
	if !reflect.DeepEqual(commands, want) {
		t.Fatalf("commands=%v want=%v", commands, want)
	}
}

func readTestRESPCommand(reader *bufio.Reader) ([]string, error) {
	line, err := reader.ReadString('\n')
	if err != nil {
		return nil, err
	}
	count, err := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(line, "*")))
	if err != nil {
		return nil, err
	}
	parts := make([]string, 0, count)
	for range count {
		lengthLine, err := reader.ReadString('\n')
		if err != nil {
			return nil, err
		}
		length, err := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(lengthLine, "$")))
		if err != nil {
			return nil, err
		}
		value := make([]byte, length+2)
		if _, err := reader.Read(value); err != nil {
			return nil, err
		}
		if string(value[length:]) != "\r\n" {
			return nil, fmt.Errorf("missing RESP terminator")
		}
		parts = append(parts, string(value[:length]))
	}
	return parts, nil
}

func TestValkeyNetworkPolicyAllowsRegisteredPFSSNamespaces(t *testing.T) {
	policy := valkeyNetworkPolicy("opensphere-foundation", "data", map[string]interface{}{"app": valkeyName}, false)
	from, found, err := unstructured.NestedSlice(policy.Object, "spec", "ingress", "0", "from")
	_ = from
	if err == nil && found {
		t.Fatal("NestedSlice cannot address array indexes; test must inspect the typed ingress below")
	}
	ingress, _, _ := unstructured.NestedSlice(policy.Object, "spec", "ingress")
	rule := ingress[0].(map[string]interface{})
	sources := rule["from"].([]interface{})
	if len(sources) != 2 {
		t.Fatalf("network policy sources=%v", sources)
	}
	managed := sources[1].(map[string]interface{})["namespaceSelector"].(map[string]interface{})["matchLabels"].(map[string]interface{})
	if managed["opensphere.io/managed-by"] != "foundation" || managed["opensphere.io/purpose"] != "pfss-service" {
		t.Fatalf("managed namespace selector=%v", managed)
	}
}
