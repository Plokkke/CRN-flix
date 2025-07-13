resource "docker_image" "migration" {
  name = "${var.slug}-migration:${var.app_version}"
  
  build {
    context = "${path.cwd}/../components/database"
    dockerfile = "Dockerfile"
  }
  
  keep_locally = true
}

resource "docker_container" "migration" {
  image = docker_image.migration.image_id
  name  = "${var.slug}-migration"
  
  # Migration runs once and exits
  restart = "no"
  
  networks_advanced {
    name = var.network_name
  }
  
  # Environment variables for database connection
  env = [
    "DATABASE_URL=postgresql://${var.database_config.user}:${var.database_config.password}@${var.database_config.host}:${var.database_config.port}/${var.database_config.database}",
    "DATABASE_HOST=${var.database_config.host}",
    "DATABASE_PORT=${var.database_config.port}",
    "DATABASE_NAME=${var.database_config.database}",
    "DATABASE_USER=${var.database_config.user}",
    "DATABASE_PASSWORD=${var.database_config.password}"
  ]
  
  # Labels for grouping
  labels {
    label = "com.docker.compose.project"
    value = var.slug
  }
  
  labels {
    label = "com.docker.compose.service"
    value = "migration"
  }

  # Wait for database to be ready
  depends_on = [var.database_container_id]
}