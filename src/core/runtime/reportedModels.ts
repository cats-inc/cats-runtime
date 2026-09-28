import type { ReportedModel } from '../types.js';

/**
 * Adds a turn's newly reported models to those already seen, once per name. A
 * name that any report marks as not the requested model stays marked.
 */
export function mergeReportedModels(
  current: ReportedModel[] | undefined,
  reported: readonly ReportedModel[],
): ReportedModel[] {
  const merged = (current ?? []).map((entry) => ({ ...entry }));
  for (const entry of reported) {
    const model = entry.model.trim();
    if (!model) continue;
    const existing = merged.find((candidate) => candidate.model === model);
    if (!existing) {
      merged.push({
        model,
        ...(entry.matchesRequest !== undefined ? { matchesRequest: entry.matchesRequest } : {}),
      });
    } else if (entry.matchesRequest === false) {
      existing.matchesRequest = false;
    } else if (entry.matchesRequest === true && existing.matchesRequest === undefined) {
      existing.matchesRequest = true;
    }
  }
  return merged;
}

export function hasReportedModelMismatch(reported: readonly ReportedModel[] | undefined): boolean {
  return Boolean(reported?.some((entry) => entry.matchesRequest === false));
}

/**
 * The `reported=` value of a run log line. `(none)` says the provider did not
 * report a model, so `model=` shows only what was requested.
 */
export function describeReportedModels(reported: readonly ReportedModel[] | undefined): string {
  if (!reported?.length) return '(none)';
  return reported
    .map((entry) => (entry.matchesRequest === false ? `${entry.model}(differs)` : entry.model))
    .join(',');
}
