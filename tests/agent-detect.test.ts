import { afterEach, describe, expect, it } from "vitest";
import { detectAgent, getAgent, resetAgentCache, isValidAgent, agentDisplayName } from "../src/agent-detect.js";

describe("detectAgent", () => {
  afterEach(() => {
    delete process.env.CODING_AGENT;
    delete process.env.PI_SESSION;
    delete process.env.PI_AGENT;
    delete process.env.DEVIN_SESSION;
    delete process.env.DEVIN_WORKSPACE;
    delete process.env.OPENCODE_SESSION;
    delete process.env.OPENCODE_WORKSPACE;
    delete process.env.CODEX_SESSION;
    delete process.env.CODEX_WORKSPACE;
    resetAgentCache();
  });

  it("detects Pi agent via PI_SESSION env var", () => {
    process.env.PI_SESSION = "session-123";
    expect(detectAgent()).toBe("pi");
  });

  it("detects Pi agent via PI_AGENT env var", () => {
    process.env.PI_AGENT = "true";
    expect(detectAgent()).toBe("pi");
  });

  it("detects Devin agent via DEVIN_SESSION env var", () => {
    process.env.DEVIN_SESSION = "session-456";
    expect(detectAgent()).toBe("devin");
  });

  it("detects Devin agent via DEVIN_WORKSPACE env var", () => {
    process.env.DEVIN_WORKSPACE = "/workspace";
    expect(detectAgent()).toBe("devin");
  });

  it("detects OpenCode agent via OPENCODE_SESSION env var", () => {
    process.env.OPENCODE_SESSION = "session-789";
    expect(detectAgent()).toBe("opencode");
  });

  it("detects OpenCode agent via OPENCODE_WORKSPACE env var", () => {
    process.env.OPENCODE_WORKSPACE = "/workspace";
    expect(detectAgent()).toBe("opencode");
  });

  it("detects Codex agent via CODEX_SESSION env var", () => {
    process.env.CODEX_SESSION = "session-codex";
    expect(detectAgent()).toBe("codex");
  });

  it("detects Codex agent via CODEX_WORKSPACE env var", () => {
    process.env.CODEX_WORKSPACE = "/workspace";
    expect(detectAgent()).toBe("codex");
  });

  it("returns unknown when no agent env vars are set", () => {
    expect(detectAgent()).toBe("unknown");
  });

  it("prefers explicit CODING_AGENT env var over agent-specific vars", () => {
    process.env.CODING_AGENT = "devin";
    process.env.PI_SESSION = "pi-session";
    expect(detectAgent()).toBe("devin");
  });

  it("returns unknown for invalid CODING_AGENT value", () => {
    process.env.CODING_AGENT = "not-a-real-agent";
    expect(detectAgent()).toBe("unknown");
  });

  it("is case-insensitive for CODING_AGENT", () => {
    process.env.CODING_AGENT = "OPEnCODE";
    expect(detectAgent()).toBe("opencode");
  });
});

describe("isValidAgent", () => {
  it("accepts valid agents", () => {
    expect(isValidAgent("pi")).toBe(true);
    expect(isValidAgent("devin")).toBe(true);
    expect(isValidAgent("opencode")).toBe(true);
    expect(isValidAgent("codex")).toBe(true);
    expect(isValidAgent("unknown")).toBe(true);
  });

  it("rejects invalid agents", () => {
    expect(isValidAgent("chatgpt")).toBe(false);
    expect(isValidAgent("")).toBe(false);
    expect(isValidAgent("agent")).toBe(false);
  });
});

describe("agentDisplayName", () => {
  it("returns correct display names", () => {
    expect(agentDisplayName("pi")).toBe("Pi Coding Agent");
    expect(agentDisplayName("devin")).toBe("Devin");
    expect(agentDisplayName("opencode")).toBe("OpenCode");
    expect(agentDisplayName("codex")).toBe("Codex");
    expect(agentDisplayName("unknown")).toBe("Unknown Agent");
  });
});

describe("getAgent", () => {
  afterEach(() => {
    delete process.env.PI_SESSION;
    resetAgentCache();
  });

  it("caches the agent result", () => {
    process.env.PI_SESSION = "session-1";
    const first = getAgent();
    delete process.env.PI_SESSION;
    const second = getAgent();
    // Should still be "pi" because of caching
    expect(first).toBe("pi");
    expect(second).toBe("pi");
  });

  it("resetAgentCache allows re-detection", () => {
    process.env.PI_SESSION = "session-1";
    expect(getAgent()).toBe("pi");
    delete process.env.PI_SESSION;
    resetAgentCache();
    expect(getAgent()).toBe("unknown");
  });
});
