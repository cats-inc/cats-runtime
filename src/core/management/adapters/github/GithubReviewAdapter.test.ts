import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GithubReviewAdapter } from './GithubReviewAdapter.js';
import { ManagementOperationStore } from '../../operations.js';
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
  let operations: ManagementOperationStore;

  beforeEach(() => {
    vi.clearAllMocks();
    operations = new ManagementOperationStore();
    adapter = new GithubReviewAdapter({ command: 'gh', operations });
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
  // open_pull_request (gh pr create does NOT support --json)
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

    it('creates PR on apply and parses URL from stdout', async () => {
      // gh pr create prints the URL to stdout (no --json)
      mockRun.mockResolvedValue(ok('https://github.com/me/repo/pull/1\n'));

      const result = await adapter.execute(request({
        action: 'open_pull_request',
        apply: true,
        target: { title: 'feat: new', body: 'desc' },
        authorization: { actorClass: 'owner' },
      }));
      expect(result.state).toBe('completed');
      expect(result.outputs).toEqual(expect.objectContaining({
        url: 'https://github.com/me/repo/pull/1',
        number: 1,
      }));
    });

    it('verifies gh pr create args do not include --json', async () => {
      mockRun.mockResolvedValue(ok('https://github.com/me/repo/pull/2\n'));

      await adapter.execute(request({
        action: 'open_pull_request',
        apply: true,
        target: { title: 'fix: bug', body: '', base: 'develop' },
        authorization: { actorClass: 'owner' },
      }));

      const call = mockRun.mock.calls[0];
      expect(call[0]).toBe('gh');
      expect(call[1]).not.toContain('--json');
      expect(call[1]).toContain('--base');
      expect(call[1]).toContain('develop');
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
  // wait_review_checks (uses gh pr view --json statusCheckRollup)
  // -----------------------------------------------------------------------

  describe('wait_review_checks', () => {
    it('returns completed when all checks pass immediately', async () => {
      // gh pr view --json statusCheckRollup returns nested object
      mockRun.mockResolvedValue(ok('{"statusCheckRollup":[{"name":"ci","status":"COMPLETED","conclusion":"SUCCESS"}]}'));

      const result = await adapter.execute(request({
        action: 'wait_review_checks',
        target: { number: 1, timeoutMs: 1000 },
      }));
      expect(result.state).toBe('completed');
      expect(result.operation).toBeDefined();
      expect(result.operation!.status).toBe('completed');
    });

    it('stores operation in the shared store', async () => {
      mockRun.mockResolvedValue(ok('{"statusCheckRollup":[{"name":"ci","status":"COMPLETED"}]}'));

      const result = await adapter.execute(request({
        action: 'wait_review_checks',
        target: { number: 1, timeoutMs: 500 },
      }));
      expect(operations.size).toBeGreaterThan(0);
      expect(result.operation?.operationId).toBeDefined();
      // The operation should be findable in the shared store
      const stored = operations.get(result.operation!.operationId);
      expect(stored).toBeDefined();
      expect(stored!.status).toBe('completed');
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

    it('verifies gh args use pr view --json statusCheckRollup, not pr checks --json', async () => {
      mockRun.mockResolvedValue(ok('{"statusCheckRollup":[{"name":"ci","status":"COMPLETED"}]}'));

      await adapter.execute(request({
        action: 'wait_review_checks',
        target: { number: 5, timeoutMs: 500 },
      }));

      // First call is the check poll
      const call = mockRun.mock.calls[0];
      expect(call[0]).toBe('gh');
      expect(call[1]).toContain('pr');
      expect(call[1]).toContain('view');
      expect(call[1]).toContain('--json');
      expect(call[1]).toContain('statusCheckRollup');
      // Should NOT contain 'checks' as a subcommand
      expect(call[1]).not.toContain('checks');
    });
  });

  // -----------------------------------------------------------------------
  // unsupported action
  // -----------------------------------------------------------------------

  it('returns unsupported for unknown action', async () => {
    const result = await adapter.execute(request({ action: 'create_deployment' as never }));
    expect(result.state).toBe('unsupported');
  });

  // -----------------------------------------------------------------------
  // resume via pollChecks
  // -----------------------------------------------------------------------

  describe('pollChecks (resume path)', () => {
    it('can be called directly for resume and completes', async () => {
      mockRun.mockResolvedValue(ok('{"statusCheckRollup":[{"name":"ci","status":"COMPLETED"}]}'));

      const op = operations.create(5000);
      operations.update(op.operationId, 'polling', {
        _requestContext: { domain: 'review', action: 'wait_review_checks', cwd: '/tmp', prRef: '1', adapter: 'github' },
      });

      const result = await adapter.pollChecks(
        { domain: 'review', action: 'wait_review_checks' },
        op.operationId,
        '/tmp',
        '1',
        5000,
      );
      expect(result.state).toBe('completed');
      expect(result.operation?.status).toBe('completed');
    });
  });
});
