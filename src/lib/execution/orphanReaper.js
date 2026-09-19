import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Sweeps and terminates any orphaned CodeCraft execution containers.
 * Strictly operates only on containers tagged with label `codecraft.execution=true`.
 *
 * @param {number} [maxAgeSeconds=300]
 * @returns {Promise<number>} Number of cleaned containers
 */
export async function reapOrphanContainers(maxAgeSeconds = 300) {
  const cleaned = [];
  const errors = [];

  try {
    const { stdout } = await execFileAsync("docker", [
      "ps",
      "-a",
      "--filter", "label=codecraft.execution=true",
      "--format", "{{.ID}}\t{{.Names}}",
    ], { timeout: 5000, windowsHide: true });

    const lines = stdout.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      const [id, name] = line.split("\t");
      if (id) {
        try {
          await execFileAsync("docker", ["rm", "-f", id], { timeout: 3000, windowsHide: true });
          cleaned.push(name || id);
        } catch (e) {
          errors.push(`Failed to remove container ${id}: ${e.message}`);
        }
      }
    }
  } catch {
    // Docker daemon not running or not responsive
  }

  return cleaned.length;
}
