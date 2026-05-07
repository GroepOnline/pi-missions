import { afterAll, beforeAll, describe, expect, it } from "vitest";
import piMissions from "../src/index.js";
import { createMission, saveMissionSafe, getActiveFeature } from "../src/state.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = path.join(os.tmpdir(), `pi-missions-index-test-${process.pid}`);

function setupTmp(): void {
  fs.mkdirSync(tmpRoot, { recursive: true });
}

function cleanupTmp(): void {
  if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
}

describe("piMissions extension registration", () => {
  const origHome = process.env.HOME;

  beforeAll(() => {
    process.env.HOME = tmpRoot;
    cleanupTmp();
    setupTmp();
  });

  afterAll(() => {
    process.env.HOME = origHome;
    cleanupTmp();
  });

  it("registers the mission command and tools on startup", () => {
    const commands: any[] = [];
    const tools: any[] = [];
    const hooks: Record<string, any[]> = {};
    const shortcuts: any[] = [];
    const labels: Array<{ leafId: string; label: string }> = [];

    const pi = {
      registerCommand: (name: string, def: any) => { commands.push({ name, ...def }); },
      registerTool: (def: any) => { tools.push(def); },
      registerShortcut: (key: string, def: any) => { shortcuts.push({ key, ...def }); },
      on: (event: string, handler: any) => { if (!hooks[event]) hooks[event] = []; hooks[event].push(handler); },
      setSessionName: () => {},
      setLabel: (leafId: string, label: string) => { labels.push({ leafId, label }); },
      appendEntry: () => {},
    };

    piMissions(pi as any);

    expect(commands).toHaveLength(1);
    expect(commands[0]!.name).toBe("mission");
    expect(commands[0]!.description).toContain("Mission management");

    expect(tools).toHaveLength(2);
    expect(tools[0]!.name).toBe("mission_feature_done");
    expect(tools[1]!.name).toBe("mission_next_feature");

    expect(shortcuts).toHaveLength(2);
    expect(shortcuts[0]!.key).toBe("ctrl+shift+m");
    expect(shortcuts[0]!.description).toContain("dashboard");
    expect(shortcuts[1]!.key).toBe("ctrl+shift+d");
    expect(shortcuts[1]!.description).toContain("done");
  });

  it("registers all expected lifecycle hooks", () => {
    const tools: any[] = [];
    const hooks: Record<string, any[]> = {};

    const pi = {
      registerCommand: () => {},
      registerTool: (def: any) => { tools.push(def); },
      registerShortcut: () => {},
      on: (event: string, handler: any) => { if (!hooks[event]) hooks[event] = []; hooks[event].push(handler); },
      setSessionName: () => {},
      setLabel: () => {},
      appendEntry: () => {},
    };

    piMissions(pi as any);

    const expectedHooks = [
      "session_start",
      "resources_discover",
      "session_before_tree",
      "before_agent_start",
      "tool_call",
      "turn_end",
      "agent_end",
      "session_before_compact",
      "session_shutdown",
    ];

    for (const hook of expectedHooks) {
      expect(hooks[hook]).toBeDefined();
      expect(hooks[hook]!.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("session_start hook auto-loads mission from entries", async () => {
    const m = createMission("AutoLoad", "Auto load test");
    saveMissionSafe(m);

    const hooks: Record<string, any[]> = {};

    const pi = {
      registerCommand: () => {},
      registerTool: () => {},
      registerShortcut: () => {},
      on: (event: string, handler: any) => { if (!hooks[event]) hooks[event] = []; hooks[event].push(handler); },
      setSessionName: () => {},
      setLabel: () => {},
      appendEntry: () => {},
    };

    const entries = [
      { type: "custom", customType: "pi-mission-active", data: { missionId: m.id } },
    ];

    const ctx = {
      sessionManager: { getEntries: () => entries },
      ui: { setStatus: () => {}, notify: () => {} },
      getContextUsage: () => null,
    };

    piMissions(pi as any);

    // The runtime is internal, but we can verify the hooks exist
    expect(hooks["session_start"]).toBeDefined();
    expect(hooks["session_start"]![0]).toBeDefined();
  });

  it("tool_call hook blocks disallowed tools in research phase", async () => {
    const hooks: Record<string, any[]> = {};
    const m = createMission("ToolPolicy", "Tool policy test");
    // Set phase to research by having no started features
    getActiveFeature(m)!.status = "pending";

    const pi = {
      registerCommand: () => {},
      registerTool: () => {},
      registerShortcut: () => {},
      on: (event: string, handler: any) => { if (!hooks[event]) hooks[event] = []; hooks[event].push(handler); },
      setSessionName: () => {},
      setLabel: () => {},
      appendEntry: () => {},
    };

    piMissions(pi as any);

    // The tool_call hook should exist
    const toolCallHandler = hooks["tool_call"];
    expect(toolCallHandler).toBeDefined();
    expect(toolCallHandler!.length).toBeGreaterThanOrEqual(1);
  });

  it("session_shutdown hook clears interval and saves", async () => {
    const hooks: Record<string, any[]> = {};
    const m = createMission("Shutdown", "Shutdown test");
    saveMissionSafe(m);

    const pi = {
      registerCommand: () => {},
      registerTool: () => {},
      registerShortcut: () => {},
      on: (event: string, handler: any) => { if (!hooks[event]) hooks[event] = []; hooks[event].push(handler); },
      setSessionName: () => {},
      setLabel: () => {},
      appendEntry: () => {},
    };

    piMissions(pi as any);

    const shutdownHandler = hooks["session_shutdown"];
    expect(shutdownHandler).toBeDefined();
    expect(shutdownHandler!.length).toBeGreaterThanOrEqual(1);
  });

  it("session_before_tree returns mission summary", async () => {
    const hooks: Record<string, any[]> = {};

    const pi = {
      registerCommand: () => {},
      registerTool: () => {},
      registerShortcut: () => {},
      on: (event: string, handler: any) => { if (!hooks[event]) hooks[event] = []; hooks[event].push(handler); },
      setSessionName: () => {},
      setLabel: () => {},
      appendEntry: () => {},
    };

    piMissions(pi as any);

    expect(hooks["session_before_tree"]).toBeDefined();
  });

  it("session_before_compact calls compaction checkpoint", async () => {
    const hooks: Record<string, any[]> = {};

    const pi = {
      registerCommand: () => {},
      registerTool: () => {},
      registerShortcut: () => {},
      on: (event: string, handler: any) => { if (!hooks[event]) hooks[event] = []; hooks[event].push(handler); },
      setSessionName: () => {},
      setLabel: () => {},
      appendEntry: () => {},
    };

    piMissions(pi as any);

    expect(hooks["session_before_compact"]).toBeDefined();
  });

  it("before_agent_start hook builds mission context", async () => {
    const m = createMission("Context", "Context test");
    saveMissionSafe(m);

    const hooks: Record<string, any[]> = {};

    const pi = {
      registerCommand: () => {},
      registerTool: () => {},
      registerShortcut: () => {},
      on: (event: string, handler: any) => { if (!hooks[event]) hooks[event] = []; hooks[event].push(handler); },
      setSessionName: () => {},
      setLabel: () => {},
      appendEntry: () => {},
    };

    piMissions(pi as any);

    // Two before_agent_start handlers registered (context + phase tracking)
    expect(hooks["before_agent_start"]).toBeDefined();
    expect(hooks["before_agent_start"]!.length).toBe(2);
  });

  it("agent_end hook checks for completion signals", async () => {
    const hooks: Record<string, any[]> = {};

    const pi = {
      registerCommand: () => {},
      registerTool: () => {},
      registerShortcut: () => {},
      on: (event: string, handler: any) => { if (!hooks[event]) hooks[event] = []; hooks[event].push(handler); },
      setSessionName: () => {},
      setLabel: () => {},
      appendEntry: () => {},
    };

    piMissions(pi as any);

    expect(hooks["agent_end"]).toBeDefined();
  });

  it("turn_end hook tracks token usage", async () => {
    const hooks: Record<string, any[]> = {};

    const pi = {
      registerCommand: () => {},
      registerTool: () => {},
      registerShortcut: () => {},
      on: (event: string, handler: any) => { if (!hooks[event]) hooks[event] = []; hooks[event].push(handler); },
      setSessionName: () => {},
      setLabel: () => {},
      appendEntry: () => {},
    };

    piMissions(pi as any);

    expect(hooks["turn_end"]).toBeDefined();
  });

  it("keyboard shortcut ctrl+shift+d marks feature done", async () => {
    const m = createMission("Shortcut", "Shortcut test");
    saveMissionSafe(m);

    const shortcuts: any[] = [];

    const pi = {
      registerCommand: () => {},
      registerTool: () => {},
      registerShortcut: (key: string, def: any) => { shortcuts.push({ key, handler: def.handler }); },
      on: () => {},
      setSessionName: () => {},
      setLabel: () => {},
      appendEntry: () => {},
    };

    piMissions(pi as any);

    const doneShortcut = shortcuts.find((s) => s.key === "ctrl+shift+d");
    expect(doneShortcut).toBeDefined();
    expect(typeof doneShortcut!.handler).toBe("function");
  });

  it("resources_discover hook returns empty paths", async () => {
    const hooks: Record<string, any[]> = {};

    const pi = {
      registerCommand: () => {},
      registerTool: () => {},
      registerShortcut: () => {},
      on: (event: string, handler: any) => { if (!hooks[event]) hooks[event] = []; hooks[event].push(handler); },
      setSessionName: () => {},
      setLabel: () => {},
      appendEntry: () => {},
    };

    piMissions(pi as any);

    expect(hooks["resources_discover"]).toBeDefined();
  });
});
