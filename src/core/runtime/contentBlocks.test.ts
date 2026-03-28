import { describe, expect, it } from 'vitest';
import { createRuntimeContentBlockProjector } from './contentBlocks.js';

describe('runtime content block projector', () => {
  it('merges incremental text into one streaming block and completes it on result', () => {
    const projector = createRuntimeContentBlockProjector();

    const first = projector.project({
      type: 'text',
      text: 'Hello',
    });
    const second = projector.project({
      type: 'text',
      text: ' world',
    });
    const completed = projector.project({
      type: 'result',
    });

    expect(first).toEqual([
      expect.objectContaining({
        type: 'content_block',
        block: expect.objectContaining({
          kind: 'text',
          status: 'streaming',
          text: 'Hello',
          index: 0,
        }),
      }),
    ]);
    expect(second).toEqual([
      expect.objectContaining({
        type: 'content_block',
        block: expect.objectContaining({
          kind: 'text',
          status: 'streaming',
          text: 'Hello world',
          index: 0,
        }),
      }),
    ]);
    expect(completed).toEqual([
      expect.objectContaining({
        type: 'content_block',
        block: expect.objectContaining({
          kind: 'text',
          status: 'complete',
          text: 'Hello world',
          index: 0,
        }),
      }),
    ]);
  });

  it('creates tool blocks and upgrades them with tool results', () => {
    const projector = createRuntimeContentBlockProjector();

    const started = projector.project({
      type: 'tool_use',
      toolName: 'read_file',
      toolId: 'tool-1',
    });
    const completed = projector.project({
      type: 'tool_result',
      toolName: 'read_file',
      toolId: 'tool-1',
      text: 'done',
    });

    expect(started).toEqual([
      expect.objectContaining({
        type: 'content_block',
        block: expect.objectContaining({
          kind: 'tool',
          status: 'streaming',
          toolName: 'read_file',
          toolId: 'tool-1',
        }),
      }),
    ]);
    expect(completed).toEqual([
      expect.objectContaining({
        type: 'content_block',
        block: expect.objectContaining({
          kind: 'tool',
          status: 'complete',
          text: 'done',
          toolName: 'read_file',
          toolId: 'tool-1',
        }),
      }),
    ]);
  });

  it('projects progress checkpoints into status blocks', () => {
    const projector = createRuntimeContentBlockProjector();

    const blocks = projector.project({
      type: 'progress',
      text: 'Updating plan',
      metadata: {
        kind: 'plan',
      },
    });

    expect(blocks).toEqual([
      expect.objectContaining({
        type: 'content_block',
        block: expect.objectContaining({
          kind: 'status',
          status: 'complete',
          title: 'Plan',
          text: 'Updating plan',
          metadata: expect.objectContaining({
            kind: 'plan',
          }),
        }),
      }),
    ]);
  });
});
