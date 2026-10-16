#!/bin/sh
# Production publication until the stack moves to Terraform (see home-platform docs/applications/crn-flix.md):
# builds and pushes the images from this working tree, syncs the compose file, restarts the stack.
# The server's .env (secrets) is not versioned; .env.example lists its keys.
set -e

REMOTE_HOST="pi"
REMOTE_DIR="/srv/docker/crn-flix"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

echo "==> Building Docker images..."
docker build -t antoinecaron/crn-flix:latest components/api/
docker build -f components/database/migration/Dockerfile -t antoinecaron/crn-flix-migration:latest .

echo "==> Pushing images to registry..."
docker push antoinecaron/crn-flix:latest
docker push antoinecaron/crn-flix-migration:latest

echo "==> Syncing docker-compose to server..."
rsync -av infrastructure/compose/docker-compose.yaml "$REMOTE_HOST:$REMOTE_DIR/docker-compose.yml"

echo "==> Deploying on server..."
ssh "$REMOTE_HOST" "cd $REMOTE_DIR \
  && docker compose pull \
  && docker compose up -d --remove-orphans"

echo "==> Deploy complete!"
