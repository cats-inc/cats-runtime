import { describe, expect, it, beforeEach } from 'vitest';
import { RuntimeManagementService } from './RuntimeManagementService.js';
import { StubManagementAdapter } from './adapters/stub/StubAdapter.js';
import { diagnoseManagementAdapters } from './diagnostics.js';

describe('diagnoseManagementAdapters', () => {
  let service: RuntimeManagementService;

  beforeEach(() => {
    service = new RuntimeManagementService({});
    const gh = new StubManagementAdapter('github', ['review'], [
      'audit_review_target', 'open_pull_request', 'inspect_pull_request', 'wait_review_checks',
    ]);
    const zb = new StubManagementAdapter('zeabur', ['deployment'], [
      'audit_deployment_target', 'create_deployment', 'inspect_deployment', 'read_deployment_logs',
    ]);
    service.registerAdapter(gh);
    service.registerAdapter(zb);
  });

  it('returns diagnostics for all adapters', async () => {
    const results = await diagnoseManagementAdapters(service);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.adapter)).toEqual(expect.arrayContaining(['github', 'zeabur']));
  });

  it('filters by domain', async () => {
    const results = await diagnoseManagementAdapters(service, { domains: ['review'] });
    expect(results).toHaveLength(1);
    expect(results[0].domain).toBe('review');
  });

  it('reports availability status', async () => {
    const results = await diagnoseManagementAdapters(service);
    for (const r of results) {
      expect(r.availability.status).toBe('ok');
      expect(r.availability.checkedAt).toBeDefined();
      expect(r.checks.length).toBeGreaterThan(0);
    }
  });

  it('returns empty when no adapters match domain filter', async () => {
    const results = await diagnoseManagementAdapters(service, { domains: ['unknown'] });
    expect(results).toHaveLength(0);
  });
});
