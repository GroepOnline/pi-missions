import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

/**
 * Root directory for mission storage.
 *
 * Multi-agent: all coding agents share the same mission store by setting
 * MISSIONS_ROOT to a common directory.
 *
 * Priority:
 * 1. MISSIONS_ROOT env var (explicit override)
 * 2. PI_MISSIONS_ROOT env var (Pi-specific override)
 * 3. Default: ~/.pi/missions
 */
export function missionsRoot(): string {
  if (process.env.MISSIONS_ROOT) {
    if (!path.isAbsolute(process.env.MISSIONS_ROOT)) {
      throw new Error(`MISSIONS_ROOT must be an absolute path, got: ${process.env.MISSIONS_ROOT}`);
    }
    return process.env.MISSIONS_ROOT;
  }
  if (process.env.PI_MISSIONS_ROOT) {
    if (!path.isAbsolute(process.env.PI_MISSIONS_ROOT)) {
      throw new Error(`PI_MISSIONS_ROOT must be an absolute path, got: ${process.env.PI_MISSIONS_ROOT}`);
    }
    return process.env.PI_MISSIONS_ROOT;
  }
  return path.join(os.homedir(), ".pi", "missions");
}

/**
 * Sanitize a mission ID for filesystem use.
 * Replaces all non-alphanumeric/dot/underscore/hyphen chars with hyphens.
 * Guards against path traversal attacks.
 */
export function missionDirSafe(id: string): string {
  const root = path.resolve(missionsRoot());
  const safeId = id.replace(/[^a-zA-Z0-9._-]/g, "-");
  const resolved = path.resolve(root, safeId);
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error(`Invalid mission id: path traversal detected (${id})`);
  }
  return resolved;
}

/**
 * Create a mission ID in the format pim:<timestamp>:<slug>.
 */
export function createMissionId(title: string, now = Date.now()): string {
  const date = new Date(now).toISOString().replace(/[-:T.Z]/g, "");
  const stamp = date.slice(0, 17);
  const slug = slugify(title);
  return `pim:${stamp}:${slug}`;
}

/**
 * Validate whether a string matches the pim:<ts>:<slug> format.
 */
export function isValidMissionId(id: string): boolean {
  return id.startsWith("pim:") && id.split(":").length === 3;
}

/**
 * Create a validation token (64 hex chars).
 */
export function createValidationToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Slugify a string for use in mission IDs.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "mission";
}

/**
 * Compute a SHA-256 hash of a buffer or string.
 */
export function sha256(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}
