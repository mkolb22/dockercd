package config

import (
	"time"

	"github.com/spf13/viper"
)

func setDefaults(v *viper.Viper) {
	v.SetDefault("data_dir", "/data")
	v.SetDefault("config_dir", "/config/applications")
	v.SetDefault("log_level", "info")
	v.SetDefault("api_port", 8080)
	v.SetDefault("docker_host", "unix:///var/run/docker.sock")
	v.SetDefault("worker_count", 4)
	v.SetDefault("default_poll_interval", 180*time.Second)
	v.SetDefault("git_token", "")
	v.SetDefault("webhook_secret", "")
	v.SetDefault("slack_webhook_url", "")
	v.SetDefault("notification_webhook_url", "")
	v.SetDefault("notification_webhook_headers", map[string]string{})
	v.SetDefault("age_key_file", "")
	v.SetDefault("tls", []TLSHostConfig{})
	v.SetDefault("vault_addr", "")
	v.SetDefault("vault_token", "")
	v.SetDefault("aws_region", "")
	v.SetDefault("aws_endpoint", "")
	v.SetDefault("api_token", "")
	v.SetDefault("image_poll_interval", 300*time.Second)
	v.SetDefault("default_registry_url", "")
	v.SetDefault("manifest_repo_url", "")
	v.SetDefault("manifest_repo_path", "applications")
	v.SetDefault("manifest_revision", "main")

	// Cluster defaults (disabled by default — single-node mode)
	v.SetDefault("cluster.enabled", false)
	v.SetDefault("cluster.node_id", "node0")
	v.SetDefault("cluster.peer_addr", "")
	v.SetDefault("cluster.listen_addr", ":9090")
	v.SetDefault("cluster.heartbeat_interval", 60*time.Second)
	v.SetDefault("cluster.max_missed_beats", 3)
	v.SetDefault("cluster.preferred_leader", "node0")
	v.SetDefault("cluster.data_dir", "/data")
}
