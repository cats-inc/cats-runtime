import { describe, expect, it } from 'vitest';
import type { SessionInfo } from '../types.js';
import { RuntimeMeteringService } from './RuntimeMeteringService.js';

function createSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  const now = new Date().toISOString();
  return {
    id: 'session-1',
    providerName: 'claude',
    providerBackend: 'api',
    providerInstanceId: 'main',
    status: 'ready',
    origin: 'runtime',
    cwd: '/workspace/repo',
    messageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('RuntimeMeteringService', () => {
  it('records result usage and aggregates it into diagnostics snapshots', () => {
    const service = new RuntimeMeteringService();
    const session = createSession({
      providerName: 'junie',
      providerBackend: 'cli',
      providerInstanceId: 'default',
    });

    const observed = service.observeEvent(session, {
      type: 'result',
      usage: {
        inputTokens: 12,
        outputTokens: 8,
      },
      metadata: {
        runtimeUsage: {
          estimatedCost: 0.015,
          currency: 'USD',
          sourceConfidence: 'aggregated',
        },
      },
    }, {
      turnStartedAt: Date.now() - 150,
    });

    expect(observed).toEqual(expect.objectContaining({
      metadata: expect.objectContaining({
        runtimeUsage: expect.objectContaining({
          totalTokens: 20,
          estimatedCost: 0.015,
          currency: 'USD',
          sourceConfidence: 'aggregated',
          latencyMs: expect.any(Number),
        }),
      }),
    }));

    const snapshot = service.buildSnapshot([session]);
    expect(snapshot.summary).toEqual({
      status: 'ok',
      summary: 'No active metering incidents or guardrails.',
      usageRecords: 1,
      incidents: 0,
      activeGuardrails: 0,
      activeCooldowns: 0,
      activeBlocks: 0,
    });
    expect(snapshot.usage.totals).toEqual(expect.objectContaining({
      observationCount: 1,
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      estimatedCost: 0.015,
      currency: 'USD',
      confidenceCounts: {
        reported: 0,
        aggregated: 1,
        estimated: 0,
        unknown: 0,
      },
    }));
    expect(snapshot.usage.byProviderInstance).toEqual([
      expect.objectContaining({
        provider: 'junie',
        instance: 'default',
        backend: 'cli',
        observationCount: 1,
        totalTokens: 20,
      }),
    ]);
    expect(snapshot.usage.bySession).toEqual([
      expect.objectContaining({
        provider: 'junie',
        sessionId: 'session-1',
        observationCount: 1,
        totalTokens: 20,
      }),
    ]);
  });

  it('returns warning and block preflight outcomes for session token thresholds', () => {
    const service = new RuntimeMeteringService({
      sessionTotalTokensWarn: 10,
      sessionTotalTokensBlock: 20,
    });

    expect(service.evaluatePreflight(createSession({
      totalInputTokens: 6,
      totalOutputTokens: 5,
    }))).toEqual(expect.objectContaining({
      outcome: 'warned',
      scope: 'session',
      metric: 'total_tokens',
      action: 'warn',
      threshold: 10,
      currentValue: 11,
    }));

    expect(service.evaluatePreflight(createSession({
      id: 'session-2',
      totalInputTokens: 11,
      totalOutputTokens: 10,
    }))).toEqual(expect.objectContaining({
      outcome: 'blocked',
      scope: 'session',
      metric: 'total_tokens',
      action: 'block',
      threshold: 20,
      currentValue: 21,
    }));
  });

  it('records rate-limit incidents and activates provider-instance cooldowns', () => {
    const service = new RuntimeMeteringService({
      rateLimitCooldownMs: 5000,
    });
    const session = createSession();

    const observed = service.observeEvent(session, {
      type: 'error',
      text: '429 Too Many Requests. Retry after 2s.',
    }, {
      turnStartedAt: Date.now() - 20,
    });

    expect(observed).toEqual(expect.objectContaining({
      metadata: expect.objectContaining({
        incident: expect.objectContaining({
          classification: 'rate_limited',
          retryAfterMs: 2000,
        }),
        guardrail: expect.objectContaining({
          outcome: 'cooldown',
          scope: 'provider_instance',
          action: 'cooldown',
        }),
      }),
    }));

    expect(service.evaluatePreflight(session)).toEqual(expect.objectContaining({
      outcome: 'cooldown',
      provider: 'claude',
      instance: 'main',
      backend: 'api',
    }));

    const snapshot = service.buildSnapshot([session]);
    expect(snapshot.summary).toEqual(expect.objectContaining({
      status: 'degraded',
      incidents: 1,
      activeGuardrails: 1,
      activeCooldowns: 1,
    }));
    expect(snapshot.incidents.recent).toEqual([
      expect.objectContaining({
        classification: 'rate_limited',
      }),
    ]);
  });

  it('blocks provider instances when quota exhaustion is detected', () => {
    const service = new RuntimeMeteringService();
    const session = createSession({
      providerName: 'codex',
      providerInstanceId: 'payg',
    });

    const observed = service.observeEvent(session, {
      type: 'error',
      text: 'insufficient_quota: billing hard limit reached',
    }, {
      turnStartedAt: Date.now() - 10,
    });

    expect(observed).toEqual(expect.objectContaining({
      metadata: expect.objectContaining({
        incident: expect.objectContaining({
          classification: 'quota_exhausted',
        }),
        guardrail: expect.objectContaining({
          outcome: 'blocked',
          action: 'block',
        }),
      }),
    }));

    expect(service.evaluatePreflight(session)).toEqual(expect.objectContaining({
      outcome: 'blocked',
      scope: 'provider_instance',
      action: 'block',
      provider: 'codex',
      instance: 'payg',
    }));
  });
});
