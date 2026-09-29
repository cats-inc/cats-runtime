/**
 * Session MCP servers (SPEC-035): host-supplied MCP server descriptors that a
 * Runtime-spawned provider CLI is configured to connect to. Runtime never
 * proxies MCP traffic; it only configures the child.
 *
 * Descriptors carry secrets. They live in memory only, keyed by session, and
 * never reach `SessionInfo`, persistence, session reads, logs or argv.
 */

export const MAX_SESSION_MCP_SERVERS = 8;
const MAX_BEARER_TOKEN_LENGTH = 4096;
const SERVER_NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const BEARER_TOKEN_PATTERN = /^[\x21-\x7e]+$/;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);
const ENTRY_KEYS = new Set(['name', 'transport', 'url', 'auth']);

export type SessionMcpServerAuth =
  | { kind: 'bearer_env'; token: string }
  | { kind: 'none' };

export interface SessionMcpServer {
  name: string;
  transport: 'http';
  url: string;
  auth: SessionMcpServerAuth;
}

/** What an adapter sees at launch: no secret, only where to read it from. */
export interface SessionMcpServerLaunch {
  name: string;
  transport: 'http';
  url: string;
  bearerTokenEnvVar?: string;
}

export interface SessionMcpLaunchConfig {
  servers: SessionMcpServerLaunch[];
  /** Secret environment contributions for the child process only. */
  env: Record<string, string>;
}

export type SessionMcpDeliveryStatus = 'delivered' | 'unsupported' | 'failed';
export type SessionMcpServerConnection = 'connected' | 'failed' | 'unknown';

export interface SessionMcpDeliveryReport {
  status: SessionMcpDeliveryStatus;
  servers: { name: string; connection: SessionMcpServerConnection }[];
}

export type ParsedSessionMcpServers =
  | { ok: true; servers: SessionMcpServer[] | undefined }
  | { ok: false; error: string };

function invalid(error: string): ParsedSessionMcpServers {
  return { ok: false, error: `mcpServers: ${error}` };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || url.hash) return null;
  if (!LOOPBACK_HOSTS.has(url.hostname)) return null;
  return url.toString();
}

function parseAuth(value: unknown, index: number): SessionMcpServerAuth | string {
  if (!isRecord(value)) return `entry ${index} auth must be an object`;
  if (value.kind === 'none') {
    return Object.keys(value).length === 1 ? { kind: 'none' } : `entry ${index} auth has unknown keys`;
  }
  if (value.kind === 'bearer_env') {
    if (Object.keys(value).some((key) => key !== 'kind' && key !== 'token')) {
      return `entry ${index} auth has unknown keys`;
    }
    const token = value.token;
    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_BEARER_TOKEN_LENGTH
      || !BEARER_TOKEN_PATTERN.test(token)) {
      return `entry ${index} auth.token must be 1-${MAX_BEARER_TOKEN_LENGTH} visible ASCII characters`;
    }
    return { kind: 'bearer_env', token };
  }
  return `entry ${index} auth.kind must be 'bearer_env' or 'none'`;
}

/**
 * Parse the optional `mcpServers` request field. `undefined` keeps the current
 * set and `[]` clears it. Errors never include token material.
 */
export function parseSessionMcpServers(value: unknown): ParsedSessionMcpServers {
  if (value === undefined) return { ok: true, servers: undefined };
  if (!Array.isArray(value)) return invalid('must be an array');
  if (value.length > MAX_SESSION_MCP_SERVERS) {
    return invalid(`at most ${MAX_SESSION_MCP_SERVERS} servers are allowed`);
  }
  const names = new Set<string>();
  const servers: SessionMcpServer[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) return invalid(`entry ${index} must be an object`);
    if (Object.keys(entry).some((key) => !ENTRY_KEYS.has(key))) {
      return invalid(`entry ${index} has unknown keys`);
    }
    const name = entry.name;
    if (typeof name !== 'string' || !SERVER_NAME_PATTERN.test(name)) {
      return invalid(`entry ${index} name must match ${SERVER_NAME_PATTERN.source}`);
    }
    if (names.has(name)) return invalid(`duplicate server name '${name}'`);
    names.add(name);
    if (entry.transport !== 'http') {
      return invalid(`server '${name}' transport must be 'http'`);
    }
    const url = validateUrl(entry.url);
    if (!url) {
      return invalid(`server '${name}' url must be an http(s) loopback URL without credentials or fragment`);
    }
    const auth = parseAuth(entry.auth, index);
    if (typeof auth === 'string') return invalid(auth);
    servers.push({ name, transport: 'http', url, auth });
  }
  return { ok: true, servers };
}

export function sessionMcpTokenEnvVar(name: string): string {
  return `CATS_MCP_${name.toUpperCase().replace(/-/g, '_')}_TOKEN`;
}

export function toSessionMcpLaunchConfig(servers: readonly SessionMcpServer[]): SessionMcpLaunchConfig {
  const env: Record<string, string> = {};
  const launch = servers.map((server): SessionMcpServerLaunch => {
    if (server.auth.kind !== 'bearer_env') {
      return { name: server.name, transport: server.transport, url: server.url };
    }
    const bearerTokenEnvVar = sessionMcpTokenEnvVar(server.name);
    env[bearerTokenEnvVar] = server.auth.token;
    return { name: server.name, transport: server.transport, url: server.url, bearerTokenEnvVar };
  });
  return { servers: launch, env };
}

/** Map a provider-reported server status onto the report's connection value. */
export function toSessionMcpConnection(status: string | undefined): SessionMcpServerConnection {
  if (status === 'connected') return 'connected';
  if (status === 'failed' || status === 'needs-auth') return 'failed';
  return 'unknown';
}

/** Order-sensitive identity of a set, used to tell whether a worker runs the current set. */
function fingerprint(servers: readonly SessionMcpServer[]): string {
  return JSON.stringify(servers.map((server) => [
    server.name,
    server.url,
    server.auth.kind,
    server.auth.kind === 'bearer_env' ? server.auth.token : '',
  ]));
}

/**
 * In-memory descriptor store. Entries survive worker kill/close so a respawn can
 * reuse them, and are dropped only when the session itself is removed.
 */
export class SessionMcpServerStore {
  private readonly servers = new Map<string, SessionMcpServer[]>();
  /** Fingerprint of the set the live worker was actually launched with. */
  private readonly launches = new Map<string, string>();

  get(sessionId: string): readonly SessionMcpServer[] {
    return this.servers.get(sessionId) ?? [];
  }

  /** Apply a parsed request value: `undefined` keeps, `[]` clears, otherwise replaces. */
  apply(sessionId: string, servers: SessionMcpServer[] | undefined): void {
    if (servers === undefined) return;
    if (servers.length === 0) {
      this.servers.delete(sessionId);
      return;
    }
    this.servers.set(sessionId, servers.map((server) => ({ ...server, auth: { ...server.auth } })));
  }

  /** Record the set a worker launch was actually configured with (`[]` when none). */
  recordLaunch(sessionId: string, launched: readonly SessionMcpServer[]): void {
    this.launches.set(sessionId, fingerprint(launched));
  }

  /**
   * `supported` is whether the session's adapter and runtime can take servers at
   * all; a supporting worker that is not running the current set is `failed`.
   */
  report(sessionId: string, supported: boolean): SessionMcpDeliveryReport | undefined {
    const current = this.get(sessionId);
    if (current.length === 0) return undefined;
    const status: SessionMcpDeliveryStatus = !supported
      ? 'unsupported'
      : this.launches.get(sessionId) === fingerprint(current) ? 'delivered' : 'failed';
    return {
      status,
      servers: current.map((server) => ({ name: server.name, connection: 'unknown' })),
    };
  }

  remove(sessionId: string): void {
    this.servers.delete(sessionId);
    this.launches.delete(sessionId);
  }
}
