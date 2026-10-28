import { record } from '../../../core/interactions/validation.js';
import type { SessionToolInventory, SessionToolServer } from '../../../core/interactions/capabilities.js';

export function emptyCodexInventory(reason = 'thread_not_initialized'): SessionToolInventory {
  return { state: 'not_observed', observedAt: null, stale: false, coverage: 'top-level-mcp', pages: 0,
    servers: [], dynamicTools: [], builtins: 'not_exposed_by_provider', reason };
}

function name(value: unknown): string {
  if (typeof value !== 'string' || !/^[\w.\/:\-]{1,256}$/.test(value)) throw new Error('Unsupported tool name');
  return value;
}

/** No raw errors, schemas, URLs, resource contents, tokens or configuration escape discovery. */
export function codexInventoryPage(result: Record<string, unknown>, injected: ReadonlySet<string>): {
  servers: SessionToolServer[]; cursor?: string;
} {
  if (!Array.isArray(result.data) || result.data.length > 128) throw new Error('Unsupported inventory response');
  const servers = result.data.map(value => {
    const input = record(value);
    const serverName = name(input?.name);
    const entries = Object.keys(record(input?.tools) ?? {});
    const tools = entries.slice(0, 2048).map(key => {
      const toolName = name(key);
      return { name: toolName, qualifiedName: `${injected.has(serverName) ? 'session' : 'provider'}/${encodeURIComponent(serverName)}/${encodeURIComponent(toolName)}` };
    });
    const connection = typeof input?.runtimeStatus === 'string' && ['notStarted', 'starting', 'connected',
      'authenticationRequired', 'failed', 'cancelled', 'disabled'].includes(input.runtimeStatus)
      ? input.runtimeStatus as SessionToolServer['connection'] : 'unknown';
    const auth = typeof input?.authStatus === 'string' && ['unknown', 'unsupported', 'notLoggedIn', 'bearerToken', 'oAuth'].includes(input.authStatus)
      ? input.authStatus as SessionToolServer['auth'] : 'unknown';
    return { name: serverName, source: injected.has(serverName) ? 'session-injected' : 'provider-configured', connection, auth, tools,
      discovery: input?.toolsError ? 'failed' : entries.length > 2048 ? 'truncated' : 'advertised', invocation: 'not_verified' } satisfies SessionToolServer;
  });
  const cursor = result.nextCursor;
  if (cursor !== undefined && cursor !== null && (typeof cursor !== 'string' || !cursor || cursor.length > 4096)) {
    throw new Error('Unsupported inventory cursor');
  }
  return { servers, ...(typeof cursor === 'string' ? { cursor } : {}) };
}
