variable "slug" {
  description = "Application slug"
  type        = string
}

variable "app_version" {
  description = "Migration version tag"
  type        = string
  default     = "latest"
}

variable "network_name" {
  description = "Docker network name"
  type        = string
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

variable "database_container_id" {
  description = "Database container ID for dependency"
  type        = string
}