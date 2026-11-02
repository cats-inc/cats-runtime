import { record } from '../../../core/interactions/validation.js';
import type { InteractionAnswer, InteractionKind, InteractionPrompt } from '../../../core/interactions/types.js';
import { boundedInteractionText, interactionInputSummary } from './hostedInteractionSummary.js';

export const ACP_INTERACTION_KINDS: InteractionKind[] = ['command_approval', 'file_approval', 'tool_approval'];
export const GROK_INTERACTION_KINDS: InteractionKind[] = [...ACP_INTERACTION_KINDS, 'user_input'];

export function acpReply(id: string | number, result: Record<string, unknown>): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n';
}

/** Grok's typed ACP extension; question text is the native answer key, local field IDs are bounded. */
export function mapGrokInput(params: Record<string, unknown>, plan: boolean): ReturnType<typeof mapAcpPermission> {
  if (typeof params.toolCallId !== 'string' || !params.toolCallId || params.toolCallId.length > 256) throw new Error('Invalid Grok interaction.');
  if (plan) return { toolId: params.toolCallId,
    prompt: { kind: 'tool_approval', title: 'Approve implementation plan',
      message: typeof params.planContent === 'string' ? boundedInteractionText(params.planContent, 16_384) : 'The provider is ready to leave plan mode.',
      choices: [{ id: 'approve', label: 'Approve this plan' }] },
    result: answer => ({ outcome: answer.action === 'accept' ? 'approved' : 'cancelled' }) };
  if (!Array.isArray(params.questions) || !params.questions.length || params.questions.length > 4) throw new Error('Unsupported Grok questions.');
  const questions = params.questions.map((value, index) => {
    const question = record(value);
    if (!question || typeof question.question !== 'string' || question.question.length > 4096 || !Array.isArray(question.options)
      || question.options.length > 16) throw new Error('Unsupported Grok question.');
    const options = question.options.map(value => {
      const option = record(value);
      if (!option || typeof option.label !== 'string' || !option.label || option.label.length > 256) throw new Error('Unsupported Grok option.');
      return { id: option.label, label: option.label, ...(typeof option.description === 'string' ? { description: option.description.slice(0, 4096) } : {}) };
    });
    if (new Set(options.map(option => option.id)).size !== options.length) throw new Error('Duplicate Grok option.');
    return { key: question.question, field: { id: `question-${index}`, label: question.question,
      type: question.multiSelect === true ? 'strings' as const : 'string' as const, required: true,
      options, allowOther: question.multiSelect !== true, maxLength: 4096,
      ...(question.multiSelect === true ? { min: 1, max: options.length } : {}) } };
  });
  if (new Set(questions.map(question => question.key)).size !== questions.length) throw new Error('Duplicate Grok question.');
  return { toolId: params.toolCallId, prompt: { kind: 'user_input', title: 'Grok question', fields: questions.map(question => question.field) },
    result: answer => {
      if (answer.action !== 'accept') return { outcome: 'cancelled' };
      const annotations: Record<string, { notes: string }> = Object.create(null);
      const answers = Object.fromEntries(questions.map(({ key, field }) => {
        const value = answer.values?.[field.id];
        if (field.type === 'strings') {
          if (!Array.isArray(value) || !value.length || new Set(value).size !== value.length
            || value.some(entry => !field.options.some(option => option.id === entry))) throw new Error('Invalid Grok answer.');
          return [key, value];
        }
        if (typeof value !== 'string' || !value.trim() || value.length > 4096) throw new Error('Invalid Grok answer.');
        if (field.options.some(option => option.id === value)) return [key, [value]];
        annotations[key] = { notes: value }; return [key, ['Other']];
      }));
      return { outcome: 'accepted', answers, ...(Object.keys(annotations).length ? { annotations } : {}) };
    } };
}

/** ACP's allow_always can persist a global rule. Only a one-action grant is offered. */
export function mapAcpPermission(params: Record<string, unknown>, cwd: string): {
  prompt: InteractionPrompt;
  toolId: string;
  result(answer: InteractionAnswer): Record<string, unknown>;
} {
  const tool = record(params.toolCall);
  if (!tool || typeof tool.toolCallId !== 'string' || !tool.toolCallId || tool.toolCallId.length > 256
    || !Array.isArray(params.options) || params.options.length > 32) throw new Error('Unsupported ACP permission request.');
  const offered = params.options.map(record).filter(option => option && typeof option.optionId === 'string'
    && option.optionId.length > 0 && option.optionId.length <= 256 && typeof option.name === 'string');
  if (offered.length !== params.options.length || new Set(offered.map(option => option!.optionId)).size !== offered.length) {
    throw new Error('Invalid ACP permission options.');
  }
  const allow = offered.filter(option => option!.kind === 'allow_once');
  const deny = offered.find(option => option!.kind === 'reject_once');
  const input = record(tool.rawInput);
  const command = typeof input?.command === 'string' ? boundedInteractionText(input.command) : undefined;
  const title = typeof tool.title === 'string' ? tool.title.slice(0, 4096) : 'Provider tool approval';
  const paths = Array.isArray(tool.locations) ? tool.locations.slice(0, 20).map(record)
    .flatMap(location => typeof location?.path === 'string' ? [location.path.slice(0, 1024)] : []) : [];
  return {
    toolId: tool.toolCallId,
    prompt: { kind: tool.kind === 'execute' ? 'command_approval' : tool.kind === 'edit' ? 'file_approval' : 'tool_approval',
      title, cwd, ...(command ? { command } : {}),
      message: [paths.length ? `Paths:\n${paths.join('\n')}` : '',
        tool.rawInput !== undefined ? `Input:\n${interactionInputSummary(tool.rawInput)}` : '',
        'Scope: this action only'].filter(Boolean).join('\n'),
      choices: allow.map(option => ({ id: String(option!.optionId), label: String(option!.name).slice(0, 256) })) },
    result: answer => {
      if (answer.action === 'cancel') return { outcome: { outcome: 'cancelled' } };
      const option = answer.action === 'accept'
        ? allow.find(option => option!.optionId === (answer.choice ?? allow[0]?.optionId)) : deny;
      if (!option) {
        if (answer.action === 'accept') throw new Error('ACP did not offer that one-action permission.');
        return { outcome: { outcome: 'cancelled' } };
      }
      return { outcome: { outcome: 'selected', optionId: option.optionId } };
    },
  };
}
