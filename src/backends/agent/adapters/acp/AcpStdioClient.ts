import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface as ReadLineInterface } from 'node:readline';
import { hiddenWindowsSpawnOptions } from '../../../../core/process/windowsSpawn.js';
import type { AgentProcessSpawner, AgentSpawnedProcess } from '../../types.js';

export interface AcpJsonRpcErrorPayload {
  code: number;
  message: string;
  data?: unknown;
}

export interface AcpJsonRpcRequest<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: T;
}

export interface AcpJsonRpcNotification<T = unknown> {
  jsonrpc: '2.0';
  method: string;
  params?: T;
}

export interface AcpJsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number | null;
  result?: T;
  error?: AcpJsonRpcErrorPayload;
}

export type AcpJsonRpcMessage =
  | AcpJsonRpcRequest
  | AcpJsonRpcNotification
  | AcpJsonRpcResponse;

export interface AcpSpawnProcessOptions {
  cwd?: string;
  env?: Record<string, string>;
}

export interface AcpStdioClientOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  spawnProcess?: AgentProcessSpawner;
  onNotification?: (message: AcpJsonRpcNotification) => void | Promise<void>;
  onServerRequest?: (
    message: AcpJsonRpcRequest,
  ) => Promise<unknown> | unknown;
  onStderr?: (text: string) => void;
}

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout?: NodeJS.Timeout;
}

export interface AcpJsonRpcRequestOptions {
  timeoutMs?: number;
}

function defaultSpawnProcess(
  command: string,
  args: string[],
  options: AcpSpawnProcessOptions,
): AgentSpawnedProcess {
  return spawn(command, args, {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : undefined,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    ...hiddenWindowsSpawnOptions(),
  }) as ChildProcess;
}

function isResponse(message: AcpJsonRpcMessage): message is AcpJsonRpcResponse {
  return Object.prototype.hasOwnProperty.call(message, 'id')
    && !Object.prototype.hasOwnProperty.call(message, 'method');
}

function isRequest(message: AcpJsonRpcMessage): message is AcpJsonRpcRequest {
  return typeof (message as { method?: unknown }).method === 'string'
    && typeof (message as { id?: unknown }).id === 'number';
}

function isNotification(message: AcpJsonRpcMessage): message is AcpJsonRpcNotification {
  return typeof (message as { method?: unknown }).method === 'string'
    && !Object.prototype.hasOwnProperty.call(message, 'id');
}

function toJsonRpcError(error: unknown): AcpJsonRpcErrorPayload {
  if (error instanceof AcpJsonRpcClientError && error.code !== undefined) {
    return {
      code: error.code,
      message: error.message,
      ...(error.data !== undefined ? { data: error.data } : {}),
    };
  }

  if (error instanceof Error) {
    return {
      code: -32000,
      message: error.message,
    };
  }

  return {
    code: -32000,
    message: String(error),
  };
}

export class AcpJsonRpcClientError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'AcpJsonRpcClientError';
  }
}

export class AcpStdioClient {
  private readonly pending = new Map<number, PendingRequest>();
  private readonly process: AgentSpawnedProcess;
  private readonly spawnOptions: AcpSpawnProcessOptions;
  private readonly rl: ReadLineInterface;
  private nextId = 0;
  private closed = false;

  constructor(private readonly options: AcpStdioClientOptions) {
    this.spawnOptions = {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.env ? { env: { ...options.env } } : {}),
    };
    const spawnProcess = options.spawnProcess || defaultSpawnProcess;
    this.process = spawnProcess(
      options.command,
      options.args ? [...options.args] : [],
      this.spawnOptions,
    );
    if (!this.process.stdin || !this.process.stdout) {
      throw new Error('ACP stdio process must expose stdin and stdout streams');
    }

    this.rl = createInterface({ input: this.process.stdout });
    this.rl.on('line', (line) => {
      void this.handleLine(line).catch((error) => {
        this.failAll(error instanceof Error ? error : new Error(String(error)));
      });
    });
    this.process.stderr?.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString().trim();
      if (text) {
        this.options.onStderr?.(text);
      }
    });
    this.process.on('error', (error: Error) => {
      this.failAll(error);
    });
    this.process.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (this.closed) {
        return;
      }
      this.failAll(new Error(
        `ACP stdio process exited before the client finished (code: ${code ?? 'null'}, `
        + `signal: ${signal ?? 'null'}).`,
      ));
    });
  }

  async request<TResponse = unknown, TParams = unknown>(
    method: string,
    params?: TParams,
    options: AcpJsonRpcRequestOptions = {},
  ): Promise<TResponse> {
    if (this.closed) {
      throw new Error('ACP stdio client is already closed');
    }

    const id = this.nextId++;
    const request: AcpJsonRpcRequest<TParams> = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };

    const promise = new Promise<TResponse>((resolve, reject) => {
      const pending: PendingRequest = {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
      };
      if (options.timeoutMs && options.timeoutMs > 0) {
        pending.timeout = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(
            `ACP stdio request '${method}' timed out after ${options.timeoutMs}ms.`,
          ));
        }, options.timeoutMs);
      }
      this.pending.set(id, pending);
    });
    this.writeMessage(request);
    return promise;
  }

  notify<TParams = unknown>(method: string, params?: TParams): void {
    if (this.closed) {
      throw new Error('ACP stdio client is already closed');
    }

    const notification: AcpJsonRpcNotification<TParams> = {
      jsonrpc: '2.0',
      method,
      ...(params === undefined ? {} : { params }),
    };
    this.writeMessage(notification);
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.rl.close();
    this.failAll(new Error('ACP stdio client closed'));
    this.process.stdin?.end();
    if (this.process.exitCode === null || this.process.exitCode === undefined) {
      this.process.kill('SIGTERM');
    }
  }

  private async handleLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let parsed: AcpJsonRpcMessage;
    try {
      parsed = JSON.parse(trimmed) as AcpJsonRpcMessage;
    } catch (error) {
      this.failAll(new Error(
        `Received non-JSON ACP stdio message: ${error instanceof Error ? error.message : String(error)}`,
      ));
      return;
    }

    if (isResponse(parsed)) {
      this.handleResponse(parsed);
      return;
    }

    if (isRequest(parsed)) {
      await this.handleServerRequest(parsed);
      return;
    }

    if (isNotification(parsed)) {
      await this.options.onNotification?.(parsed);
      return;
    }

    this.failAll(new Error('Received malformed ACP JSON-RPC frame'));
  }

  private handleResponse(message: AcpJsonRpcResponse): void {
    if (typeof message.id !== 'number') {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    this.pending.delete(message.id);
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }
    if (message.error) {
      pending.reject(new AcpJsonRpcClientError(
        `${pending.method} failed: ${message.error.message}`,
        message.error.code,
        message.error.data,
      ));
      return;
    }

    pending.resolve(message.result);
  }

  private async handleServerRequest(message: AcpJsonRpcRequest): Promise<void> {
    if (!this.options.onServerRequest) {
      this.writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32601,
          message: `No ACP server-request handler is configured for '${message.method}'.`,
        },
      } satisfies AcpJsonRpcResponse);
      return;
    }

    try {
      const result = await this.options.onServerRequest(message);
      this.writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        result: result ?? null,
      } satisfies AcpJsonRpcResponse);
    } catch (error) {
      this.writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        error: toJsonRpcError(error),
      } satisfies AcpJsonRpcResponse);
    }
  }

  private writeMessage(message: AcpJsonRpcMessage): void {
    const payload = `${JSON.stringify(message)}\n`;
    this.process.stdin?.write(payload);
  }

  private failAll(error: Error): void {
    if (this.pending.size === 0) {
      return;
    }

    for (const pending of this.pending.values()) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pending.reject(error);
    }
    this.pending.clear();
  }
}
