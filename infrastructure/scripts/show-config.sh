#!/bin/sh
# Prints the NON-secret settings of the compose .env on the server, to check the defaults of
# infrastructure/terraform/variables.tf. Secret keys are never read out.
set -eu

ENV_FILE="${ENV_FILE:-/srv/docker/crn-flix/.env}"

ssh pi "cat '$ENV_FILE'" | grep -E '^(ENGINE_[A-Z_]+|TRAKT_HOST|JELLYFIN_URL|LOADIX_[A-Z_]+|INDEXER_[A-Z_]+|SYNC_[A-Z_]+|FETCHR_DOWNLOAD_PATH|PUID|PGID|HOST_DATA_PATH)='
