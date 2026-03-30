import { describe, expect, it } from 'vitest';
import { AgentTargetEvidenceService } from '../diagnostics/AgentTargetEvidenceService.js';
import type { ProviderTargetDescriptor } from '../providerCatalog.js';
import type { RuntimeSessionInspection, SessionInfo } from '../types.js';
import { buildAgentDiagnosticSessionEvidence } from './agentDiagnosticsEvidence.js';

function createSession(): SessionInfo {
  return {
    id: 'session-1',
    providerName: 'claude',
    providerBackend: 'agent',
    providerInstanceId: 'sdk',
    status: 'ready',
    origin: 'api',
    cwd: '/workspace/demo',
    workspace: {
      kind: 'shared',
      key: 'shared:/workspace/demo',
      path: '/workspace/demo',
    },
    workspaceMode: 'shared',
    outputDir: '/workspace/demo/out',
    messageCount: 1,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    createdAt: '2026-03-30T08:00:00.000Z',
    updatedAt: '2026-03-30T08:05:00.000Z',
    lastActivity: '2026-03-30T08:06:00.000Z',
  };
}

function createInspection(): RuntimeSessionInspection {
  return {
    state: 'idle',
    attached: true,
    busy: false,
    wake: null,
    currentRun: {
      id: 'run-1',
      status: 'succeeded',
      startedAt: '2026-03-30T08:05:00.000Z',
      endedAt: '2026-03-30T08:06:00.000Z',
      resultSummary: 'Rendered dashboard preview',
    },
    recentEvents: [],
    metering: {
      preflight: { outcome: 'allow', reason: null },
      activeGuardrails: [],
      recentIncidents: [],
    },
    maintenance: {
      status: 'idle',
      compaction: {
        status: 'idle',
        reasonCodes: [],
        messageCount: 1,
        totalTokens: 0,
      },
      hooks: {
        preReset: { available: false, pending: [] },
        preCompaction: { available: false, pending: [] },
        preFlush: { available: false, pending: [] },
      },
      resetBoundary: { status: 'none', reasonCodes: [] },
      cleanup: { status: 'idle', reasonCodes: [] },
      flush: {
        status: 'idle',
        phase: 'pre_flush',
        hookCount: 0,
        reasonCodes: [],
      },
      markers: [],
    },
    artifacts: [],
    services: [],
    previewSurfaces: [],
    browserSessions: [
      {
        id: 'browser-1',
        driverId: 'manual',
        status: 'ready',
        runtimeSessionId: 'session-1',
        createdAt: '2026-03-30T08:05:00.000Z',
        updatedAt: '2026-03-30T08:06:00.000Z',
        pages: [
          {
            id: 'page-1',
            browserSessionId: 'browser-1',
            status: 'ready',
            label: 'Preview Page',
            title: 'Preview',
            url: 'https://preview.test/page-1',
            createdAt: '2026-03-30T08:05:00.000Z',
            updatedAt: '2026-03-30T08:06:00.000Z',
            binding: { kind: 'runtime_session', runtimeSessionId: 'session-1' },
            previewSurface: {
              id: 'browser_page:page-1',
              kind: 'browser_page',
              source: 'runtime_browser',
              status: 'ready',
              renderHint: 'iframe',
              url: 'https://preview.test/page-1',
            },
          },
          {
            id: 'page-2',
            browserSessionId: 'browser-1',
            status: 'ready',
            title: 'Logs',
            path: '/workspace/demo/out/logs.html',
            mediaType: 'text/html',
            createdAt: '2026-03-30T08:05:00.000Z',
            updatedAt: '2026-03-30T08:06:00.000Z',
            binding: { kind: 'runtime_session', runtimeSessionId: 'session-1' },
            previewSurface: {
              id: 'browser_page:page-2',
              kind: 'browser_page',
              source: 'runtime_browser',
              status: 'ready',
              renderHint: 'iframe',
              path: '/workspace/demo/out/logs.html',
            },
          },
          {
            id: 'page-closed',
            browserSessionId: 'browser-1',
            status: 'closed',
            title: 'Closed',
            url: 'https://preview.test/closed',
            createdAt: '2026-03-30T08:05:00.000Z',
            updatedAt: '2026-03-30T08:06:00.000Z',
            closedAt: '2026-03-30T08:06:00.000Z',
            binding: { kind: 'runtime_session', runtimeSessionId: 'session-1' },
            previewSurface: {
              id: 'browser_page:page-closed',
              kind: 'browser_page',
              source: 'runtime_browser',
              status: 'closed',
              renderHint: 'iframe',
              url: 'https://preview.test/closed',
            },
          },
        ],
        inspection: {
          driver: {
            id: 'manual',
            label: 'Manual',
            kind: 'manual',
            summary: 'Manual browser driver',
            capabilities: {
              preview: true,
              navigation: false,
              automation: false,
              restartPersistence: false,
            },
          },
          openPageCount: 2,
          closedPageCount: 1,
          previewSurfaces: [],
        },
      },
    ],
    actions: {
      canClose: true,
      canDelete: true,
      canResume: true,
      canRefresh: true,
      canCancel: false,
      canReset: true,
      canRetry: false,
    },
  };
}

describe('agentDiagnosticsEvidence', () => {
  it('includes bounded open browser page samples in agent evidence summaries', () => {
    const evidence = buildAgentDiagnosticSessionEvidence(
      createSession(),
      createInspection(),
      'runtime_session_inspection',
    );

    expect(evidence).toEqual(expect.objectContaining({
      latestRun: expect.objectContaining({
        resultSummary: 'Rendered dashboard preview',
      }),
      browserSessions: [
        expect.objectContaining({
          id: 'browser-1',
          openPageCount: 2,
          openPages: [
            {
              id: 'page-1',
              label: 'Preview Page',
              title: 'Preview',
              url: 'https://preview.test/page-1',
              renderHint: 'iframe',
            },
            {
              id: 'page-2',
              title: 'Logs',
              path: '/workspace/demo/out/logs.html',
              mediaType: 'text/html',
              renderHint: 'iframe',
            },
          ],
        }),
      ],
    }));
  });

  it('retains nested browser page samples when storing target evidence', () => {
    const service = new AgentTargetEvidenceService();
    const target: ProviderTargetDescriptor = {
      providerName: 'claude',
      backend: 'agent',
      instanceId: 'sdk',
      defaultTarget: false,
    };
    const evidence = buildAgentDiagnosticSessionEvidence(
      createSession(),
      createInspection(),
      'retained_target_evidence',
    );

    service.record(target, { evidence });
    const retained = service.get(target);

    expect(retained?.evidence?.browserSessions[0]?.openPages).toEqual([
      {
        id: 'page-1',
        label: 'Preview Page',
        title: 'Preview',
        url: 'https://preview.test/page-1',
        renderHint: 'iframe',
      },
      {
        id: 'page-2',
        title: 'Logs',
        path: '/workspace/demo/out/logs.html',
        mediaType: 'text/html',
        renderHint: 'iframe',
      },
    ]);
  });
});
