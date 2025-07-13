variable "slug" {
  description = "Application slug"
  type        = string
}

variable "network_name" {
  description = "Docker network name"
  type        = string
}

variable "sql_scripts_path" {
  description = "Path to SQL initialization scripts"
  type        = string
  default     = "./sql"
}

variable "database_password" {
  description = "Database password (optional, will be randomly generated if not provided)"
  type        = string
  default     = null
  sensitive   = true
}

variable "image_registry" {
  description = "Docker image registry URL (e.g., europe-west1-docker.pkg.dev/project-id/repository). If empty, images will be built locally."
  type        = string
  default     = ""
} 