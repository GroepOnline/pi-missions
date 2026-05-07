import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Types (self-contained so the module can be tree-shaken without types.ts)
// ---------------------------------------------------------------------------

export interface PresetConfig {
  provider: string;
  model: string;
  description?: string;
}

export interface AgentModelConfig {
  preset: string;
  fallbackModels?: string[];
}

export interface ModelsConfig {
  version: number;
  presets: Record<string, PresetConfig>;
  agents: Record<string, AgentModelConfig>;
  orchestrator: AgentModelConfig;
}

export interface ResolvedModel {
  provider: string;
  model: string;
  fallbackModels: string[];
}

// ---------------------------------------------------------------------------
// Hardcoded fallbacks — used when models.json is missing or incomplete
// ---------------------------------------------------------------------------

const BUILTIN_PRESETS: Record<string, PresetConfig> = {
  fast: { provider: "azure-deepseek", model: "DeepSeek-V4-Flash" },
  balanced: { provider: "azure-fireworks", model: "fw-kimi-k2-5" },
  powerful: { provider: "azure-fireworks", model: "fw-glm-5-1" },
};

const BUILTIN_AGENT_DEFAULTS: Record<string, AgentModelConfig> = {
  "mission-scout": { preset: "fast", fallbackModels: ["fw-kimi-k2-5", "fw-glm-5-1"] },
  "mission-planner": { preset: "balanced", fallbackModels: ["fw-glm-5-1", "DeepSeek-V4-Flash"] },
  "mission-worker": { preset: "balanced", fallbackModels: ["fw-glm-5-1", "DeepSeek-V4-Flash"] },
  "mission-reviewer": { preset: "fast", fallbackModels: ["fw-kimi-k2-5", "fw-glm-5-1"] },
};

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

let _configCache: ModelsConfig | null = null;

export function loadModelConfig(configPath?: string): ModelsConfig {
  if (_configCache) return _configCache;
  const file = configPath ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "models.json");
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (raw && typeof raw === "object" && raw.presets && raw.agents) {
      _configCache = raw as ModelsConfig;
      return _configCache;
    }
  } catch {
    // Config file missing or invalid — use builtins below.
  }
  _configCache = {
    version: 1,
    presets: BUILTIN_PRESETS,
    agents: { ...BUILTIN_AGENT_DEFAULTS },
    orchestrator: { preset: "balanced", fallbackModels: ["fw-glm-5-1", "DeepSeek-V4-Flash"] },
  };
  return _configCache;
}

/** Clear the in-memory cache so loadModelConfig re-reads from disk. */
export function clearModelConfigCache(): void {
  _configCache = null;
}

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

/**
 * Environment variable naming convention:
 *   PI_MISSION_MODEL_<AGENT>   → full "provider/model" string
 *   PI_MISSION_PROVIDER_<AGENT> → provider only
 *   PI_MISSION_FALLBACKS_<AGENT> → comma-separated fallback model names
 *
 * Agent names are uppercased and dashes become underscores:
 *   mission-scout → MISSION_SCOUT
 */
function agentEnvKey(agentName: string): string {
  return agentName.toUpperCase().replace(/-/g, "_");
}

export function resolveModel(agentName: string, config?: ModelsConfig): ResolvedModel {
  const cfg = config ?? loadModelConfig();

  // 1. Environment variable override: PI_MISSION_MODEL_SCOUT=provider/model
  const envModel = process.env[`PI_MISSION_MODEL_${agentEnvKey(agentName)}`];
  if (envModel && envModel.includes("/")) {
    const [provider, ...modelParts] = envModel.split("/");
    const model = modelParts.join("/");
    const fallbacks = (process.env[`PI_MISSION_FALLBACKS_${agentEnvKey(agentName)}`] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return { provider: provider!, model, fallbackModels: fallbacks.length ? fallbacks : [model] };
  }

  // 2. Check agent config in models.json
  const agentCfg = cfg.agents[agentName];

  // 3. Resolve preset
  const presetName = agentCfg?.preset ?? "balanced";
  const preset: PresetConfig | undefined = cfg.presets[presetName] ?? BUILTIN_PRESETS[presetName];

  // 4. Build fallback chain: agent fallbacks → preset-implied → builtin
  const fallbackModels: string[] = [];
  if (agentCfg?.fallbackModels?.length) fallbackModels.push(...agentCfg.fallbackModels);
  if (preset && !fallbackModels.includes(preset.model)) fallbackModels.push(preset.model);
  // Add builtin defaults as last resort
  for (const m of ["fw-glm-5-1", "fw-kimi-k2-5", "DeepSeek-V4-Flash"]) {
    if (!fallbackModels.includes(m)) fallbackModels.push(m);
  }

  return {
    provider: preset?.provider ?? "azure-fireworks",
    model: preset?.model ?? "fw-kimi-k2-5",
    fallbackModels,
  };
}

export function resolveOrchestratorModel(config?: ModelsConfig): ResolvedModel {
  const cfg = config ?? loadModelConfig();
  const agentCfg = cfg.orchestrator ?? { preset: "balanced", fallbackModels: ["fw-glm-5-1", "DeepSeek-V4-Flash"] };
  const presetName = agentCfg.preset ?? "balanced";
  const preset: PresetConfig | undefined = cfg.presets[presetName] ?? BUILTIN_PRESETS[presetName];

  const fallbackModels: string[] = [];
  if (agentCfg.fallbackModels?.length) fallbackModels.push(...agentCfg.fallbackModels);
  if (preset && !fallbackModels.includes(preset.model)) fallbackModels.push(preset.model);
  for (const m of ["fw-glm-5-1", "fw-kimi-k2-5", "DeepSeek-V4-Flash"]) {
    if (!fallbackModels.includes(m)) fallbackModels.push(m);
  }

  return {
    provider: preset?.provider ?? "azure-fireworks",
    model: preset?.model ?? "fw-kimi-k2-5",
    fallbackModels,
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers (used by /mission models CLI)
// ---------------------------------------------------------------------------

export function formatModelConfig(config?: ModelsConfig): string {
  const cfg = config ?? loadModelConfig();
  const lines: string[] = ["## Model Configuration", ""];

  // Presets
  lines.push("### Presets");
  for (const [name, p] of Object.entries(cfg.presets)) {
    lines.push(`  ${name.padEnd(12)} ${p.provider}/${p.model}  ${p.description ?? ""}`);
  }

  // Agents
  lines.push("", "### Agent Assignments");
  const agentNames = ["mission-scout", "mission-planner", "mission-worker", "mission-reviewer"];
  for (const name of agentNames) {
    const resolved = resolveModel(name, cfg);
    const envOverride = process.env[`PI_MISSION_MODEL_${agentEnvKey(name)}`];
    const tag = envOverride ? "[ENV]" : "";
    lines.push(`  ${name.padEnd(18)} ${resolved.provider}/${resolved.model}  ${tag}`);
  }

  // Orchestrator
  const orch = resolveOrchestratorModel(cfg);
  lines.push("", "### Orchestrator");
  lines.push(`  orchestrator     ${orch.provider}/${orch.model}`);

  lines.push("", `Loaded from: models.json (version ${cfg.version})`);
  return lines.join("\n");
}

export function formatAgentModelLine(agentName: string, config?: ModelsConfig): string {
  const resolved = resolveModel(agentName, config);
  return `${agentName}: ${resolved.provider}/${resolved.model}  fallbacks: ${resolved.fallbackModels.slice(0, 3).join(", ")}`;
}
