#!/bin/sh
# Cutover only: copies the compose database (crn-flix-postgres) into the database the stack
# created on the shared Postgres, owned by the application role. Run once the engine is
# stopped and the first deployment (start_engine = false) created the role and the database.
set -eu

SOURCE_CONTAINER="crn-flix-postgres"
SOURCE_USER="crn-flix-engine"
SOURCE_DB="crn-flix-data"
TARGET_CONTAINER="postgres"
TARGET_DB="crn_flix"
TARGET_ROLE="crn_flix"
TABLES="medias media_requests request_users users tickets planned_downloads download_jobs user_notifications _migrations"

target_psql() {
  ssh pi "docker exec -i $TARGET_CONTAINER psql -U postgres -d $TARGET_DB -v ON_ERROR_STOP=1 -At -c \"$1\""
}

counts() {
  container="$1" user="$2" db="$3"
  for table in $TABLES; do
    printf '%s=' "$table"
    ssh pi "docker exec $container psql -U $user -d $db -At -c 'SELECT count(*) FROM $table'"
  done
}

if ssh pi "docker ps --format '{{.Names}}'" | grep -qx crn-flix-engine; then
  echo "crn-flix-engine is still running: stop it first (docker compose stop crn-flix-engine)" >&2
  exit 1
fi

existing=$(target_psql "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
if [ "$existing" != "0" ]; then
  echo "$TARGET_DB already holds $existing table(s): refusing to restore over them" >&2
  exit 1
fi

echo "==> Copying $SOURCE_DB into $TARGET_DB (owned by $TARGET_ROLE)"
ssh pi "docker exec $SOURCE_CONTAINER pg_dump -U $SOURCE_USER -d $SOURCE_DB --format=custom --no-owner --no-privileges \
  | docker exec -i $TARGET_CONTAINER pg_restore -U postgres -d $TARGET_DB --role=$TARGET_ROLE --no-owner --no-privileges --exit-on-error"

echo "==> Row counts (source, then target): they must match"
source_counts=$(mktemp)
target_counts=$(mktemp)
trap 'rm -f "$source_counts" "$target_counts"' EXIT
counts "$SOURCE_CONTAINER" "$SOURCE_USER" "$SOURCE_DB" > "$source_counts"
counts "$TARGET_CONTAINER" postgres "$TARGET_DB" > "$target_counts"
if diff "$source_counts" "$target_counts"; then
  cat "$target_counts"
  echo "==> Transfer complete"
else
  echo "Row counts differ: do not start the engine on $TARGET_DB" >&2
  exit 1
fi
