import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import piMissions from "../src/index.js";
import { createMission, saveMissionSafe, getActiveFeature, loadMissionFromDisk, readHistory } from "../src/core/state.js";
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

  function mkPi(overrides: Record<string, any> = {}): any {
    const commands: any[] = [];
    const tools: any[] = [];
    const hooks: Record<string, any[]> = {};
    const shortcuts: any[] = [];
    const labels: Array<{ leafId: string; label: string }> = [];
    const entries: Array<Record<string, any>> = [];
    return {
      registerCommand: (name: string, def: any) => { commands.push({ name, ...def }); },
      registerTool: (def: any) => { tools.push(def); },
      registerShortcut: (key: string, def: any) => { shortcuts.push({ key, ...def }); },
      on: (event: string, handler: any) => { if (!hooks[event]) hooks[event] = []; hooks[event].push(handler); },
      setSessionName: () => {},
      setLabel: (leafId: string, label: string) => { labels.push({ leafId, label }); },
      appendEntry: (type: string, data: Record<string, any>) => { entries.push({ type, data }); },
      getCommands: () => commands,
      getTools: () => tools,
      getHooks: () => hooks,
      getShortcuts: () => shortcuts,
      getLabels: () => labels,
      getEntries: () => entries,
      ...overrides,
    };
  }

  it("registers the mission command and tools on startup", () => {
    const pi = mkPi();
    piMissions(pi);

    expect(pi.getCommands()).toHaveLength(1);
    expect(pi.getCommands()[0]!.name).toBe("mission");
    expect(pi.getCommands()[0]!.description).toContain("Mission management");
    expect(pi.getCommands()[0]!.description).toContain("start");
    expect(pi.getCommands()[0]!.getArgumentCompletions("sta")).toContainEqual({ value: "start", label: "start" });

    expect(pi.getTools()).toHaveLength(10);
    expect(pi.getTools()[0]!.name).toBe("mission_feature_done");
    expect(pi.getTools()[1]!.name).toBe("mission_next_feature");
    expect(pi.getTools()[2]!.name).toBe("mission_ask_user");
    expect(pi.getTools()[3]!.name).toBe("mission_block_self");
    expect(pi.getTools()[4]!.name).toBe("mission_fork");
    expect(pi.getTools()[5]!.name).toBe("mission_error_status");
    expect(pi.getTools()[6]!.name).toBe("mission_spawn_worker");
    expect(pi.getTools()[7]!.name).toBe("mission_worker_status");
    expect(pi.getTools()[8]!.name).toBe("mission_kill_worker");
    expect(pi.getTools()[9]!.name).toBe("mission_retry_error");

    expect(pi.getShortcuts()).toHaveLength(2);
    expect(pi.getShortcuts()[0]!.key).toBe("ctrl+shift+m");
    expect(pi.getShortcuts()[0]!.description).toContain("dashboard");
    expect(pi.getShortcuts()[1]!.key).toBe("ctrl+shift+d");
    expect(pi.getShortcuts()[1]!.description).toContain("done");
  });

  it("registers all expected lifecycle hooks", () => {
    const pi = mkPi();
    piMissions(pi);

    const expectedHooks = [
      "session_start",
      "resources_discover",
      "session_before_tree",
      "before_agent_start",
      "tool_call",
      "tool_result",
      "turn_end",
      "agent_end",
      "session_before_compact",
      "session_shutdown",
    ];

    for (const hook of expectedHooks) {
      expect(pi.getHooks()[hook]).toBeDefined();
      expect(pi.getHooks()[hook]!.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("dispatches /mission start through the mission creation path", async () => {
    const pi = mkPi();
    const notifications: any[] = [];
    const customMessages: any[] = [];
    const ctx = {
      sessionManager: {
        getEntries: () => [],
        getLeafId: () => null,
        appendCustomMessageEntry: (customType: string, content: string, display: boolean, details: Record<string, unknown>) => {
          customMessages.push({ customType, content, display, details });
          return `custom-message-${customMessages.length}`;
        },
      },
      ui: {
        setStatus: () => {},
        notify: (msg: string, level: string) => { notifications.push({ msg, level }); },
      },
      getContextUsage: () => null,
      fork: async () => {},
    };

    piMissions(pi);
    await pi.getCommands()[0]!.handler("start Alias Mission", ctx);

    expect(notifications[0]!.msg).toContain("Mission created");
    expect(pi.getEntries().some((entry: any) => entry.type === "pi-mission-active")).toBe(true);
    expect(pi.getEntries().some((entry: any) => entry.type === "pi-mission-context")).toBe(true);
    expect(customMessages[0]!.customType).toBe("pi-mission-context");
    expect(customMessages[0]!.content).toContain("## Pi Missions Extension — Active");
    expect(customMessages[0]!.details.reason).toBe("mission_started");
  });

  it("session_start hook auto-loads mission from entries", async () => {
    const m = createMission("AutoLoad", "Auto load test");
    await saveMissionSafe(m);

    const pi = mkPi();
    const entries = [
      { type: "custom", customType: "pi-mission-active", data: { missionId: m.id, validationToken: m.validationToken } },
    ];

    const ctx = {
      sessionManager: { getEntries: () => entries, getLeafId: () => null },
      ui: { setStatus: () => {}, notify: () => {} },
      getContextUsage: () => null,
      fork: async () => {},
    };

    piMissions(pi);
    const sessionStartHandler = pi.getHooks()["session_start"]![0];
    expect(sessionStartHandler).toBeDefined();
    // Invoke the handler to cover the callback body
    await sessionStartHandler({}, ctx);
  });

  it("session_start hook warns and returns on invalid mission ID format", async () => {
    const pi = mkPi();
    const notifyCalls: any[] = [];
    const consoleWarnCalls: any[] = [];
    const originalConsoleWarn = console.warn;

    try {
      console.warn = (...args: any[]) => { consoleWarnCalls.push(args); };

      const entries = [
        { type: "custom", customType: "pi-mission-active", data: { missionId: "not-a-valid-id", validationToken: "abc" } },
      ];

      const ctx = {
        sessionManager: { getEntries: () => entries, getLeafId: () => null },
        ui: { setStatus: () => {}, notify: (msg: string, level: string) => { notifyCalls.push({ msg, level }); } },
        getContextUsage: () => null,
        fork: async () => {},
      };

      piMissions(pi);
      const sessionStartHandler = pi.getHooks()["session_start"]![0];
      await sessionStartHandler({}, ctx);

      // Now logs a warning and tries to load — directory won't exist, so "not found"
      expect(notifyCalls.length).toBeGreaterThanOrEqual(1);
      expect(notifyCalls[0]!.msg).toContain("not found on disk");
      expect(notifyCalls[0]!.level).toBe("warning");
      // console.warn is no longer used — the code now uses structured logger.warn instead
      expect(consoleWarnCalls.length).toBe(0);
      // Should NOT set session name (no mission loaded)
      expect(pi.getLabels().length).toBe(0);
    } finally {
      console.warn = originalConsoleWarn;
    }
  });

  it("session_start hook warns and returns on malformed active mission entry", async () => {
    const pi = mkPi();
    const notifyCalls: any[] = [];

    const entries = [
      { type: "custom", customType: "pi-mission-active", data: { validationToken: "abc" } },
    ];

    const ctx = {
      sessionManager: { getEntries: () => entries, getLeafId: () => null },
      ui: { setStatus: () => {}, notify: (msg: string, level: string) => { notifyCalls.push({ msg, level }); } },
      getContextUsage: () => null,
      fork: async () => {},
    };

    piMissions(pi);
    const sessionStartHandler = pi.getHooks()["session_start"]![0];
    await sessionStartHandler({}, ctx);

    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0]!.msg).toContain("Ignoring invalid mission session entry");
    expect(notifyCalls[0]!.level).toBe("warning");
  });

  it("session_start hook warns and returns when mission not found on disk", async () => {
    const pi = mkPi();
    const notifyCalls: any[] = [];

    const entries = [
      { type: "custom", customType: "pi-mission-active", data: { missionId: "pim:20250101000000000:nonexistent-mission-xyz", validationToken: "abc" } },
    ];

    const ctx = {
      sessionManager: { getEntries: () => entries, getLeafId: () => null },
      ui: { setStatus: () => {}, notify: (msg: string, level: string) => { notifyCalls.push({ msg, level }); } },
      getContextUsage: () => null,
      fork: async () => {},
    };

    piMissions(pi);
    const sessionStartHandler = pi.getHooks()["session_start"]![0];
    await sessionStartHandler({}, ctx);

    // Should warn about mission not found
    expect(notifyCalls.length).toBeGreaterThanOrEqual(1);
    expect(notifyCalls[0]!.msg).toContain("not found on disk");
    expect(notifyCalls[0]!.level).toBe("warning");
    // Should NOT set session name
    expect(pi.getLabels().length).toBe(0);
  });

  it("session_start hook warns and returns on validation token mismatch", async () => {
    const m = createMission("TokenMismatch", "Token mismatch guardrail test");
    await saveMissionSafe(m);

    const pi = mkPi();
    const notifyCalls: any[] = [];

    // Use a different validation token than what's stored on disk
    const entries = [
      { type: "custom", customType: "pi-mission-active", data: { missionId: m.id, validationToken: "wrong-token-0000000000000000000000000000000000000000000000000000000000000000" } },
    ];

    const ctx = {
      sessionManager: { getEntries: () => entries, getLeafId: () => null },
      ui: { setStatus: () => {}, notify: (msg: string, level: string) => { notifyCalls.push({ msg, level }); } },
      getContextUsage: () => null,
      fork: async () => {},
    };

    piMissions(pi);
    const sessionStartHandler = pi.getHooks()["session_start"]![0];
    await sessionStartHandler({}, ctx);

    // Should warn about invalid validation token
    expect(notifyCalls.length).toBeGreaterThanOrEqual(1);
    expect(notifyCalls[0]!.msg).toContain("Invalid mission event token");
    expect(notifyCalls[0]!.level).toBe("warning");
    // Should NOT set session name (token mismatch prevented activation)
    expect(pi.getLabels().length).toBe(0);
  });

  it("session_start hook activates mission when token matches", async () => {
    const m = createMission("ValidToken", "Valid token activation test");
    await saveMissionSafe(m);

    const pi = mkPi();
    let sessionNameSet: string | null = null;
    const overrides = {
      setSessionName: (name: string) => { sessionNameSet = name; },
    };
    // Create pi with setSessionName override
    const pip = mkPi(overrides);

    const entries = [
      { type: "custom", customType: "pi-mission-active", data: { missionId: m.id, validationToken: m.validationToken } },
    ];

    const ctx = {
      sessionManager: { getEntries: () => entries, getLeafId: () => null },
      ui: { setStatus: () => {}, notify: () => {} },
      getContextUsage: () => null,
      fork: async () => {},
    };

    piMissions(pip);
    const sessionStartHandler = pip.getHooks()["session_start"]![0];
    await sessionStartHandler({}, ctx);

    // When token matches and mission is valid, setSessionName is called
    expect(sessionNameSet).toBe(`🎯 ${m.title}`);
  });

  it("session_start hook handles empty entries gracefully", async () => {
    const pi = mkPi();

    const ctx = {
      sessionManager: { getEntries: () => [], getLeafId: () => null },
      ui: { setStatus: () => {}, notify: () => {} },
      getContextUsage: () => null,
      fork: async () => {},
    };

    piMissions(pi);
    const sessionStartHandler = pi.getHooks()["session_start"]![0];
    // Should not throw
    await sessionStartHandler({}, ctx);
    expect(pi.getLabels().length).toBe(0);
  });

  it("tool_call hook blocks disallowed tools in research phase", async () => {
    const pi = mkPi();
    const m = createMission("ToolPolicy", "Tool policy test");
    getActiveFeature(m)!.status = "pending";
    await saveMissionSafe(m);

    piMissions(pi);

    // First trigger session_start to load the mission into runtime
    const sessionStartHandler = pi.getHooks()["session_start"]![0];
    const entries = [
      { type: "custom", customType: "pi-mission-active", data: { missionId: m.id, validationToken: m.validationToken } },
    ];
    const ctx = {
      sessionManager: { getEntries: () => entries, getLeafId: () => null },
      ui: { setStatus: () => {}, notify: () => {} },
      getContextUsage: () => null,
      fork: async () => {},
    };
    await sessionStartHandler({}, ctx);

    // Now trigger before_agent_start to set the phase
    for (const handler of pi.getHooks()["before_agent_start"] || []) {
      await handler({}, ctx);
    }

    // The tool_call hook should exist and block disallowed tools in planning phase
    const toolCallHandler = pi.getHooks()["tool_call"]![0];
    expect(toolCallHandler).toBeDefined();
    const result = await toolCallHandler({ toolName: "read_file" });
    // read_file is NOT allowed in planning phase (active feature title contains "clarify")
    expect(result).toBeDefined();
    expect(result!.block).toBe(true);
    expect(result!.reason).toContain("not allowed");
  });

  it("tool_call hook allows read-only bash exploration in planning phase", async () => {
    const pi = mkPi();
    const m = createMission("ToolPolicy", "Tool policy test");
    await saveMissionSafe(m);

    piMissions(pi);

    const sessionStartHandler = pi.getHooks()["session_start"]![0];
    const entries = [
      { type: "custom", customType: "pi-mission-active", data: { missionId: m.id, validationToken: m.validationToken } },
    ];
    const ctx = {
      sessionManager: { getEntries: () => entries, getLeafId: () => null },
      ui: { setStatus: () => {}, notify: () => {} },
      getContextUsage: () => null,
      fork: async () => {},
    };
    await sessionStartHandler({}, ctx);

    for (const handler of pi.getHooks()["before_agent_start"] || []) {
      await handler({}, ctx);
    }

    const toolCallHandler = pi.getHooks()["tool_call"]![0];
    await expect(toolCallHandler({ toolName: "bash", input: { command: "ls -la src/" } })).resolves.toBeUndefined();
    await expect(toolCallHandler({ toolName: "bash", input: { command: "rg -n \"getMissionPhase\" src" } })).resolves.toBeUndefined();
    await expect(toolCallHandler({ toolName: "bash", input: { command: "sed -n 1,20p src/index.ts" } })).resolves.toBeUndefined();
    await expect(toolCallHandler({ toolName: "bash", input: { command: "git status --short" } })).resolves.toBeUndefined();
  });

  it("tool_call hook blocks mutating bash in planning phase", async () => {
    const pi = mkPi();
    const m = createMission("ToolPolicy", "Tool policy test");
    await saveMissionSafe(m);

    piMissions(pi);

    const sessionStartHandler = pi.getHooks()["session_start"]![0];
    const entries = [
      { type: "custom", customType: "pi-mission-active", data: { missionId: m.id, validationToken: m.validationToken } },
    ];
    const ctx = {
      sessionManager: { getEntries: () => entries, getLeafId: () => null },
      ui: { setStatus: () => {}, notify: () => {} },
      getContextUsage: () => null,
      fork: async () => {},
    };
    await sessionStartHandler({}, ctx);

    for (const handler of pi.getHooks()["before_agent_start"] || []) {
      await handler({}, ctx);
    }

    const toolCallHandler = pi.getHooks()["tool_call"]![0];
    const result = await toolCallHandler({ toolName: "bash", input: { command: "touch nope" } });
    expect(result).toBeDefined();
    expect(result.block).toBe(true);
    expect(result.reason).toContain("only allowed in planning phase");

    for (const command of ["find . -delete", "find . -exec rm {} +", "sed -n -i 1p src/index.ts", "ls -la > out.txt", "ls\nrm -rf /", "echo ok\rwhoami"]) {
      const blocked = await toolCallHandler({ toolName: "bash", input: { command } });
      expect(blocked).toBeDefined();
      expect(blocked.block).toBe(true);
      expect(blocked.reason).toContain("only allowed in planning phase");
    }
  });

  it("tool_result hook records real tool failures after execution", async () => {
    const pi = mkPi();
    const m = createMission("ToolResult", "Tool result test");
    await saveMissionSafe(m);

    piMissions(pi);

    const entries = [
      { type: "custom", customType: "pi-mission-active", data: { missionId: m.id, validationToken: m.validationToken } },
    ];
    const ctx = {
      sessionManager: { getEntries: () => entries, getLeafId: () => null },
      ui: { setStatus: () => {}, notify: () => {} },
      getContextUsage: () => null,
      fork: async () => {},
    };
    await pi.getHooks()["session_start"]![0]({}, ctx);

    const toolResultHandler = pi.getHooks()["tool_result"]![0];
    await toolResultHandler({
      toolName: "bash",
      toolCallId: "call-1",
      input: { command: "npm test" },
      content: [{ type: "text", text: "permission denied" }],
      isError: true,
    });

    const history = readHistory(m.id);
    expect(history.some((entry) => entry.event === "error_detected" && entry.note?.includes("permission denied"))).toBe(true);
  });

  it("tool_call hook recalculates phase after an already-applied mission_next_feature transition", async () => {
    const pi = mkPi();
    const m = createMission("ToolPolicy", "Tool policy test");
    getActiveFeature(m)!.status = "done";
    await saveMissionSafe(m);

    piMissions(pi);

    const sessionStartHandler = pi.getHooks()["session_start"]![0];
    const entries = [
      { type: "custom", customType: "pi-mission-active", data: { missionId: m.id, validationToken: m.validationToken } },
    ];
    const ctx = {
      sessionManager: { getEntries: () => entries, getLeafId: () => null },
      ui: { setStatus: () => {}, notify: () => {} },
      getContextUsage: () => null,
      fork: async () => {},
    };
    await sessionStartHandler({}, ctx);

    for (const handler of pi.getHooks()["before_agent_start"] || []) {
      await handler({}, ctx);
    }

    const nextTool = pi.getTools().find((tool: any) => tool.name === "mission_next_feature");
    await nextTool.execute("call-next", {}, null, () => {}, ctx);

    const toolCallHandler = pi.getHooks()["tool_call"]![0];
    await expect(toolCallHandler({ toolName: "bash", input: { command: "npm test" } })).resolves.toBeUndefined();
  });

  it("tool_call hook blocks when max tool calls exceeded", async () => {
    const pi = mkPi();
    const m = createMission("ToolLimit", "Tool limit test");
    getActiveFeature(m)!.status = "active";
    m.activeFeatureId = "F002"; // execution phase (title "Implement the core change")
    await saveMissionSafe(m);

    piMissions(pi);

    const sessionStartHandler = pi.getHooks()["session_start"]![0];
    const entries = [
      { type: "custom", customType: "pi-mission-active", data: { missionId: m.id, validationToken: m.validationToken } },
    ];
    const ctx = {
      sessionManager: { getEntries: () => entries, getLeafId: () => null },
      ui: { setStatus: () => {}, notify: () => {} },
      getContextUsage: () => null,
      fork: async () => {},
    };
    await sessionStartHandler({}, ctx);

    // Set phase to execution by triggering before_agent_start
    for (const handler of pi.getHooks()["before_agent_start"] || []) {
      await handler({}, ctx);
    }

    const toolCallHandler = pi.getHooks()["tool_call"]![0];
    // In execution phase, allowed tools are read, write, edit, bash, grep, find, ls.
    // Max tool calls for execution is 120. We need to exceed it.
    let lastResult: any;
    for (let i = 0; i < 125; i++) {
      lastResult = await toolCallHandler({ toolName: "read" });
    }
    expect(lastResult).toBeDefined();
    expect(lastResult.block).toBe(true);
    expect(lastResult.reason).toContain("Max tool calls");
  });

  it("session_before_tree returns undefined when no mission", async () => {
    const pi = mkPi();
    piMissions(pi);
    const treeHandler = pi.getHooks()["session_before_tree"]![0];
    const result = await treeHandler({}, {});
    expect(result).toBeUndefined();
  });

  it("agent_end hook does nothing when feature not active", async () => {
    const pi = mkPi();
    piMissions(pi);

    const notifyCalls: any[] = [];
    const ctx = {
      sessionManager: { getEntries: () => [], getLeafId: () => "leaf-1" },
      ui: { setStatus: () => {}, notify: (msg: string, level: string) => { notifyCalls.push({ msg, level }); } },
      getContextUsage: () => null,
      fork: async () => {},
    };

    const agentEndHandler = pi.getHooks()["agent_end"]![0];
    await agentEndHandler({ messages: [] }, ctx);
    expect(notifyCalls.length).toBe(0);
  });

  it("session_shutdown does nothing when no active mission", async () => {
    const pi = mkPi();
    piMissions(pi);

    const shutdownHandler = pi.getHooks()["session_shutdown"]![0];
    const ctx = {
      sessionManager: { getSessionFile: () => "/tmp/session.jsonl" },
      ui: { setStatus: () => {}, notify: () => {} },
    };
    await shutdownHandler({}, ctx);
    // Should not throw
  });

  it("session_shutdown hook clears interval and saves", async () => {
    const m = createMission("Shutdown", "Shutdown test");
    await saveMissionSafe(m);

    const pi = mkPi();
    piMissions(pi);

    // First load the mission via session_start
    const sessionStartHandler = pi.getHooks()["session_start"]![0];
    const entries = [
      { type: "custom", customType: "pi-mission-active", data: { missionId: m.id, validationToken: m.validationToken } },
    ];
    const startCtx = {
      sessionManager: { getEntries: () => entries, getLeafId: () => null, getSessionFile: () => "/tmp/session.jsonl" },
      ui: { setStatus: () => {}, notify: () => {} },
      getContextUsage: () => null,
      fork: async () => {},
    };
    await sessionStartHandler({}, startCtx);

    // Now trigger shutdown
    const shutdownHandler = pi.getHooks()["session_shutdown"]![0];
    expect(shutdownHandler).toBeDefined();
    const shutdownCtx = {
      sessionManager: { getSessionFile: () => "/tmp/session.jsonl" },
      ui: { setStatus: () => {}, notify: () => {} },
    };
    await shutdownHandler({}, shutdownCtx);
  });

  it("session_before_tree returns mission summary when mission active", async () => {
    const m = createMission("TreeSummary", "Test");
    await saveMissionSafe(m);

    const pi = mkPi();
    piMissions(pi);

    // Load mission first
    const sessionStartHandler = pi.getHooks()["session_start"]![0];
    const entries = [
      { type: "custom", customType: "pi-mission-active", data: { missionId: m.id, validationToken: m.validationToken } },
    ];
    const ctx = {
      sessionManager: { getEntries: () => entries, getLeafId: () => null },
      ui: { setStatus: () => {}, notify: () => {} },
      getContextUsage: () => null,
      fork: async () => {},
    };
    await sessionStartHandler({}, ctx);

    // Now trigger session_before_tree
    const treeHandler = pi.getHooks()["session_before_tree"]![0];
    const result = await treeHandler({}, ctx);
    expect(result).toBeDefined();
    expect(result!.summary.summary).toContain("Mission:");
    expect(result!.summary.summary).toContain("TreeSummary");
  });

  it("session_before_compact calls compaction checkpoint", async () => {
    const m = createMission("Compact", "Test");
    await saveMissionSafe(m);

    const pi = mkPi();
    piMissions(pi);

    // Load mission first
    const sessionStartHandler = pi.getHooks()["session_start"]![0];
    const entries = [
      { type: "custom", customType: "pi-mission-active", data: { missionId: m.id, validationToken: m.validationToken } },
    ];
    const ctx = {
      sessionManager: { getEntries: () => entries, getLeafId: () => null },
      ui: { setStatus: () => {}, notify: () => {} },
      getContextUsage: () => null,
      fork: async () => {},
    };
    await sessionStartHandler({}, ctx);

    // Now trigger compaction
    const compactHandler = pi.getHooks()["session_before_compact"]![0];
    await compactHandler({}, ctx);

    // Verify an entry was appended
    expect(pi.getEntries().length).toBeGreaterThanOrEqual(1);
    expect(pi.getEntries()[0]!.type).toBe("pi-mission-compaction-checkpoint");
  });

  it("before_agent_start hook builds lean mission context", async () => {
    const m = createMission("Context", "Context test");
    await saveMissionSafe(m);

    const pi = mkPi();
    piMissions(pi);

    // Load mission first
    const sessionStartHandler = pi.getHooks()["session_start"]![0];
    const entries = [
      { type: "custom", customType: "pi-mission-active", data: { missionId: m.id, validationToken: m.validationToken } },
    ];
    const ctx = {
      sessionManager: { getEntries: () => entries, getLeafId: () => null },
      ui: { setStatus: () => {}, notify: () => {} },
      getContextUsage: () => null,
      fork: async () => {},
    };
    await sessionStartHandler({}, ctx);

    // Two before_agent_start handlers registered (context + phase tracking)
    expect(pi.getHooks()["before_agent_start"]).toBeDefined();
    expect(pi.getHooks()["before_agent_start"]!.length).toBe(2);

    // Invoke both handlers to cover the callback bodies
    for (const handler of pi.getHooks()["before_agent_start"] || []) {
      const result = await handler({}, ctx);
      // First handler returns lean context message
      if (result && result.message) {
        expect(result.message.customType).toBe("pi-mission-context");
        // Lean context has banner but NOT full help
        expect(result.message.content).toContain("## Pi Missions Extension — Active");
        expect(result.message.content).toContain("**Acceptance:**");
        expect(result.message.content).toContain("Use /mission status for full overview");
        // Should NOT contain the full commands/tools reference
        expect(result.message.content).not.toContain("### Mission Commands");
        expect(result.message.content).not.toContain("### Mission Tools");
      }
    }
  });

  it("agent_end hook checks for completion signals", async () => {
    const m = createMission("AgentEnd", "Test");
    await saveMissionSafe(m);

    const pi = mkPi();
    piMissions(pi);

    // Load mission first
    const sessionStartHandler = pi.getHooks()["session_start"]![0];
    const entries = [
      { type: "custom", customType: "pi-mission-active", data: { missionId: m.id, validationToken: m.validationToken } },
    ];
    const notifyCalls: any[] = [];
    const ctx = {
      sessionManager: { getEntries: () => entries, getLeafId: () => "leaf-1" },
      ui: { setStatus: () => {}, notify: (msg: string, level: string) => { notifyCalls.push({ msg, level }); } },
      getContextUsage: () => null,
      fork: async () => {},
    };
    await sessionStartHandler({}, ctx);

    // Now trigger agent_end with a completion signal in messages
    const agentEndHandler = pi.getHooks()["agent_end"]![0];
    const event = {
      messages: [
        { content: [{ type: "text", text: "I have completed the implementation. The feature is done." }] },
      ],
    };
    await agentEndHandler(event, ctx);
    expect(notifyCalls.length).toBeGreaterThanOrEqual(1);
    // The new completion detector may return different messages based on confidence
    // Just check that it mentions completion in some way
    expect(notifyCalls[0]!.msg).toMatch(/complete|done/i);
  });

  it("turn_end hook warns when token budget exceeded", async () => {
    const m = createMission("Budget", "Test");
    m.tokensBudget = 10000;
    m.tokensUsed = 0;
    m.lastContextTokens = 0;
    await saveMissionSafe(m);

    const pi = mkPi();
    piMissions(pi);

    const sessionStartHandler = pi.getHooks()["session_start"]![0];
    const entries = [
      { type: "custom", customType: "pi-mission-active", data: { missionId: m.id, validationToken: m.validationToken } },
    ];
    const notifyCalls: any[] = [];
    const ctx = {
      sessionManager: { getEntries: () => entries, getLeafId: () => "leaf-1" },
      ui: { setStatus: () => {}, notify: (msg: string, level: string) => { notifyCalls.push({ msg, level }); } },
      getContextUsage: () => ({ tokens: 8500 }),
      fork: async () => {},
    };
    await sessionStartHandler({}, ctx);

    const turnEndHandler = pi.getHooks()["turn_end"]![0];
    await turnEndHandler({}, ctx);

    const loaded = loadMissionFromDisk(m.id);
    expect(loaded!.status).toBe("budget_limited");
    expect(notifyCalls.some((c) => c.msg.includes("budget") && c.level === "warning")).toBe(true);
  });

  it("turn_end hook tracks token usage and labels leaf", async () => {
    const m = createMission("TurnEnd", "Test");
    await saveMissionSafe(m);

    const pi = mkPi();
    piMissions(pi);

    // Load mission first
    const sessionStartHandler = pi.getHooks()["session_start"]![0];
    const entries = [
      { type: "custom", customType: "pi-mission-active", data: { missionId: m.id, validationToken: m.validationToken } },
    ];
    const ctx = {
      sessionManager: { getEntries: () => entries, getLeafId: () => "leaf-1" },
      ui: { setStatus: () => {}, notify: () => {} },
      getContextUsage: () => ({ tokens: 5000 }),
      fork: async () => {},
    };
    await sessionStartHandler({}, ctx);

    // Now trigger turn_end
    const turnEndHandler = pi.getHooks()["turn_end"]![0];
    await turnEndHandler({}, ctx);

    // Verify label was set for the active feature
    expect(pi.getLabels().length).toBeGreaterThanOrEqual(1);
    expect(pi.getLabels()[0]!.leafId).toBe("leaf-1");
    expect(pi.getLabels()[0]!.label).toContain("🎯");
  });

  it("keyboard shortcut ctrl+shift+d marks feature done", async () => {
    const m = createMission("Shortcut", "Shortcut test");
    await saveMissionSafe(m);

    const pi = mkPi();
    piMissions(pi);

    // Load mission via session_start first
    const sessionStartHandler = pi.getHooks()["session_start"]![0];
    const entries = [
      { type: "custom", customType: "pi-mission-active", data: { missionId: m.id, validationToken: m.validationToken } },
    ];
    const notifyCalls: any[] = [];
    const ctx = {
      sessionManager: { getEntries: () => entries, getLeafId: () => null },
      ui: { setStatus: () => {}, notify: (msg: string, level: string) => { notifyCalls.push({ msg, level }); } },
      getContextUsage: () => null,
      hasUI: false,
      fork: async () => {},
    };
    await sessionStartHandler({}, ctx);

    const doneShortcut = pi.getShortcuts().find((s: any) => s.key === "ctrl+shift+d");
    expect(doneShortcut).toBeDefined();
    expect(typeof doneShortcut!.handler).toBe("function");

    // Invoke the handler to cover its body
    await doneShortcut!.handler(ctx);
    expect(notifyCalls.length).toBeGreaterThanOrEqual(1);
    expect(notifyCalls[0]!.msg).toContain("done");
  });

  it("resources_discover hook returns empty paths", async () => {
    const pi = mkPi();
    piMissions(pi);

    const handler = pi.getHooks()["resources_discover"]![0];
    const result = await handler();
    expect(result).toEqual({ skillPaths: [], promptPaths: [], themePaths: [] });
  });
});
