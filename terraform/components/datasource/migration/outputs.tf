output "container_id" {
  description = "Migration container ID"
  value       = docker_container.migration.id
}

output "container_name" {
  description = "Migration container name"
  value       = docker_container.migration.name
}