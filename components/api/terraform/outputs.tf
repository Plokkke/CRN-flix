output "container_name" {
  description = "Container name"
  value       = docker_container.docker_container_api.name
}

output "container_id" {
  description = "Container ID"
  value       = docker_container.docker_container_api.id
}