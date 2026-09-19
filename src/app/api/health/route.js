import { checkDockerAvailability } from "../../../lib/execution/dockerDetector.js";

/**
 * Production Health, Readiness, and Liveness Endpoint.
 *
 * Distinguishes:
 * - HEALTHY: All subsystems operational (Web, Collab, Sandbox, AI).
 * - DEGRADED: Web service operational, but optional/external dependencies (Docker sandbox or Collab) offline.
 * - UNAVAILABLE: Core server cannot serve requests.
 *
 * Never exposes secrets or credential values.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const probeType = searchParams.get("type"); // 'liveness' | 'readiness' | null

  // Fast Liveness Probe: Just confirms the Next.js process is alive
  if (probeType === "liveness") {
    return Response.json(
      {
        status: "HEALTHY",
        service: "codecraft-web",
        probe: "liveness",
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  }

  const checks = {
    web: { status: "UP" },
    collaboration: { status: "UNKNOWN", message: null },
    sandbox: { status: "DOWN", available: false, reason: null },
    aiProvider: {
      configured: Boolean(process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.includes("your_gemini")),
      model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
    },
  };

  // 1. Check Docker Sandbox Availability
  try {
    const dockerStatus = await checkDockerAvailability();
    checks.sandbox = {
      status: dockerStatus.available ? "UP" : "DOWN",
      available: dockerStatus.available,
      version: dockerStatus.version || null,
      reason: dockerStatus.reason || null,
    };
  } catch (err) {
    checks.sandbox = {
      status: "DOWN",
      available: false,
      reason: err.message,
    };
  }

  // 2. Check Collaboration Server Connectivity (Optional dependency, short timeout)
  const collabUrl = process.env.NEXT_PUBLIC_COLLAB_HTTP_URL || "http://localhost:1234";
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200);

    const res = await fetch(`${collabUrl}/health`, {
      signal: controller.signal,
      cache: "no-store",
    }).catch(() => null);

    clearTimeout(timeoutId);

    if (res && res.ok) {
      const data = await res.json().catch(() => ({}));
      checks.collaboration = {
        status: "UP",
        activeRooms: data.activeRooms || 0,
        activeClients: data.activeClients || 0,
      };
    } else {
      checks.collaboration = {
        status: "DOWN",
        message: "Collaboration server not responding or non-200 status",
      };
    }
  } catch (err) {
    checks.collaboration = {
      status: "DOWN",
      message: err.message,
    };
  }

  // Determine Overall Status
  // If sandbox or collab is down, application is DEGRADED (can still edit, view, commit git),
  // but NEVER falsely reports HEALTHY sandbox capability.
  let overallStatus = "HEALTHY";
  if (!checks.sandbox.available || checks.collaboration.status === "DOWN") {
    overallStatus = "DEGRADED";
  }

  return Response.json(
    {
      status: overallStatus,
      service: "codecraft-web",
      probe: probeType || "full",
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: 200 }
  );
}
