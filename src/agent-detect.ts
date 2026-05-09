// Shim: re-exports agent detection for backward compatibility with tests
// The v2 codebase includes AgentSource in core/types.ts; this provides
// a minimal compatible agent-detect API for existing test suites.

import type { AgentSource } from "./core/types.js";

export type { AgentSource };

let cachedAgent: AgentSource | null = null;

export function detectAgent(): AgentSource {
  if (process.env.CODING_AGENT) {
    const val = process.env.CODING_AGENT.toLowerCase();
    if (val === "pi") return "pi";
    if (val === "devin") return "devin";
    if (val === "opencode") return "opencode";
    if (val === "codex") return "codex";
  }
  if (process.env.PI_SESSION || process.env.PI_AGENT) return "pi";
  if (process.env.DEVIN_SESSION || process.env.DEVIN_WORKSPACE) return "devin";
  if (process.env.OPENCODE_SESSION || process.env.OPENCODE_WORKSPACE) return "opencode";
  if (process.env.CODEX_SESSION || process.env.CODEX_WORKSPACE) return "codex";
  return "unknown";
}

export function getAgent(): AgentSource {
  if (!cachedAgent) cachedAgent = detectAgent();
  return cachedAgent;
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
