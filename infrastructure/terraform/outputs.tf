output "container" {
  value = one(docker_container.api[*].name)
}

# During the cutover (no engine yet) the service that must stay up is the player.
output "health_url" {
  value = var.start_engine ? "http://127.0.0.1:${var.host_port}/health" : "${var.jellyfin_url}/health"
}

output "public_url" {
  value = local.public_url
}

# Dumped by the deployer before every version change.
output "backup_databases" {
  value = [postgresql_database.app.name]
}
