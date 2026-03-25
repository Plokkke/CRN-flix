# Docker network
resource "docker_network" "network" {
  name = "${var.slug}-network"
}

# Database module (includes migration)
module "database" {
  source = "../components/database/terraform"

  slug              = var.slug
  network_name      = docker_network.network.name
  database_password = var.database_password
  image_registry    = var.image_registry
  app_version       = var.versions.migration
}

# API module
module "api" {
  source = "../components/api/terraform"

  slug                  = var.slug
  app_version           = var.versions.api
  api_port              = var.api_port
  image_registry        = var.image_registry
  network_name          = docker_network.network.name
  database_container_id = module.database.container_id

  # Application configuration
  server_url       = var.server_url
  service_name     = var.service_name
  sync_interval_ms = var.sync_interval_ms
  database_config  = module.database.connection_details

  # External services
  trakt_client_id     = var.trakt_client_id
  trakt_client_secret = var.trakt_client_secret
  jellyfin_host       = var.jellyfin_host
  jellyfin_token      = var.jellyfin_token
  jellyfin_login      = var.jellyfin_login
  jellyfin_password   = var.jellyfin_password
  discord_channel_id  = var.discord_channel_id
  discord_bot_token   = var.discord_bot_token
  discord_admin_ids   = var.discord_admin_ids
  gmail_email         = var.gmail_email
  gmail_password      = var.gmail_password
  clickup_api_token   = var.clickup_api_token
  clickup_team_id     = var.clickup_team_id
  clickup_list_id     = var.clickup_list_id

  depends_on = [module.database]
}