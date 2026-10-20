#!/bin/sh
# Builds infrastructure/secrets/production.sops.yaml from the compose .env on the server,
# without ever printing a value nor writing it in clear: the .env goes through a pipe and is
# encrypted for the .sops.yaml recipients (public keys only, no Touch ID needed).
set -eu

ENV_FILE="${ENV_FILE:-/srv/docker/crn-flix/.env}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="infrastructure/secrets/production.sops.yaml"
cd "$REPO_ROOT"

ssh pi "cat '$ENV_FILE'" | python3 -c '
import json, sys

KEYS = {
    "TRAKT_CLIENT_ID": "trakt_client_id",
    "TRAKT_CLIENT_SECRET": "trakt_client_secret",
    "JELLYFIN_TOKEN": "jellyfin_token",
    "DISCORD_BOT_TOKEN": "discord_bot_token",
    "DISCORD_CHANNEL_ID": "discord_channel_id",
    "DISCORD_ADMIN_IDS": "discord_admin_ids",
    "GMAIL_USER": "gmail_user",
    "GMAIL_PASSWORD": "gmail_password",
    "TMDB_API_KEY": "tmdb_api_key",
    "FETCHR_API_KEY": "fetchr_api_key",
}

env = {}
for line in sys.stdin:
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip().strip("\"").strip("\x27")

missing = [key for key in KEYS if not env.get(key)]
if missing:
    sys.exit("missing or empty in the .env: " + ", ".join(missing))
json.dump({name: env[key] for key, name in KEYS.items()}, sys.stdout)
' | sops encrypt --filename-override "$TARGET" --input-type json --output-type yaml /dev/stdin > "$TARGET.tmp"

mv "$TARGET.tmp" "$TARGET"
echo "Encrypted the secrets into $TARGET (values never shown)"
