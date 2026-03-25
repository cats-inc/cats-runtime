import { describe, expect, it, beforeEach } from 'vitest';
import { RuntimeManagementService } from './RuntimeManagementService.js';
import { StubManagementAdapter } from './adapters/stub/StubAdapter.js';
import type { RuntimeManagementRequest, RuntimeManagementResult } from './types.js';

function reviewAdapter(id = 'github') {
  return new StubManagementAdapter(id, ['review'], [
    'audit_review_target',
    'open_pull_request',
    'inspect_pull_request',
    'wait_review_checks',
  ]);
}

function deployAdapter(id = 'zeabur') {
  return new StubManagementAdapter(id, ['deployment'], [
    'audit_deployment_target',
    'create_deployment',
    'inspect_deployment',
    'read_deployment_logs',
  ]);
}

function baseRequest(overrides: Partial<RuntimeManagementRequest> = {}): RuntimeManagementRequest {
  return {
    domain: 'review',
    action: 'audit_review_target',
    ...overrides,
  };
}

describe('RuntimeManagementService', () => {
  let service: RuntimeManagementService;

  beforeEach(() => {
    service = new RuntimeManagementService({
      config: {
        version: 1,
        adapters: {
          review: {
            default: 'github',
            instances: { github: { transport: 'cli', command: 'gh' } },
          },
          deployment: {
            default: 'zeabur',
            instances: { zeabur: { transport: 'cli', command: 'zeabur' } },
          },
        },
      },
    });
    service.registerAdapter(reviewAdapter());
    service.registerAdapter(deployAdapter());
  });

  // -------------------------------------------------------------------------
  // Adapter resolution
  // -------------------------------------------------------------------------

  it('routes request to the correct adapter by domain', async () => {
    const result = await service.execute(baseRequest({ domain: 'review', action: 'audit_review_target' }));
    expect(result.adapter).toBe('github');
    expect(result.state).toBe('completed');
  });

  it('routes deployment request to zeabur', async () => {
    const result = await service.execute(baseRequest({
      domain: 'deployment',
      action: 'audit_deployment_target',
    }));
    expect(result.adapter).toBe('zeabur');
  });

  it('allows explicit adapter override', async () => {
    const custom = reviewAdapter('custom-gh');
    service.registerAdapter(custom);

    const result = await service.execute(baseRequest({
      domain: 'review',
      action: 'audit_review_target',
      adapter: 'custom-gh',
    }));
    expect(result.adapter).toBe('custom-gh');
  });

  it('returns unsupported when no adapter is registered', async () => {
    const empty = new RuntimeManagementService({});
    const result = await empty.execute(baseRequest());
    expect(result.state).toBe('unsupported');
    expect(result.capabilityGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'no_adapter' }),
      ]),
    );
  });

  // -------------------------------------------------------------------------
  // Authorization for read-only actions
  // -------------------------------------------------------------------------

  it('never requires approval for read-only actions', async () => {
    const result = await service.execute(baseRequest({
      action: 'audit_review_target',
    }));
    expect(result.authorization.requiresApproval).toBe(false);
    expect(result.contract.readOnly).toBe(true);
    expect(result.contract.applyDecision).toBe('read_only_operation');
  });

  it('never requires approval for inspect actions', async () => {
    const result = await service.execute(baseRequest({
      domain: 'deployment',
      action: 'inspect_deployment',
    }));
    expect(result.authorization.requiresApproval).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Authorization for mutating actions
  // -------------------------------------------------------------------------

  it('blocks mutating apply without authorization', async () => {
    const result = await service.execute(baseRequest({
      action: 'open_pull_request',
      apply: true,
    }));
    expect(result.state).toBe('blocked');
    expect(result.contract.applyDecision).toBe('blocked');
    expect(result.blockedReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'authorization_required' }),
      ]),
    );
  });

  it('allows mutating apply with actorClass', async () => {
    const result = await service.execute(baseRequest({
      action: 'open_pull_request',
      apply: true,
      authorization: { actorClass: 'owner' },
    }));
    expect(result.state).toBe('completed');
    expect(result.contract.applyDecision).toBe('applied');
    expect(result.contract.mode).toBe('apply');
  });

  it('allows mutating apply with approvalRef', async () => {
    const result = await service.execute(baseRequest({
      action: 'open_pull_request',
      apply: true,
      authorization: { approvalRef: 'ref-123' },
    }));
    expect(result.state).toBe('completed');
    expect(result.contract.applyDecision).toBe('applied');
  });

  it('returns preview contract for mutating action without apply', async () => {
    const result = await service.execute(baseRequest({
      action: 'open_pull_request',
      authorization: { actorClass: 'operator' },
    }));
    expect(result.contract.mode).toBe('preview');
    expect(result.contract.applyDecision).toBe('not_requested');
    expect(result.contract.applyRequested).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Contract shape
  // -------------------------------------------------------------------------

  it('includes safeDefaultMode as preview', async () => {
    const result = await service.execute(baseRequest());
    expect(result.contract.safeDefaultMode).toBe('preview');
  });

  // -------------------------------------------------------------------------
  // Canned results from stub
  // -------------------------------------------------------------------------

  it('returns canned result from stub adapter', async () => {
    const gh = reviewAdapter();
    const canned: RuntimeManagementResult = {
      domain: 'review',
      action: 'audit_review_target',
      state: 'degraded',
      adapter: 'github',
      contract: {
        mode: 'preview',
        safeDefaultMode: 'preview',
        applyRequested: false,
        applyDecision: 'read_only_operation',
        readOnly: true,
      },
      authorization: {
        canApply: false,
        requiresApproval: false,
        reason: 'test',
      },
      warnings: [{ code: 'test_warn', message: 'Test warning' }],
      blockedReasons: [],
      capabilityGaps: [],
    };
    gh.setResult('audit_review_target', canned);

    const svc = new RuntimeManagementService({
      config: {
        version: 1,
        adapters: {
          review: { default: 'github', instances: {} },
        },
      },
    });
    svc.registerAdapter(gh);

    const result = await svc.execute(baseRequest());
    expect(result.state).toBe('degraded');
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'test_warn' }),
      ]),
    );
  });

  // -------------------------------------------------------------------------
  // Operation resumption
  // -------------------------------------------------------------------------

  it('returns undefined for unknown operation', async () => {
    const result = await service.resumeOperation('nonexistent');
    expect(result).toBeUndefined();
  });

  it('resumes a completed operation', async () => {
    const op = service.operations.create();
    service.operations.complete(op.operationId, { checks: 'passed' });

    const result = await service.resumeOperation(op.operationId);
    expect(result).toBeDefined();
    expect(result!.state).toBe('completed');
    expect(result!.operation!.status).toBe('completed');
    expect(result!.outputs).toEqual({ checks: 'passed' });
  });

  it('resumes a polling operation', async () => {
    const op = service.operations.create();

    const result = await service.resumeOperation(op.operationId);
    expect(result).toBeDefined();
    expect(result!.state).toBe('degraded');
    expect(result!.operation!.status).toBe('polling');
  });

  // -------------------------------------------------------------------------
  // Adapter listing
  // -------------------------------------------------------------------------

  it('lists registered adapters', () => {
    expect(service.getRegisteredAdapters()).toHaveLength(2);
  });
});
