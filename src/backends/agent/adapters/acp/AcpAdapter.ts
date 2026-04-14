import { spawn, type ChildProcess } from 'node:child_process';
import type {
  AgentAdapter,
  AgentAcpHostMcpServer,
  AgentAdapterInspection,
  AgentAdapterProbeResult,
  AgentBackendOptions,
  AgentInvokeInput,
} from '../../types.js';
import type { PermissionMode, SessionProviderState, StreamEvent } from '../../../../core/types.js';
import type { RemoteProviderInstanceConfig } from '../../../cli/config.js';
import { runCliCommand } from '../../../../core/management/cli.js';
import { hiddenWindowsSpawnOptions } from '../../../../core/process/windowsSpawn.js';
import { createRuntimeProgressEvent } from '../../../../core/progress.js';
import { resolveSafeWorkspacePath } from '../../../../core/tools/pathSafety.js';
import { parseRecord, prependInstructions, readString } from '../../utils.js';
import {
  AcpJsonRpcClientError,
  AcpStdioClient,
  type AcpJsonRpcNotification,
  type AcpJsonRpcRequest,
} from './AcpStdioClient.js';
import { buildAcpHelpProbeArgs, resolveAcpProviderProfile } from './profiles.js';

const DEFAULT_ACP_PROTOCOL_VERSION = 1;
const DEFAULT_ACP_STDIN_PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_ACP_TERMINAL_OUTPUT_BYTE_LIMIT = 128 * 1024;

type AcpInvokePhase = 'bootstrap' | 'prompt';
interface AcpObservedToolCall {
  name?: string;
}

interface AcpConfigOptionSnapshot {
  id: string;
  label?: string;
  value?: string;
}

interface AcpPermissionDecision {
  response: Record<string, unknown>;
  progress: {
    text: string;
    status: 'updated' | 'blocked';
    details: Record<string, unknown>;
    toolId?: string;
    toolName?: string;
  };
}

interface AcpManagedTerminal {
  id: string;
  process: ChildProcess;
  output: string;
  truncated: boolean;
  byteLimit: number;
  exitCode: number | null;
  signal: string | null;
  released: boolean;
  exitPromise: Promise<void>;
  resolveExit: () => void;
}

function resolveEndpoint(
  instance: RemoteProviderInstanceConfig,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const value = (instance.urlEnv ? env[instance.urlEnv] : undefined)
    || instance.url
    || (instance.baseUrlEnv ? env[instance.baseUrlEnv] : undefined)
    || instance.baseUrl;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function sanitizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      clean[key] = value;
    }
  }
  return clean;
}

function buildInspection(
  instance: RemoteProviderInstanceConfig,
  env: NodeJS.ProcessEnv,
  hostBridgeConfigured: boolean,
): AgentAdapterInspection {
  const endpoint = resolveEndpoint(instance, env);
  const command = instance.command?.trim() || undefined;
  const profile = resolveAcpProviderProfile(instance);
  const supportsRemoteCancel = Boolean(command && profile);
  const supportsModelDiscovery = Boolean(command && profile);
  const transportKind = command ? 'stdio' as const : 'http' as const;
  const launch = command
    ? {
        kind: 'stdio' as const,
        command,
        ...(instance.args?.length ? { args: [...instance.args] } : {}),
        ...(instance.cwd ? { cwd: instance.cwd } : {}),
        ...(instance.startupTimeoutMs ? { startupTimeoutMs: instance.startupTimeoutMs } : {}),
      }
    : undefined;
  const authConfigured = Boolean(
    (instance.authTokenEnv && env[instance.authTokenEnv])
    || (instance.headers && Object.keys(instance.headers).some((key) =>
      key.toLowerCase() === 'authorization')),
  );
  const hostBridgeSummary = hostBridgeConfigured
    ? 'A runtime ACP host-capability bridge is configured; the current execution slice mediates ACP permission, filesystem, and terminal requests through runtime policy, while client MCP server exposure remains disabled unless the host bridge explicitly supplies MCP declarations.'
    : 'It will require a runtime ACP host-capability bridge before turn execution is enabled.';
  const profileSummary = profile
    ? ` ${profile.label} is the current ACP pilot target because its lifecycle overlaps with an existing runtime seam.`
    : '';
  const summary = command
    ? `ACP target '${instance.providerName}/${instance.id}' is configured as a provider-managed stdio agent command.${profileSummary} ${hostBridgeSummary}`
    : `ACP target '${instance.providerName}/${instance.id}' is configured as a provider-managed ACP transport. ${hostBridgeSummary}`;

  return {
    adapter: 'acp',
    family: 'protocol',
    summary,
    ...(endpoint ? { endpoint } : {}),
    ...(launch ? { launch } : {}),
    transport: {
      kind: transportKind,
      protocol: 'acp_v1',
      liveProbe: command ? 'command_help' : 'none',
      modelDiscovery: supportsModelDiscovery ? 'session_bootstrap' : 'none',
      toolDiscovery: 'none',
      streaming: 'generic',
    },
    request: {
      headerNames: Object.keys(instance.headers || {})
        .filter((name) => name !== 'content-type' && name !== 'accept')
        .sort(),
    },
    auth: {
      mechanisms: authConfigured && !command ? ['bearer_header'] : [],
      credentials: [
        ...(endpoint
          ? [{
              kind: 'base_url' as const,
              configured: true,
            }]
          : []),
        ...(instance.authTokenEnv || authConfigured
          ? [{
              kind: 'auth_token' as const,
              configured: authConfigured,
            }]
          : []),
      ],
    },
    continuity: {
      providerManagedSessions: true,
      sessionKey: true,
      providerSessionState: true,
      cancel: supportsRemoteCancel,
    },
    capabilities: {
      probe: Boolean(command),
      modelDiscovery: supportsModelDiscovery,
      toolCatalog: false,
      effectiveToolCatalog: false,
      cancel: supportsRemoteCancel,
      runtimeServices: hostBridgeConfigured,
      toolCallEvents: Boolean(command),
    },
  };
}

function buildProviderState(
  input: AgentInvokeInput,
  providerSessionId: string,
  status: string,
  extra: Record<string, unknown> = {},
): SessionProviderState {
  const existingAgentSession = input.sessionState?.agentSession;
  const existingAdapterState = parseRecord(existingAgentSession?.adapterState) || {};
  const profile = resolveAcpProviderProfile(input.instance);

  return {
    ...(input.sessionState || {}),
    agentSession: {
      providerSessionId,
      sessionKey: input.sessionKey,
      status,
      summary: status === 'active'
        ? 'ACP stdio session is actively processing a prompt.'
        : 'ACP stdio session is idle.',
      ...(existingAgentSession?.activity ? { activity: existingAgentSession.activity } : {}),
      adapterState: {
        ...existingAdapterState,
        transport: input.instance.transport || 'acp',
        ...(profile ? { acpProfile: profile.id } : {}),
        ...extra,
      },
    },
  };
}

function buildInitializeParams(
  instance?: RemoteProviderInstanceConfig,
  options: {
    filesystem?: boolean;
    terminal?: boolean;
  } = {},
) {
  const profile = instance ? resolveAcpProviderProfile(instance) : undefined;
  return {
    protocolVersion: DEFAULT_ACP_PROTOCOL_VERSION,
    clientCapabilities: {
      ...(profile?.clientCapabilityMeta
        ? { _meta: { ...profile.clientCapabilityMeta } }
        : {}),
      fs: {
        readTextFile: options.filesystem === true,
        writeTextFile: options.filesystem === true,
      },
      terminal: options.terminal === true,
    },
    clientInfo: {
      name: 'cats-runtime',
      title: 'cats-runtime',
      version: '0.1.0',
    },
  };
}

function buildSessionBootstrapParams(input: AgentInvokeInput) {
  const cwd = resolveBootstrapCwd(input.instance.cwd, input.turn.context?.workspace?.cwd, input.acpHost?.context.cwd);
  if (!cwd) {
    throw new Error('ACP session bootstrap requires a working directory.');
  }

  return {
    cwd,
    mcpServers: resolveBootstrapMcpServers(input),
  };
}

function cloneMcpServer(server: AgentAcpHostMcpServer): AgentAcpHostMcpServer {
  if (server.type === 'stdio') {
    return {
      type: 'stdio',
      name: server.name,
      command: server.command,
      args: [...server.args],
      env: server.env.map((entry) => ({
        name: entry.name,
        value: entry.value,
      })),
    };
  }

  return {
    type: server.type,
    name: server.name,
    url: server.url,
    headers: server.headers.map((entry) => ({
      name: entry.name,
      value: entry.value,
    })),
  };
}

function readSessionMcpServers(adapterState: Record<string, unknown> | undefined): AgentAcpHostMcpServer[] {
  if (!Array.isArray(adapterState?.sessionMcpServers)) {
    return [];
  }

  const servers: AgentAcpHostMcpServer[] = [];
  for (const entry of adapterState.sessionMcpServers) {
    const record = parseRecord(entry);
    if (!record) {
      continue;
    }

    const type = readString(record.type);
    const name = readString(record.name);
    if (!type || !name) {
      continue;
    }

    if (type === 'stdio') {
      const command = readString(record.command);
      const args = Array.isArray(record.args)
        ? record.args.map((value) => readString(value)).filter((value): value is string => Boolean(value))
        : [];
      const env = Array.isArray(record.env)
        ? record.env.flatMap((item) => {
          const header = parseRecord(item);
          const key = readString(header?.name);
          const value = readString(header?.value);
          return key && value ? [{ name: key, value }] : [];
        })
        : [];
      if (!command) {
        continue;
      }
      servers.push({
        type: 'stdio' as const,
        name,
        command,
        args,
        env,
      });
      continue;
    }

    if (type === 'http' || type === 'sse') {
      const url = readString(record.url);
      const headers = Array.isArray(record.headers)
        ? record.headers.flatMap((item) => {
          const header = parseRecord(item);
          const key = readString(header?.name);
          const value = readString(header?.value);
          return key && value ? [{ name: key, value }] : [];
        })
        : [];
      if (!url) {
        continue;
      }
      servers.push({
        type,
        name,
        url,
        headers,
      });
    }
  }

  return servers;
}

function resolveBootstrapMcpServers(input: AgentInvokeInput): AgentAcpHostMcpServer[] {
  const bridge = input.acpHost?.bridge;
  const context = input.acpHost?.context;
  if (!bridge || !context || !bridge.listMcpServers) {
    return [];
  }

  return bridge.listMcpServers(context).map((server) => cloneMcpServer(server));
}

function resolveBootstrapCwd(...candidates: Array<string | undefined>): string | undefined {
  return candidates.find((candidate) => typeof candidate === 'string' && candidate.trim().length > 0);
}

function buildPromptParams(input: AgentInvokeInput, sessionId: string) {
  return {
    sessionId,
    prompt: [{
      type: 'text',
      text: prependInstructions(input.turn.message, input.turn.instructions),
    }],
  };
}

function extractSessionIdFromBootstrapResult(
  value: unknown,
  fallback?: string,
): string {
  const record = parseRecord(value);
  return readString(record?.sessionId) || fallback || '';
}

function parseModels(value: unknown): Array<{ id: string; label: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const record = parseRecord(entry);
    if (!record) {
      return [];
    }

    const id = readString(record.modelId)
      || readString(record.id)
      || readString(record.name);
    if (!id) {
      return [];
    }

    const label = readString(record.name)
      || readString(record.title)
      || id;
    return [{ id, label }];
  });
}

function selectPermissionOption(
  options: unknown,
  permissionMode: PermissionMode | undefined,
  allowedTools: string[] | undefined,
  request: AcpJsonRpcRequest,
): Record<string, unknown> | undefined {
  if (!Array.isArray(options)) {
    return undefined;
  }

  const records = options
    .map((entry) => parseRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const findByKind = (...kinds: string[]) => records.find((option) =>
    kinds.includes(readString(option.kind) || ''))
    ;

  if (permissionMode === 'skip') {
    return findByKind('allow_always', 'allow_once') || records[0];
  }

  if (permissionMode === 'whitelist' && matchesPermissionRequestToAllowedTools(request, allowedTools)) {
    return findByKind('allow_always', 'allow_once') || undefined;
  }

  return findByKind('reject_once', 'reject_always')
    || undefined;
}

function readPermissionToolIdentity(
  request: AcpJsonRpcRequest,
): { toolId?: string; toolName?: string } {
  const params = parseRecord(request.params);
  const toolCall = parseRecord(params?.toolCall) || parseRecord(params?.tool_call);
  return {
    ...(readString(toolCall?.toolCallId) || readString(toolCall?.id)
      ? { toolId: readString(toolCall?.toolCallId) || readString(toolCall?.id) }
      : {}),
    ...(readString(toolCall?.title) || readString(toolCall?.name) || readString(toolCall?.kind)
      ? { toolName: readString(toolCall?.title) || readString(toolCall?.name) || readString(toolCall?.kind) }
      : {}),
  };
}

function resolvePermissionDecision(
  request: AcpJsonRpcRequest,
  permissionMode: PermissionMode | undefined,
  allowedTools: string[] | undefined,
  aborted: boolean,
): AcpPermissionDecision {
  const toolIdentity = readPermissionToolIdentity(request);
  if (aborted) {
    return {
      response: {
        outcome: {
          outcome: 'cancelled',
        },
      },
      progress: {
        text: `Runtime cancelled ACP permission request${toolIdentity.toolName ? ` for ${toolIdentity.toolName}` : ''} after the turn was aborted.`,
        status: 'blocked',
        details: {
          outcome: 'cancelled',
          policyReason: 'turn_aborted',
          permissionMode: permissionMode || 'skip',
        },
        ...toolIdentity,
      },
    };
  }

  const params = parseRecord(request.params);
  const selectedOption = selectPermissionOption(
    params?.options,
    permissionMode,
    allowedTools,
    request,
  );
  const selectedOptionId = readString(selectedOption?.optionId);
  const selectedKind = readString(selectedOption?.kind);
  if (selectedOptionId) {
    const allowed = selectedKind === 'allow_once' || selectedKind === 'allow_always';
    return {
      response: {
        outcome: {
          outcome: 'selected',
          optionId: selectedOptionId,
        },
      },
      progress: {
        text: allowed
          ? `Runtime approved ACP permission request${toolIdentity.toolName ? ` for ${toolIdentity.toolName}` : ''}.`
          : `Runtime rejected ACP permission request${toolIdentity.toolName ? ` for ${toolIdentity.toolName}` : ''}.`,
        status: allowed ? 'updated' : 'blocked',
        details: {
          outcome: 'selected',
          optionId: selectedOptionId,
          optionKind: selectedKind,
          policyReason: allowed ? 'policy_allowed' : 'policy_rejected',
          permissionMode: permissionMode || 'skip',
        },
        ...toolIdentity,
      },
    };
  }

  return {
    response: {
      outcome: {
        outcome: 'cancelled',
      },
    },
    progress: {
      text: `Runtime cancelled ACP permission request${toolIdentity.toolName ? ` for ${toolIdentity.toolName}` : ''}.`,
      status: 'blocked',
      details: {
        outcome: 'cancelled',
        policyReason: 'no_supported_option',
        permissionMode: permissionMode || 'skip',
      },
      ...toolIdentity,
    },
  };
}

async function executeHostTool(
  binding: NonNullable<AgentInvokeInput['acpHost']>,
  call: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  },
): Promise<string> {
  const result = await binding.bridge.executeTool(binding.context, call);
  if (result.isError) {
    throw new AcpJsonRpcClientError(result.output || `ACP host tool '${call.name}' failed.`, -32000);
  }

  return result.output;
}

async function handleReadTextFileRequest(
  binding: NonNullable<AgentInvokeInput['acpHost']>,
  request: AcpJsonRpcRequest,
): Promise<Record<string, unknown>> {
  const params = parseRecord(request.params);
  const path = readString(params?.path);
  if (!path) {
    throw new AcpJsonRpcClientError('ACP fs/read_text_file requires a path.', -32602);
  }

  const line = readNumber(params?.line);
  const limit = readNumber(params?.limit);
  const content = await executeHostTool(binding, {
    id: `acp-fs-read-${request.id}`,
    name: 'read_file',
    arguments: {
      path,
      offset_line: line !== undefined && line > 0 ? line - 1 : 0,
      limit_lines: limit !== undefined ? limit : 2000,
    },
  });

  return { content };
}

async function handleWriteTextFileRequest(
  binding: NonNullable<AgentInvokeInput['acpHost']>,
  request: AcpJsonRpcRequest,
): Promise<Record<string, never>> {
  const params = parseRecord(request.params);
  const path = readString(params?.path);
  if (!path) {
    throw new AcpJsonRpcClientError('ACP fs/write_text_file requires a path.', -32602);
  }
  if (typeof params?.content !== 'string') {
    throw new AcpJsonRpcClientError('ACP fs/write_text_file requires string content.', -32602);
  }

  await executeHostTool(binding, {
    id: `acp-fs-write-${request.id}`,
    name: 'write_file',
    arguments: {
      path,
      content: params.content,
    },
  });

  return {};
}

function normalizePermissionModeForShell(
  binding: NonNullable<AgentInvokeInput['acpHost']>,
): PermissionMode {
  return binding.context.permissionMode
    || (binding.context.workspaceMode === 'read_only' ? 'default' : 'skip');
}

function ensureTerminalExecutionAllowed(
  binding: NonNullable<AgentInvokeInput['acpHost']>,
): void {
  const listedTools = new Set(binding.bridge.listTools(binding.context).map((tool) => tool.name));
  if (!listedTools.has('run_shell')) {
    throw new AcpJsonRpcClientError(
      `ACP terminal execution is disabled by toolProfile '${binding.context.toolProfile || 'standard'}'.`,
      -32000,
    );
  }

  if (binding.context.workspaceMode === 'read_only') {
    throw new AcpJsonRpcClientError('ACP terminal execution is not allowed in read_only workspace mode.', -32000);
  }

  const permissionMode = normalizePermissionModeForShell(binding);
  if (permissionMode === 'default') {
    throw new AcpJsonRpcClientError('ACP terminal execution requires permissionMode=skip or whitelist.', -32000);
  }

  if (permissionMode === 'whitelist') {
    const allowedTools = new Set((binding.context.allowedTools || []).map(normalizeAllowedToken));
    if (!allowedTools.has('runshell') && !allowedTools.has('*')) {
      throw new AcpJsonRpcClientError(
        "ACP terminal execution requires 'run_shell' in allowedTools when permissionMode=whitelist.",
        -32000,
      );
    }
  }
}

function appendTerminalOutput(
  terminal: AcpManagedTerminal,
  chunk: string,
): void {
  if (!chunk) {
    return;
  }

  terminal.output += chunk;
  while (Buffer.byteLength(terminal.output, 'utf8') > terminal.byteLimit && terminal.output.length > 0) {
    terminal.output = terminal.output.slice(1);
    terminal.truncated = true;
  }
}

function buildTerminalExitStatus(terminal: AcpManagedTerminal): Record<string, unknown> | null {
  return terminal.exitCode !== null || terminal.signal !== null
    ? {
        exitCode: terminal.exitCode,
        signal: terminal.signal,
      }
    : null;
}

async function handleCreateTerminalRequest(
  binding: NonNullable<AgentInvokeInput['acpHost']>,
  request: AcpJsonRpcRequest,
  terminals: Map<string, AcpManagedTerminal>,
  nextTerminalId: () => string,
): Promise<Record<string, unknown>> {
  ensureTerminalExecutionAllowed(binding);

  const params = parseRecord(request.params);
  const command = readString(params?.command);
  if (!command) {
    throw new AcpJsonRpcClientError('ACP terminal/create requires a command.', -32602);
  }

  const args = Array.isArray(params?.args)
    ? params.args.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const requestedCwd = readString(params?.cwd) || binding.context.cwd;
  const cwd = (await resolveSafeWorkspacePath(binding.context.cwd, requestedCwd)).fullPath;
  const envEntries = Array.isArray(params?.env)
    ? params.env.flatMap((entry) => {
        const record = parseRecord(entry);
        const name = readString(record?.name);
        const value = readString(record?.value);
        return name && value !== undefined ? [[name, value] as const] : [];
      })
    : [];
  const childEnv: NodeJS.ProcessEnv = envEntries.length > 0
    ? { ...globalThis.process.env, ...Object.fromEntries(envEntries) }
    : { ...globalThis.process.env };
  const outputByteLimit = readNumber(params?.outputByteLimit) || DEFAULT_ACP_TERMINAL_OUTPUT_BYTE_LIMIT;
  const terminalId = nextTerminalId();
  let resolveExit: () => void = () => {};
  const exitPromise = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });

  const child = spawn(command, args, {
    cwd,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    ...hiddenWindowsSpawnOptions(),
  });
  const terminal: AcpManagedTerminal = {
    id: terminalId,
    process: child,
    output: '',
    truncated: false,
    byteLimit: outputByteLimit,
    exitCode: null,
    signal: null,
    released: false,
    exitPromise,
    resolveExit,
  };
  terminals.set(terminalId, terminal);

  child.stdout?.on('data', (chunk: Buffer | string) => {
    appendTerminalOutput(terminal, chunk.toString());
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    appendTerminalOutput(terminal, chunk.toString());
  });
  child.on('error', (error: Error) => {
    appendTerminalOutput(terminal, error.message);
    terminal.signal = 'spawn_error';
    terminal.resolveExit();
  });
  child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
    terminal.exitCode = code;
    terminal.signal = signal;
    terminal.resolveExit();
  });

  return { terminalId };
}

function requireManagedTerminal(
  terminals: Map<string, AcpManagedTerminal>,
  request: AcpJsonRpcRequest,
): AcpManagedTerminal {
  const params = parseRecord(request.params);
  const terminalId = readString(params?.terminalId);
  if (!terminalId) {
    throw new AcpJsonRpcClientError(`ACP ${request.method} requires a terminalId.`, -32602);
  }

  const terminal = terminals.get(terminalId);
  if (!terminal || terminal.released) {
    throw new AcpJsonRpcClientError(`ACP terminal '${terminalId}' is not available.`, -32000);
  }

  return terminal;
}

async function handleTerminalOutputRequest(
  terminals: Map<string, AcpManagedTerminal>,
  request: AcpJsonRpcRequest,
): Promise<Record<string, unknown>> {
  const terminal = requireManagedTerminal(terminals, request);
  return {
    output: terminal.output,
    truncated: terminal.truncated,
    exitStatus: buildTerminalExitStatus(terminal),
  };
}

async function handleWaitForTerminalExitRequest(
  terminals: Map<string, AcpManagedTerminal>,
  request: AcpJsonRpcRequest,
): Promise<Record<string, unknown>> {
  const terminal = requireManagedTerminal(terminals, request);
  await terminal.exitPromise;
  return {
    exitCode: terminal.exitCode,
    signal: terminal.signal,
  };
}

async function handleKillTerminalRequest(
  terminals: Map<string, AcpManagedTerminal>,
  request: AcpJsonRpcRequest,
): Promise<Record<string, never>> {
  const terminal = requireManagedTerminal(terminals, request);
  if (terminal.exitCode === null && terminal.signal === null) {
    terminal.process.kill('SIGTERM');
    await terminal.exitPromise;
  }
  return {};
}

async function handleReleaseTerminalRequest(
  terminals: Map<string, AcpManagedTerminal>,
  request: AcpJsonRpcRequest,
): Promise<Record<string, never>> {
  const terminal = requireManagedTerminal(terminals, request);
  if (terminal.exitCode === null && terminal.signal === null) {
    terminal.process.kill('SIGTERM');
    await terminal.exitPromise;
  }
  terminal.released = true;
  terminals.delete(terminal.id);
  return {};
}

function normalizeAllowedToken(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase().replace(/[^a-z0-9*]+/g, '');
}

function kindCandidates(kind: string | undefined): string[] {
  switch ((kind || '').trim().toLowerCase()) {
    case 'read':
      return ['read_file', 'read', 'view_image'];
    case 'edit':
      return ['apply_patch', 'write_file', 'edit_file', 'write'];
    case 'execute':
      return ['run_shell', 'command_execution', 'exec'];
    case 'fetch':
      return ['web_fetch', 'web_search', 'fetch'];
    default:
      return [];
  }
}

function matchesPermissionRequestToAllowedTools(
  request: AcpJsonRpcRequest,
  allowedTools: string[] | undefined,
): boolean {
  const normalizedAllowed = new Set((allowedTools || [])
    .map(normalizeAllowedToken)
    .filter(Boolean));
  if (normalizedAllowed.size === 0) {
    return false;
  }
  if (normalizedAllowed.has('*')) {
    return true;
  }

  const params = parseRecord(request.params);
  const toolCall = parseRecord(params?.toolCall) || parseRecord(params?.tool_call);
  const title = readString(toolCall?.title);
  const kind = readString(toolCall?.kind);
  const name = readString(toolCall?.name);
  const candidates = [
    title,
    name,
    kind,
    ...(title ? [title.split(/\s+/, 1)[0] || ''] : []),
    ...kindCandidates(kind),
  ]
    .map(normalizeAllowedToken)
    .filter(Boolean);

  return candidates.some((candidate) => normalizedAllowed.has(candidate));
}

function extractToolText(content: unknown): string | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }

  const lines = content.flatMap((entry) => {
    const record = parseRecord(entry);
    if (!record) {
      return [];
    }

    const directText = readString(record.text);
    if (directText) {
      return [directText];
    }

    const nestedContent = parseRecord(record.content);
    const nestedText = readString(nestedContent?.text);
    if (nestedText) {
      return [nestedText];
    }

    const resource = parseRecord(record.resource);
    const resourceText = readString(resource?.text);
    if (resourceText) {
      return [resourceText];
    }

    return [];
  });

  return lines.length > 0 ? lines.join('\n') : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function formatProviderLabel(providerName: string): string {
  if (!providerName.trim()) {
    return 'ACP agent';
  }

  return providerName
    .split(/[_\s-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildProgressEvent(
  input: AgentInvokeInput,
  providerSessionId: string,
  text: string,
  kind: 'plan' | 'reasoning' | 'command' | 'session' | 'model_state',
  status: 'running' | 'updated',
  native: Record<string, unknown>,
  providerState: SessionProviderState,
  tool?: { toolId?: string; toolName?: string },
): StreamEvent {
  const progress = createRuntimeProgressEvent({
    text,
    providerSessionId,
    provider: input.providerName,
    backend: 'agent',
    instance: input.instance.id,
    source: 'provider',
    kind,
    status,
    native,
  });
  return {
    ...progress,
    providerState,
    ...(tool?.toolId ? { toolId: tool.toolId } : {}),
    ...(tool?.toolName ? { toolName: tool.toolName } : {}),
  };
}

function countPlanEntries(value: unknown): number | undefined {
  const plan = parseRecord(value);
  const entries = Array.isArray(plan?.entries)
    ? plan.entries
    : Array.isArray(plan?.steps)
      ? plan.steps
      : Array.isArray(value)
        ? value
        : [];
  return entries.length > 0 ? entries.length : undefined;
}

function summarizePlanUpdate(input: AgentInvokeInput, update: Record<string, unknown>): {
  text: string;
  stepCount?: number;
} {
  const plan = parseRecord(update.plan) || update;
  const summary = readString(plan.summary) || readString(update.summary);
  const stepCount = countPlanEntries(plan);
  if (summary) {
    return {
      text: summary,
      ...(stepCount === undefined ? {} : { stepCount }),
    };
  }

  const label = formatProviderLabel(input.providerName);
  return stepCount === undefined
    ? { text: `${label} updated the plan.` }
    : {
        text: `${label} updated the plan (${stepCount} steps).`,
        stepCount,
      };
}

function normalizeConfigOption(entry: unknown): AcpConfigOptionSnapshot | null {
  const record = parseRecord(entry);
  if (!record) {
    return null;
  }

  const payload = parseRecord(record.payload) || record;
  const id = readString(record.configId)
    || readString(record.id)
    || readString(record.name);
  if (!id) {
    return null;
  }

  const label = readString(record.name) || readString(record.label);
  const currentValue = readString(payload.currentValue)
    || readString(record.currentValue)
    || readString(record.value);

  return {
    id,
    ...(label ? { label } : {}),
    ...(currentValue ? { value: currentValue } : {}),
  };
}

function parseConfigOptions(value: unknown): AcpConfigOptionSnapshot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const normalized = normalizeConfigOption(entry);
    return normalized ? [normalized] : [];
  });
}

function summarizeAvailableCommandsUpdate(
  input: AgentInvokeInput,
  commands: Array<{ name: string }>,
): { text: string; count?: number } {
  const label = formatProviderLabel(input.providerName);
  const count = commands.length;
  if (count === 0) {
    return { text: `${label} cleared available commands.` };
  }

  return {
    text: `${label} updated available commands (${count} command${count === 1 ? '' : 's'}).`,
    count,
  };
}

function summarizeConfigOptionUpdate(
  input: AgentInvokeInput,
  options: AcpConfigOptionSnapshot[],
): {
  text: string;
  kind: 'session' | 'model_state';
  details: Record<string, unknown>;
} {
  const label = formatProviderLabel(input.providerName);
  const model = options.find((option) => option.id === 'model');
  if (model?.value) {
    return {
      text: `${label} model state updated to ${model.value}.`,
      kind: 'model_state',
      details: {
        configId: 'model',
        value: model.value,
      },
    };
  }

  const mode = options.find((option) => option.id === 'mode');
  if (mode?.value) {
    return {
      text: `${label} session mode updated to ${mode.value}.`,
      kind: 'session',
      details: {
        configId: 'mode',
        value: mode.value,
      },
    };
  }

  return {
    text: `${label} updated session configuration (${options.length} option${options.length === 1 ? '' : 's'}).`,
    kind: 'session',
    details: {
      optionCount: options.length,
    },
  };
}

function summarizeCurrentModeUpdate(
  input: AgentInvokeInput,
  modeId: string,
): string {
  return `${formatProviderLabel(input.providerName)} current mode updated to ${modeId}.`;
}

function summarizeUsageUpdate(
  input: AgentInvokeInput,
  usage: {
    used: number;
    size: number;
    costAmount?: number;
    costCurrency?: string;
  },
): string {
  const base = `${formatProviderLabel(input.providerName)} context window usage updated to ${usage.used}/${usage.size} tokens.`;
  if (usage.costAmount === undefined || !usage.costCurrency) {
    return base;
  }

  return `${base} Session cost is now ${usage.costAmount} ${usage.costCurrency}.`;
}

function buildToolMetadata(
  sourceEvent: string,
  toolCall: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const kind = readString(toolCall.kind);
  const meta = parseRecord(toolCall.meta);
  const details: Record<string, unknown> = {
    native: {
      sourceEvent,
      ...(kind ? { toolKind: kind } : {}),
    },
  };

  if (meta && Object.keys(meta).length > 0) {
    details.native = {
      ...(details.native as Record<string, unknown>),
      meta,
    };
  }

  return Object.keys(details).length > 0 ? details : undefined;
}

function parseSessionUpdateEvents(
  input: AgentInvokeInput,
  providerSessionId: string,
  notification: AcpJsonRpcNotification,
  observedTools: Map<string, AcpObservedToolCall>,
  adapterState: Record<string, unknown>,
): StreamEvent[] {
  const params = parseRecord(notification.params);
  const update = parseRecord(params?.update);
  if (!update) {
    return [];
  }

  const updateType = readString(update.sessionUpdate);
  if (!updateType) {
    return [];
  }

  const buildActiveState = () => buildProviderState(input, providerSessionId, 'active', adapterState);
  if (updateType === 'agent_message_chunk') {
    const text = readString(update.content)
      || readString(parseRecord(update.chunk)?.text)
      || readString(parseRecord(update.delta)?.text);
    return text
      ? [{
          type: 'text',
          providerSessionId,
          text,
        }]
      : [];
  }

  if (updateType === 'agent_thought_chunk') {
    const text = readString(update.content)
      || readString(parseRecord(update.chunk)?.text)
      || readString(parseRecord(update.delta)?.text);
    return text
      ? [buildProgressEvent(
          input,
          providerSessionId,
          text,
          'reasoning',
          'running',
          {
            sourceEvent: 'session/update:agent_thought_chunk',
            hasReasoningDelta: true,
          },
          buildActiveState(),
        )]
      : [];
  }

  if (updateType === 'plan') {
    const summary = summarizePlanUpdate(input, update);
    return [buildProgressEvent(
      input,
      providerSessionId,
      summary.text,
      'plan',
      'updated',
      {
        sourceEvent: 'session/update:plan',
        ...(summary.stepCount === undefined ? {} : { stepCount: summary.stepCount }),
      },
      buildActiveState(),
    )];
  }

  if (updateType === 'current_mode_update') {
    const currentModeUpdate = parseRecord(update.currentModeUpdate) || update;
    const modeId = readString(currentModeUpdate.modeId) || readString(currentModeUpdate.currentModeId);
    if (!modeId) {
      return [];
    }

    adapterState.currentModeId = modeId;
    return [buildProgressEvent(
      input,
      providerSessionId,
      summarizeCurrentModeUpdate(input, modeId),
      'session',
      'updated',
      {
        sourceEvent: 'session/update:current_mode_update',
        modeId,
      },
      buildActiveState(),
    )];
  }

  if (updateType === 'usage_update') {
    const usageUpdate = parseRecord(update.usageUpdate) || update;
    const used = readNumber(usageUpdate.used);
    const size = readNumber(usageUpdate.size);
    if (used === undefined || size === undefined) {
      return [];
    }

    const cost = parseRecord(usageUpdate.cost);
    const costAmount = readNumber(cost?.amount);
    const costCurrency = readString(cost?.currency);
    adapterState.contextWindowUsage = {
      used,
      size,
      ...(costAmount === undefined ? {} : { costAmount }),
      ...(costCurrency ? { costCurrency } : {}),
    };

    return [buildProgressEvent(
      input,
      providerSessionId,
      summarizeUsageUpdate(input, {
        used,
        size,
        ...(costAmount === undefined ? {} : { costAmount }),
        ...(costCurrency ? { costCurrency } : {}),
      }),
      'session',
      'updated',
      {
        sourceEvent: 'session/update:usage_update',
        used,
        size,
        ...(costAmount === undefined ? {} : { costAmount }),
        ...(costCurrency ? { costCurrency } : {}),
      },
      buildActiveState(),
    )];
  }

  if (updateType === 'session_info_update') {
    const sessionInfo = parseRecord(update.sessionInfoUpdate) || update;
    const title = readString(sessionInfo.title);
    if (!title) {
      return [];
    }

    adapterState.sessionTitle = title;
    return [buildProgressEvent(
      input,
      providerSessionId,
      `${formatProviderLabel(input.providerName)} session title updated to ${title}.`,
      'session',
      'updated',
      {
        sourceEvent: 'session/update:session_info_update',
        title,
      },
      buildActiveState(),
    )];
  }

  if (updateType === 'available_commands_update') {
    const availableCommandsUpdate = parseRecord(update.availableCommandsUpdate) || update;
    const commands = Array.isArray(availableCommandsUpdate.availableCommands)
      ? availableCommandsUpdate.availableCommands.flatMap((entry) => {
          const record = parseRecord(entry);
          const name = readString(record?.name);
          return name ? [{ name }] : [];
        })
      : [];
    adapterState.availableCommands = commands.map((command) => command.name);
    const summary = summarizeAvailableCommandsUpdate(input, commands);
    return [buildProgressEvent(
      input,
      providerSessionId,
      summary.text,
      'command',
      'updated',
      {
        sourceEvent: 'session/update:available_commands_update',
        ...(summary.count === undefined ? {} : { commandCount: summary.count }),
        commandNames: commands.map((command) => command.name),
      },
      buildActiveState(),
    )];
  }

  if (updateType === 'config_option_update') {
    const configOptionUpdate = parseRecord(update.configOptionUpdate) || update;
    const options = parseConfigOptions(configOptionUpdate.configOptions);
    if (options.length === 0) {
      return [];
    }

    adapterState.configOptions = options.map((option) => ({
      id: option.id,
      ...(option.label ? { label: option.label } : {}),
      ...(option.value ? { value: option.value } : {}),
    }));
    const summary = summarizeConfigOptionUpdate(input, options);
    return [buildProgressEvent(
      input,
      providerSessionId,
      summary.text,
      summary.kind,
      'updated',
      {
        sourceEvent: 'session/update:config_option_update',
        ...summary.details,
      },
      buildActiveState(),
    )];
  }

  if (updateType === 'tool_call') {
    const toolCall = parseRecord(update.toolCall) || update;
    const toolName = readString(toolCall.title)
      || readString(toolCall.kind)
      || readString(toolCall.name);
    const toolId = readString(toolCall.toolCallId) || readString(toolCall.id);
    const toolText = extractToolText(toolCall.content);
    const toolMetadata = buildToolMetadata('session/update:tool_call', toolCall);
    const rawInput = parseRecord(toolCall.rawInput) || parseRecord(toolCall.raw_input);
    if (toolId) {
      observedTools.set(toolId, {
        ...(toolName ? { name: toolName } : {}),
      });
    }
    return [{
      type: 'tool_use',
      providerSessionId,
      ...(toolText ? { text: toolText } : {}),
      ...(toolName ? { toolName } : {}),
      ...(toolId ? { toolId } : {}),
      ...(toolMetadata ? { metadata: toolMetadata } : {}),
      providerState: buildActiveState(),
      ...(rawInput ? { toolArgs: rawInput } : {}),
    }];
  }

  if (updateType === 'tool_call_update') {
    const toolCallUpdate = parseRecord(update.toolCallUpdate) || update;
    const toolId = readString(toolCallUpdate.toolCallId) || readString(toolCallUpdate.id);
    const observed = toolId ? observedTools.get(toolId) : undefined;
    const toolName = readString(toolCallUpdate.title)
      || readString(toolCallUpdate.kind)
      || readString(toolCallUpdate.name)
      || observed?.name;
    const fields = parseRecord(toolCallUpdate.fields);
    const status = readString(fields?.status) || readString(toolCallUpdate.status);
    const text = extractToolText(fields?.content ?? toolCallUpdate.content);
    const meta = parseRecord(toolCallUpdate.meta);
    const events: StreamEvent[] = [];
    const terminalOutput = parseRecord(meta?.terminal_output);
    const terminalExit = parseRecord(meta?.terminal_exit);

    if (terminalOutput) {
      const output = readString(terminalOutput.data);
      if (output) {
        events.push(buildProgressEvent(
          input,
          providerSessionId,
          output,
          'command',
          'running',
          {
            sourceEvent: 'session/update:tool_call_update:terminal_output',
            terminalId: readString(terminalOutput.terminal_id) || toolId,
          },
          buildActiveState(),
          {
            ...(toolId ? { toolId } : {}),
            ...(toolName ? { toolName } : {}),
          },
        ));
      }
    }

    if (terminalExit) {
      const exitCode = readNumber(terminalExit.exit_code);
      const signal = readString(terminalExit.signal);
      const summary = exitCode !== undefined
        ? `Command exited with code ${exitCode}.`
        : signal
          ? `Command exited with signal ${signal}.`
          : 'Command exited.';
      events.push(buildProgressEvent(
        input,
        providerSessionId,
        summary,
        'command',
        'updated',
          {
            sourceEvent: 'session/update:tool_call_update:terminal_exit',
            terminalId: readString(terminalExit.terminal_id) || toolId,
            ...(exitCode === undefined ? {} : { exitCode }),
            ...(signal ? { signal } : {}),
          },
          buildActiveState(),
          {
            ...(toolId ? { toolId } : {}),
            ...(toolName ? { toolName } : {}),
          },
      ));
    }

    if (status === 'completed' || status === 'failed') {
      events.push({
        type: 'tool_result',
        providerSessionId,
        ...(toolId ? { toolId } : {}),
        ...(toolName ? { toolName } : {}),
        ...(text ? { text } : {}),
        ...(status === 'failed' ? { isError: true } : {}),
        providerState: buildActiveState(),
        ...(meta && Object.keys(meta).length > 0
          ? {
              metadata: {
                native: {
                  sourceEvent: 'session/update:tool_call_update',
                  status,
                  meta,
                },
              },
            }
          : {}),
      });
    }

    return events;
  }

  return [];
}

export class AcpAdapter implements AgentAdapter {
  readonly kind = 'acp';

  constructor(private readonly options: AgentBackendOptions = {}) {}

  async probe(instance: RemoteProviderInstanceConfig): Promise<AgentAdapterProbeResult> {
    const checkedAt = new Date().toISOString();
    const command = instance.command?.trim();
    const profile = resolveAcpProviderProfile(instance);
    if (!command) {
      return {
        health: {
          status: 'degraded',
          checkedAt,
          details: 'ACP diagnostics probe currently supports stdio agent commands only.',
        },
        checks: [
          {
            code: 'acp_probe_transport_unsupported',
            status: 'degraded',
            message: 'ACP probe skipped because this target is not configured as a stdio command.',
            details: {
              transport: instance.transport || 'unknown',
            },
          },
        ],
      };
    }

    const env = sanitizeEnv(this.options.env || process.env);
    const args = buildAcpHelpProbeArgs(instance, profile);
    const runner = this.options.cliCommandRunner || runCliCommand;
    const result = await runner(command, args, {
      cwd: instance.cwd,
      timeoutMs: instance.startupTimeoutMs ?? DEFAULT_ACP_STDIN_PROBE_TIMEOUT_MS,
      env,
    });
    const commandSummary = [command, ...args].join(' ');
    const combinedOutput = `${result.stdout}\n${result.stderr}`.trim();
    const status = !result.timedOut && result.code === 0 ? 'ok' : 'unavailable';

    return {
      health: {
        status,
        checkedAt,
        details: status === 'ok'
          ? `ACP stdio help probe succeeded for '${commandSummary}'.`
          : `ACP stdio help probe failed for '${commandSummary}'.`,
      },
      liveProbe: {
        transport: 'stdio',
        command,
        args,
        ...(profile ? { profile: profile.id, profileLabel: profile.label } : {}),
        exitCode: result.code,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
        hasOutput: combinedOutput.length > 0,
      },
      checks: [
        {
          code: 'acp_help_probe_exit',
          status,
          message: status === 'ok'
            ? 'ACP stdio command accepted the help probe.'
            : 'ACP stdio command did not complete the help probe successfully.',
          details: {
            command: commandSummary,
            exitCode: result.code,
            timedOut: result.timedOut,
            durationMs: result.durationMs,
          },
        },
        {
          code: 'acp_target_profile',
          status: profile ? 'ok' : 'degraded',
          message: profile
            ? `Resolved ACP target profile '${profile.label}'.`
            : 'ACP target is using the generic stdio profile with no runtime-owned pilot hints.',
          details: profile
            ? {
                profile: profile.id,
                label: profile.label,
                family: profile.family,
              }
            : {
                provider: instance.providerName,
              },
        },
      ],
    };
  }

  async listModels(
    instance: RemoteProviderInstanceConfig,
  ): Promise<Array<{ id: string; label: string }>> {
    const command = instance.command?.trim();
    if (!command) {
      throw new Error('ACP model discovery currently supports stdio agent commands only.');
    }

    const cwd = resolveBootstrapCwd(instance.cwd, process.cwd());
    if (!cwd) {
      throw new Error('ACP model discovery requires a working directory.');
    }

    const env = sanitizeEnv(this.options.env || process.env);
    const client = new AcpStdioClient({
      command,
      args: instance.args,
      cwd,
      env,
      spawnProcess: this.options.acpProcessSpawner,
    });
    try {
      await client.request('initialize', buildInitializeParams(instance));
      const sessionResult = parseRecord(await client.request('session/new', {
        cwd,
        mcpServers: [],
      }));
      return parseModels(sessionResult?.models);
    } finally {
      await client.close();
    }
  }

  async *invoke(input: AgentInvokeInput): AsyncGenerator<StreamEvent> {
    if (!input.acpHost) {
      throw new Error(
        'ACP agent transport is configured but no runtime ACP host-capability bridge '
        + 'is attached. Continue with PLAN-032 Phase 2 before enabling turn execution.',
      );
    }

    const command = input.instance.command?.trim();
    if (!command) {
      throw new Error(
        'ACP turn execution currently supports stdio agent commands only. '
        + 'HTTP ACP targets remain a future follow-up.',
      );
    }

    const env = sanitizeEnv(this.options.env || process.env);
    const queue: Array<StreamEvent | Error | null> = [];
    let resolve: (() => void) | null = null;
    let providerSessionId = input.providerSessionId;
    let phase: AcpInvokePhase = 'bootstrap';
    const observedTools = new Map<string, AcpObservedToolCall>();
    const adapterStateSnapshot = {
      ...(parseRecord(input.sessionState?.agentSession?.adapterState) || {}),
    };
    const terminals = new Map<string, AcpManagedTerminal>();
    let nextTerminalCounter = 0;

    const push = (item: StreamEvent | Error | null) => {
      queue.push(item);
      if (resolve) {
        resolve();
        resolve = null;
      }
    };

    const client = new AcpStdioClient({
      command,
      args: input.instance.args,
      cwd: input.instance.cwd || input.acpHost.context.cwd,
      env,
      spawnProcess: this.options.acpProcessSpawner,
      onNotification: async (notification) => {
        if (phase !== 'prompt' || notification.method !== 'session/update' || !providerSessionId) {
          return;
        }

        for (const event of parseSessionUpdateEvents(
          input,
          providerSessionId,
          notification,
          observedTools,
          adapterStateSnapshot,
        )) {
          push(event);
        }
      },
      onServerRequest: async (request) => {
        if (request.method === 'fs/read_text_file' && input.acpHost) {
          return handleReadTextFileRequest(input.acpHost, request);
        }

        if (request.method === 'fs/write_text_file' && input.acpHost) {
          return handleWriteTextFileRequest(input.acpHost, request);
        }

        if (request.method === 'terminal/create' && input.acpHost) {
          return handleCreateTerminalRequest(
            input.acpHost,
            request,
            terminals,
            () => `acp-terminal-${++nextTerminalCounter}`,
          );
        }

        if (request.method === 'terminal/output') {
          return handleTerminalOutputRequest(terminals, request);
        }

        if (request.method === 'terminal/wait_for_exit') {
          return handleWaitForTerminalExitRequest(terminals, request);
        }

        if (request.method === 'terminal/kill') {
          return handleKillTerminalRequest(terminals, request);
        }

        if (request.method === 'terminal/release') {
          return handleReleaseTerminalRequest(terminals, request);
        }

        if (request.method === 'session/request_permission') {
          const decision = resolvePermissionDecision(
            request,
            input.acpHost?.context.permissionMode,
            input.acpHost?.context.allowedTools,
            input.signal.aborted,
          );
          if (providerSessionId) {
            push({
              ...createRuntimeProgressEvent({
                text: decision.progress.text,
                providerSessionId,
                provider: input.providerName,
                backend: 'agent',
                instance: input.instance.id,
                kind: 'guardrail',
                status: decision.progress.status,
                source: 'runtime',
                details: decision.progress.details,
              }),
              ...(decision.progress.toolId ? { toolId: decision.progress.toolId } : {}),
              ...(decision.progress.toolName ? { toolName: decision.progress.toolName } : {}),
              providerState: buildProviderState(
                input,
                providerSessionId,
                'active',
                adapterStateSnapshot,
              ),
            });
          }
          return decision.response;
        }

        throw new AcpJsonRpcClientError(
          `Unsupported ACP server request '${request.method}' in the current runtime slice.`,
          -32601,
        );
      },
    });

    const run = (async () => {
      const initializeResult = parseRecord(
        await client.request('initialize', buildInitializeParams(input.instance, {
          filesystem: true,
          terminal: true,
        })),
      );
      const protocolVersion = initializeResult?.protocolVersion;
      const agentCapabilities = parseRecord(initializeResult?.agentCapabilities);
      const loadSessionSupported = agentCapabilities?.loadSession === true;

      const bootstrapParams = buildSessionBootstrapParams(input);
      if (providerSessionId) {
        if (!loadSessionSupported) {
          throw new Error(
            `ACP target '${input.providerName}/${input.instance.id}' returned no load-session `
            + 'capability, so the runtime cannot restore provider-managed continuity yet.',
          );
        }

        await client.request('session/load', {
          sessionId: providerSessionId,
          ...bootstrapParams,
        });
      } else {
        const sessionResult = await client.request('session/new', bootstrapParams);
        providerSessionId = extractSessionIdFromBootstrapResult(sessionResult);
        if (!providerSessionId) {
          throw new Error('ACP session bootstrap returned no session id.');
        }
      }

      push({
        type: 'init',
        providerSessionId,
        providerState: buildProviderState(input, providerSessionId, 'active', {
          ...adapterStateSnapshot,
          protocolVersion,
          loadSessionSupported,
          sessionCwd: bootstrapParams.cwd,
          sessionMcpServers: bootstrapParams.mcpServers,
        }),
      });

      phase = 'prompt';
      const onAbort = () => {
        if (providerSessionId) {
          try {
            client.notify('session/cancel', { sessionId: providerSessionId });
          } catch {
            // best-effort only
          }
        }
      };
      input.signal.addEventListener('abort', onAbort, { once: true });
      try {
        const promptResult = parseRecord(
          await client.request('session/prompt', buildPromptParams(input, providerSessionId)),
        );
        const stopReason = readString(promptResult?.stopReason);
        push({
          type: 'result',
          providerSessionId,
          ...(stopReason ? { summary: `ACP stop reason: ${stopReason}` } : {}),
          providerState: buildProviderState(input, providerSessionId, 'idle', {
            ...adapterStateSnapshot,
            protocolVersion,
            loadSessionSupported,
            sessionCwd: bootstrapParams.cwd,
            sessionMcpServers: bootstrapParams.mcpServers,
            ...(stopReason ? { stopReason } : {}),
          }),
          metadata: {
            ...(stopReason ? { stopReason } : {}),
          },
        });
      } finally {
        input.signal.removeEventListener('abort', onAbort);
      }
    })();

    try {
      while (true) {
        if (queue.length === 0) {
          await Promise.race([
            run.then(() => undefined).catch((error) => {
              push(error instanceof Error ? error : new Error(String(error)));
            }),
            new Promise<void>((resolveQueue) => {
              resolve = resolveQueue;
            }),
          ]);
        }

        const item = queue.shift();
        if (item === undefined) {
          if (queue.length === 0) {
            await run;
            break;
          }
          continue;
        }
        if (item === null) {
          break;
        }
        if (item instanceof Error) {
          throw item;
        }
        yield item;
      }
      await run;
    } finally {
      await Promise.all(Array.from(terminals.values()).map(async (terminal) => {
        if (terminal.released) {
          return;
        }
        if (terminal.exitCode === null && terminal.signal === null) {
          terminal.process.kill('SIGTERM');
          await terminal.exitPromise;
        }
      }));
      await client.close();
    }
  }

  async cancel(
    _sessionId: string,
    instance: RemoteProviderInstanceConfig,
    state?: SessionProviderState,
  ): Promise<void> {
    const command = instance.command?.trim();
    const providerSessionId = state?.agentSession?.providerSessionId;
    const adapterState = parseRecord(state?.agentSession?.adapterState) || undefined;
    const sessionCwd = readString(adapterState?.sessionCwd) || instance.cwd;
    const sessionMcpServers = readSessionMcpServers(adapterState);
    if (!command || !providerSessionId || !sessionCwd) {
      return;
    }

    const env = sanitizeEnv(this.options.env || process.env);
    const client = new AcpStdioClient({
      command,
      args: instance.args,
      cwd: instance.cwd || sessionCwd,
      env,
      spawnProcess: this.options.acpProcessSpawner,
    });
    try {
      const initializeResult = parseRecord(
        await client.request('initialize', buildInitializeParams(instance)),
      );
      const agentCapabilities = parseRecord(initializeResult?.agentCapabilities);
      if (agentCapabilities?.loadSession !== true) {
        return;
      }

      await client.request('session/load', {
        sessionId: providerSessionId,
        cwd: sessionCwd,
        mcpServers: sessionMcpServers,
      });
      client.notify('session/cancel', {
        sessionId: providerSessionId,
      });
    } finally {
      await client.close();
    }
  }

  inspect(instance: RemoteProviderInstanceConfig): AgentAdapterInspection {
    return buildInspection(
      instance,
      this.options.env || process.env,
      Boolean(this.options.acpHostBridge),
    );
  }
}
