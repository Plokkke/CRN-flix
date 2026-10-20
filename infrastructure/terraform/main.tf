locals {
  name          = "crn-flix"
  database      = "crn_flix"
  public_url    = "https://${var.subdomain}.crn-tech.fr"
  shared_server = "postgres" # container and network of the shared Postgres
  data_path     = "/data"    # the media disk inside the engine
  images = {
    api       = "${var.image_prefix}/api:${var.image_tag}"
    migration = "${var.image_prefix}/migration:${var.image_tag}"
  }
  secrets = data.sops_file.secrets.data
  # Above the engine's SHUTDOWN_TIMEOUT_MS so in-flight work drains before SIGKILL.
  shutdown_timeout_s = 30
  log_opts = {
    max-size = "10m"
    max-file = "3"
  }
}

# ---------- secrets ----------

# Third-party credentials, encrypted in the repository (the deployer provides SOPS_AGE_KEY).
data "sops_file" "secrets" {
  source_file = "${path.module}/../secrets/production.sops.yaml"
}

# ---------- database on the shared Postgres ----------

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "postgresql_role" "app" {
  name     = local.database
  login    = true
  password = random_password.db.result
}

resource "postgresql_database" "app" {
  name  = local.database
  owner = postgresql_role.app.name
}

resource "postgresql_grant" "no_public_connect" {
  database    = postgresql_database.app.name
  role        = "public"
  object_type = "database"
  privileges  = []
}

# ---------- images ----------

data "docker_registry_image" "app" {
  for_each = local.images
  name     = each.value
}

resource "docker_image" "app" {
  for_each      = local.images
  name          = each.value
  pull_triggers = [data.docker_registry_image.app[each.key].sha256_digest]
  keep_locally  = true
}

# ---------- migrations: one-shot, the engine only starts once they all applied ----------

resource "docker_container" "migration" {
  count = var.start_engine ? 1 : 0

  name          = "${local.name}-migrate"
  image         = docker_image.app["migration"].image_id
  attach        = true
  must_run      = false
  logs          = true
  security_opts = ["no-new-privileges:true"]

  env = [
    "DATABASE_HOST=${local.shared_server}",
    "DATABASE_PORT=5432",
    "DATABASE_USER=${postgresql_role.app.name}",
    "DATABASE_URL=postgresql://${postgresql_role.app.name}:${random_password.db.result}@${local.shared_server}:5432/${postgresql_database.app.name}",
  ]

  networks_advanced {
    name = local.shared_server
  }

  lifecycle {
    postcondition {
      condition     = self.exit_code == 0
      error_message = "Database migrations failed: see the crn-flix-migrate container logs."
    }
  }
}

# ---------- engine ----------

resource "docker_network" "app" {
  name = local.name
}

resource "docker_container" "api" {
  count = var.start_engine ? 1 : 0

  name          = "${local.name}-api"
  image         = docker_image.app["api"].image_id
  restart       = "unless-stopped"
  user          = var.run_as
  init          = true
  stop_timeout  = local.shutdown_timeout_s + 10
  security_opts = ["no-new-privileges:true"]

  env = concat(local.engine_env, local.indexer_env)

  networks_advanced {
    name = docker_network.app.name
  }

  networks_advanced {
    name = local.shared_server
  }

  ports {
    internal = 3000
    external = var.host_port
    ip       = "127.0.0.1"
  }

  # The whole disk: the engine moves finished downloads into the libraries (a rename, never a copy).
  # rslave so a remount of the disk on the host reaches the container.
  mounts {
    type   = "bind"
    source = var.media_disk_path
    target = local.data_path
    bind_options {
      propagation = "rslave"
    }
  }

  log_driver = "json-file"
  log_opts   = local.log_opts

  depends_on = [docker_container.migration]
}

# ---------- HTTPS site on the host nginx (certificate included); kept as is when it exists ----------

resource "terraform_data" "site" {
  count = var.start_engine ? 1 : 0

  input = { subdomain = var.subdomain, port = var.host_port }

  provisioner "local-exec" {
    command = "[ -e /etc/nginx/sites-available/${self.input.subdomain}.crn-tech.fr ] || sudo /etc/nginx/register-service.sh ${self.input.subdomain} ${self.input.port}"
  }

  provisioner "local-exec" {
    when    = destroy
    command = "sudo /etc/nginx/unregister-service.sh ${self.input.subdomain}"
  }

  depends_on = [docker_container.api]
}
