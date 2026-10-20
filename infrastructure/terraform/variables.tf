variable "image_prefix" {
  description = "Image repository prefix; components are <prefix>/api and <prefix>/migration"
  type        = string
  default     = "ghcr.io/plokkke/crn-flix"
}

variable "image_tag" {
  description = "Semantic version to deploy"
  type        = string

  validation {
    condition     = var.image_tag != ""
    error_message = "image_tag is required: deploy a released version."
  }
}

variable "start_engine" {
  description = "false only for the cutover: the database is created first, the data transferred into it, then the migrations and the engine run on it (see knowledge/deploiement.md)"
  type        = bool
  default     = true
}

variable "docker_host" {
  description = "Docker API endpoint; the deployer runs on the Raspberry Pi itself"
  type        = string
  default     = "unix:///var/run/docker.sock"
}

variable "subdomain" {
  description = "https://<subdomain>.crn-tech.fr"
  type        = string
  default     = "crn-flix"
}

variable "host_port" {
  description = "Loopback port the host nginx proxies to"
  type        = number
  default     = 4040
}

variable "media_disk_path" {
  description = "The media disk: downloads and libraries on one filesystem, so placing a file is a rename"
  type        = string
  default     = "/mnt/disk18to"
}

variable "run_as" {
  description = "uid:gid owning the media disk, shared with the downloader and the player"
  type        = string
  default     = "1000:1000"
}

variable "user_messaging" {
  description = "send, or dry-run: nothing reaches users and notifications stay queued until switched back"
  type        = string
  default     = "send"

  validation {
    condition     = contains(["send", "dry-run"], var.user_messaging)
    error_message = "user_messaging is send or dry-run."
  }
}

variable "log_level" {
  type    = string
  default = "debug"
}

variable "service_name" {
  type    = string
  default = "CRN-Flix"
}

variable "trakt_host" {
  type    = string
  default = "api.trakt.tv"
}

variable "jellyfin_url" {
  description = "The player's public url: users open it, the engine reaches it through the host nginx"
  type        = string
  default     = "https://jellyfin.crn-tech.fr"
}

variable "fetchr_url" {
  description = "The downloader's public WebSocket url (its own stack, Plokkke/fetchr)"
  type        = string
  default     = "wss://fetchr.crn-tech.fr"
}

variable "fetchr_downloads_prefix" {
  description = "Where the downloader writes, as it reports paths; mapped onto <media disk>/downloads"
  type        = string
  default     = "/downloads"
}

variable "loadix" {
  description = "Loadix indexer hosts; null disables the indexer"
  type        = object({ api_host = string, site_host = string })
  default     = { api_host = "https://api.loadix.fun", site_host = "https://loadix.fun" }
  nullable    = true
}

variable "indexer_preferences" {
  description = "Release preferences (empty lists = no filter); bytes per minute per quality, size tolerance"
  type = object({
    qualities        = list(string)
    languages        = list(string)
    hosts            = list(string)
    size_tolerance   = number
    bytes_per_minute = map(number)
  })
  default = {
    qualities        = ["hd-1080p"]
    languages        = ["truefrench", "multi", "french"]
    hosts            = ["1fichier"]
    size_tolerance   = 1.25
    bytes_per_minute = { "uhd-4k" = 80000000, "hd-1080p" = 24000000, "hd-720p" = 12000000, "sd" = 6000000 }
  }
}
