import { record } from '../../../core/interactions/validation.js';
import type { InteractionAnswer, InteractionKind, InteractionOption, InteractionPrompt } from '../../../core/interactions/types.js';
import { boundedText as text, fieldId, mcpElicitationUrl, mcpFormFields } from './mcpElicitation.js';

/** Codex MCP tool approvals arrive as marked elicitations, not command approvals. */
export const CODEX_INTERACTION_KINDS: InteractionKind[] = [
  'command_approval', 'file_approval', 'tool_approval', 'permission_grant', 'user_input', 'mcp_form', 'mcp_url',
];

export const CODEX_INTERACTION_METHODS = new Set([
  'item/commandExecution/requestApproval', 'item/fileChange/requestApproval',
  'item/permissions/requestApproval', 'item/tool/requestUserInput', 'tool/requestUserInput',
  'mcpServer/elicitation/request',
]);

export interface CodexInteraction {
  prompt: InteractionPrompt;
  deadlineMs?: number;
  result(answer: InteractionAnswer): Record<string, unknown>;
}

function unsupported(): never { throw new Error('Unsupported Codex interaction shape.'); }

/** Preserve the kind even when the provider shape cannot be answered. */
export function codexInteractionKind(method: string, params: Record<string, unknown>): InteractionKind {
  if (method === 'item/commandExecution/requestApproval') return 'command_approval';
  if (method === 'item/fileChange/requestApproval') return 'file_approval';
  if (method === 'item/permissions/requestApproval') return 'permission_grant';
  if (method.includes('requestUserInput')) return 'user_input';
  if (record(params._meta)?.codex_approval_kind === 'mcp_tool_call') return 'tool_approval';
  return params.mode === 'url' ? 'mcp_url' : 'mcp_form';
}

export function mapCodexInteraction(method: string, params: Record<string, unknown>, toolApprovals = true): CodexInteraction {
  if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
    const command = method === 'item/commandExecution/requestApproval';
    const offered = params.availableDecisions ?? ['accept', 'acceptForSession', 'decline', 'cancel'];
    if (!Array.isArray(offered)) return unsupported();
    const choices = offered.filter(item => item === 'accept' || item === 'acceptForSession')
      .map(id => ({ id, label: id === 'accept' ? 'Allow once' : 'Allow for this session' }));
    if (!choices.length) return unsupported();
    return {
      prompt: { kind: command ? 'command_approval' : 'file_approval', title: command ? 'Command approval' : 'File change approval',
        message: text(params.reason), ...(command ? { command: text(params.command), cwd: text(params.cwd) }
          : { cwd: text(params.grantRoot) }), choices },
      result: answer => ({ decision: answer.action === 'accept' ? answer.choice : answer.action }),
    };
  }
  if (method === 'item/tool/requestUserInput' || method === 'tool/requestUserInput') {
    if (!Array.isArray(params.questions) || !params.questions.length || params.questions.length > 3) return unsupported();
    const fields = params.questions.map(value => {
      const question = record(value);
      if (!question || typeof question.id !== 'string' || typeof question.question !== 'string') return unsupported();
      let choices: InteractionOption[] | undefined;
      if (question.options !== undefined && question.options !== null) {
        if (!Array.isArray(question.options) || question.options.length > 64) return unsupported();
        choices = question.options.map(value => {
          const option = record(value);
          if (!option || typeof option.label !== 'string') return unsupported();
          return { id: text(option.label), label: text(option.label), description: text(option.description) };
        });
      }
      return { id: fieldId(question.id), label: text(question.header, question.id), description: text(question.question),
        type: 'string' as const, required: true, minLength: 1, secret: question.isSecret === true,
        allowOther: question.isOther === true || !choices?.length, ...(choices?.length ? { options: choices } : {}) };
    });
    if (new Set(fields.map(field => field.id)).size !== fields.length) return unsupported();
    return { prompt: { kind: 'user_input', title: 'Your input is needed', fields },
      ...(typeof params.autoResolutionMs === 'number' && Number.isFinite(params.autoResolutionMs)
        ? { deadlineMs: Date.now() + Math.max(0, params.autoResolutionMs) } : {}),
      result: answer => ({ answers: Object.fromEntries(fields.map(field => [field.id,
        { answers: [String(answer.values?.[field.id] ?? '')] }])) }),
    };
  }
  if (method === 'item/permissions/requestApproval') {
    const requested = record(params.permissions);
    if (!requested || Object.keys(requested).some(key => !['network', 'fileSystem'].includes(key))) return unsupported();
    const units: Array<{ id: string; label: string; key: 'network' | 'read' | 'write'; value: unknown }> = [];
    const network = record(requested.network);
    if (requested.network != null && (!network || Object.keys(network).some(key => key !== 'enabled')
      || network.enabled != null && typeof network.enabled !== 'boolean')) return unsupported();
    if (network?.enabled === true) units.push({ id: 'network', label: 'Network access', key: 'network', value: true });
    const fs = record(requested.fileSystem);
    if (requested.fileSystem != null && (!fs || Object.keys(fs).some(key => !['read', 'write', 'entries', 'globScanMaxDepth'].includes(key)))) return unsupported();
    // Structured filesystem entries need their own admission mapping; never broaden them to a path.
    if (fs?.entries !== undefined || fs?.globScanMaxDepth !== undefined) return unsupported();
    for (const key of ['read', 'write'] as const) {
      const paths = fs?.[key];
      if (paths !== undefined && paths !== null) {
        if (!Array.isArray(paths) || paths.length > 32) return unsupported();
        for (const [index, path] of paths.entries()) {
          if (typeof path !== 'string') return unsupported();
          units.push({ id: `${key}-${index}`, label: `${key}: ${text(path)}`, key, value: path });
        }
      }
    }
    if (!units.length || units.length > 64) return unsupported();
    return { prompt: { kind: 'permission_grant', title: 'Additional permissions', message: text(params.reason),
      cwd: text(params.cwd), permissions: units.map(({ id, label }) => ({ id, label })), scopes: ['turn', 'session'] },
      result: answer => {
        const selected = answer.action === 'accept' ? units.filter(unit => answer.grants?.includes(unit.id)) : [];
        const read = selected.filter(unit => unit.key === 'read').map(unit => unit.value);
        const write = selected.filter(unit => unit.key === 'write').map(unit => unit.value);
        return { permissions: {
          ...(selected.some(unit => unit.key === 'network') ? { network: { enabled: true } } : {}),
          ...(read.length || write.length ? { fileSystem: { read, write } } : {}),
        }, scope: answer.scope ?? 'turn' };
      },
    };
  }
  if (method === 'mcpServer/elicitation/request') {
    const server = text(params.serverName);
    const common = { title: 'MCP input request', message: text(params.message), server };
    if (toolApprovals && codexInteractionKind(method, params) === 'tool_approval') {
      // Native 0.165.0: accepting this empty form authorizes this call only. Never
      // turn a changed/nonempty schema into an implicit successful empty answer.
      if (params.mode !== 'form' || !server || !common.message || mcpFormFields(params.requestedSchema).length) return unsupported();
      const meta = record(params._meta)!;
      const input = record(meta.tool_params);
      const summary = input ? JSON.stringify(input, null, 2) : '';
      return { prompt: { ...common, title: 'Tool approval', kind: 'tool_approval',
        message: [common.message, summary.length > 4096 ? `${summary.slice(0, 4096)}\n… (input truncated)` : summary].filter(Boolean).join('\n\n'),
        choices: [{ id: 'accept', label: 'Allow once' }] },
      result: answer => ({ action: answer.action, content: answer.action === 'accept' ? {} : null, _meta: null }) };
    }
    if (params.mode === 'url') {
      return { prompt: { ...common, kind: 'mcp_url', url: mcpElicitationUrl(params.url) },
        result: answer => ({ action: answer.action, content: null, _meta: null }) };
    }
    if (!['form', 'openai/form', 'openaiForm'].includes(String(params.mode))) return unsupported();
    const fields = mcpFormFields(params.requestedSchema);
    return { prompt: { ...common, kind: 'mcp_form', fields }, result: answer => ({ action: answer.action,
      content: answer.action === 'accept' ? answer.values ?? {} : null, _meta: null }) };
  }
  return unsupported();
}

export function codexInteractionFallback(method: string, id: string | number): string {
  const result = method === 'mcpServer/elicitation/request' ? { action: 'decline', content: null, _meta: null }
    : method === 'item/permissions/requestApproval' ? { permissions: {}, scope: 'turn' }
      : method.includes('requestUserInput') ? undefined : { decision: 'decline' };
  return JSON.stringify({ jsonrpc: '2.0', id, ...(result ? { result }
    : { error: { code: -32000, message: 'User input was cancelled or unavailable.' } }) }) + '\n';
}
