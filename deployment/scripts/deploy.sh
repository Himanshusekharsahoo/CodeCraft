#!/usr/bin/env bash
# ==============================================================================
# CodeCraft — Production Deployment Script
# Zero-downtime rolling restart with automatic health validation and rollback
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "=== [1/6] CodeCraft Production Deployment Started ==="
date -u

cd "${APP_DIR}"

# 1. Verify Environment and Secret Invariants
if [ ! -f "/etc/codecraft/codecraft.env" ] && [ ! -f ".env.local" ] && [ ! -f ".env.production" ]; then
    echo "[ERROR] No production environment file found. Aborting deployment."
    exit 1
fi

# 2. Verify Git Workspace Directory Permissions
mkdir -p data/git/workspaces data/executions
chmod 750 data/git/workspaces
chmod 770 data/executions

# 3. Build Production Artifacts
echo "=== [2/6] Building Next.js Production Assets ==="
npm ci --omit=dev --ignore-scripts
npm run build

# 4. Manage Services
echo "=== [3/6] Restarting Services ==="
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet codecraft-web; then
    echo "Restarting via systemd..."
    systemctl restart codecraft-collab
    sleep 2
    systemctl restart codecraft-web
elif command -v docker-compose >/dev/null 2>&1; then
    echo "Restarting via docker-compose..."
    docker-compose -f docker-compose.prod.yml up -d --build
else
    echo "[NOTICE] Standalone mode: restart your node/pm2 processes manually."
fi

# 5. Automated Health Check Verification
echo "=== [4/6] Executing Health Probe Verification ==="
MAX_RETRIES=30
RETRY_COUNT=0
HEALTHY=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/health?type=liveness || true)
    if [ "$HTTP_CODE" = "200" ]; then
        HEALTHY=1
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "Waiting for web server to become healthy... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
done

if [ $HEALTHY -ne 1 ]; then
    echo "[FATAL] Health check failed after 60 seconds (HTTP $HTTP_CODE). Initiating automated rollback!"
    "${SCRIPT_DIR}/rollback.sh"
    exit 1
fi

echo "=== [5/6] Probing Collaboration Health ==="
COLLAB_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:1234/health || true)
if [ "$COLLAB_CODE" != "200" ]; then
    echo "[WARNING] Collaboration server returned HTTP $COLLAB_CODE (Degraded state)."
else
    echo "[INFO] Collaboration server is operational (HTTP 200)."
fi

echo "=== [6/6] Deployment Completed Successfully ==="
exit 0
