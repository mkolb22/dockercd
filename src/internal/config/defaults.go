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
}
