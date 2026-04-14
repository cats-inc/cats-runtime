import type {
  AgentAdapter,
  AgentAdapterInspection,
  AgentAdapterProbeResult,
  AgentBackendOptions,
  AgentInvokeInput,
} from '../../types.js';
import type { PermissionMode, SessionProviderState, StreamEvent } from '../../../../core/types.js';
import type { RemoteProviderInstanceConfig } from '../../../cli/config.js';
import { runCliCommand } from '../../../../core/management/cli.js';
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

type AcpInvokePhase = 'bootstrap' | 'prompt';

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
    ? 'A runtime ACP host-capability bridge is configured; the current execution slice uses runtime permission-policy mediation while fuller filesystem and terminal client capabilities remain follow-up work.'
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

function buildInitializeParams() {
  return {
    protocolVersion: DEFAULT_ACP_PROTOCOL_VERSION,
    clientCapabilities: {
      fs: {
        readTextFile: false,
        writeTextFile: false,
      },
      terminal: false,
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
    mcpServers: [],
  };
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
): string | undefined {
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
    return readString(findByKind('allow_always', 'allow_once')?.optionId)
      || readString(records[0]?.optionId);
  }

  if (permissionMode === 'whitelist' && matchesPermissionRequestToAllowedTools(request, allowedTools)) {
    return readString(findByKind('allow_always', 'allow_once')?.optionId)
      || undefined;
  }

  return readString(findByKind('reject_once', 'reject_always')?.optionId)
    || undefined;
}

function buildPermissionResponse(
  request: AcpJsonRpcRequest,
  permissionMode: PermissionMode | undefined,
  allowedTools: string[] | undefined,
): Record<string, unknown> {
  const params = parseRecord(request.params);
  const selectedOptionId = selectPermissionOption(
    params?.options,
    permissionMode,
    allowedTools,
    request,
  );
  if (selectedOptionId) {
    return {
      outcome: {
        outcome: 'selected',
        optionId: selectedOptionId,
      },
    };
  }

  return {
    outcome: {
      outcome: 'cancelled',
    },
  };
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

function parseSessionUpdateEvents(
  input: AgentInvokeInput,
  providerSessionId: string,
  notification: AcpJsonRpcNotification,
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

  const providerState = buildProviderState(input, providerSessionId, 'active');
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

  if (updateType === 'tool_call') {
    const toolCall = parseRecord(update.toolCall) || update;
    const toolName = readString(toolCall.title)
      || readString(toolCall.kind)
      || readString(toolCall.name);
    const toolId = readString(toolCall.toolCallId) || readString(toolCall.id);
    return [{
      type: 'tool_use',
      providerSessionId,
      ...(toolName ? { toolName } : {}),
      ...(toolId ? { toolId } : {}),
      providerState,
    }];
  }

  if (updateType === 'tool_call_update') {
    const toolCallUpdate = parseRecord(update.toolCallUpdate) || update;
    const toolId = readString(toolCallUpdate.toolCallId) || readString(toolCallUpdate.id);
    const fields = parseRecord(toolCallUpdate.fields);
    const status = readString(fields?.status) || readString(toolCallUpdate.status);
    const text = extractToolText(fields?.content ?? toolCallUpdate.content);
    if (status === 'completed' || status === 'failed') {
      return [{
        type: 'tool_result',
        providerSessionId,
        ...(toolId ? { toolId } : {}),
        ...(text ? { text } : {}),
        ...(status === 'failed' ? { isError: true } : {}),
        providerState,
      }];
    }
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
      await client.request('initialize', buildInitializeParams());
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

        for (const event of parseSessionUpdateEvents(input, providerSessionId, notification)) {
          push(event);
        }
      },
      onServerRequest: async (request) => {
        if (request.method === 'session/request_permission') {
          return buildPermissionResponse(
            request,
            input.acpHost?.context.permissionMode,
            input.acpHost?.context.allowedTools,
          );
        }

        throw new AcpJsonRpcClientError(
          `Unsupported ACP server request '${request.method}' in the current runtime slice.`,
          -32601,
        );
      },
    });

    const run = (async () => {
      const initializeResult = parseRecord(await client.request('initialize', buildInitializeParams()));
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
          protocolVersion,
          loadSessionSupported,
          sessionCwd: bootstrapParams.cwd,
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
            protocolVersion,
            loadSessionSupported,
            sessionCwd: bootstrapParams.cwd,
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
    const adapterState = parseRecord(state?.agentSession?.adapterState);
    const sessionCwd = readString(adapterState?.sessionCwd) || instance.cwd;
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
      const initializeResult = parseRecord(await client.request('initialize', buildInitializeParams()));
      const agentCapabilities = parseRecord(initializeResult?.agentCapabilities);
      if (agentCapabilities?.loadSession !== true) {
        return;
      }

      await client.request('session/load', {
        sessionId: providerSessionId,
        cwd: sessionCwd,
        mcpServers: [],
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
