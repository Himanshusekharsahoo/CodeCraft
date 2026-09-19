#!/usr/bin/env bash
# ==============================================================================
# CodeCraft — Production Health Check Script
# Probes Web Application, Collaboration Server, and Docker Sandbox availability
# ==============================================================================
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:3000}"
COLLAB_URL="${2:-http://127.0.0.1:1234}"

echo "=================================================="
echo "  CodeCraft Production Health & Readiness Probe   "
echo "=================================================="

# 1. Probe Web Liveness
echo -n "[1/3] Probing Web Liveness (${BASE_URL}/api/health?type=liveness)... "
LIVENESS_RESP=$(curl -s -w "\n%{http_code}" "${BASE_URL}/api/health?type=liveness" || true)
LIVENESS_CODE=$(echo "$LIVENESS_RESP" | tail -n1)
LIVENESS_BODY=$(echo "$LIVENESS_RESP" | sed '$d')

if [ "$LIVENESS_CODE" = "200" ]; then
    echo "OK (HTTP 200)"
else
    echo "FAILED (HTTP ${LIVENESS_CODE})"
    echo "Response: ${LIVENESS_BODY}"
    exit 1
fi

# 2. Probe Web Readiness & Subsystems
echo -n "[2/3] Probing Web Readiness (${BASE_URL}/api/health)... "
READINESS_RESP=$(curl -s -w "\n%{http_code}" "${BASE_URL}/api/health" || true)
READINESS_CODE=$(echo "$READINESS_RESP" | tail -n1)
READINESS_BODY=$(echo "$READINESS_RESP" | sed '$d')

if [ "$READINESS_CODE" = "200" ]; then
    echo "OK (HTTP 200)"
    echo "Subsystem Details: ${READINESS_BODY}"
else
    echo "DEGRADED / UNAVAILABLE (HTTP ${READINESS_CODE})"
    echo "Response: ${READINESS_BODY}"
fi

# 3. Probe Collaboration Server Directly
echo -n "[3/3] Probing Collaboration Health (${COLLAB_URL}/health)... "
COLLAB_RESP=$(curl -s -w "\n%{http_code}" "${COLLAB_URL}/health" || true)
COLLAB_CODE=$(echo "$COLLAB_RESP" | tail -n1)
COLLAB_BODY=$(echo "$COLLAB_RESP" | sed '$d')

if [ "$COLLAB_CODE" = "200" ]; then
    echo "OK (HTTP 200)"
    echo "Collab Details: ${COLLAB_BODY}"
else
    echo "FAILED (HTTP ${COLLAB_CODE})"
fi

echo "=================================================="
echo "  Health Check Probe Complete                     "
echo "=================================================="
