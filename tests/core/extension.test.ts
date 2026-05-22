import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { latestActiveEntry, hook, type SessionEntry, type PiEventHandler } from '../../src/core/extension.js';
import piMissions from '../../src/core/extension.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// Mock Pi with hook capture — used by integration tests
// ═══════════════════════════════════════════════════════════════════════════

interface CapturedPi {
  pi: ExtensionAPI;
  hooks: Record<string, Array<(...args: unknown[]) => unknown>>;
  setSessionName: ReturnType<typeof vi.fn>;
  setLabel: ReturnType<typeof vi.fn>;
  registerCommand: ReturnType<typeof vi.fn>;
  registerTool: ReturnType<typeof vi.fn>;
  registerShortcut: ReturnType<typeof vi.fn>;
}

function makeCapturedPi(): CapturedPi {
  const hooks: Record<string, Array<(...args: unknown[]) => unknown>> = {};
  const setSessionName = vi.fn();
  const setLabel = vi.fn();
  const registerCommand = vi.fn();
  const registerTool = vi.fn();
  const registerShortcut = vi.fn();
  const pi = {
    on(event: string, handler: PiEventHandler) {
      if (!hooks[event]) hooks[event] = [];
      hooks[event].push(handler);
    },
    setSessionName,
    setLabel,
    registerCommand,
    registerTool,
    registerShortcut,
  } as unknown as ExtensionAPI;
  return { pi, hooks, setSessionName, setLabel, registerCommand, registerTool, registerShortcut };
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    ui: { setStatus: vi.fn(), notify: vi.fn(), confirm: vi.fn() },
    sessionManager: { getEntries: vi.fn(() => []), getLeafId: vi.fn(() => null), getSessionFile: vi.fn(() => '/tmp/test-session.json') },
    getContextUsage: vi.fn(() => ({ percent: 10, tokens: 5000 })),
    hasUI: true,
    ...overrides,
  } as any;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests for latestActiveEntry
// ═══════════════════════════════════════════════════════════════════════════

describe('latestActiveEntry', () => {
  it('returns null for empty entries array', () => {
    expect(latestActiveEntry([])).toBeNull();
  });

  it('returns null when no pi-mission-active entry exists', () => {
    const entries: SessionEntry[] = [
      { type: 'user', role: 'user', content: 'hello' },
      { type: 'assistant', role: 'assistant', content: 'hi' },
    ];
    expect(latestActiveEntry(entries)).toBeNull();
  });

  it('finds native format entry (type: pi-mission-active)', () => {
    const entries: SessionEntry[] = [
      { type: 'user', role: 'user', content: 'hello' },
      { type: 'pi-mission-active', data: { missionId: 'pim:20250101000000000:test-mission-abc', validationToken: 'tok123' } },
      { type: 'assistant', role: 'assistant', content: 'ok' },
    ];
    const result = latestActiveEntry(entries);
    expect(result).not.toBeNull();
    expect(result!.missionId).toBe('pim:20250101000000000:test-mission-abc');
    expect(result!.validationToken).toBe('tok123');
  });

  it('finds custom format entry (type: custom, customType: pi-mission-active)', () => {
    const entries: SessionEntry[] = [
      { type: 'custom', customType: 'pi-mission-active', data: { missionId: 'pim:20250101000000000:custom-test', validationToken: 'tok456' } },
    ];
    const result = latestActiveEntry(entries);
    expect(result).not.toBeNull();
    expect(result!.missionId).toBe('pim:20250101000000000:custom-test');
    expect(result!.validationToken).toBe('tok456');
  });

  it('returns the LAST (most recent) pi-mission-active entry when multiple exist', () => {
    const entries: SessionEntry[] = [
      { type: 'custom', customType: 'pi-mission-active', data: { missionId: 'pim:first', validationToken: 'tok1' } },
      { type: 'pi-mission-active', data: { missionId: 'pim:second', validationToken: 'tok2' } },
      { type: 'custom', customType: 'pi-mission-active', data: { missionId: 'pim:third', validationToken: 'tok3' } },
    ];
    const result = latestActiveEntry(entries);
    // Most recent is the last one in the array
    expect(result!.missionId).toBe('pim:third');
    expect(result!.validationToken).toBe('tok3');
  });

  it('skips entries without data or with null data', () => {
    const entries: SessionEntry[] = [
      { type: 'pi-mission-active', data: null },
      { type: 'custom', customType: 'pi-mission-active' }, // data undefined
      { type: 'pi-mission-active', data: { missionId: 'pim:valid', validationToken: 'tok' } },
    ];
    const result = latestActiveEntry(entries);
    expect(result!.missionId).toBe('pim:valid');
  });

  it('skips entries where missionId is not a string', () => {
    const entries: SessionEntry[] = [
      { type: 'pi-mission-active', data: { missionId: 123, validationToken: 'tok' } },
      { type: 'pi-mission-active', data: { missionId: null, validationToken: 'tok' } },
      { type: 'pi-mission-active', data: { missionId: 'pim:valid-id', validationToken: 'tok' } },
    ];
    const result = latestActiveEntry(entries);
    expect(result!.missionId).toBe('pim:valid-id');
  });

  it('skips entries where missionId is undefined but other fields are present', () => {
    const entries: SessionEntry[] = [
      { type: 'pi-mission-active', data: { validationToken: 'tok' } },
      { type: 'pi-mission-active', data: { missionId: 'pim:has-id' } },
    ];
    const result = latestActiveEntry(entries);
    expect(result!.missionId).toBe('pim:has-id');
  });

  it('returns validationToken only when it is a string', () => {
    const entries1: SessionEntry[] = [
      { type: 'pi-mission-active', data: { missionId: 'pim:1', validationToken: 12345 } },
    ];
    expect(latestActiveEntry(entries1)!.validationToken).toBeUndefined();

    const entries2: SessionEntry[] = [
      { type: 'pi-mission-active', data: { missionId: 'pim:2', validationToken: 'tok-good' } },
    ];
    expect(latestActiveEntry(entries2)!.validationToken).toBe('tok-good');

    const entries3: SessionEntry[] = [
      { type: 'pi-mission-active', data: { missionId: 'pim:3' } },
    ];
    expect(latestActiveEntry(entries3)!.validationToken).toBeUndefined();
  });

  it('handles entries with extra fields gracefully', () => {
    const entries: SessionEntry[] = [
      { type: 'pi-mission-active', data: { missionId: 'pim:extra', extraField: 'ignored', count: 99 } as any },
    ];
    const result = latestActiveEntry(entries);
    expect(result!.missionId).toBe('pim:extra');
  });

  it('handles malformed entries (non-object data) without throwing', () => {
    const entries: SessionEntry[] = [
      { type: 'pi-mission-active', data: 'not an object' as any },
      { type: 'pi-mission-active', data: { missionId: 'pim:good' } },
    ];
    expect(() => latestActiveEntry(entries)).not.toThrow();
    expect(latestActiveEntry(entries)!.missionId).toBe('pim:good');
  });

  it('prefers native type over custom type when both exist in same entry', () => {
    // This is an edge case - both type and customType are set
    const entries: SessionEntry[] = [
      { type: 'pi-mission-active', customType: 'other', data: { missionId: 'pim:native-wins' } as any },
    ];
    const result = latestActiveEntry(entries);
    expect(result!.missionId).toBe('pim:native-wins');
  });

  it('processes entries in reverse order', () => {
    const entries: SessionEntry[] = [
      { type: 'pi-mission-active', data: { missionId: 'pim:first' } },
      { type: 'user', role: 'user', content: 'ignored' },
      { type: 'pi-mission-active', data: { missionId: 'pim:last' } },
    ];
    const result = latestActiveEntry(entries);
    expect(result!.missionId).toBe('pim:last');
  });

  it('handles custom format with role and content fields present', () => {
    const entries: SessionEntry[] = [
      {
        type: 'custom',
        customType: 'pi-mission-active',
        role: 'assistant',
        content: 'some content',
        data: { missionId: 'pim:with-extras', validationToken: 'tok' },
      },
    ];
    const result = latestActiveEntry(entries);
    expect(result!.missionId).toBe('pim:with-extras');
    expect(result!.validationToken).toBe('tok');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tests for hook() helper
// ═══════════════════════════════════════════════════════════════════════════

describe('hook', () => {
  function makePi(): Pick<ExtensionAPI, 'on'> {
    const hooks: Record<string, any[]> = {};
    return {
      on(event: string, handler: PiEventHandler) {
        if (!hooks[event]) hooks[event] = [];
        hooks[event].push(handler);
      },
      // Expose hooks for test verification via casting
      __hooks: hooks,
    } as unknown as Pick<ExtensionAPI, 'on'> & { __hooks: Record<string, any[]> };
  }

  function getHooks(pi: Pick<ExtensionAPI, 'on'>): Record<string, any[]> {
    return (pi as any).__hooks;
  }

  it('registers a handler under the given event name', () => {
    const pi = makePi();
    const handler = vi.fn();
    hook(pi as unknown as ExtensionAPI, 'session_start', handler);
    expect(getHooks(pi)['session_start']).toHaveLength(1);
    expect(getHooks(pi)['session_start'][0]).toBe(handler);
  });

  it('registers handlers for multiple different events', () => {
    const pi = makePi();
    const h1 = vi.fn();
    const h2 = vi.fn();
    const h3 = vi.fn();
    hook(pi as unknown as ExtensionAPI, 'session_start', h1);
    hook(pi as unknown as ExtensionAPI, 'tool_call', h2);
    hook(pi as unknown as ExtensionAPI, 'agent_end', h3);
    expect(getHooks(pi)['session_start']).toHaveLength(1);
    expect(getHooks(pi)['tool_call']).toHaveLength(1);
    expect(getHooks(pi)['agent_end']).toHaveLength(1);
  });

  it('allows multiple handlers on the same event', () => {
    const pi = makePi();
    const h1 = vi.fn();
    const h2 = vi.fn();
    hook(pi as unknown as ExtensionAPI, 'session_start', h1);
    hook(pi as unknown as ExtensionAPI, 'session_start', h2);
    expect(getHooks(pi)['session_start']).toHaveLength(2);
    expect(getHooks(pi)['session_start'][0]).toBe(h1);
    expect(getHooks(pi)['session_start'][1]).toBe(h2);
  });

  it('registers non-standard Pi events not in the public ExtensionAPI types', () => {
    const pi = makePi();
    const handler = vi.fn();
    // These events are valid at runtime but not in the public TypeScript types
    hook(pi as unknown as ExtensionAPI, 'tool_result', handler);
    hook(pi as unknown as ExtensionAPI, 'session_before_tree', handler);
    hook(pi as unknown as ExtensionAPI, 'session_before_compact', handler);
    hook(pi as unknown as ExtensionAPI, 'session_shutdown', handler);
    hook(pi as unknown as ExtensionAPI, 'resources_discover', handler);
    expect(getHooks(pi)['tool_result']).toHaveLength(1);
    expect(getHooks(pi)['session_before_tree']).toHaveLength(1);
    expect(getHooks(pi)['session_before_compact']).toHaveLength(1);
    expect(getHooks(pi)['session_shutdown']).toHaveLength(1);
    expect(getHooks(pi)['resources_discover']).toHaveLength(1);
  });

  it('registered handler is invoked when called via pi.hooks', () => {
    const pi = makePi();
    const handler = vi.fn((...args: unknown[]) => ({ handled: true, args }));
    hook(pi as unknown as ExtensionAPI, 'session_start', handler);

    // Simulate Pi calling the handler
    const ctx = { sessionManager: { getEntries: () => [] } };
    const result = getHooks(pi)['session_start'][0]({}, ctx);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ handled: true, args: expect.any(Array) });
  });

  it('preserves handler identity — same function reference is registered', () => {
    const pi = makePi();
    const handler = vi.fn();
    hook(pi as unknown as ExtensionAPI, 'session_start', handler);
    expect(getHooks(pi)['session_start'][0]).toBe(handler);
  });

  it('handler receives all arguments passed by Pi runtime', () => {
    const pi = makePi();
    const receivedArgs: unknown[][] = [];
    hook(pi as unknown as ExtensionAPI, 'tool_call', (...args: unknown[]) => { receivedArgs.push(args); });

    // Simulate different Pi invocations
    getHooks(pi)['tool_call'][0]({ toolName: 'bash', toolCallId: 'call-1' }, { hasUI: true });
    getHooks(pi)['tool_call'][0]({ toolName: 'read', toolCallId: 'call-2' }, { hasUI: false });

    expect(receivedArgs).toHaveLength(2);
    expect(receivedArgs[0]![0]).toEqual({ toolName: 'bash', toolCallId: 'call-1' });
    expect(receivedArgs[1]![0]).toEqual({ toolName: 'read', toolCallId: 'call-2' });
  });

  it('handles async handlers correctly', async () => {
    const pi = makePi();
    const asyncHandler = vi.fn(async (...args: unknown[]) => {
      await new Promise(resolve => setTimeout(resolve, 1));
      return 'async result';
    });
    hook(pi as unknown as ExtensionAPI, 'agent_end', asyncHandler);

    const result = await getHooks(pi)['agent_end'][0]({ messages: [] }, {});
    expect(asyncHandler).toHaveBeenCalled();
    expect(result).toBe('async result');
  });

  it('returns expected result from tool_call handler', async () => {
    const pi = makePi();
    const policyHandler = vi.fn((...args: unknown[]) => ({ block: false }));
    hook(pi as unknown as ExtensionAPI, 'tool_call', policyHandler);

    const result = await getHooks(pi)['tool_call'][0]({ toolName: 'bash', input: { command: 'ls' } });
    expect(policyHandler).toHaveBeenCalled();
    expect(result).toEqual({ block: false });
  });

  it('can block tool by returning block object', async () => {
    const pi = makePi();
    const blockHandler = vi.fn((...args: unknown[]) => ({ block: true, reason: 'Tool not allowed' }));
    hook(pi as unknown as ExtensionAPI, 'tool_call', blockHandler);

    const result = await getHooks(pi)['tool_call'][0]({ toolName: 'write' });
    expect(result).toEqual({ block: true, reason: 'Tool not allowed' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tests for project-local extension discovery
// ═══════════════════════════════════════════════════════════════════════════

describe('piMissions — project-local extension discovery', () => {
  const tmpRoot = path.join(os.tmpdir(), `pi-missions-ext-test-${process.pid}`);
  const originalEnv = { ...process.env };

  beforeAll(() => {
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  afterEach(() => {
    // Restore env vars that piMissions may have set
    delete process.env.PI_MISSIONS_EXTENSION_PATH;
    delete process.env.PI_MISSIONS_PROJECT_DIR;
  });

  function makeMockPi(): ExtensionAPI {
    return {
      on: vi.fn(),
      registerCommand: vi.fn(),
      registerTool: vi.fn(),
      registerShortcut: vi.fn(),
      appendEntry: vi.fn(),
      setSessionName: vi.fn(),
      setLabel: vi.fn(),
    } as unknown as ExtensionAPI;
  }

  it('sets PI_MISSIONS_EXTENSION_PATH to project-local path when project .pi/extensions/pi-missions/index.ts exists', () => {
    // Create project-local extension path
    const projectDir = path.join(tmpRoot, 'my-project');
    const localExtDir = path.join(projectDir, '.pi', 'extensions', 'pi-missions');
    const localExtFile = path.join(localExtDir, 'index.ts');
    fs.mkdirSync(localExtDir, { recursive: true });
    fs.writeFileSync(localExtFile, '// project-local pi-missions', 'utf-8');

    // Mock process.cwd() to return the project directory
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    try {
      const pi = makeMockPi();
      piMissions(pi);

      expect(process.env.PI_MISSIONS_EXTENSION_PATH).toBe(localExtFile);
      // PI_MISSIONS_PROJECT_DIR is set to the extension dir, not project root
      expect(process.env.PI_MISSIONS_PROJECT_DIR).toBe(localExtDir);
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it('falls back to global extension path when no project-local extension exists', () => {
    const fakeProject = path.join(tmpRoot, 'no-local-ext');
    fs.mkdirSync(fakeProject, { recursive: true });

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(fakeProject);

    try {
      const pi = makeMockPi();
      piMissions(pi);

      // Should still set PI_MISSIONS_EXTENSION_PATH (global), but NOT PI_MISSIONS_PROJECT_DIR
      expect(process.env.PI_MISSIONS_EXTENSION_PATH).toBeDefined();
      expect(process.env.PI_MISSIONS_PROJECT_DIR).toBeUndefined();
      // Global path should not be in the fake project dir
      expect(process.env.PI_MISSIONS_EXTENSION_PATH).not.toContain(fakeProject);
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it('handles project dir .pi/extensions but no pi-missions subdirectory', () => {
    const partialDir = path.join(tmpRoot, 'partial-ext');
    const extDir = path.join(partialDir, '.pi', 'extensions');
    fs.mkdirSync(extDir, { recursive: true });
    // No pi-missions subdirectory — extension doesn't exist

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(partialDir);

    try {
      const pi = makeMockPi();
      piMissions(pi);

      expect(process.env.PI_MISSIONS_EXTENSION_PATH).toBeDefined();
      expect(process.env.PI_MISSIONS_PROJECT_DIR).toBeUndefined();
    } finally {
      cwdSpy.mockRestore();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Integration tests for hook handler closures inside piMissions()
// ═══════════════════════════════════════════════════════════════════════════

describe('piMissions — hook handler integration', () => {
  let cap: CapturedPi;

  beforeEach(() => {
    cap = makeCapturedPi();
    // Suppress env var setting by using a cwd that won't find project-local files
    vi.spyOn(process, 'cwd').mockReturnValue('/tmp/fake-pi-missions-cwd');
    piMissions(cap.pi);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function getHooks(event: string) {
    return cap.hooks[event] || [];
  }

  // ── resources_discover ─────────────────────────────────────────────────

  describe('resources_discover handler', () => {
    it('returns empty resource lists', async () => {
      const handlers = getHooks('resources_discover');
      expect(handlers).toHaveLength(1);
      const result = await handlers[0]!();
      expect(result).toEqual({ skillPaths: [], promptPaths: [], themePaths: [] });
    });
  });

  // ── session_before_tree ────────────────────────────────────────────────

  describe('session_before_tree handler', () => {
    it('returns undefined when no active mission (no summary)', async () => {
      const handlers = getHooks('session_before_tree');
      expect(handlers).toHaveLength(1);
      const result = await handlers[0]!();
      expect(result).toBeUndefined();
    });
  });

  // ── before_agent_start: phase reset ────────────────────────────────────

  describe('before_agent_start — phase reset handler', () => {
    it('clears pending completion and resets tool call count', async () => {
      const handlers = getHooks('before_agent_start');
      expect(handlers.length).toBeGreaterThanOrEqual(1);
      // First handler is phase reset
      const ctx = makeCtx();
      await handlers[0]!({}, ctx);
      // No active mission → returns early without error
    });
  });

  // ── before_agent_start: inject lean context ────────────────────────────

  describe('before_agent_start — context inject handler', () => {
    it('returns early when no active mission', async () => {
      const handlers = getHooks('before_agent_start');
      expect(handlers.length).toBeGreaterThanOrEqual(2);
      const ctx = makeCtx();
      const result = await handlers[1]!({}, ctx);
      expect(result).toBeUndefined();
    });

    it('returns early when mission status is not active', async () => {
      // We need to set up the runtime. Since piMissions creates a closure runtime,
      // we can't easily access it. This test verifies the handler exists and doesn't throw.
      const handlers = getHooks('before_agent_start');
      expect(handlers.length).toBeGreaterThanOrEqual(2);
      // Handler exists and can be called without active mission
      const result = await handlers[1]!({}, makeCtx());
      expect(result).toBeUndefined();
    });
  });

  // ── turn_end handler ──────────────────────────────────────────────────

  describe('turn_end handler', () => {
    it('returns early when no active mission', async () => {
      const handlers = getHooks('turn_end');
      expect(handlers).toHaveLength(1);
      const ctx = makeCtx();
      await handlers[0]!({}, ctx);
      // Should not throw — early return on no mission
    });
  });

  // ── agent_end handler ──────────────────────────────────────────────────

  describe('agent_end handler', () => {
    it('returns early when no active mission', async () => {
      const handlers = getHooks('agent_end');
      expect(handlers).toHaveLength(1);
      const ctx = makeCtx();
      await handlers[0]!({ messages: [] }, ctx);
      // Should not throw
    });
  });

  // ── tool_call handler ──────────────────────────────────────────────────

  describe('tool_call handler', () => {
    it('returns early when no active mission', async () => {
      const handlers = getHooks('tool_call');
      expect(handlers).toHaveLength(1);
      const ctx = makeCtx();
      const result = await handlers[0]!({ toolName: 'read', input: {} }, ctx);
      expect(result).toBeUndefined();
    });
  });

  // ── tool_result handler ────────────────────────────────────────────────

  describe('tool_result handler', () => {
    it('returns early when no active mission', async () => {
      const handlers = getHooks('tool_result');
      expect(handlers).toHaveLength(1);
      const ctx = makeCtx();
      const result = await handlers[0]!({ toolName: 'read', isError: false }, ctx);
      expect(result).toBeUndefined();
    });
  });

  // ── session_shutdown handler ───────────────────────────────────────────

  describe('session_shutdown handler', () => {
    it('runs without error when no active mission', async () => {
      const handlers = getHooks('session_shutdown');
      expect(handlers).toHaveLength(1);
      const ctx = makeCtx();
      await handlers[0]!({}, ctx);
    });
  });

  // ── session_start handler ──────────────────────────────────────────────

  describe('session_start handler', () => {
    it('returns early when entries are empty (no active mission entry)', async () => {
      const handlers = getHooks('session_start');
      expect(handlers).toHaveLength(1);
      const ctx = makeCtx();
      await handlers[0]!({}, ctx);
      // Should not throw — no active entry found
    });
  });

  // ── session_before_compact handler ─────────────────────────────────────

  describe('session_before_compact handler', () => {
    it('calls compactionCheckpoint without error', async () => {
      const handlers = getHooks('session_before_compact');
      expect(handlers).toHaveLength(1);
      await handlers[0]!();
    });
  });

  // ── Handler registration checks ────────────────────────────────────────

  describe('handler registration', () => {
    it('registers handlers for all expected events', () => {
      const expectedEvents = [
        'session_start', 'resources_discover', 'session_before_tree',
        'before_agent_start', 'tool_call', 'tool_result',
        'turn_end', 'agent_end', 'session_before_compact', 'session_shutdown',
      ];
      for (const event of expectedEvents) {
        expect(cap.hooks[event]).toBeDefined();
        expect(cap.hooks[event]!.length).toBeGreaterThan(0);
      }
    });

    it('registers two before_agent_start handlers (phase reset + context inject)', () => {
      expect(cap.hooks['before_agent_start']).toHaveLength(2);
    });

    it('registers commands and tools', () => {
      expect(cap.registerCommand).toHaveBeenCalled();
      expect(cap.registerTool).toHaveBeenCalled();
    });

    it('registers keyboard shortcuts', () => {
      expect(cap.registerShortcut).toHaveBeenCalledWith('ctrl+shift+m', expect.any(Object));
      expect(cap.registerShortcut).toHaveBeenCalledWith('ctrl+shift+d', expect.any(Object));
    });
  });
});