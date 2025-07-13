# Docker network
resource "docker_network" "network" {
  name = "${var.slug}-network"
}

# Datasource module
module "datasource" {
  source = "./components/datasource"
  
  slug              = var.slug
  network_name      = docker_network.network.name
  sql_scripts_path  = "${path.cwd}/../components/database/schema"
  database_password = var.database_password
}

# API module
module "api" {
  source = "./components/api"
  
  slug                  = var.slug
  app_version           = var.api_version
  network_name          = docker_network.network.name
  database_container_id = module.datasource.container_id
  
  # Application configuration
  server_url        = var.server_url
  service_name      = var.service_name
  sync_interval_ms  = var.sync_interval_ms
  database_config   = module.datasource.connection_details
  
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
}