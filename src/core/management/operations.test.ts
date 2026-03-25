import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { ManagementOperationStore } from './operations.js';

describe('ManagementOperationStore', () => {
  let store: ManagementOperationStore;

  beforeEach(() => {
    store = new ManagementOperationStore();
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

    // Mock the startedAt to 11 minutes ago
    const raw = store.get(op.operationId);
    if (raw) {
      (raw as { startedAt: string }).startedAt = new Date(Date.now() - 11 * 60_000).toISOString();
    }

    store.cleanup();
    expect(store.get(op.operationId)).toBeUndefined();
  });

  it('stores optional timeoutMs', () => {
    const op = store.create(30_000);
    expect(op.timeoutMs).toBe(30_000);
  });
});
