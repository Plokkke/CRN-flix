variable "slug" {
  description = "Application slug"
  type        = string
}

variable "app_version" {
  description = "Application version tag"
  type        = string
  default     = "latest"
}

variable "network_name" {
  description = "Docker network name"
  type        = string
}

variable "database_container_id" {
  description = "Database container ID for dependency"
  type        = string
}

# Application configuration
variable "server_url" {
  description = "Server URL for the application"
  type        = string
}

variable "service_name" {
  description = "Service name for the application"
  type        = string
}

variable "sync_interval_ms" {
  description = "Sync interval in milliseconds"
  type        = number
}

variable "database_config" {
  description = "Database connection configuration"
  type = object({
    host     = string
    port     = string
    database = string
    user     = string
    password = string
  })
  sensitive = true
}

# External services
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
}

variable "jellyfin_password" {
  description = "Jellyfin login password"
  type        = string
  sensitive   = true
}

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
  description = "Discord admin user IDs"
  type        = string
  sensitive   = true
}

variable "gmail_email" {
  description = "Gmail email address"
  type        = string
  sensitive   = true
}

variable "gmail_password" {
  description = "Gmail password"
  type        = string
  sensitive   = true
}

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