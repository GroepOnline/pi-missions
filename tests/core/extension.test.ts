import { describe, expect, it, vi } from 'vitest';
import { latestActiveEntry, hook, type SessionEntry, type PiEventHandler } from '../../src/core/extension.js';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

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