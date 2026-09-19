/**
 * Monaco Editor Safety and Protection Guard (Phase 9 Hardening).
 *
 * Prevents browser tab freezing, CRDT memory bloat, and crashes caused by
 * attempting to render large binary assets or oversized files in Monaco.
 */

export const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "pdf",
  "zip", "tar", "gz", "7z", "rar", "exe", "bin", "wasm",
  "mp4", "mp3", "wav", "ogg", "mov", "avi", "woff", "woff2",
  "ttf", "eot", "otf", "iso", "dmg", "lockb"
]);

export const MAX_EDITABLE_FILE_SIZE = 512 * 1024; // 512 KB

/**
 * Inspects a workspace file to determine if it is unsupported for Monaco editing
 * (e.g. binary asset or exceeds 512 KB safety threshold).
 *
 * @param {object} file
 * @param {string} [file.name]
 * @param {number} [file.size]
 * @param {string} [file.content]
 * @returns {{ isUnsupported: boolean, reason: string | null }}
 */
export function isBinaryOrOversizedFile(file) {
  if (!file) return { isUnsupported: false, reason: null };

  const fileName = file.name || "";
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot !== -1) {
    const ext = fileName.substring(lastDot + 1).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      return {
        isUnsupported: true,
        reason: `Binary file format (.${ext}) cannot be edited directly in Monaco.`,
      };
    }
  }

  if (typeof file.size === "number" && file.size > MAX_EDITABLE_FILE_SIZE) {
    const sizeKB = Math.round(file.size / 1024);
    return {
      isUnsupported: true,
      reason: `File size (${sizeKB} KB) exceeds the 512 KB editor safety limit.`,
    };
  }

  if (typeof file.content === "string") {
    if (file.content.length > MAX_EDITABLE_FILE_SIZE) {
      return {
        isUnsupported: true,
        reason: `File content exceeds the 512 KB editor safety limit.`,
      };
    }
    if (file.content.includes("\0")) {
      return {
        isUnsupported: true,
        reason: `File contains binary null bytes and cannot be edited safely.`,
      };
    }
  }

  return { isUnsupported: false, reason: null };
}
