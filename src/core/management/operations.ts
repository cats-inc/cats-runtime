import { randomUUID } from 'node:crypto';
import type { RuntimeManagementOperation, RuntimeManagementOperationStatus } from './types.js';

const DEFAULT_TTL_MS = 10 * 60_000; // 10 minutes
const MAX_OPERATIONS = 100;

export class ManagementOperationStore {
  private readonly operations = new Map<string, RuntimeManagementOperation>();

  create(timeoutMs?: number): RuntimeManagementOperation {
    this.cleanup();

    if (this.operations.size >= MAX_OPERATIONS) {
      // Evict oldest entry to stay under cap
      const oldest = this.operations.keys().next().value;
      if (oldest) this.operations.delete(oldest);
    }

    const now = new Date().toISOString();
    const op: RuntimeManagementOperation = {
      operationId: randomUUID(),
      status: 'polling',
      startedAt: now,
      updatedAt: now,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    };
    this.operations.set(op.operationId, op);
    return op;
  }

  get(operationId: string): RuntimeManagementOperation | undefined {
    const op = this.operations.get(operationId);
    if (!op) return undefined;
    if (this.isExpired(op)) {
      this.operations.delete(operationId);
      return undefined;
    }
    return op;
  }

  update(
    operationId: string,
    status: RuntimeManagementOperationStatus,
    result?: Record<string, unknown>,
  ): RuntimeManagementOperation | undefined {
    const op = this.operations.get(operationId);
    if (!op) return undefined;
    op.status = status;
    op.updatedAt = new Date().toISOString();
    if (result !== undefined) {
      op.result = result;
    }
    return op;
  }

  complete(
    operationId: string,
    result: Record<string, unknown>,
  ): RuntimeManagementOperation | undefined {
    return this.update(operationId, 'completed', result);
  }

  fail(
    operationId: string,
    result?: Record<string, unknown>,
  ): RuntimeManagementOperation | undefined {
    return this.update(operationId, 'failed', result);
  }

  cleanup(): void {
    for (const [id, op] of this.operations) {
      if (this.isExpired(op)) {
        this.operations.delete(id);
      }
    }
  }

  get size(): number {
    return this.operations.size;
  }

  private isExpired(op: RuntimeManagementOperation): boolean {
    const age = Date.now() - new Date(op.startedAt).getTime();
    return age > DEFAULT_TTL_MS;
  }
}
