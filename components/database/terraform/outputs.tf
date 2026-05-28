output "container_name" {
  description = "PostgreSQL container name"
  value       = docker_container.postgres.name
}

output "container_id" {
  description = "PostgreSQL container ID"
  value       = docker_container.postgres.id
}

output "volume_name" {
  description = "PostgreSQL data volume name"
  value       = docker_volume.postgres_data.name
}

output "connection_details" {
  description = "PostgreSQL connection details"
  value = {
    host     = docker_container.postgres.name
    port     = "5432"
    database = var.slug
    user     = var.slug
    password = local.database_password
  }
  sensitive = true
} 