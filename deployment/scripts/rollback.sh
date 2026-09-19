#!/usr/bin/env bash
# ==============================================================================
# CodeCraft — Production Rollback Script
# Reverts application code/containers WITHOUT touching user Git workspace data
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "=== [ROLLBACK] Initiating CodeCraft Emergency Rollback ==="
date -u

cd "${APP_DIR}"

# 1. Protection of User Workspace Data Invariant
echo "[SAFETY] User Git workspaces at ${APP_DIR}/data/git/workspaces are strictly PRESERVED."

# 2. Container / Process Rollback
if command -v docker-compose >/dev/null 2>&1; then
    echo "Rolling back Docker Compose containers to previous images..."
    docker-compose -f docker-compose.prod.yml down
    # If backup compose or previous tag exists, revert to it
    if [ -f "docker-compose.prod.yml.bak" ]; then
        cp docker-compose.prod.yml.bak docker-compose.prod.yml
    fi
    docker-compose -f docker-compose.prod.yml up -d
elif command -v systemctl >/dev/null 2>&1; then
    echo "Restarting previous systemd service instances..."
    systemctl restart codecraft-collab
    systemctl restart codecraft-web
else
    echo "[NOTICE] Manual process restart required."
fi

# 3. Post-Rollback Health Verification
sleep 5
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/health?type=liveness || true)
echo "Post-rollback health probe status: HTTP ${HTTP_CODE}"

if [ "$HTTP_CODE" = "200" ]; then
    echo "=== [ROLLBACK] Service successfully restored to stable state ==="
    exit 0
else
    echo "[CRITICAL] Post-rollback probe failed. Manual sysadmin intervention required."
    exit 2
fi
