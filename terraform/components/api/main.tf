# Random port for API if not provided
resource "random_integer" "api_port" {
  count = var.api_port == null ? 1 : 0
  min = 10000
  max = 65535
}

locals {
  api_external_port = var.api_port != null ? var.api_port : random_integer.api_port[0].result
}

locals {
  build_locally = var.image_registry == "" || var.image_registry == null
}

resource "docker_image" "docker_image_api" {
  name = local.build_locally ? "${var.slug}-api:${var.app_version}" : "${var.image_registry}/${var.slug}/api:${var.app_version}"
  keep_locally = true

  # Build locally if no registry provided
  dynamic "build" {
    for_each = local.build_locally ? [1] : []
    content {
      context = "${path.cwd}/../components/api"
      dockerfile = "Dockerfile"
    }
  }
}

resource "docker_container" "docker_container_api" {
  image = docker_image.docker_image_api.image_id
  name  = "${var.slug}-api"
  
  restart = "unless-stopped"
  
  networks_advanced {
    name = var.network_name
  }
  
  ports {
    internal = 3000
    external = local.api_external_port
  }
  
  # Environment variables
  env = [
    "NODE_ENV=production",
    "PORT=3000",
    "SERVER_URL=${var.server_url}",
    "SERVICE_NAME=${var.service_name}",
    "SYNC_INTERVAL_MS=${var.sync_interval_ms}",
    "DATABASE_HOST=${var.database_config.host}",
    "DATABASE_PORT=${var.database_config.port}",
    "DATABASE_NAME=${var.database_config.database}",
    "DATABASE_USERNAME=${var.database_config.user}",
    "DATABASE_PASSWORD=${var.database_config.password}",
    "TRAKT_HOST=api.trakt.tv",
    "TRAKT_CLIENT_ID=${var.trakt_client_id}",
    "TRAKT_CLIENT_SECRET=${var.trakt_client_secret}",
    "JELLYFIN_URL=${var.jellyfin_host}",
    "JELLYFIN_TOKEN=${var.jellyfin_token}",
    "JELLYFIN_USERNAME=${var.jellyfin_login}",
    "JELLYFIN_PASSWORD=${var.jellyfin_password}",
    "DISCORD_CHANNEL_ID=${var.discord_channel_id}",
    "DISCORD_BOT_TOKEN=${var.discord_bot_token}",
    "DISCORD_ADMIN_IDS=${var.discord_admin_ids}",
    "GMAIL_USER=${var.gmail_email}",
    "GMAIL_PASSWORD=${var.gmail_password}",
    "CLICKUP_API_TOKEN=${var.clickup_api_token}",
    "CLICKUP_TEAM_ID=${var.clickup_team_id}",
    "CLICKUP_LIST_ID=${var.clickup_list_id}"
  ]


  # Labels for grouping
  labels {
    label = "com.docker.compose.project"
    value = var.slug
  }
  
  labels {
    label = "com.docker.compose.service"
    value = "api"
  }

  # Wait for database to be ready
  depends_on = [var.database_container_id]
} 