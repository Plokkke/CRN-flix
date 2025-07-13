variable "docker_host" {
  description = "Docker host connection string"
  type        = string
}

variable "docker_ssh_key" {
  description = "SSH private key for Docker host connection (optional for local)"
  type        = string
  default     = null
  sensitive   = true
}

variable "slug" {
  description = "Application qualifier to use as prefix"
  type        = string
}

variable "service_name" {
  description = "Service name for the application"
  type        = string
}

variable "postgres_version" {
  description = "PostgreSQL version"
  type        = string
  default     = "15-alpine"
}

variable "api_version" {
  description = "API version"
  type        = string
  default     = "latest"
}

variable "api_port" {
  description = "External port for API (optional, will be randomly generated if not provided)"
  type        = number
  default     = null
}

variable "image_registry" {
  description = "Docker image registry URL (e.g., europe-west1-docker.pkg.dev/project-id/repository). If empty, images will be built locally."
  type        = string
  default     = ""
}

variable "server_url" {
  description = "Server URL for the application"
  type        = string
}

variable "sync_interval_ms" {
  description = "Sync interval in milliseconds"
  type        = number
  default     = 600000
}

# Trakt configuration
variable "trakt_client_id" {
  description = "Trakt API client ID"
  type        = string
  sensitive   = true
}

variable "trakt_client_secret" {
  description = "Trakt API client secret"
  type        = string
  sensitive   = true
}

# Jellyfin configuration
variable "jellyfin_host" {
  description = "Jellyfin server host URL"
  type        = string
}

variable "jellyfin_token" {
  description = "Jellyfin API token"
  type        = string
  sensitive   = true
}

variable "jellyfin_login" {
  description = "Jellyfin login username"
  type        = string
  default     = "AdminLogin"
}

variable "jellyfin_password" {
  description = "Jellyfin login password"
  type        = string
  sensitive   = true
}

# Discord configuration
variable "discord_channel_id" {
  description = "Discord channel ID"
  type        = string
  sensitive   = true
}

variable "discord_bot_token" {
  description = "Discord bot token"
  type        = string
  sensitive   = true
}

variable "discord_admin_ids" {
  description = "Discord admin user IDs (comma-separated)"
  type        = string
  sensitive   = true
}

# Gmail configuration
variable "gmail_email" {
  description = "Gmail email address"
  type        = string
  sensitive   = true
}

variable "gmail_password" {
  description = "Gmail password or app password"
  type        = string
  sensitive   = true
}

# ClickUp configuration
variable "clickup_api_token" {
  description = "ClickUp API token"
  type        = string
  sensitive   = true
}

variable "clickup_team_id" {
  description = "ClickUp team ID"
  type        = string
  sensitive   = true
}

variable "clickup_list_id" {
  description = "ClickUp list ID"
  type        = string
  sensitive   = true
}

# Database configuration
variable "database_password" {
  description = "Database password (optional, will be randomly generated if not provided)"
  type        = string
  default     = null
  sensitive   = true
}