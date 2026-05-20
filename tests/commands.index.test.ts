import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { registerMissionCommand, injectMissionContext, compactionCheckpoint, missionSummaryForTree, saveSessionLink } from "../src/commands/index.js";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { RuntimeState } from "../src/core/types.js";

// Mock commands handlers
vi.mock("../src/commands/handlers.js", () => ({
  handleNew: vi.fn(),
  handleList: vi.fn(),
  handleLoad: vi.fn(),
  handleStatus: vi.fn(),
  handleHelp: vi.fn(),
  handleDashboard: vi.fn(),
  handleNext: vi.fn(),
  handleDone: vi.fn(),
  handleBlock: vi.fn(),
  handleRun: vi.fn(),
  handlePause: vi.fn(),
  handleResume: vi.fn(),
  handleStop: vi.fn(),
  handleAutopilot: vi.fn(),
  handleClear: vi.fn(),
  handleEdit: vi.fn(),
  handleFork: vi.fn(),
  handleDebug: vi.fn(),
  handleMetrics: vi.fn(),
  handleExport: vi.fn(),
  handleTemplates: vi.fn(),
  handleHistory: vi.fn(),
  handleWorker: vi.fn(),
  handleWorkerStatus: vi.fn(),
  handleKillWorker: vi.fn(),
  handleMigrate: vi.fn(),
  handleMigrateConfirm: vi.fn()
}));

// Mock core state
vi.mock("../src/core/state.js", () => ({
  getActiveFeature: vi.fn(),
  linkSession: vi.fn()
}));

// Mock tools
vi.mock("../src/tools/index.js", () => ({
  injectMissionContext: vi.fn()
}));

// Mock context utils
vi.mock("../src/utils/context.js", () => ({
  buildMissionContext: vi.fn(() => "mock-mission-context"),
  buildCompactionSummary: vi.fn(() => "mock-compaction-summary")
}));

import * as handlers from "../src/commands/handlers.js";
import * as tools from "../src/tools/index.js";
import * as state from "../src/core/state.js";

describe("src/commands/index.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("registerMissionCommand", () => {
    it("registers the mission command with proper completions and routes subcommands correctly", async () => {
      let registeredCommandName = "";
      let registeredDef: any;

      const mockPi = {
        registerCommand: vi.fn((name, def) => {
          registeredCommandName = name;
          registeredDef = def;
        })
      } as unknown as ExtensionAPI;

      const mockRuntime = {} as RuntimeState;

      registerMissionCommand(mockPi, mockRuntime);

      expect(mockPi.registerCommand).toHaveBeenCalled();
      expect(registeredCommandName).toBe("mission");
      expect(registeredDef).toBeDefined();

      const { getArgumentCompletions, handler } = registeredDef;

      // Test completions
      const completions = getArgumentCompletions("st");
      expect(completions).toContainEqual({ value: "start", label: "start" });
      expect(completions).toContainEqual({ value: "status", label: "status" });
      expect(completions).toContainEqual({ value: "stop", label: "stop" });
      expect(completions).not.toContainEqual({ value: "new", label: "new" });

      const mockCtx = {
        ui: {
          notify: vi.fn()
        }
      } as unknown as ExtensionCommandContext;

      // Test routing
      await handler("new test mission", mockCtx);
      expect(handlers.handleNew).toHaveBeenCalledWith("test mission", mockCtx, mockPi, mockRuntime);

      await handler("start test mission", mockCtx);
      expect(handlers.handleNew).toHaveBeenCalledWith("test mission", mockCtx, mockPi, mockRuntime);

      await handler("list", mockCtx);
      expect(handlers.handleList).toHaveBeenCalledWith(mockCtx, mockPi, mockRuntime);

      await handler("load 123", mockCtx);
      expect(handlers.handleLoad).toHaveBeenCalledWith("123", mockCtx, mockPi, mockRuntime);

      await handler("status", mockCtx);
      expect(handlers.handleStatus).toHaveBeenCalledWith(mockCtx, mockRuntime);

      await handler("help", mockCtx);
      expect(handlers.handleHelp).toHaveBeenCalledWith(mockCtx);

      await handler("dashboard", mockCtx);
      expect(handlers.handleDashboard).toHaveBeenCalledWith(mockCtx, mockRuntime);

      await handler("next", mockCtx);
      expect(handlers.handleNext).toHaveBeenCalledWith(mockCtx, mockRuntime);

      await handler("done reason", mockCtx);
      expect(handlers.handleDone).toHaveBeenCalledWith("reason", mockCtx, mockRuntime);

      await handler("block reason", mockCtx);
      expect(handlers.handleBlock).toHaveBeenCalledWith("reason", mockCtx, mockRuntime);

      await handler("run", mockCtx);
      expect(handlers.handleRun).toHaveBeenCalledWith(mockCtx, mockPi, mockRuntime);

      await handler("pause", mockCtx);
      expect(handlers.handlePause).toHaveBeenCalledWith(mockCtx, mockRuntime);

      await handler("resume", mockCtx);
      expect(handlers.handleResume).toHaveBeenCalledWith(mockCtx, mockRuntime);

      await handler("stop", mockCtx);
      expect(handlers.handleStop).toHaveBeenCalledWith(mockCtx, mockRuntime);

      await handler("autopilot", mockCtx);
      expect(handlers.handleAutopilot).toHaveBeenCalledWith(mockCtx, mockRuntime);

      await handler("clear", mockCtx);
      expect(handlers.handleClear).toHaveBeenCalledWith(mockCtx, mockRuntime);

      await handler("edit f1", mockCtx);
      expect(handlers.handleEdit).toHaveBeenCalledWith("f1", mockCtx, mockRuntime);

      await handler("fork f1", mockCtx);
      expect(handlers.handleFork).toHaveBeenCalledWith("f1", mockCtx, mockRuntime);

      await handler("debug arg", mockCtx);
      expect(handlers.handleDebug).toHaveBeenCalledWith("arg", mockCtx, mockRuntime);

      await handler("metrics", mockCtx);
      expect(handlers.handleMetrics).toHaveBeenCalledWith(mockCtx, mockRuntime);

      await handler("export f1", mockCtx);
      expect(handlers.handleExport).toHaveBeenCalledWith("f1", mockCtx, mockRuntime);

      await handler("templates t1 arg2 more args", mockCtx);
      expect(handlers.handleTemplates).toHaveBeenCalledWith("t1", "arg2", "more args", mockCtx, mockPi, mockRuntime);

      await handler("history f1", mockCtx);
      expect(handlers.handleHistory).toHaveBeenCalledWith("f1", mockCtx, mockRuntime);

      await handler("worker w1", mockCtx);
      expect(handlers.handleWorker).toHaveBeenCalledWith("w1", mockCtx, mockRuntime);

      await handler("worker-status", mockCtx);
      expect(handlers.handleWorkerStatus).toHaveBeenCalledWith(mockCtx);

      await handler("kill-worker", mockCtx);
      expect(handlers.handleKillWorker).toHaveBeenCalledWith(mockCtx);

      await handler("migrate m1", mockCtx);
      expect(handlers.handleMigrate).toHaveBeenCalledWith("m1", mockCtx, mockRuntime);

      await handler("migrate m1 confirm", mockCtx);
      expect(handlers.handleMigrateConfirm).toHaveBeenCalledWith("m1", mockCtx, mockRuntime);

      // Default routing
      await handler("unknown", mockCtx);
      expect(mockCtx.ui.notify).toHaveBeenCalledWith("Unknown /mission subcommand: unknown", "warning");

      // Empty args routing
      await handler("", mockCtx);
      expect(handlers.handleStatus).toHaveBeenCalledWith(mockCtx, mockRuntime); // default is status
    });
  });

  describe("injectMissionContext", () => {
    it("calls tools.injectMissionContext with built context if content is not provided", () => {
      const mockPi = {} as ExtensionAPI;
      const mockCtx = {} as ExtensionCommandContext;
      const mockMission = { id: "m1" } as any;

      injectMissionContext(mockPi, mockCtx, mockMission, "test reason");

      expect(tools.injectMissionContext).toHaveBeenCalledWith(mockPi, mockCtx, mockMission, "test reason", "mock-mission-context");
    });

    it("calls tools.injectMissionContext with provided content", () => {
      const mockPi = {} as ExtensionAPI;
      const mockCtx = {} as ExtensionCommandContext;
      const mockMission = { id: "m1" } as any;

      injectMissionContext(mockPi, mockCtx, mockMission, "test reason", "custom-content");

      expect(tools.injectMissionContext).toHaveBeenCalledWith(mockPi, mockCtx, mockMission, "test reason", "custom-content");
    });
  });

  describe("compactionCheckpoint", () => {
    it("does nothing if no active mission", () => {
      const mockPi = { appendEntry: vi.fn() } as unknown as ExtensionAPI;
      const mockRuntime = { activeMission: null } as RuntimeState;

      compactionCheckpoint(mockPi, mockRuntime);

      expect(mockPi.appendEntry).not.toHaveBeenCalled();
    });

    it("appends entry if active mission exists", () => {
      const mockPi = { appendEntry: vi.fn() } as unknown as ExtensionAPI;
      const mockRuntime = { activeMission: { id: "m1" } } as unknown as RuntimeState;
      vi.useFakeTimers();
      vi.setSystemTime(1000);

      compactionCheckpoint(mockPi, mockRuntime);

      expect(mockPi.appendEntry).toHaveBeenCalledWith("pi-mission-compaction-checkpoint", {
        missionId: "m1",
        summary: "mock-compaction-summary",
        timestamp: 1000
      });

      vi.useRealTimers();
    });
  });

  describe("missionSummaryForTree", () => {
    it("returns null if no active mission", () => {
      const mockRuntime = { activeMission: null } as RuntimeState;
      expect(missionSummaryForTree(mockRuntime)).toBeNull();
    });

    it("returns mission title if active mission but no active feature", () => {
      const mockRuntime = { activeMission: { title: "Test Mission" } } as unknown as RuntimeState;
      (state.getActiveFeature as any).mockReturnValue(null);

      expect(missionSummaryForTree(mockRuntime)).toBe("Mission: Test Mission");
    });

    it("returns mission title and feature title if both exist", () => {
      const mockRuntime = { activeMission: { title: "Test Mission" } } as unknown as RuntimeState;
      (state.getActiveFeature as any).mockReturnValue({ title: "Test Feature" });

      expect(missionSummaryForTree(mockRuntime)).toBe("Mission: Test Mission — Feature: Test Feature");
    });
  });

  describe("saveSessionLink", () => {
    const originalEnv = process.env.CODING_AGENT;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.CODING_AGENT;
      } else {
        process.env.CODING_AGENT = originalEnv;
      }
    });

    it("does nothing if no active mission", () => {
      const mockRuntime = { activeMission: null } as RuntimeState;
      saveSessionLink(mockRuntime, "session1");
      expect(state.linkSession).not.toHaveBeenCalled();
    });

    it("does nothing if no session file", () => {
      const mockRuntime = { activeMission: { id: "m1" } } as unknown as RuntimeState;
      saveSessionLink(mockRuntime, undefined);
      expect(state.linkSession).not.toHaveBeenCalled();
    });

    it("links session with known agent", () => {
      const mockRuntime = { activeMission: { id: "m1" } } as unknown as RuntimeState;
      process.env.CODING_AGENT = "pi";
      saveSessionLink(mockRuntime, "session1");
      expect(state.linkSession).toHaveBeenCalledWith({ id: "m1" }, "session1", "pi");
    });

    it("links session with unknown agent if not set", () => {
      const mockRuntime = { activeMission: { id: "m1" } } as unknown as RuntimeState;
      delete process.env.CODING_AGENT;
      saveSessionLink(mockRuntime, "session1");
      expect(state.linkSession).toHaveBeenCalledWith({ id: "m1" }, "session1", "unknown");
    });
  });
});
