import type { Writable } from 'node:stream';
import type { AppContext } from '../http/app.js';
import { handleAcpJsonRpc } from './server.js';
import type { AcpJsonRpcError, AcpJsonRpcSuccess } from './types.js';

const HEADER_DELIMITER = '\r\n\r\n';

export type AcpJsonRpcHandler = (
  message: unknown,
) => Promise<AcpJsonRpcSuccess | AcpJsonRpcError | null>;

export interface AcpStdioServerOptions {
  ctx?: AppContext;
  handleJsonRpc?: AcpJsonRpcHandler;
  input?: NodeJS.ReadableStream;
  output?: Writable;
  errorOutput?: Writable;
  onClose?: () => Promise<void> | void;
}

export interface AcpStdioServerHandle {
  close(): Promise<void>;
}

function encodeMessage(message: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.from(`Content-Length: ${payload.length}${HEADER_DELIMITER}`, 'utf8');
  return Buffer.concat([header, payload]);
}

function findHeaderEnd(buffer: Buffer): number {
  return buffer.indexOf(HEADER_DELIMITER);
}

function parseContentLength(headerBlock: string): number {
  const lines = headerBlock.split('\r\n');
  for (const line of lines) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex < 0) {
      continue;
    }
    const name = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    if (name === 'content-length') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
      }
      break;
    }
  }

  throw new Error('Missing or invalid Content-Length header');
}

function parseMessages(buffer: Buffer): {
  messages: unknown[];
  remainder: Buffer;
} {
  const messages: unknown[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const headerEnd = findHeaderEnd(buffer.subarray(offset));
    if (headerEnd < 0) {
      break;
    }

    const absoluteHeaderEnd = offset + headerEnd;
    const headerBlock = buffer.subarray(offset, absoluteHeaderEnd).toString('utf8');
    const contentLength = parseContentLength(headerBlock);
    const bodyStart = absoluteHeaderEnd + HEADER_DELIMITER.length;
    const bodyEnd = bodyStart + contentLength;
    if (buffer.length < bodyEnd) {
      break;
    }

    const body = buffer.subarray(bodyStart, bodyEnd).toString('utf8');
    messages.push(JSON.parse(body) as unknown);
    offset = bodyEnd;
  }

  return {
    messages,
    remainder: buffer.subarray(offset),
  };
}

function parseErrorResponse(message: string) {
  return {
    jsonrpc: '2.0' as const,
    id: null,
    error: {
      code: -32700,
      message,
    },
  };
}

function resolveJsonRpcHandler(options: AcpStdioServerOptions): AcpJsonRpcHandler {
  if (options.handleJsonRpc) {
    return options.handleJsonRpc;
  }
  if (options.ctx) {
    return (message) => handleAcpJsonRpc(options.ctx as AppContext, message);
  }

  throw new Error('ACP stdio server requires either ctx or handleJsonRpc');
}

export function startAcpStdioServer(options: AcpStdioServerOptions): AcpStdioServerHandle {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const errorOutput = options.errorOutput ?? process.stderr;
  const handleJsonRpc = resolveJsonRpcHandler(options);
  let buffer: Buffer = Buffer.alloc(0);
  let closed = false;
  let processing = Promise.resolve();

  const writeResponse = (message: unknown) => {
    output.write(encodeMessage(message));
  };

  const handleChunk = (chunk: Buffer | string) => {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);

    while (buffer.length > 0) {
      let parsed;
      try {
        parsed = parseMessages(buffer);
      } catch (error) {
        writeResponse(parseErrorResponse(
          error instanceof Error ? error.message : 'Invalid ACP stdio frame',
        ));
        buffer = Buffer.alloc(0);
        return;
      }

      if (parsed.messages.length === 0) {
        buffer = parsed.remainder;
        return;
      }

      buffer = parsed.remainder;
      for (const message of parsed.messages) {
        processing = processing.then(async () => {
          const response = await handleJsonRpc(message);
          if (response !== null) {
            writeResponse(response);
          }
        }).catch((error) => {
          errorOutput.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
        });
      }
    }
  };

  const close = async () => {
    if (closed) {
      return;
    }
    closed = true;
    input.off('data', handleChunk);
    input.off('end', handleEnd);
    input.off('error', handleError);
    await processing.catch(() => undefined);
    await options.onClose?.();
  };

  const handleEnd = () => {
    void close();
  };

  const handleError = (error: Error) => {
    errorOutput.write(`${error.stack ?? error.message}\n`);
    void close();
  };

  input.on('data', handleChunk);
  input.on('end', handleEnd);
  input.on('error', handleError);

  return { close };
}
