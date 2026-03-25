import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GithubReviewAdapter } from './GithubReviewAdapter.js';
import type { RuntimeManagementRequest } from '../../types.js';

// Mock the cli module
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
    domain: 'review',
    action: 'audit_review_target',
    workspacePath: '/tmp/repo',
    ...overrides,
  };
}

describe('GithubReviewAdapter', () => {
  let adapter: GithubReviewAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GithubReviewAdapter({ command: 'gh' });
  });

  // -----------------------------------------------------------------------
  // diagnose
  // -----------------------------------------------------------------------

  describe('diagnose', () => {
    it('reports ok when gh is available and authenticated', async () => {
      mockAvail.mockResolvedValue({ available: true, version: '2.50.0' });
      mockRun.mockResolvedValue(ok(''));

      const diag = await adapter.diagnose('/tmp/repo');
      expect(diag.available).toBe(true);
      expect(diag.commandFound).toBe(true);
      expect(diag.authenticated).toBe(true);
      expect(diag.version).toBe('2.50.0');
    });

    it('reports unavailable when gh is not found', async () => {
      mockAvail.mockResolvedValue({ available: false });

      const diag = await adapter.diagnose();
      expect(diag.available).toBe(false);
      expect(diag.commandFound).toBe(false);
    });

    it('reports unavailable when not authenticated', async () => {
      mockAvail.mockResolvedValue({ available: true, version: '2.50.0' });
      mockRun.mockResolvedValue(fail('not logged in'));

      const diag = await adapter.diagnose();
      expect(diag.authenticated).toBe(false);
      expect(diag.available).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // audit_review_target
  // -----------------------------------------------------------------------

  describe('audit_review_target', () => {
    it('returns ready when auth and repo are ok', async () => {
      mockRun
        .mockResolvedValueOnce(ok('')) // auth status
        .mockResolvedValueOnce(ok('{"name":"repo","owner":{"login":"me"}}')); // repo view

      const result = await adapter.execute(request());
      expect(result.state).toBe('ready');
      expect(result.outputs).toEqual(expect.objectContaining({
        repository: expect.objectContaining({ name: 'repo' }),
      }));
    });

    it('returns blocked when auth fails', async () => {
      mockRun
        .mockResolvedValueOnce(fail('not logged in'))
        .mockResolvedValueOnce(ok('{"name":"repo"}'));

      const result = await adapter.execute(request());
      expect(result.state).toBe('blocked');
      expect(result.blockedReasons).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'auth_missing' })]),
      );
    });

    it('returns blocked when not in a repo', async () => {
      mockRun
        .mockResolvedValueOnce(ok(''))
        .mockResolvedValueOnce(fail('not a git repository'));

      const result = await adapter.execute(request());
      expect(result.state).toBe('blocked');
      expect(result.blockedReasons).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'repo_missing' })]),
      );
    });
  });

  // -----------------------------------------------------------------------
  // open_pull_request
  // -----------------------------------------------------------------------

  describe('open_pull_request', () => {
    it('returns preview when apply is false', async () => {
      const result = await adapter.execute(request({
        action: 'open_pull_request',
        target: { title: 'My PR', body: 'desc' },
      }));
      expect(result.state).toBe('ready');
      expect(result.outputs).toEqual(expect.objectContaining({ preview: true, title: 'My PR' }));
    });

    it('returns blocked when title is missing', async () => {
      const result = await adapter.execute(request({
        action: 'open_pull_request',
        apply: true,
        target: {},
      }));
      expect(result.state).toBe('blocked');
      expect(result.blockedReasons).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'missing_title' })]),
      );
    });

    it('creates PR on apply', async () => {
      mockRun.mockResolvedValue(ok('{"url":"https://github.com/me/repo/pull/1","number":1}'));

      const result = await adapter.execute(request({
        action: 'open_pull_request',
        apply: true,
        target: { title: 'feat: new', body: 'desc' },
        authorization: { actorClass: 'owner' },
      }));
      expect(result.state).toBe('completed');
      expect(result.outputs).toEqual(expect.objectContaining({ url: 'https://github.com/me/repo/pull/1' }));
    });

    it('returns blocked when gh pr create fails', async () => {
      mockRun.mockResolvedValue(fail('branch has no commits'));

      const result = await adapter.execute(request({
        action: 'open_pull_request',
        apply: true,
        target: { title: 'feat: new', body: '' },
        authorization: { actorClass: 'owner' },
      }));
      expect(result.state).toBe('blocked');
    });
  });

  // -----------------------------------------------------------------------
  // inspect_pull_request
  // -----------------------------------------------------------------------

  describe('inspect_pull_request', () => {
    it('returns PR data', async () => {
      mockRun.mockResolvedValue(ok('{"number":42,"title":"PR","state":"OPEN"}'));

      const result = await adapter.execute(request({
        action: 'inspect_pull_request',
        target: { number: 42 },
      }));
      expect(result.state).toBe('completed');
      expect(result.outputs).toEqual(expect.objectContaining({ number: 42 }));
    });

    it('returns blocked when PR not found', async () => {
      mockRun.mockResolvedValue(fail('no pull requests found'));

      const result = await adapter.execute(request({ action: 'inspect_pull_request' }));
      expect(result.state).toBe('blocked');
    });
  });

  // -----------------------------------------------------------------------
  // wait_review_checks (mocked to avoid real polling)
  // -----------------------------------------------------------------------

  describe('wait_review_checks', () => {
    it('returns completed when all checks pass immediately', async () => {
      mockRun.mockResolvedValue(ok('[{"name":"ci","state":"completed","conclusion":"success"}]'));

      const result = await adapter.execute(request({
        action: 'wait_review_checks',
        target: { number: 1, timeoutMs: 1000 },
      }));
      expect(result.state).toBe('completed');
      expect(result.operation).toBeDefined();
      expect(result.operation!.status).toBe('completed');
    });

    it('returns blocked when checks query fails', async () => {
      mockRun.mockResolvedValue(fail('no checks'));

      const result = await adapter.execute(request({
        action: 'wait_review_checks',
        target: { number: 1, timeoutMs: 500 },
      }));
      expect(result.state).toBe('blocked');
      expect(result.operation).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // unsupported action
  // -----------------------------------------------------------------------

  it('returns unsupported for unknown action', async () => {
    const result = await adapter.execute(request({ action: 'create_deployment' as never }));
    expect(result.state).toBe('unsupported');
  });
});
