import type { ReportedModel, RuntimeRunStatus, SessionInfo } from '../types.js';
import { describeReportedModels } from './reportedModels.js';

/**
 * One line per run in the runtime's own output, which the desktop host keeps as
 * `cats-runtime.log`. Without it that log showed only `POST /messages 200` for
 * every turn: not which model a session ran, and not that it failed or why, so
 * a model switch between turns and a provider error were both invisible.
 *
 * Message content is never logged; the error text is the provider's own, as the
 * client already receives it.
 */

const MAX_ERROR_LENGTH = 600;

export type RuntimeRunLogOutcome = 'started' | Exclude<RuntimeRunStatus, 'running'>;

export function describeRunTarget(
  session: Pick<SessionInfo, 'providerName' | 'providerBackend' | 'providerInstanceId' | 'model'>,
): string {
  const instance = [session.providerBackend, session.providerInstanceId].filter(Boolean).join('/');
  return [
    `provider=${session.providerName}${instance ? ` instance=${instance}` : ''}`,
    `model=${session.model?.trim() || '(provider default)'}`,
  ].join(' ');
}

export function formatRunLogLine(input: {
  outcome: RuntimeRunLogOutcome;
  sessionId: string;
  runId: string;
  target: string;
  durationMs?: number;
  error?: string;
  /** Given for a finished run; `model=` alone is only what was requested. */
  reportedModels?: readonly ReportedModel[] | null;
}): string {
  const parts = [
    `[run] ${input.outcome}`,
    `session=${input.sessionId}`,
    `run=${input.runId}`,
    input.target,
  ];
  if (input.reportedModels !== undefined) {
    parts.push(`reported=${describeReportedModels(input.reportedModels ?? undefined)}`);
  }
  if (input.durationMs !== undefined) {
    parts.push(`duration=${(input.durationMs / 1000).toFixed(1)}s`);
  }
  if (input.error) {
    parts.push(`error=${summarizeError(input.error)}`);
  }
  return parts.join(' ');
}

/** One line, bounded: provider errors can carry multi-line stacks or whole response bodies. */
function summarizeError(error: string): string {
  const oneLine = error.replace(/\s+/gu, ' ').trim();
  return oneLine.length > MAX_ERROR_LENGTH
    ? `${oneLine.slice(0, MAX_ERROR_LENGTH)}... (${oneLine.length} chars)`
    : oneLine;
}
