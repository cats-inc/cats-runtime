import { randomUUID } from 'node:crypto';
import type { RuntimeManagementOperation, RuntimeManagementOperationStatus } from './types.js';

const DEFAULT_TTL_MS = 10 * 60_000; // 10 minutes
const MAX_OPERATIONS = 100;

export interface ManagementOperationStoreSummary {
  total: number;
  polling: number;
  completed: number;
  failed: number;
  oldestStartedAt: string | null;
  latestUpdatedAt: string | null;
}

export interface ManagementOperationDiagnosticEntry {
  operationId: string;
  status: RuntimeManagementOperationStatus;
  startedAt: string;
  updatedAt: string;
  timeoutMs?: number;
  domain?: string;
  action?: string;
  adapter?: string;
}

export interface ManagementOperationStoreDiagnostics {
  summary: ManagementOperationStoreSummary;
  recent: ManagementOperationDiagnosticEntry[];
}

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

  touch(operationId: string): RuntimeManagementOperation | undefined {
    const op = this.operations.get(operationId);
    if (!op) return undefined;
    op.updatedAt = new Date().toISOString();
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

  inspect(limit = 5): ManagementOperationStoreDiagnostics {
    this.cleanup();
    const operations = [...this.operations.values()]
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    const summary: ManagementOperationStoreSummary = {
      total: operations.length,
      polling: operations.filter((operation) => operation.status === 'polling').length,
      completed: operations.filter((operation) => operation.status === 'completed').length,
      failed: operations.filter((operation) => operation.status === 'failed').length,
      oldestStartedAt: operations.length > 0
        ? operations.reduce(
            (oldest, operation) => operation.startedAt < oldest ? operation.startedAt : oldest,
            operations[0]!.startedAt,
          )
        : null,
      latestUpdatedAt: operations.length > 0 ? operations[0]!.updatedAt : null,
    };

    return {
      summary,
      recent: operations.slice(0, Math.max(0, limit)).map((operation) => this.toDiagnosticEntry(operation)),
    };
  }

  private isExpired(op: RuntimeManagementOperation): boolean {
    const age = Date.now() - new Date(op.updatedAt).getTime();
    return age > DEFAULT_TTL_MS;
  }

  private toDiagnosticEntry(
    operation: RuntimeManagementOperation,
  ): ManagementOperationDiagnosticEntry {
    const requestContext = (
      operation.result?._requestContext
      && typeof operation.result._requestContext === 'object'
      && !Array.isArray(operation.result._requestContext)
    ) ? operation.result._requestContext as Record<string, unknown> : undefined;

    return {
      operationId: operation.operationId,
      status: operation.status,
      startedAt: operation.startedAt,
      updatedAt: operation.updatedAt,
      ...(operation.timeoutMs !== undefined ? { timeoutMs: operation.timeoutMs } : {}),
      ...(readOptionalString(requestContext, 'domain') ? { domain: readOptionalString(requestContext, 'domain') } : {}),
      ...(readOptionalString(requestContext, 'action') ? { action: readOptionalString(requestContext, 'action') } : {}),
      ...(readOptionalString(requestContext, 'adapter') ? { adapter: readOptionalString(requestContext, 'adapter') } : {}),
    };
  }
}

function readOptionalString(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const candidate = value?.[key];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}
