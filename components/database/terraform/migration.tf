locals {
  build_locally = var.image_registry == "" || var.image_registry == null

  # URL encode the password for use in DATABASE_URL
  # Encode % first to avoid double-encoding
  encoded_password = replace(
    replace(
      replace(
        replace(
          replace(
            replace(
              replace(
                replace(
                  local.database_password,
                  "%", "%25"  # Must be first to avoid double-encoding other %XX sequences
                ),
                "&", "%26"
              ),
              "@", "%40"
            ),
            ":", "%3A"
          ),
          "/", "%2F"
        ),
        "?", "%3F"
      ),
      "#", "%23"
    ),
    "+", "%2B"
  )
}

resource "docker_image" "migration" {
  name         = local.build_locally ? "${var.slug}-migration:${var.app_version}" : "${var.image_registry}/${var.slug}/migration:${var.app_version}"
  keep_locally = true

  # Build locally if no registry provided
  dynamic "build" {
    for_each = local.build_locally ? [1] : []
    content {
      context    = "${path.cwd}/.."
      dockerfile = "components/database/migration/Dockerfile"
    }
  }
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
    "DATABASE_URL=postgresql://${var.slug}:${local.encoded_password}@${docker_container.postgres.name}:5432/${var.slug}",
    "DATABASE_HOST=${docker_container.postgres.name}",
    "DATABASE_PORT=5432",
    "DATABASE_NAME=${var.slug}",
    "DATABASE_USER=${var.slug}",
    "DATABASE_PASSWORD=${local.database_password}"
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
  depends_on = [docker_container.postgres]
}
