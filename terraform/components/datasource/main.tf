resource "random_password" "database_password" {
  count   = var.database_password == null ? 1 : 0
  length  = 32
  min_lower = 5
  min_upper = 5
  min_numeric = 5
  min_special = 5
  special = true
}

# Random port for PostgreSQL to avoid conflicts
resource "random_integer" "postgres_port" {
  min = 10000
  max = 65535
}

locals {
  database_password = var.database_password != null ? var.database_password : random_password.database_password[0].result
}

# PostgreSQL volume
resource "docker_volume" "postgres_data" {
  name = "${var.slug}-postgres-data"
}

# PostgreSQL container
resource "docker_container" "postgres" {
  image = "postgres:15-alpine"
  name  = "${var.slug}-postgres"
  
  restart = "unless-stopped"
  
  networks_advanced {
    name = var.network_name
  }
  
  ports {
    internal = 5432
    external = random_integer.postgres_port.result
  }
  
  env = [
    "POSTGRES_DB=${var.slug}",
    "POSTGRES_USER=${var.slug}",
    "POSTGRES_PASSWORD=${local.database_password}"
  ]
  
  volumes {
    volume_name    = docker_volume.postgres_data.name
    container_path = "/var/lib/postgresql/data"
  }
  
  # Mount SQL initialization scripts
  volumes {
    host_path      = var.sql_scripts_path
    container_path = "/docker-entrypoint-initdb.d"
    read_only      = true
  }
  
  # Labels for grouping
  labels {
    label = "com.docker.compose.project"
    value = var.slug
  }
  
  labels {
    label = "com.docker.compose.service"
    value = "postgres"
  }

  healthcheck {
    test     = ["CMD-SHELL", "pg_isready -U ${var.slug}"]
    interval = "30s"
    timeout  = "10s"
    retries  = 3
  }
}

# Migration module
module "migration" {
  source = "./migration"
  
  slug                  = var.slug
  network_name          = var.network_name
  database_container_id = docker_container.postgres.id
  image_registry        = var.image_registry
  database_config       = {
    host     = docker_container.postgres.name
    port     = "5432"
    database = var.slug
    user     = var.slug
    password = local.database_password
  }
}