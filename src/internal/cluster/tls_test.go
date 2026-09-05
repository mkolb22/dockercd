package cluster

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type testTLSMaterial struct {
	caFile string
	certs  map[string]string
	keys   map[string]string
}

func newTestTLSMaterial(t *testing.T, names ...string) testTLSMaterial {
	t.Helper()
	dir := t.TempDir()
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	caTemplate := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "dockercd test CA"},
		NotBefore:             now.Add(-time.Hour),
		NotAfter:              now.Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTemplate, caTemplate, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	caFile := filepath.Join(dir, "ca.pem")
	writeTestPEM(t, caFile, "CERTIFICATE", caDER)

	material := testTLSMaterial{caFile: caFile, certs: make(map[string]string), keys: make(map[string]string)}
	for i, name := range names {
		key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		leafTemplate := &x509.Certificate{
			SerialNumber: big.NewInt(int64(i + 2)),
			Subject:      pkix.Name{CommonName: name},
			DNSNames:     []string{name},
			NotBefore:    now.Add(-time.Hour),
			NotAfter:     now.Add(time.Hour),
			KeyUsage:     x509.KeyUsageDigitalSignature,
			ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth, x509.ExtKeyUsageServerAuth},
		}
		leafDER, err := x509.CreateCertificate(rand.Reader, leafTemplate, caTemplate, &key.PublicKey, caKey)
		if err != nil {
			t.Fatal(err)
		}
		certFile := filepath.Join(dir, name+".pem")
		keyFile := filepath.Join(dir, name+".key")
		writeTestPEM(t, certFile, "CERTIFICATE", leafDER)
		keyDER, err := x509.MarshalECPrivateKey(key)
		if err != nil {
			t.Fatal(err)
		}
		writeTestPEM(t, keyFile, "EC PRIVATE KEY", keyDER)
		material.certs[name] = certFile
		material.keys[name] = keyFile
	}
	return material
}

func writeTestPEM(t *testing.T, path, typ string, der []byte) {
	t.Helper()
	if err := os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: typ, Bytes: der}), 0o600); err != nil {
		t.Fatal(err)
	}
}

func secureTestConfig(t *testing.T, material testTLSMaterial, nodeID, peerID, peerAddr, listenAddr, preferred string) ClusterConfig {
	t.Helper()
	return ClusterConfig{
		Enabled:           true,
		NodeID:            nodeID,
		PeerID:            peerID,
		PeerAddr:          peerAddr,
		ListenAddr:        listenAddr,
		HeartbeatInterval: 100 * time.Millisecond,
		MaxMissedBeats:    3,
		PreferredLeader:   preferred,
		DataDir:           t.TempDir(),
		TLSCertFile:       material.certs[nodeID],
		TLSKeyFile:        material.keys[nodeID],
		TLSCAFile:         material.caFile,
	}
}

func freeTCPAddr(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	return addr
}

func startHeartbeatForTest(t *testing.T, n *ClusterNode) context.CancelFunc {
	t.Helper()
	if err := n.config.Validate(); err != nil {
		t.Fatal(err)
	}
	if err := n.configureTLS(); err != nil {
		t.Fatal(err)
	}
	listener, err := n.startHeartbeatListener()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	go n.serveHeartbeat(ctx, listener)
	return cancel
}

func TestClusterControlRequiresMutualTLS(t *testing.T) {
	material := newTestTLSMaterial(t, "node0", "node1")
	addr := freeTCPAddr(t)
	server := NewClusterNode(secureTestConfig(t, material, "node1", "node0", "127.0.0.1:1", addr, "node0"), nil, nil, testLogger())
	cancel := startHeartbeatForTest(t, server)
	defer cancel()

	conn, err := net.DialTimeout("tcp", addr, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(time.Second))
	if _, err := conn.Write([]byte("PROMOTE node0\\n")); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 1)
	if _, err := conn.Read(buf); err == nil {
		t.Fatal("unauthenticated plaintext control message unexpectedly received a response")
	}
	if server.IsActive() {
		t.Fatal("unauthenticated control message promoted the passive node")
	}
}

func TestClusterControlRejectsWrongPeerIdentity(t *testing.T) {
	material := newTestTLSMaterial(t, "node0", "node1", "attacker")
	addr := freeTCPAddr(t)
	server := NewClusterNode(secureTestConfig(t, material, "node1", "node0", "127.0.0.1:1", addr, "node0"), nil, nil, testLogger())
	cancel := startHeartbeatForTest(t, server)
	defer cancel()

	attacker := NewClusterNode(secureTestConfig(t, material, "attacker", "node1", addr, "127.0.0.1:0", "node0"), nil, nil, testLogger())
	if err := attacker.configureTLS(); err != nil {
		t.Fatal(err)
	}
	if _, err := attacker.sendMessage(MsgPromote); err == nil {
		t.Fatal("wrong peer identity unexpectedly received a control response")
	}
	if server.IsActive() {
		t.Fatal("wrong peer identity promoted the passive node")
	}
}

func TestClusterControlAcceptsConfiguredPeer(t *testing.T) {
	material := newTestTLSMaterial(t, "node0", "node1")
	addr := freeTCPAddr(t)
	server := NewClusterNode(secureTestConfig(t, material, "node1", "node0", "127.0.0.1:1", addr, "node0"), nil, nil, testLogger())
	cancel := startHeartbeatForTest(t, server)
	defer cancel()

	client := NewClusterNode(secureTestConfig(t, material, "node0", "node1", addr, "127.0.0.1:0", "node0"), nil, nil, testLogger())
	if err := client.configureTLS(); err != nil {
		t.Fatal(err)
	}

	var response Message
	var err error
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		response, err = client.sendMessage(MsgPromote)
		if err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err != nil {
		t.Fatalf("configured peer control request failed: %v", err)
	}
	if response.Type != MsgAck || response.NodeID != "node1" || response.Extra != "active" {
		t.Fatalf("unexpected response: %#v", response)
	}
	if !server.IsActive() {
		t.Fatal("configured peer control request did not promote the node")
	}
}
