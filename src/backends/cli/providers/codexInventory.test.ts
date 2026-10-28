import { describe, expect, it } from 'vitest';
import { codexInventoryPage, emptyCodexInventory } from './codexInventory.js';

describe('Codex inventory normalization', () => {
  it('distinguishes source, auth mechanism and invocation evidence without copying secrets', () => {
    const result = codexInventoryPage({ data: [
      { name: 'cua_repl', runtimeStatus: 'connected', authStatus: 'unsupported', tools: { js: { description: 'private-marker', inputSchema: {} } },
        httpOrigin: 'https://private.test', serverCapabilities: { private: 'marker' } },
      { name: 'cats', runtimeStatus: 'failed', authStatus: 'bearerToken', tools: {}, toolsError: 'private-token' },
    ], nextCursor: 'opaque-cursor' }, new Set(['cats']));
    expect(result.servers[0]).toMatchObject({ source: 'provider-configured', connection: 'connected', auth: 'unsupported',
      invocation: 'not_verified', tools: [{ name: 'js', qualifiedName: 'provider/cua_repl/js' }] });
    expect(result.servers[1]).toMatchObject({ source: 'session-injected', discovery: 'failed' });
    expect(result.cursor).toBe('opaque-cursor');
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('bounds large catalogs, rejects unsupported shapes and keeps absent observations distinct', () => {
    expect(emptyCodexInventory()).toMatchObject({ state: 'not_observed', observedAt: null, stale: false });
    const tools = Object.fromEntries(Array.from({ length: 2050 }, (_, i) => [`tool_${i}`, {}]));
    const result = codexInventoryPage({ data: [{ name: 'fixture', tools }] }, new Set());
    expect(result.servers[0]!.tools).toHaveLength(2048);
    expect(result.servers[0]!.discovery).toBe('truncated');
    expect(() => codexInventoryPage({ data: {}, nextCursor: null }, new Set())).toThrow();
    expect(() => codexInventoryPage({ data: [], nextCursor: 3 }, new Set())).toThrow();
  });
});
