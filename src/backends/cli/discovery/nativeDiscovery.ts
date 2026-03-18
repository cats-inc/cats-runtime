import type { SessionRegistry } from '../pool/SessionRegistry.js';

export interface NativeSessionSummary {
  providerSessionId: string;
  cwd: string;
  summary?: string;
  messageCount: number;
  lastActivity?: string;
  model?: string;
}

export function syncNativeSessions(
  registry: SessionRegistry,
  providerName: 'cursor' | 'goose' | 'kiro' | 'opencode',
  sessions: NativeSessionSummary[],
  providerInstanceId?: string,
): { newCount: number; syncedCount: number } {
  const known = new Set(
    registry.list({ provider: providerName })
      .filter((session) => (session.providerInstanceId || 'default') === (providerInstanceId || 'default'))
      .map((session) => session.providerSessionId)
      .filter((sessionId): sessionId is string => Boolean(sessionId)),
  );

  let newCount = 0;
  let syncedCount = 0;

  for (const session of sessions) {
    if (!known.has(session.providerSessionId)) {
      newCount++;
    }

    const tracked = registry.upsertDiscovered(session.providerSessionId, {
      providerName,
      providerInstanceId,
      cwd: session.cwd,
      summary: session.summary,
      messageCount: session.messageCount,
      lastActivity: session.lastActivity,
      model: session.model,
    });

    if (tracked) {
      syncedCount++;
    }
  }

  registry.pruneMissingDiscovered(
    providerName,
    sessions.map((session) => session.providerSessionId),
    'cli',
    providerInstanceId,
  );

  return { newCount, syncedCount };
}
