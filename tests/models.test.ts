import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  clearModelConfigCache,
  formatAgentModelLine,
  formatModelConfig,
  loadModelConfig,
  resolveModel,
  resolveOrchestratorModel,
  type ModelsConfig,
  type ResolvedModel,
} from "../src/models.js";

const MOCK_CONFIG: ModelsConfig = {
  version: 1,
  presets: {
    fast: { provider: "azure-deepseek", model: "DeepSeek-V4-Flash" },
    balanced: { provider: "azure-fireworks", model: "fw-kimi-k2-5" },
    powerful: { provider: "azure-fireworks", model: "fw-glm-5-1" },
  },
  agents: {
    "mission-scout": { preset: "fast", fallbackModels: ["fw-kimi-k2-5", "fw-glm-5-1"] },
    "mission-planner": { preset: "balanced", fallbackModels: ["fw-glm-5-1"] },
    "mission-worker": { preset: "balanced" },
    "mission-reviewer": { preset: "fast", fallbackModels: ["fw-kimi-k2-5"] },
  },
  orchestrator: { preset: "balanced", fallbackModels: ["fw-glm-5-1"] },
};

function assertModel(resolved: ResolvedModel, provider: string, model: string, fallbacksContain: string[]) {
  expect(resolved.provider).toBe(provider);
  expect(resolved.model).toBe(model);
  for (const m of fallbacksContain) expect(resolved.fallbackModels).toContain(m);
}

describe("resolveModel", () => {
  it("resolves mission-scout to fast preset", () => {
    assertModel(resolveModel("mission-scout", MOCK_CONFIG), "azure-deepseek", "DeepSeek-V4-Flash", ["fw-kimi-k2-5", "fw-glm-5-1"]);
  });

  it("resolves mission-planner to balanced preset", () => {
    assertModel(resolveModel("mission-planner", MOCK_CONFIG), "azure-fireworks", "fw-kimi-k2-5", ["fw-glm-5-1"]);
  });

  it("resolves mission-worker to balanced preset (no explicit fallbacks)", () => {
    const r = resolveModel("mission-worker", MOCK_CONFIG);
    expect(r.provider).toBe("azure-fireworks");
    expect(r.model).toBe("fw-kimi-k2-5");
    // Builtin fallbacks are appended
    expect(r.fallbackModels.length).toBeGreaterThanOrEqual(2);
  });

  it("resolves mission-reviewer to fast preset", () => {
    assertModel(resolveModel("mission-reviewer", MOCK_CONFIG), "azure-deepseek", "DeepSeek-V4-Flash", ["fw-kimi-k2-5"]);
  });

  it("falls back to builtin for unknown agent", () => {
    const r = resolveModel("unknown-agent", MOCK_CONFIG);
    expect(r.provider).toBeTruthy();
    expect(r.model).toBeTruthy();
    expect(r.fallbackModels.length).toBeGreaterThan(0);
  });
});

describe("resolveModel — env var override", () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
    delete process.env.PI_MISSION_MODEL_MISSION_SCOUT;
    delete process.env.PI_MISSION_FALLBACKS_MISSION_SCOUT;
  });

  it("uses PI_MISSION_MODEL_<AGENT> env var when set", () => {
    process.env.PI_MISSION_MODEL_MISSION_SCOUT = "anthropic/claude-sonnet-4.6";
    assertModel(resolveModel("mission-scout", MOCK_CONFIG), "anthropic", "claude-sonnet-4.6", ["claude-sonnet-4.6"]);
  });

  it("uses PI_MISSION_FALLBACKS_<AGENT> env var for fallback chain", () => {
    process.env.PI_MISSION_MODEL_MISSION_SCOUT = "openai/gpt-5";
    process.env.PI_MISSION_FALLBACKS_MISSION_SCOUT = "gpt-4o,claude-haiku-4.5";
    const r = resolveModel("mission-scout", MOCK_CONFIG);
    expect(r.provider).toBe("openai");
    expect(r.model).toBe("gpt-5");
    expect(r.fallbackModels).toEqual(["gpt-4o", "claude-haiku-4.5"]);
  });

  it("ignores env var without slash separator", () => {
    process.env.PI_MISSION_MODEL_MISSION_SCOUT = "just-a-model-name";
    // Should fall through to config-based resolution
    assertModel(resolveModel("mission-scout", MOCK_CONFIG), "azure-deepseek", "DeepSeek-V4-Flash", ["fw-kimi-k2-5"]);
  });
});

describe("resolveOrchestratorModel", () => {
  it("resolves orchestrator to balanced preset", () => {
    const r = resolveOrchestratorModel(MOCK_CONFIG);
    expect(r.provider).toBe("azure-fireworks");
    expect(r.model).toBe("fw-kimi-k2-5");
    expect(r.fallbackModels).toContain("fw-glm-5-1");
  });

  it("includes builtin fallbacks when config is empty", () => {
    const emptyConfig: ModelsConfig = {
      version: 1,
      presets: {},
      agents: {},
      orchestrator: { preset: "nonexistent" },
    };
    const r = resolveOrchestratorModel(emptyConfig);
    expect(r.model).toBeTruthy();
    expect(r.fallbackModels.length).toBeGreaterThanOrEqual(2);
  });

  it("uses orchestrator fallback models", () => {
    const cfg: ModelsConfig = {
      version: 1,
      presets: { fast: { provider: "azure-deepseek", model: "DeepSeek-V4-Flash" } },
      agents: {},
      orchestrator: { preset: "fast", fallbackModels: ["custom-model", "other-model"] },
    };
    const r = resolveOrchestratorModel(cfg);
    expect(r.provider).toBe("azure-deepseek");
    expect(r.model).toBe("DeepSeek-V4-Flash");
    expect(r.fallbackModels).toContain("custom-model");
    expect(r.fallbackModels).toContain("other-model");
  });
});

describe("loadModelConfig", () => {
  it("returns a valid config when models.json is missing (builtin fallback)", () => {
    clearModelConfigCache();
    const cfg = loadModelConfig("/nonexistent/models.json");
    expect(cfg.version).toBe(1);
    expect(Object.keys(cfg.presets)).toContain("fast");
    expect(Object.keys(cfg.presets)).toContain("balanced");
    expect(Object.keys(cfg.presets)).toContain("powerful");
    expect(cfg.agents["mission-scout"]?.preset).toBe("fast");
  });
});

describe("formatModelConfig", () => {
  it("produces readable output with presets and agent assignments", () => {
    const out = formatModelConfig(MOCK_CONFIG);
    expect(out).toContain("## Model Configuration");
    expect(out).toContain("### Presets");
    expect(out).toContain("fast");
    expect(out).toContain("azure-deepseek/DeepSeek-V4-Flash");
    expect(out).toContain("### Agent Assignments");
    expect(out).toContain("mission-scout");
    expect(out).toContain("### Orchestrator");
    expect(out).toContain("models.json (version 1)");
  });
});

describe("formatAgentModelLine", () => {
  it("returns a one-line summary for an agent", () => {
    const line = formatAgentModelLine("mission-worker", MOCK_CONFIG);
    expect(line).toContain("mission-worker:");
    expect(line).toContain("azure-fireworks/fw-kimi-k2-5");
    expect(line).toContain("fallbacks:");
  });
});
