# The engine's environment (validated at boot by components/api/src/environment.ts).
locals {
  engine_env = [
    "APP_VERSION=${var.image_tag}",
    "LOG_LEVEL=${var.log_level}",
    "SHUTDOWN_TIMEOUT_MS=${local.shutdown_timeout_s * 1000}",
    "PORT=3000",
    "SERVER_URL=${local.public_url}",
    "SERVICE_NAME=${var.service_name}",
    "USER_MESSAGING=${var.user_messaging}",
    "USER_MESSAGING_QUIET_HOURS=${var.user_messaging_quiet_hours}",
    "USER_MESSAGING_TIMEZONE=${var.user_messaging_timezone}",
    "DATABASE_HOST=${local.shared_server}",
    "DATABASE_PORT=5432",
    "DATABASE_NAME=${postgresql_database.app.name}",
    "DATABASE_USERNAME=${postgresql_role.app.name}",
    "DATABASE_PASSWORD=${random_password.db.result}",
    "TRAKT_HOST=${var.trakt_host}",
    "TRAKT_CLIENT_ID=${local.secrets["trakt_client_id"]}",
    "TRAKT_CLIENT_SECRET=${local.secrets["trakt_client_secret"]}",
    "TMDB_API_KEY=${local.secrets["tmdb_api_key"]}",
    "JELLYFIN_URL=${var.jellyfin_url}",
    "JELLYFIN_TOKEN=${local.secrets["jellyfin_token"]}",
    "JELLYFIN_LIBRARY_ROOT=/medias",
    "FETCHR_URL=${var.fetchr_url}",
    "FETCHR_API_KEY=${local.secrets["fetchr_api_key"]}",
    "FETCHR_DOWNLOADS_PREFIX=${var.fetchr_downloads_prefix}",
    "DOWNLOADS_PATH=${local.data_path}/downloads",
    "MEDIAS_PATH=${local.data_path}/medias",
    "DISCORD_BOT_TOKEN=${local.secrets["discord_bot_token"]}",
    "DISCORD_CHANNEL_ID=${local.secrets["discord_channel_id"]}",
    "DISCORD_ADMIN_IDS=${local.secrets["discord_admin_ids"]}",
    "GMAIL_USER=${local.secrets["gmail_user"]}",
    "GMAIL_PASSWORD=${local.secrets["gmail_password"]}",
  ]

  indexer_env = concat(
    [
      "INDEXER_ALLOWED_QUALITIES=${join(",", var.indexer_preferences.qualities)}",
      "INDEXER_ALLOWED_LANGUAGES=${join(",", var.indexer_preferences.languages)}",
      "INDEXER_ALLOWED_HOSTS=${join(",", var.indexer_preferences.hosts)}",
      "INDEXER_SIZE_TOLERANCE=${var.indexer_preferences.size_tolerance}",
      "INDEXER_BYTES_PER_MIN_JSON=${jsonencode(var.indexer_preferences.bytes_per_minute)}",
    ],
    var.loadix == null ? [] : [
      "LOADIX_API_HOST=${var.loadix.api_host}",
      "LOADIX_SITE_HOST=${var.loadix.site_host}",
    ],
  )
}
