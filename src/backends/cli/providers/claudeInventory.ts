import { record } from '../../../core/interactions/validation.js';
import type {
  ProviderSessionCapabilities, SessionToolInventory, SessionToolServer,
} from '../../../core/interactions/capabilities.js';

export const CLAUDE_CHROME_SERVER = 'claude-in-chrome';

export function emptyClaudeInventory(reason = 'not_yet_observed'): SessionToolInventory {
  return { state: 'not_observed', observedAt: null, stale: false, coverage: 'top-level-mcp', pages: 0,
    servers: [], dynamicTools: [], builtins: 'not_observed', reason };
}

// claude.ai connectors are named like `claude.ai Gmail`.
function name(value: unknown): string {
  if (typeof value !== 'string' || !/^[\w .\/:\-]{1,256}$/.test(value)) throw new Error('Unsupported tool name');
  return value;
}

const CONNECTION: Record<string, SessionToolServer['connection']> = {
  connected: 'connected', pending: 'starting', failed: 'failed', 'needs-auth': 'authenticationRequired', disabled: 'disabled',
};

/**
 * Map an `mcp_status` reply. Only names and states leave: no configuration, commands,
 * URLs, schemas, server info or errors.
 */
export function claudeInventory(result: Record<string, unknown>, injected: ReadonlySet<string>): SessionToolInventory {
  if (!Array.isArray(result.mcpServers) || result.mcpServers.length > 128) throw new Error('Unsupported inventory response');
  let total = 0;
  let truncated = false;
  const servers = result.mcpServers.map((value) => {
    const input = record(value);
    const serverName = name(input?.name);
    const source = injected.has(serverName) ? 'session-injected' as const : 'provider-configured' as const;
    const entries = Array.isArray(input?.tools) ? input.tools : [];
    const room = Math.max(0, Math.min(2048, 8192 - total));
    const tools = entries.slice(0, room).map((entry) => {
      const toolName = name(record(entry)?.name);
      return { name: toolName, qualifiedName: `${source === 'session-injected' ? 'session' : 'provider'}/${encodeURIComponent(serverName)}/${encodeURIComponent(toolName)}` };
    });
    total += tools.length;
    truncated ||= entries.length > tools.length;
    const status = typeof input?.status === 'string' ? input.status : '';
    return { name: serverName, source, connection: CONNECTION[status] ?? 'unknown', auth: 'unknown', tools,
      discovery: status === 'failed' ? 'failed' : entries.length > tools.length ? 'truncated' : 'advertised',
      invocation: 'not_verified' } satisfies SessionToolServer;
  });
  return { state: truncated || servers.some(server => server.discovery !== 'advertised') ? 'partial' : 'observed',
    observedAt: new Date().toISOString(), stale: false, coverage: 'top-level-mcp', pages: 1, servers,
    dynamicTools: [], builtins: 'not_observed' };
}

/** A connected Chrome server does not prove a browser is connected to it. */
export function claudeDependencies(inventory: SessionToolInventory): ProviderSessionCapabilities['dependencies'] {
  const chrome = inventory.servers.find(server => server.name === CLAUDE_CHROME_SERVER);
  return [
    chrome ? { kind: 'browser', status: chrome.connection === 'failed' || chrome.connection === 'disabled' ? 'unavailable' : 'unknown',
      evidence: `The ${CLAUDE_CHROME_SERVER} MCP server is ${chrome.connection}; a browser connection is not observed until a browser tool runs.`,
      remediation: 'Open Chrome or Edge with the Claude extension signed in to the same account.' }
      : { kind: 'browser', status: inventory.state === 'not_observed' ? 'unknown' : 'unavailable',
        evidence: inventory.state === 'not_observed' ? 'MCP servers have not been observed for this worker yet.'
          : `No ${CLAUDE_CHROME_SERVER} MCP server is configured for this session.`,
        remediation: 'Add --chrome to the Claude instance launch arguments to enable Claude in Chrome.' },
    { kind: 'computer_use', status: 'unavailable',
      evidence: 'Claude Code offers computer use only to interactive macOS sessions, not to headless runs.',
      remediation: 'Use the Claude desktop application for computer use; Runtime cannot provide it.' },
  ];
}
