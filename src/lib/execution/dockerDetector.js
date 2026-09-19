import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let cachedStatus = null;
let lastCheckTime = 0;
const CACHE_TTL_MS = 5000; // 5 second cache

let mockOverride = null;

/**
 * Checks whether the Docker CLI and Docker daemon are running and responsive.
 *
 * @param {boolean} [forceRefresh=false]
 * @returns {Promise<{ available: boolean, version?: string, reason?: string }>}
 */
export async function checkDockerAvailability(forceRefresh = false) {
  if (mockOverride !== null) {
    return mockOverride;
  }

  const now = Date.now();
  if (!forceRefresh && cachedStatus && now - lastCheckTime < CACHE_TTL_MS) {
    return cachedStatus;
  }

  try {
    const { stdout, stderr } = await execFileAsync("docker", ["info", "--format", "{{.ServerVersion}}"], {
      timeout: 8000,
      windowsHide: true,
    });

    const version = (stdout || "").trim();
    if (!version || (stderr && stderr.includes("error during connect")) || !/^[0-9]/.test(version)) {
      cachedStatus = {
        available: false,
        version: null,
        reason: (stderr || "Docker daemon returned empty ServerVersion (daemon offline)").trim(),
      };
    } else {
      cachedStatus = {
        available: true,
        version,
        reason: null,
      };
    }
  } catch (err) {
    let reason = "Docker daemon is unreachable or not running";
    if (err.code === "ENOENT") {
      reason = "Docker CLI binary ('docker') was not found on system PATH";
    } else if (err.killed) {
      reason = "Docker daemon probe timed out";
    }

    cachedStatus = {
      available: false,
      version: null,
      reason,
    };
  }

  lastCheckTime = now;
  return cachedStatus;
}

/**
 * Injects a mock Docker availability state (used strictly for automated test suites).
 *
 * @param {{ available: boolean, version?: string, reason?: string } | null} mock
 */
export function setMockDockerAvailability(mock) {
  mockOverride = mock;
}
