import { describe, expect, it } from 'vitest';
import { createToolCallBatchSignature, updateRepeatedToolCallState } from './reactGuards.js';

describe('react strategy guards', () => {
  it('builds stable duplicate-detection signatures regardless of object key order', () => {
    const left = createToolCallBatchSignature([{
      type: 'tool_call',
      id: 'call-1',
      name: 'read_file',
      arguments: {
        path: 'answer.txt',
        options: {
          encoding: 'utf-8',
          startLine: 1,
        },
      },
    }]);
    const right = createToolCallBatchSignature([{
      type: 'tool_call',
      id: 'call-2',
      name: 'read_file',
      arguments: {
        options: {
          startLine: 1,
          encoding: 'utf-8',
        },
        path: 'answer.txt',
      },
    }]);

    expect(left).toBe(right);
  });

  it('marks the loop as stuck once duplicate tool batches reach the configured threshold', () => {
    const toolCalls = [{
      type: 'tool_call',
      id: 'call-1',
      name: 'read_file',
      arguments: { path: 'answer.txt' },
    }] as const;

    const first = updateRepeatedToolCallState(undefined, [...toolCalls], 2);
    const second = updateRepeatedToolCallState(first, [...toolCalls], 2);
    const reset = updateRepeatedToolCallState(second, [{
      type: 'tool_call',
      id: 'call-2',
      name: 'list_files',
      arguments: { path: '.' },
    }], 2);

    expect(first).toEqual({
      signature: 'read_file:{"path":"answer.txt"}',
      consecutiveCount: 1,
      stuck: false,
    });
    expect(second).toEqual({
      signature: 'read_file:{"path":"answer.txt"}',
      consecutiveCount: 2,
      stuck: true,
    });
    expect(reset).toEqual({
      signature: 'list_files:{"path":"."}',
      consecutiveCount: 1,
      stuck: false,
    });
  });
});
