#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

: "${DEPLOY_HOST:?DEPLOY_HOST is required}"
: "${DEPLOY_USER:?DEPLOY_USER is required}"
: "${DEPLOY_PATH:?DEPLOY_PATH is required}"
: "${DEPLOY_ENV_FILE:?DEPLOY_ENV_FILE is required}"
: "${DEPLOY_KEYS_JSON:?DEPLOY_KEYS_JSON is required}"
: "${DEPLOY_MODELS_JSON:?DEPLOY_MODELS_JSON is required}"

DEPLOY_ENABLE_TLS="${DEPLOY_ENABLE_TLS:-false}"
REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"
SSH_OPTS=( -o BatchMode=yes -o StrictHostKeyChecking=accept-new )
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR"
printf '%s' "$DEPLOY_ENV_FILE" > "$TMP_DIR/.env"
printf '%s' "$DEPLOY_KEYS_JSON" > "$TMP_DIR/keys.json"
printf '%s' "$DEPLOY_MODELS_JSON" > "$TMP_DIR/models.json"

if [[ "$DEPLOY_ENABLE_TLS" == "true" ]]; then
  : "${DEPLOY_PUBLIC_HOST:?DEPLOY_PUBLIC_HOST is required when DEPLOY_ENABLE_TLS=true}"
  sed "s#__PUBLIC_HOST__#${DEPLOY_PUBLIC_HOST//\#/\\#}#g" deploy/Caddyfile.template > "$TMP_DIR/Caddyfile"
fi

ssh "${SSH_OPTS[@]}" "$REMOTE" "mkdir -p '$DEPLOY_PATH' '$DEPLOY_PATH/data' '$DEPLOY_PATH/db-backups'"

rsync -az --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  --exclude '.env' \
  --exclude 'keys.json' \
  --exclude 'models.json' \
  --exclude 'data/' \
  --exclude 'db-backups/' \
  "$ROOT_DIR/" "$REMOTE:$DEPLOY_PATH/"

rsync -az "$TMP_DIR/.env" "$REMOTE:$DEPLOY_PATH/.env"
rsync -az "$TMP_DIR/keys.json" "$REMOTE:$DEPLOY_PATH/keys.json"
rsync -az "$TMP_DIR/models.json" "$REMOTE:$DEPLOY_PATH/models.json"

if [[ "$DEPLOY_ENABLE_TLS" == "true" ]]; then
  rsync -az "$ROOT_DIR/deploy/docker-compose.ssl.yml" "$REMOTE:$DEPLOY_PATH/deploy/docker-compose.ssl.yml"
  rsync -az "$TMP_DIR/Caddyfile" "$REMOTE:$DEPLOY_PATH/Caddyfile"
  COMPOSE_FILES="-f docker-compose.yml -f deploy/docker-compose.ssl.yml"
else
  COMPOSE_FILES="-f docker-compose.yml"
fi

ssh "${SSH_OPTS[@]}" "$REMOTE" "docker network create ai-infra >/dev/null 2>&1 || true"
ssh "${SSH_OPTS[@]}" "$REMOTE" "cd '$DEPLOY_PATH' && docker compose $COMPOSE_FILES up -d --build --remove-orphans"
