import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { ManagementOperationStore } from './operations.js';

describe('ManagementOperationStore', () => {
  let store: ManagementOperationStore;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    store = new ManagementOperationStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates an operation with a unique id', () => {
    const op = store.create();
    expect(op.operationId).toBeDefined();
    expect(op.status).toBe('polling');
    expect(op.startedAt).toBeDefined();
    expect(op.updatedAt).toBeDefined();
  });

  it('retrieves a stored operation', () => {
    const op = store.create();
    const retrieved = store.get(op.operationId);
    expect(retrieved).toBeDefined();
    expect(retrieved!.operationId).toBe(op.operationId);
  });

  it('returns undefined for unknown operation', () => {
    expect(store.get('nonexistent')).toBeUndefined();
  });

  it('completes an operation', () => {
    const op = store.create();
    const completed = store.complete(op.operationId, { pr: 123 });
    expect(completed).toBeDefined();
    expect(completed!.status).toBe('completed');
    expect(completed!.result).toEqual({ pr: 123 });
  });

  it('fails an operation', () => {
    const op = store.create();
    const failed = store.fail(op.operationId, { error: 'timeout' });
    expect(failed).toBeDefined();
    expect(failed!.status).toBe('failed');
  });

  it('tracks store size', () => {
    expect(store.size).toBe(0);
    store.create();
    store.create();
    expect(store.size).toBe(2);
  });

  it('evicts oldest entry when at max capacity', () => {
    // Create 100 entries to fill the store
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      ids.push(store.create().operationId);
    }
    expect(store.size).toBe(100);

    // Creating one more should evict the oldest
    store.create();
    expect(store.size).toBe(100);
    expect(store.get(ids[0])).toBeUndefined();
  });

  it('cleans up expired operations', () => {
    const op = store.create();
    vi.advanceTimersByTime(11 * 60_000);

    store.cleanup();
    expect(store.get(op.operationId)).toBeUndefined();
  });

  it('stores optional timeoutMs', () => {
    const op = store.create(30_000);
    expect(op.timeoutMs).toBe(30_000);
  });

  it('keeps active operations alive based on updatedAt activity', () => {
    const op = store.create();

    vi.advanceTimersByTime(9 * 60_000);
    const touched = store.touch(op.operationId);
    expect(touched).toBeDefined();

    vi.advanceTimersByTime(2 * 60_000);
    expect(store.get(op.operationId)).toBeDefined();
  });

  it('summarizes recent operations with bounded request context details', () => {
    const polling = store.create(30_000);
    store.update(polling.operationId, 'polling', {
      _requestContext: {
        domain: 'review',
        action: 'wait_review_checks',
        adapter: 'github',
      },
    });

    vi.advanceTimersByTime(1_000);

    const completed = store.create();
    store.complete(completed.operationId, {
      _requestContext: {
        domain: 'deployment',
        action: 'create_deployment',
        adapter: 'zeabur',
      },
    });

    const diagnostics = store.inspect();
    expect(diagnostics.summary).toEqual({
      total: 2,
      polling: 1,
      completed: 1,
      failed: 0,
      oldestStartedAt: '2026-01-01T00:00:00.000Z',
      latestUpdatedAt: '2026-01-01T00:00:01.000Z',
    });
    expect(diagnostics.recent).toEqual([
      expect.objectContaining({
        operationId: completed.operationId,
        status: 'completed',
        domain: 'deployment',
        action: 'create_deployment',
        adapter: 'zeabur',
      }),
      expect.objectContaining({
        operationId: polling.operationId,
        status: 'polling',
        timeoutMs: 30_000,
        domain: 'review',
        action: 'wait_review_checks',
        adapter: 'github',
      }),
    ]);
  });

  it('drops expired operations before building diagnostics', () => {
    store.create();
    vi.advanceTimersByTime(11 * 60_000);

    const diagnostics = store.inspect();
    expect(diagnostics.summary).toEqual({
      total: 0,
      polling: 0,
      completed: 0,
      failed: 0,
      oldestStartedAt: null,
      latestUpdatedAt: null,
    });
    expect(diagnostics.recent).toEqual([]);
  });
});
