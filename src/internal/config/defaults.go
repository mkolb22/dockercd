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
	v.SetDefault("image_poll_interval", 300*time.Second)
	v.SetDefault("default_registry_url", "")
}
