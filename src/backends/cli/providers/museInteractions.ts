import { record } from '../../../core/interactions/validation.js';
import type { InteractionAnswer, InteractionKind, InteractionPrompt } from '../../../core/interactions/types.js';
import { boundedInteractionText, interactionInputSummary } from './hostedInteractionSummary.js';

/** Stable MSP schema exported from Muse 1.4.14-R7309.1; not an exact-version gate. */
export const MUSE_INTERACTION_KINDS: InteractionKind[] = [
  'command_approval', 'file_approval', 'tool_approval', 'user_input',
];

export interface MuseInteraction {
  prompt: InteractionPrompt;
  method: 'approval/decide' | 'userInput/answer';
  params(answer: InteractionAnswer): Record<string, unknown>;
  fallback: { method: 'approval/decide' | 'userInput/cancel'; params: Record<string, unknown> };
}

function invalid(): never { throw new Error('Unsupported Muse interaction shape.'); }
function id(value: unknown): string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : invalid();
}
function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? boundedInteractionText(value) : fallback;
}

/** Each closure retains the immutable native requirement, never a later mutable stage. */
export function mapMuseApproval(input: Record<string, unknown>, cwd: string): MuseInteraction {
  const sessionId = id(input.sessionId);
  const approvalId = id(input.approvalId);
  const requirement = record(input.currentRequirementId);
  if (!requirement || requirement.approvalId !== approvalId || !Number.isSafeInteger(requirement.sourceIndex)
    || (requirement.sourceIndex as number) < 0) return invalid();
  const requirementId = { approvalId, sourceIndex: requirement.sourceIndex };
  const subject = record(input.subject);
  if (!subject || typeof subject.kind !== 'string' || !Array.isArray(input.availableChoices)
    || input.availableChoices.length > 32) return invalid();
  const choices = input.availableChoices.map(entry => {
    const choice = record(entry);
    if (!choice) return invalid();
    return { id: id(choice.choiceId), label: text(choice.label), decision: choice.decision, scope: choice.scope };
  });
  if (new Set(choices.map(choice => choice.id)).size !== choices.length) return invalid();
  // Durable policy amendments belong to the provider's settings UI, not this one-action host.
  const allowed = choices.filter(choice => choice.decision === 'approved' && choice.scope === 'once'
    || choice.decision === 'approvedForSession' && choice.scope === 'session');
  const denied = choices.find(choice => choice.decision === 'denied' && choice.scope === 'once')
    ?? choices.find(choice => choice.decision === 'abort' && choice.scope === 'once');
  const cancelled = choices.find(choice => choice.decision === 'abort' && choice.scope === 'once') ?? denied;
  if (!denied || !cancelled || !allowed.length) return invalid();
  const base = { sessionId, approvalId, requirementId };
  const command = text(subject.command);
  const network = subject.kind === 'network'
    ? `${text(subject.protocol, 'network')}://${text(subject.host, '(unknown host)')}:${typeof subject.port === 'number' ? subject.port : 'all ports'}` : '';
  const kind = command ? 'command_approval' : typeof subject.path === 'string' ? 'file_approval' : 'tool_approval';
  const prompt: InteractionPrompt = { kind, title: command ? 'Command approval' : kind === 'file_approval'
    ? 'File access approval' : 'Tool approval', cwd: text(subject.workspaceRoot, cwd),
    message: [text(subject.kind), text(input.toolName, text(subject.toolName)), text(subject.access), text(subject.path), network, text(subject.target),
      text(input.reviewerReason), `Requirement ${String(requirement.sourceIndex)}`,
      input.rawArgs !== undefined ? `Input:\n${interactionInputSummary(input.rawArgs)}` : '',
      `Scopes: ${[...new Set(allowed.map(choice => choice.scope))].join(', ')}`].filter(Boolean).join('\n'),
    ...(command ? { command } : {}),
    choices: allowed.map(choice => ({ id: choice.id, label: choice.label || choice.id })),
  };
  return { prompt, method: 'approval/decide',
    params: answer => {
      const selected = answer.action === 'accept'
        ? allowed.find(choice => choice.id === (answer.choice ?? allowed[0]!.id))
        : answer.action === 'cancel' ? cancelled : denied;
      if (!selected) return invalid();
      return { ...base, choiceId: selected.id };
    },
    fallback: { method: 'approval/decide', params: { ...base, choiceId: denied.id } },
  };
}

export function mapMuseUserInput(input: Record<string, unknown>): MuseInteraction {
  const base = { sessionId: id(input.sessionId), userInputId: id(input.userInputId) };
  if (!Array.isArray(input.questions) || !input.questions.length || input.questions.length > 4) return invalid();
  const questions = input.questions.map(entry => {
    const question = record(entry);
    const selection = record(question?.selection);
    if (!question || !selection || !['single', 'multiple'].includes(String(selection.mode))
      || !Array.isArray(question.options) || question.options.length > 16) return invalid();
    const options = question.options.map(entry => {
      const option = record(entry);
      const label = id(option?.label);
      return { id: label, label };
    });
    if (new Set(options.map(option => option.id)).size !== options.length) return invalid();
    const min = selection.minSelections ?? 1;
    const max = selection.maxSelections ?? options.length;
    if (selection.mode === 'multiple' && (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || Number(min) < 0
      || Number(max) < Number(min) || Number(max) > options.length)) return invalid();
    return { id: id(question.id), label: text(question.header, 'Question'),
      description: text(question.question), type: selection.mode === 'multiple' ? 'strings' as const : 'string' as const,
      required: true, options, allowOther: selection.mode === 'single', maxLength: 500,
      ...(selection.mode === 'multiple' ? { min: Number(min), max: Number(max) } : {}) };
  });
  if (new Set(questions.map(question => question.id)).size !== questions.length) return invalid();
  return { prompt: { kind: 'user_input', title: 'Muse question', fields: questions }, method: 'userInput/answer',
    params: answer => {
      if (answer.action !== 'accept') return invalid();
      return { ...base, answers: questions.map(question => {
        const value = answer.values?.[question.id];
        if (question.type === 'strings') {
          if (!Array.isArray(value) || new Set(value).size !== value.length || value.length < question.min! || value.length > question.max!
            || value.some(entry => !question.options.some(option => option.id === entry))) return invalid();
          return { questionId: question.id, selectedLabels: value };
        }
        if (typeof value !== 'string' || !value.trim() || value.length > 500) return invalid();
        return { questionId: question.id,
          ...(question.options.some(option => option.id === value) ? { selectedLabel: value } : { freeText: value }) };
      }) };
    },
    fallback: { method: 'userInput/cancel', params: base },
  };
}
