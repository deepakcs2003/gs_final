#!/usr/bin/env bash
# Auto-deploy: pull latest main and rebuild.
# Run by deploy/autodeploy.mjs when GitHub fires a push webhook for main.
# Wrap long-running docker builds so the webhook never times out.
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/app}"
cd "$APP_DIR"

echo "[deploy] $(date -u +%FT%TZ) pull + rebuild started"

git fetch origin main
git reset --hard origin/main

docker compose up -d --build --pull always

echo "[deploy] $(date -u +%FT%TZ) deploy finished"