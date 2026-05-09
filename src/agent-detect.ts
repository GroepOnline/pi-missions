/**
 * Agent detection utility for multi-agent memory sharing.
 *
 * All coding agents (Pi, Devin, Opencode, Codex) can share the same
 * mission/memory store via the MISSIONS_ROOT environment variable.
 *
 * Each agent extension should set CODING_AGENT or its own env var
 * so that session links can track which agent created them.
 */

export type AgentSource = "pi" | "devin" | "opencode" | "codex" | "unknown";

/**
 * Detect which coding agent is currently running.
 *
 * Priority:
 * 1. CODING_AGENT env var (explicit override)
 * 2. Agent-specific env vars
 * 3. Process inspection (package dependencies, cwd patterns)
 * 4. Fallback: "unknown"
 */
export function detectAgent(): AgentSource {
  // 1. Explicit CODING_AGENT env var
  const explicit = process.env.CODING_AGENT?.toLowerCase();
  if (explicit) {
    if (isValidAgent(explicit)) return explicit as AgentSource;
  }

  // 2. Agent-specific env vars
  if (process.env.PI_SESSION || process.env.PI_AGENT) return "pi";
  if (process.env.DEVIN_SESSION || process.env.DEVIN_WORKSPACE) return "devin";
  if (process.env.OPENCODE_SESSION || process.env.OPENCODE_WORKSPACE) return "opencode";
  if (process.env.CODEX_SESSION || process.env.CODEX_WORKSPACE) return "codex";

  // 3. Fallback
  return "unknown";
}

/**
 * Get the agent display string for session tracking.
 */
export function agentDisplayName(agent: AgentSource): string {
  switch (agent) {
    case "pi": return "Pi Coding Agent";
    case "devin": return "Devin";
    case "opencode": return "OpenCode";
    case "codex": return "Codex";
    case "unknown": return "Unknown Agent";
  }
}

/**
 * Validate that a string is a known AgentSource.
 */
export function isValidAgent(value: string): value is AgentSource {
  return ["pi", "devin", "opencode", "codex", "unknown"].includes(value);
}

/**
 * Detect the agent once at module load time.
 * This is cached because the agent won't change during a session.
 */
let _cachedAgent: AgentSource | undefined;

export function getAgent(): AgentSource {
  if (_cachedAgent === undefined) {
    _cachedAgent = detectAgent();
  }
  return _cachedAgent;
}

/**
 * Reset the cached agent (for testing).
 */
export function resetAgentCache(): void {
  _cachedAgent = undefined;
}
