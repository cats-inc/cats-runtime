import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ProviderTargetDescriptor } from '../providerCatalog.js';
import type {
  AgentDiagnosticSessionActivitySummary,
  AgentDiagnosticSessionEvidenceSummary,
} from '../runtime/agentDiagnosticsEvidence.js';

interface RetainedAgentTargetEvidenceRecord {
  provider: string;
  backend: 'agent';
  instance: string;
  target: string;
  updatedAt: string;
  activity?: AgentDiagnosticSessionActivitySummary;
  evidence?: AgentDiagnosticSessionEvidenceSummary;
}

export class AgentTargetEvidenceService {
  private readonly records = new Map<string, RetainedAgentTargetEvidenceRecord>();

  constructor(private readonly storageFile?: string) {
    this.load();
  }

  record(
    target: ProviderTargetDescriptor,
    input: {
      activity?: AgentDiagnosticSessionActivitySummary;
      evidence?: AgentDiagnosticSessionEvidenceSummary;
    },
  ): void {
    if (target.backend !== 'agent') {
      return;
    }

    const retainedAt = new Date().toISOString();
    const activity = input.activity
      ? cloneActivity({ ...input.activity, retainedAt }, retainedAt)
      : undefined;
    const evidence = input.evidence
      ? cloneEvidence({ ...input.evidence, retainedAt }, retainedAt)
      : undefined;
    if (!activity && !evidence) {
      return;
    }

    const key = targetKey(target);
    this.records.set(key, {
      provider: target.providerName,
      backend: 'agent',
      instance: target.instanceId,
      target: `${target.backend}/${target.instanceId}`,
      updatedAt: retainedAt,
      ...(activity ? { activity } : {}),
      ...(evidence ? { evidence } : {}),
    });
    this.save();
  }

  get(
    target: ProviderTargetDescriptor,
  ): {
    activity?: AgentDiagnosticSessionActivitySummary;
    evidence?: AgentDiagnosticSessionEvidenceSummary;
  } | undefined {
    const stored = this.records.get(targetKey(target));
    if (!stored) {
      return undefined;
    }

    return {
      ...(stored.activity ? { activity: cloneActivity(stored.activity) } : {}),
      ...(stored.evidence ? { evidence: cloneEvidence(stored.evidence) } : {}),
    };
  }

  private load(): void {
    if (!this.storageFile) {
      return;
    }

    try {
      const raw = readFileSync(this.storageFile, 'utf8');
      const parsed = JSON.parse(raw) as RetainedAgentTargetEvidenceRecord[];
      for (const record of parsed) {
        if (
          typeof record?.provider !== 'string'
          || record.backend !== 'agent'
          || typeof record.instance !== 'string'
        ) {
          continue;
        }

        const key = `${record.provider}/agent/${record.instance}`;
        this.records.set(key, {
          provider: record.provider,
          backend: 'agent',
          instance: record.instance,
          target: record.target,
          updatedAt: record.updatedAt,
          ...(record.activity ? { activity: cloneActivity(record.activity, record.updatedAt) } : {}),
          ...(record.evidence ? { evidence: cloneEvidence(record.evidence, record.updatedAt) } : {}),
        });
      }
    } catch {
      // Best-effort retained evidence store; corrupt or missing files start fresh.
    }
  }

  private save(): void {
    if (!this.storageFile) {
      return;
    }

    mkdirSync(dirname(this.storageFile), { recursive: true });
    const payload = Array.from(this.records.values()).sort((left, right) =>
      left.target.localeCompare(right.target),
    );
    writeFileSync(this.storageFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }
}

function targetKey(target: ProviderTargetDescriptor): string {
  return `${target.providerName}/${target.backend}/${target.instanceId}`;
}

function cloneActivity(
  value: AgentDiagnosticSessionActivitySummary,
  fallbackRetainedAt?: string,
): AgentDiagnosticSessionActivitySummary {
  return {
    source: value.source,
    sessionId: value.sessionId,
    ...(value.sessionKey ? { sessionKey: value.sessionKey } : {}),
    ...(value.providerSessionId ? { providerSessionId: value.providerSessionId } : {}),
    ...(value.status ? { status: value.status } : {}),
    ...(value.observedAt
      ? { observedAt: value.observedAt }
      : (fallbackRetainedAt ? { observedAt: fallbackRetainedAt } : {})),
    ...(value.retainedAt
      ? { retainedAt: value.retainedAt }
      : (fallbackRetainedAt ? { retainedAt: fallbackRetainedAt } : {})),
    ...(value.workspace
      ? {
          workspace: {
            cwd: value.workspace.cwd,
            ...(value.workspace.outputDir ? { outputDir: value.workspace.outputDir } : {}),
            ...(value.workspace.workspaceMode ? { workspaceMode: value.workspace.workspaceMode } : {}),
          },
        }
      : {}),
    activity: {
      toolUseCount: value.activity.toolUseCount,
      toolResultCount: value.activity.toolResultCount,
      serviceUpdateCount: value.activity.serviceUpdateCount,
      observedToolNames: [...value.activity.observedToolNames],
      observedServiceIds: [...value.activity.observedServiceIds],
    },
  };
}

function cloneEvidence(
  value: AgentDiagnosticSessionEvidenceSummary,
  fallbackRetainedAt?: string,
): AgentDiagnosticSessionEvidenceSummary {
  return {
    source: value.source,
    sessionId: value.sessionId,
    ...(value.sessionKey ? { sessionKey: value.sessionKey } : {}),
    ...(value.providerSessionId ? { providerSessionId: value.providerSessionId } : {}),
    ...(value.status ? { status: value.status } : {}),
    ...(value.observedAt
      ? { observedAt: value.observedAt }
      : (fallbackRetainedAt ? { observedAt: fallbackRetainedAt } : {})),
    ...(value.retainedAt
      ? { retainedAt: value.retainedAt }
      : (fallbackRetainedAt ? { retainedAt: fallbackRetainedAt } : {})),
    ...(value.workspace
      ? {
          workspace: {
            cwd: value.workspace.cwd,
            ...(value.workspace.outputDir ? { outputDir: value.workspace.outputDir } : {}),
            ...(value.workspace.workspaceMode ? { workspaceMode: value.workspace.workspaceMode } : {}),
          },
        }
      : {}),
    ...(value.latestRun
      ? {
          latestRun: {
            id: value.latestRun.id,
            status: value.latestRun.status,
            ...(value.latestRun.resultSummary
              ? { resultSummary: value.latestRun.resultSummary }
              : {}),
          },
        }
      : {}),
    counts: { ...value.counts },
    artifacts: value.artifacts.map((artifact) => ({ ...artifact })),
    services: value.services.map((service) => ({ ...service })),
    previewSurfaces: value.previewSurfaces.map((surface) => ({ ...surface })),
    browserSessions: value.browserSessions.map((browserSession) => ({
      ...browserSession,
      openPages: browserSession.openPages.map((page) => ({ ...page })),
    })),
  };
}
