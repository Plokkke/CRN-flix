variable "slug" {
  description = "Application slug"
  type        = string
}

variable "network_name" {
  description = "Docker network name"
  type        = string
}

variable "database_password" {
  description = "Database password (optional, will be randomly generated if not provided)"
  type        = string
  default     = null
  sensitive   = true
}

variable "app_version" {
  description = "Application version for docker images"
  type        = string
  default     = "latest"
}

variable "image_registry" {
  description = "Docker image registry (empty string for local build)"
  type        = string
  default     = ""
}