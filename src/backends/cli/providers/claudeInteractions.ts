import { record } from '../../../core/interactions/validation.js';
import type {
  InteractionAnswer, InteractionField, InteractionKind, InteractionOption, InteractionPrompt,
} from '../../../core/interactions/types.js';
import type { ProviderControlCorrelation } from './types.js';
import { boundedText as text, mcpElicitationUrl, mcpFormFields } from './mcpElicitation.js';

/**
 * Claude Code stream-json host control (`--permission-prompt-tool stdio`). Observed on
 * Claude Code 2.1.312; see docs/research/2026-10-28-claude-host-control-protocol.md.
 * Claude Code has no counterpart to a permission grant.
 */
export const CLAUDE_INTERACTION_KINDS: InteractionKind[] = [
  'command_approval', 'file_approval', 'tool_approval', 'user_input', 'mcp_form', 'mcp_url',
];

/** Control replies carry the request's `request_id` inside `response`. */
export const CLAUDE_CONTROL: ProviderControlCorrelation = {
  requestId: frame => frame.type === 'control_request' && typeof frame.request_id === 'string'
    ? frame.request_id : undefined,
  reply: (frame) => {
    const response = record(frame.response);
    if (frame.type !== 'control_response' || typeof response?.request_id !== 'string') return undefined;
    return { id: response.request_id, result: record(response.response), failed: response.subtype !== 'success' };
  },
};

const COMMAND_TOOLS = new Set(['Bash', 'PowerShell']);
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const SUMMARY_LIMIT = 4096;

export type ClaudeControlFrame =
  | { type: 'request'; requestId: string; request: Record<string, unknown> }
  | { type: 'cancel'; requestId: string };

/** A CLI-initiated control frame, or undefined for every other stdout line. */
export function parseClaudeControlFrame(line: string): ClaudeControlFrame | undefined {
  if (!line.includes('"control_')) return undefined;
  let frame: Record<string, unknown> | undefined;
  try { frame = record(JSON.parse(line)); } catch { return undefined; }
  const requestId = frame?.request_id;
  if (typeof requestId !== 'string' || !requestId || requestId.length > 256) return undefined;
  if (frame!.type === 'control_cancel_request') return { type: 'cancel', requestId };
  const request = record(frame!.request);
  return frame!.type === 'control_request' && request ? { type: 'request', requestId, request } : undefined;
}

export function claudeControlResponse(requestId: string, response: Record<string, unknown>): string {
  return JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } }) + '\n';
}

export function claudeControlError(requestId: string, error: string): string {
  return JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: requestId, error } }) + '\n';
}

export interface ClaudeInteraction {
  prompt: InteractionPrompt;
  /** Approvals authorize an action; questions and forms only supply data. */
  approval: boolean;
  response(answer: InteractionAnswer): Record<string, unknown>;
}

function unsupported(): never { throw new Error('Unsupported Claude interaction shape.'); }

/** The kind a request would map to, so an unsupported one can still be reported. */
export function claudeInteractionKind(request: Record<string, unknown>): InteractionKind {
  if (request.subtype === 'elicitation') return request.mode === 'url' ? 'mcp_url' : 'mcp_form';
  const tool = request.tool_name;
  return tool === 'AskUserQuestion' ? 'user_input' : typeof tool === 'string' && COMMAND_TOOLS.has(tool)
    ? 'command_approval' : typeof tool === 'string' && FILE_TOOLS.has(tool) ? 'file_approval' : 'tool_approval';
}

/** Non-grant answer when no host can answer: deny a tool, decline an elicitation. */
export function claudeFallback(request: Record<string, unknown>): Record<string, unknown> {
  return request.subtype === 'elicitation' ? { action: 'decline' }
    : { behavior: 'deny', message: 'No one was available to answer this request, so it was denied.' };
}

function summary(input: Record<string, unknown>): string {
  const json = JSON.stringify(input, null, 2) ?? '{}';
  return json.length <= SUMMARY_LIMIT ? json
    : `${json.slice(0, SUMMARY_LIMIT)}\n… (${json.length - SUMMARY_LIMIT} more characters not shown)`;
}

/** `addRules` suggestions apply to this session only; never to a settings file. */
function sessionRules(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const suggestion = record(entry);
    if (suggestion?.type !== 'addRules' || suggestion.behavior !== 'allow' || !Array.isArray(suggestion.rules)
      || !suggestion.rules.length || suggestion.rules.length > 16) return [];
    const rules = suggestion.rules.map(record);
    if (rules.some(rule => !rule || typeof rule.toolName !== 'string' || rule.toolName.length > 256
      || rule.ruleContent !== undefined && (typeof rule.ruleContent !== 'string' || rule.ruleContent.length > 1024)
      || Object.keys(rule).some(key => !['toolName', 'ruleContent'].includes(key)))) return [];
    return [{ type: 'addRules', rules: rules.map(rule => structuredClone(rule)), behavior: 'allow', destination: 'session' }];
  });
}

function denial(answer: InteractionAnswer): Record<string, unknown> {
  return answer.action === 'cancel'
    ? { behavior: 'deny', message: 'The owner cancelled this request.', interrupt: true }
    : { behavior: 'deny', message: 'The owner declined this request.' };
}

function questionFields(input: Record<string, unknown>): { fields: InteractionField[]; questions: string[] } {
  if (!Array.isArray(input.questions) || !input.questions.length || input.questions.length > 4) return unsupported();
  const questions: string[] = [];
  const fields = input.questions.map((value, index) => {
    const question = record(value);
    if (!question || typeof question.question !== 'string' || !question.question) return unsupported();
    questions.push(text(question.question));
    let options: InteractionOption[] | undefined;
    if (question.options !== undefined) {
      if (!Array.isArray(question.options) || question.options.length > 16) return unsupported();
      options = question.options.map((entry) => {
        const option = record(entry);
        if (!option || typeof option.label !== 'string' || !option.label) return unsupported();
        return { id: text(option.label), label: text(option.label),
          ...(typeof option.description === 'string' ? { description: text(option.description) } : {}) };
      });
    }
    const multiple = question.multiSelect === true;
    // The CLI also accepts a free-text answer, so options are suggestions.
    return { id: `q${index}`, label: text(question.header, `Question ${index + 1}`), description: questions[index],
      type: multiple ? 'strings' as const : 'string' as const, required: true, ...(multiple ? {} : { minLength: 1 }),
      allowOther: true, ...(options?.length ? { options } : {}) };
  });
  if (new Set(questions).size !== questions.length) return unsupported();
  return { fields, questions };
}

function toolApproval(request: Record<string, unknown>, cwd: string): ClaudeInteraction {
  const tool = text(request.tool_name);
  if (!tool || tool.length > 256) return unsupported();
  const input = record(request.input) ?? {};
  const label = text(request.display_name, tool) || tool;
  const description = typeof request.description === 'string' ? text(request.description) : '';
  const rules = sessionRules(request.permission_suggestions);
  const choices = [{ id: 'accept', label: 'Allow once' },
    ...(rules.length ? [{ id: 'acceptForSession', label: 'Allow for this session' }] : [])];
  const response = (answer: InteractionAnswer) => answer.action !== 'accept' ? denial(answer)
    : { behavior: 'allow', updatedInput: input, ...(answer.choice === 'acceptForSession' ? { updatedPermissions: rules } : {}) };
  if (COMMAND_TOOLS.has(tool)) {
    if (typeof input.command !== 'string' || !input.command) return unsupported();
    return { approval: true, response, prompt: { kind: 'command_approval', title: 'Command approval',
      ...(typeof input.description === 'string' && input.description ? { message: text(input.description) } : {}),
      command: text(input.command), cwd, choices } };
  }
  if (FILE_TOOLS.has(tool)) {
    const path = input.file_path ?? input.notebook_path;
    if (typeof path !== 'string' || !path) return unsupported();
    // The owner sees which file and how much; the proposed contents stay out of receipts.
    const size = typeof input.content === 'string' ? ` (${input.content.length} characters)`
      : Array.isArray(input.edits) ? ` (${input.edits.length} edits)` : '';
    return { approval: true, response, prompt: { kind: 'file_approval', title: 'File change approval',
      message: `${label} ${text(path)}${size}`, cwd, choices } };
  }
  const server = record(request.mcp_server)?.name;
  return { approval: true, response, prompt: { kind: 'tool_approval', title: 'Tool approval',
    message: description ? `${label}: ${description}` : label,
    ...(typeof server === 'string' && server ? { server: text(server) } : {}),
    command: summary(input), cwd, choices } };
}

/** Map a CLI `can_use_tool` or `elicitation` request; throws for unsupported shapes. */
export function mapClaudeInteraction(request: Record<string, unknown>, cwd: string): ClaudeInteraction {
  if (request.subtype === 'elicitation') {
    const common = { title: 'MCP input request', message: text(request.message), server: text(request.mcp_server_name) };
    if (request.mode === 'url') {
      return { approval: false, prompt: { ...common, kind: 'mcp_url', url: mcpElicitationUrl(request.url) },
        response: answer => ({ action: answer.action }) };
    }
    if (request.mode !== undefined && request.mode !== 'form') return unsupported();
    let fields = mcpFormFields(request.requested_schema);
    const order = request.property_order;
    if (Array.isArray(order) && order.length === fields.length && order.every(id => fields.some(field => field.id === id))) {
      fields = order.map(id => fields.find(field => field.id === id)!);
    }
    return { approval: false, prompt: { ...common, kind: 'mcp_form', fields },
      response: answer => answer.action === 'accept' ? { action: 'accept', content: answer.values ?? {} } : { action: answer.action } };
  }
  if (request.subtype !== 'can_use_tool') return unsupported();
  if (request.tool_name !== 'AskUserQuestion') return toolApproval(request, cwd);
  const input = record(request.input) ?? {};
  const { fields, questions } = questionFields(input);
  return { approval: false, prompt: { kind: 'user_input', title: 'Your input is needed', fields },
    response: answer => answer.action !== 'accept' ? denial(answer) : { behavior: 'allow', updatedInput: {
      ...input, answers: Object.fromEntries(fields.map((field, index) => {
        const value = answer.values?.[field.id];
        return [questions[index], Array.isArray(value) ? value.join(', ') : String(value ?? '')];
      })),
    } } };
}
