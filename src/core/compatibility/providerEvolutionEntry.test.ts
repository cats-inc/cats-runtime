import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentAdapter } from '../../backends/agent/types.js';
import { buildAgentAdapter } from '../../backends/agent/adapters/registry.js';
import {
  generateProviderEvolutionProbeArtifact,
  resolveProviderEvolutionEntryContext,
} from './providerEvolutionEntry.js';
import {
  formatProviderEvolutionProbeArtifactListSummary,
  formatProviderEvolutionProbeArtifactReadSummary,
} from './providerEvolutionEntry.js';

vi.mock('../../backends/agent/adapters/registry.js', () => ({
  buildAgentAdapter: vi.fn(),
}));

describe('provider evolution entry summaries', () => {
  beforeEach(() => {
    vi.mocked(buildAgentAdapter).mockReset();
  });

  it('renders a concise list summary for retained probe artifacts', () => {
    expect(formatProviderEvolutionProbeArtifactListSummary([
      {
        artifactId: 'artifact-1',
        provider: 'codex',
        instance: 'default',
        parserId: 'codex-json-rpc',
        probeProfile: 'manual_smoke',
        transport: 'cli',
        capturedAt: '2026-03-27T00:00:00.000Z',
        execution: {
          status: 'completed',
          durationMs: 1000,
          turnsPlanned: 2,
          turnsCompleted: 2,
        },
        capabilitySnapshot: {} as never,
        compare: {
          baselineArtifactId: 'baseline-1',
          baselineCapturedAt: '2026-03-26T00:00:00.000Z',
          addedEventTypeCount: 1,
          removedEventTypeCount: 0,
          frequencyDropCount: 0,
          schemaChangeCount: 0,
          semanticDriftSuspected: false,
        },
        review: {
          classifications: ['upgrade'],
          summary: 'Detected upgrade relative to the latest baseline.',
          highlights: ['Added event types: tool_result'],
        },
        relativePath: 'codex/artifact-1.json',
        artifactPath: 'C:/tmp/provider-evolution/codex/artifact-1.json',
      },
    ], {
      probeProvider: 'codex',
      probeInstance: 'default',
      probeParser: 'codex-json-rpc',
      probeTransport: 'cli',
    })).toBe([
      'Listed 1 provider-evolution artifact(s) for codex/default/parser=codex-json-rpc/transport=cli.',
      '- 2026-03-27T00:00:00.000Z codex/default manual_smoke [upgrade] Detected upgrade relative to the latest baseline.',
      '',
    ].join('\n'));
  });

  it('renders a concise read summary for a retained artifact', () => {
    expect(formatProviderEvolutionProbeArtifactReadSummary({
      relativePath: 'codex/artifact-1.json',
      artifactPath: 'C:/tmp/provider-evolution/codex/artifact-1.json',
      artifact: {
        schemaVersion: 1,
        id: 'artifact-1',
        provider: 'codex',
        instance: 'default',
        parserId: 'codex-json-rpc',
        probeProfile: 'manual_smoke',
        transport: 'cli',
        capturedAt: '2026-03-27T00:00:00.000Z',
        execution: {
          status: 'completed',
          durationMs: 1000,
          turnsPlanned: 2,
          turnsCompleted: 2,
        },
        capabilitySnapshot: {} as never,
        review: {
          classifications: ['baseline'],
          summary: 'Captured the first retained provider-evolution baseline.',
          highlights: ['No prior matching baseline artifact was found.'],
        },
        evidence: {} as never,
      },
    })).toBe([
      'Loaded provider-evolution artifact artifact-1: Captured the first retained provider-evolution baseline.',
      '- No prior matching baseline artifact was found.',
      'Artifact: C:/tmp/provider-evolution/codex/artifact-1.json',
      '',
    ].join('\n'));
  });

  it('generates a provider-evolution artifact for agent-backed targets through the shared probe entrypoint', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-provider-evolution-agent-'));
    const configPath = join(root, 'providers.yaml');
    writeFileSync(configPath, `
version: 1
routing:
  providers:
    claude:
      default_target:
        backend: agent
        instance: sdk
backends:
  agent:
    providers:
      claude:
        default_instance: sdk
        transport: agent_sdk_bridge
        base_url: http://agent-sdk.test
        instances:
          sdk:
            model: sonnet
`.trimStart(), 'utf8');

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      CATS_RUNTIME_CONFIG_PATH: configPath,
      CATS_RUNTIME_DATA_DIR: join(root, 'runtime-data'),
      CATS_RUNTIME_SESSION_BASE_DIR: join(root, 'runtime-sessions'),
      CATS_RUNTIME_HOST: '127.0.0.1',
      CATS_RUNTIME_PORT: '3110',
    };
    mkdirSync(env.CATS_RUNTIME_DATA_DIR, { recursive: true });
    mkdirSync(env.CATS_RUNTIME_SESSION_BASE_DIR, { recursive: true });

    let invokeCount = 0;
    const adapter: AgentAdapter = {
      kind: 'agent_sdk_bridge',
      inspect() {
        return {
          adapter: 'agent_sdk_bridge',
          family: 'bridge',
          summary: 'Agent SDK bridge test adapter',
          transport: {
            kind: 'http',
            protocol: 'agent_sdk_http_v1',
            liveProbe: 'providers_get',
            modelDiscovery: 'providers_get',
            toolDiscovery: 'none',
            streaming: 'sse',
          },
          request: {
            headerNames: [],
          },
          auth: {
            mechanisms: [],
            credentials: [],
          },
          continuity: {
            providerManagedSessions: true,
            sessionKey: true,
            providerSessionState: true,
            cancel: true,
          },
          capabilities: {
            probe: true,
            modelDiscovery: true,
            toolCatalog: false,
            cancel: true,
            runtimeServices: false,
            toolCallEvents: true,
          },
        };
      },
      async *invoke(input) {
        invokeCount += 1;
        input.evolutionObserver?.recordIgnored({
          rawEventType: 'session_created',
          reason: 'session_lifecycle',
          rawSample: { type: 'session_created' },
        });
        yield {
          type: 'init',
          providerSessionId: input.providerSessionId || 'bridge-session-1',
        };
        yield {
          type: 'text',
          providerSessionId: input.providerSessionId || 'bridge-session-1',
          text: `turn-${invokeCount}`,
        };
        if (invokeCount === 1) {
          yield {
            type: 'tool_use',
            providerSessionId: 'bridge-session-1',
            toolName: 'read_file',
            toolArgs: { path: 'probe-note.txt' },
          };
        }
        input.evolutionObserver?.recordUnknown({
          rawEventType: 'mystery.event',
          reason: 'unhandled_agent_event',
          rawSample: { type: 'mystery.event', step: invokeCount },
        });
        yield {
          type: 'result',
          providerSessionId: 'bridge-session-1',
          summary: 'probe-complete',
        };
      },
    };
    vi.mocked(buildAgentAdapter).mockReturnValue(adapter);

    try {
      const result = await generateProviderEvolutionProbeArtifact({
        probeProviderEvolution: true,
        probeProvider: 'claude',
        probeInstance: 'agent/sdk',
        probeProfile: 'manual_smoke',
      }, env);

      await expect(resolveProviderEvolutionEntryContext(env).probeService.readLatestArtifact({
        provider: 'claude',
      })).resolves.toEqual(expect.objectContaining({
        artifactId: result.artifact.id,
      }));
      expect(result.artifact.transport).toBe('agent');
      expect(result.artifact.instance).toBe('agent/sdk');
      expect(result.artifact.parserId).toBe('agent_sdk_http_v1');
      expect(result.artifact.execution.status).toBe('completed');
      expect(result.artifact.execution.turnsCompleted).toBe(2);
      expect(result.artifact.capabilitySnapshot.incrementalText.observed).toBe(true);
      expect(result.artifact.capabilitySnapshot.toolUse.observed).toBe(true);
      expect(result.artifact.capabilitySnapshot.finalResult.observed).toBe(true);
      expect(result.artifact.evidence.summary.ignoredCount).toBe(2);
      expect(result.artifact.evidence.summary.unknownCount).toBe(2);
      expect(result.artifact.evidence.summary.normalizedEventTypes.text).toBe(2);
      expect(result.artifact.evidence.summary.normalizedEventTypes.tool_use).toBe(1);
      expect(result.artifact.review.classifications).toEqual(['baseline']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
