import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ZeaburDeploymentAdapter } from './ZeaburDeploymentAdapter.js';
import type { RuntimeManagementRequest } from '../../types.js';

vi.mock('../../cli.js', () => ({
  runCliCommand: vi.fn(),
  isCliAvailable: vi.fn(),
  parseCliJson: vi.fn((s: string) => {
    try { return JSON.parse(s.trim()); } catch { return undefined; }
  }),
}));

import { runCliCommand, isCliAvailable } from '../../cli.js';

const mockRun = vi.mocked(runCliCommand);
const mockAvail = vi.mocked(isCliAvailable);

function ok(stdout: string) {
  return { code: 0, stdout, stderr: '', timedOut: false, durationMs: 100 };
}

function fail(stderr: string, code = 1) {
  return { code, stdout: '', stderr, timedOut: false, durationMs: 100 };
}

function request(overrides: Partial<RuntimeManagementRequest> = {}): RuntimeManagementRequest {
  return {
    domain: 'deployment',
    action: 'audit_deployment_target',
    workspacePath: '/tmp/project',
    ...overrides,
  };
}

describe('ZeaburDeploymentAdapter', () => {
  let adapter: ZeaburDeploymentAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new ZeaburDeploymentAdapter({ command: 'zeabur' });
  });

  // -----------------------------------------------------------------------
  // diagnose
  // -----------------------------------------------------------------------

  describe('diagnose', () => {
    it('reports ok when zeabur is available and authenticated', async () => {
      mockAvail.mockResolvedValue({ available: true, version: '1.0.0' });
      mockRun.mockResolvedValue(ok(''));

      const diag = await adapter.diagnose();
      expect(diag.available).toBe(true);
      expect(diag.commandFound).toBe(true);
      expect(diag.authenticated).toBe(true);
    });

    it('reports unavailable when zeabur is not found', async () => {
      mockAvail.mockResolvedValue({ available: false });

      const diag = await adapter.diagnose();
      expect(diag.commandFound).toBe(false);
      expect(diag.available).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // audit_deployment_target
  // -----------------------------------------------------------------------

  describe('audit_deployment_target', () => {
    it('returns ready when auth and context ok', async () => {
      mockRun
        .mockResolvedValueOnce(ok('')) // auth status
        .mockResolvedValueOnce(ok('{"projectId":"p1","environmentId":"e1"}')); // context get

      const result = await adapter.execute(request());
      expect(result.state).toBe('ready');
      expect(result.outputs).toEqual(expect.objectContaining({
        context: expect.objectContaining({ projectId: 'p1' }),
      }));
    });

    it('returns blocked when auth fails', async () => {
      mockRun
        .mockResolvedValueOnce(fail('not logged in'))
        .mockResolvedValueOnce(ok('{}'));

      const result = await adapter.execute(request());
      expect(result.state).toBe('blocked');
      expect(result.blockedReasons).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'auth_missing' })]),
      );
    });

    it('returns blocked when project not linked', async () => {
      mockRun
        .mockResolvedValueOnce(ok(''))
        .mockResolvedValueOnce(fail('no context'));

      const result = await adapter.execute(request());
      expect(result.state).toBe('blocked');
      expect(result.blockedReasons).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'project_not_linked' })]),
      );
    });
  });

  // -----------------------------------------------------------------------
  // create_deployment
  // -----------------------------------------------------------------------

  describe('create_deployment', () => {
    it('returns preview when apply is false', async () => {
      const result = await adapter.execute(request({ action: 'create_deployment' }));
      expect(result.state).toBe('ready');
      expect(result.outputs).toEqual(expect.objectContaining({ preview: true }));
    });

    it('creates deployment and returns preview surface with URL', async () => {
      mockRun.mockResolvedValue(ok('Deployed to https://my-app.zeabur.app'));

      const result = await adapter.execute(request({
        action: 'create_deployment',
        apply: true,
        authorization: { actorClass: 'owner' },
      }));
      expect(result.state).toBe('completed');
      expect(result.previewSurfaces).toHaveLength(1);

      const surface = result.previewSurfaces![0];
      expect(surface.kind).toBe('service');
      expect(surface.source).toBe('request_service');
      expect(surface.renderHint).toBe('open_external');
      expect(surface.url).toBe('https://my-app.zeabur.app');
      expect(surface.status).toBe('ready');
    });

    it('returns blocked when deploy fails', async () => {
      mockRun.mockResolvedValue(fail('deployment error'));

      const result = await adapter.execute(request({
        action: 'create_deployment',
        apply: true,
        authorization: { actorClass: 'owner' },
      }));
      expect(result.state).toBe('blocked');
    });
  });

  // -----------------------------------------------------------------------
  // inspect_deployment
  // -----------------------------------------------------------------------

  describe('inspect_deployment', () => {
    it('returns service list', async () => {
      mockRun.mockResolvedValue(ok('[{"id":"s1","name":"web","status":"running"}]'));

      const result = await adapter.execute(request({ action: 'inspect_deployment' }));
      expect(result.state).toBe('completed');
    });

    it('returns blocked when inspect fails', async () => {
      mockRun.mockResolvedValue(fail('not found'));

      const result = await adapter.execute(request({ action: 'inspect_deployment' }));
      expect(result.state).toBe('blocked');
    });
  });

  // -----------------------------------------------------------------------
  // read_deployment_logs
  // -----------------------------------------------------------------------

  describe('read_deployment_logs', () => {
    it('returns logs using zeabur deployment log', async () => {
      mockRun.mockResolvedValue(ok('log line 1\nlog line 2'));

      const result = await adapter.execute(request({ action: 'read_deployment_logs' }));
      expect(result.state).toBe('completed');
      expect(result.outputs).toEqual(expect.objectContaining({ logs: 'log line 1\nlog line 2' }));

      // Verify the correct command is used
      const call = mockRun.mock.calls[0];
      expect(call[0]).toBe('zeabur');
      expect(call[1]).toContain('deployment');
      expect(call[1]).toContain('log');
    });

    it('truncates oversized logs', async () => {
      const huge = 'x'.repeat(15_000);
      mockRun.mockResolvedValue(ok(huge));

      const result = await adapter.execute(request({ action: 'read_deployment_logs' }));
      expect(result.state).toBe('completed');
      expect((result.outputs as { logs: string }).logs.length).toBeLessThan(15_000);
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'logs_truncated' })]),
      );
    });
  });

  // -----------------------------------------------------------------------
  // unsupported action
  // -----------------------------------------------------------------------

  it('returns unsupported for unknown action', async () => {
    const result = await adapter.execute(request({ action: 'open_pull_request' as never }));
    expect(result.state).toBe('unsupported');
  });
});
