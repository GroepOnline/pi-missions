import * as os from "node:os";
import * as path from "node:path";

/**
 * Root directory for mission storage.
 *
 * Multi-agent: all coding agents (Pi, Devin, Opencode, Codex) can share the
 * same mission store by setting MISSIONS_ROOT to a common directory.
 *
 * Priority:
 * 1. MISSIONS_ROOT environment variable (explicit override)
 * 2. PI_MISSIONS_ROOT environment variable (Pi-specific override)
 * 3. Default: ~/.pi/missions
 */
export function missionsRoot(): string {
  const varName = process.env.MISSIONS_ROOT !== undefined
    ? "MISSIONS_ROOT"
    : process.env.PI_MISSIONS_ROOT !== undefined
      ? "PI_MISSIONS_ROOT"
      : null;

  const envRoot = varName ? process.env[varName] : undefined;
  if (envRoot && varName) {
    if (!path.isAbsolute(envRoot)) {
      throw new Error(`${varName} must be an absolute path, got: ${envRoot}`);
    }
    return envRoot;
  }
  return path.join(os.homedir(), ".pi", "missions");
}
