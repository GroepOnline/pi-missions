import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Mock the Pi extension API
function createMockExtensionAPI(): ExtensionAPI {
  const commands: Record<string, unknown> = {};
  const tools: Record<string, unknown> = {};
  const hooks: Record<string, unknown[]> = {};

  return {
    registerCommand: vi.fn((name: string, handler: unknown) => {
      commands[name] = handler;
    }),
    registerTool: vi.fn((tool: { name: string }) => {
      tools[tool.name] = tool;
    }),
    registerShortcut: vi.fn(),
    on: vi.fn((event: string, handler: unknown) => {
      if (!hooks[event]) hooks[event] = [];
      hooks[event].push(handler);
    }),
    setSessionName: vi.fn(),
    getSessionContext: vi.fn(() => ({})),
    getActiveEditor: vi.fn(() => undefined),
    // Expose internals for testing
    _commands: commands,
    _tools: tools,
    _hooks: hooks,
  } as unknown as ExtensionAPI;
}

describe("E2E: Extension Integration", () => {
  let mockApi: ExtensionAPI & { _commands: Record<string, unknown>; _tools: Record<string, unknown>; _hooks: Record<string, unknown[]> };

  beforeEach(() => {
    mockApi = createMockExtensionAPI() as typeof mockApi;
  });

  it("extension registers /mission command", async () => {
    const { default: piMissions } = await import("../../src/core/extension.js");
    piMissions(mockApi);

    expect(mockApi._commands["mission"]).toBeDefined();
  });

  it("extension registers all expected tools", async () => {
    const { default: piMissions } = await import("../../src/core/extension.js");
    piMissions(mockApi);

    const expectedTools = [
      "mission_feature_done",
      "mission_next_feature",
      "mission_ask_user",
      "mission_block_self",
      "mission_fork",
      "mission_error_status",
      "mission_retry_error",
      "mission_spawn_worker",
      "mission_worker_status",
      "mission_kill_worker",
    ];

    for (const toolName of expectedTools) {
      expect(mockApi._tools[toolName], `Tool ${toolName} should be registered`).toBeDefined();
    }
  });

  it("extension registers session event hooks", async () => {
    const { default: piMissions } = await import("../../src/core/extension.js");
    piMissions(mockApi);

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

    for (const hookName of expectedHooks) {
      expect(mockApi._hooks[hookName], `Hook ${hookName} should be registered`).toBeDefined();
      expect(mockApi._hooks[hookName].length).toBeGreaterThan(0);
    }
  });

  it("extension default export is a function", async () => {
    const { default: piMissions } = await import("../../src/core/extension.js");
    expect(typeof piMissions).toBe("function");
  });

  it("extension handles missing session context gracefully", async () => {
    const { default: piMissions } = await import("../../src/core/extension.js");

    // Should not throw when registering
    expect(() => piMissions(mockApi)).not.toThrow();
  });

  it("session_start hook handles empty entries", async () => {
    const { default: piMissions } = await import("../../src/core/extension.js");
    piMissions(mockApi);

    // Get the session_start handler
    const sessionStartHandler = mockApi._hooks["session_start"]?.[0];
    expect(sessionStartHandler).toBeDefined();

    // Mock context with empty session entries
    const mockCtx = {
      sessionManager: {
        getEntries: () => [],
      },
      ui: {
        notify: vi.fn(),
      },
    };

    // Should not throw with empty entries
    await expect(
      (sessionStartHandler as Function)({}, mockCtx)
    ).resolves.not.toThrow();
  });

  it("session_start hook handles malformed mission entry", async () => {
    const { default: piMissions } = await import("../../src/core/extension.js");
    piMissions(mockApi);

    const sessionStartHandler = mockApi._hooks["session_start"]?.[0];
    const mockCtx = {
      sessionManager: {
        getEntries: () => [
          {
            type: "pi-mission-active",
            data: { missionId: 123 }, // Wrong type - should be string
          },
        ],
      },
      ui: {
        notify: vi.fn(),
      },
    };

    await (sessionStartHandler as Function)({}, mockCtx);

    // Should notify about invalid entry
    expect(mockCtx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("invalid"),
      "warning"
    );
  });
});
