// Shim: re-exports agent detection for backward compatibility with tests
// The v2 codebase includes AgentSource in core/types.ts; this provides
// a minimal compatible agent-detect API for existing test suites.

import type { AgentSource } from "../core/types.js";

export type { AgentSource };

let cachedAgent: AgentSource | null = null;

export function detectAgent(): AgentSource {
  // Cache result
  if (cachedAgent) return cachedAgent;

  // Check explicit override first
  if (process.env.PI_AGENT_OVERRIDE) {
    const override = process.env.PI_AGENT_OVERRIDE.toLowerCase();
    if (isValidAgent(override)) {
      cachedAgent = override;
      return override;
    }
  }

  if (process.env.CODING_AGENT) {
    const val = process.env.CODING_AGENT.toLowerCase();
    if (val === "pi") return cachedAgent = "pi";
    if (val === "devin") return cachedAgent = "devin";
    if (val === "opencode") return cachedAgent = "opencode";
    if (val === "codex") return cachedAgent = "codex";
  }
  if (process.env.PI_SESSION || process.env.PI_AGENT) return cachedAgent = "pi";
  if (process.env.DEVIN_SESSION || process.env.DEVIN_WORKSPACE) return cachedAgent = "devin";
  if (process.env.OPENCODE_SESSION || process.env.OPENCODE_WORKSPACE) return cachedAgent = "opencode";
  if (process.env.CODEX_SESSION || process.env.CODEX_WORKSPACE) return cachedAgent = "codex";

  return cachedAgent = "unknown";
}

export function getAgent(): AgentSource {
  return detectAgent();
}

export function resetAgentCache(): void {
  cachedAgent = null;
}

export function isValidAgent(value: string): value is AgentSource {
  return ["pi", "devin", "opencode", "codex", "unknown"].includes(value);
}

export function agentDisplayName(agent: AgentSource): string {
  switch (agent) {
    case "pi": return "Pi Coding Agent";
    case "devin": return "Devin";
    case "opencode": return "OpenCode";
    case "codex": return "Codex";
    default: return "Unknown Agent";
  }
}
