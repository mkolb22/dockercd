package inspector

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"

	"crypto/tls"
	"github.com/mkolb22/dockercd/internal/config"
)

func writeTestTLSMaterial(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "dockercd test CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("create certificate: %v", err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyBytes, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatalf("marshal key: %v", err)
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyBytes})
	for name, contents := range map[string][]byte{
		"cert.pem": certPEM,
		"key.pem":  keyPEM,
		"ca.pem":   certPEM,
	} {
		if err := os.WriteFile(filepath.Join(dir, name), contents, 0o600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	return dir
}

func TestTLSConfigLoad_VerifiesByDefault(t *testing.T) {
	cfg, err := (TLSConfig{CertPath: writeTestTLSMaterial(t)}).LoadTLSConfig("tcp://docker.example.test:2376")
	if err != nil {
		t.Fatalf("LoadTLSConfig: %v", err)
	}
	if cfg.InsecureSkipVerify {
		t.Fatal("TLS verification must be enabled by default")
	}
	if cfg.RootCAs == nil {
		t.Fatal("TLS CA pool must be configured")
	}
	if cfg.MinVersion != tls.VersionTLS12 {
		t.Fatalf("MinVersion = %d, want TLS 1.2", cfg.MinVersion)
	}
}

func TestTLSConfigLoad_RejectsUnparseableCA(t *testing.T) {
	dir := writeTestTLSMaterial(t)
	if err := os.WriteFile(filepath.Join(dir, "ca.pem"), []byte("not a PEM certificate"), 0o600); err != nil {
		t.Fatalf("overwrite ca.pem: %v", err)
	}
	if _, err := (TLSConfig{CertPath: dir}).LoadTLSConfig("tcp://docker.example.test:2376"); err == nil {
		t.Fatal("expected invalid CA certificate to be rejected")
	}
}

func TestTLSConfigLoad_InsecureModeRequiresAcknowledgedLoopback(t *testing.T) {
	dir := writeTestTLSMaterial(t)
	if _, err := (TLSConfig{CertPath: dir, InsecureSkipVerify: true}).LoadTLSConfig("tcp://127.0.0.1:2376"); err == nil {
		t.Fatal("expected unacknowledged insecure TLS mode to be rejected")
	}
	cfg, err := (TLSConfig{
		CertPath:                   dir,
		InsecureSkipVerify:         true,
		DevelopmentAcknowledgement: config.InsecureTLSDevelopmentAcknowledgement,
	}).LoadTLSConfig("tcp://127.0.0.1:2376")
	if err != nil {
		t.Fatalf("acknowledged loopback development TLS config: %v", err)
	}
	if !cfg.InsecureSkipVerify {
		t.Fatal("acknowledged loopback development config should retain its explicit opt-out")
	}
}
