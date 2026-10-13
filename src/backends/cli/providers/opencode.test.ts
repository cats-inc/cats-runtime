import { describe, expect, it, vi } from 'vitest';
import { OpencodeProvider } from './opencode.js';
import type { OpencodeNativeSessionService } from '../opencode/OpencodeNativeSessionService.js';

describe('OpencodeProvider', () => {
  it('emits tool, text, and result events and auto-handles pending requests', async () => {
    let capturedContent = '';
    const native = {
      prompt: vi.fn(async (input: { content: string }) => {
        capturedContent = input.content;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          sessionId: 'oc-1',
          messageId: 'msg-1',
          text: 'Done.',
          usage: {
            inputTokens: 11,
            outputTokens: 22,
          },
          toolUses: [
            { toolId: 'tool-1', toolName: 'write' },
          ],
        };
      }),
      abortSession: vi.fn(),
      listPendingPermissions: vi.fn()
        .mockResolvedValueOnce([
          {
            id: 'perm-1',
            sessionID: 'oc-1',
            permission: 'write',
            patterns: [],
          },
        ])
        .mockResolvedValue([]),
      replyPermission: vi.fn().mockResolvedValue(true),
      listPendingQuestions: vi.fn()
        .mockResolvedValueOnce([
          {
            id: 'question-1',
            sessionID: 'oc-1',
          },
        ])
        .mockResolvedValue([]),
      rejectQuestion: vi.fn().mockResolvedValue(true),
    } as unknown as OpencodeNativeSessionService;
    const provider = new OpencodeProvider(native);

    const events: unknown[] = [];
    for await (const event of provider.streamTurn({
      message: 'Ship it',
      sessionInstructions: 'Session-level instructions.',
      instructions: 'Turn-level instructions.',
    }, {
      cwd: '/tmp/repo',
      resumeSessionId: 'oc-1',
      permissionMode: 'skip',
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: 'tool_use',
        toolId: 'tool-1',
        toolName: 'write',
      },
      {
        type: 'text',
        text: 'Done.',
      },
      {
        type: 'result',
        sessionId: 'oc-1',
        usage: {
          inputTokens: 11,
          outputTokens: 22,
        },
      },
    ]);
    expect(capturedContent).toContain('Session-level instructions.');
    expect(capturedContent).toContain('Turn-level instructions.');
    expect(capturedContent).toContain('User message:');
    expect(vi.mocked(native.replyPermission)).toHaveBeenCalledWith(
      '/tmp/repo',
      'perm-1',
      'once',
      undefined,
    );
    expect(vi.mocked(native.rejectQuestion)).toHaveBeenCalledWith(
      '/tmp/repo',
      'question-1',
    );
  });
});

describe('OpencodeProvider variant', () => {
  async function promptVariant(controls?: Record<string, string>) {
    const native = {
      prompt: vi.fn(async () => ({ sessionId: 'oc-1', messageId: 'msg-1', text: 'ok', toolUses: [] })),
      abortSession: vi.fn(),
      listPendingPermissions: vi.fn().mockResolvedValue([]),
      replyPermission: vi.fn(),
      listPendingQuestions: vi.fn().mockResolvedValue([]),
      rejectQuestion: vi.fn(),
    } as unknown as OpencodeNativeSessionService;
    const provider = new OpencodeProvider(native);
    for await (const _event of provider.streamTurn({ message: 'Hi' }, {
      cwd: '/tmp/repo',
      resumeSessionId: 'oc-1',
      model: 'opencode-go/glm-5.3',
      ...(controls ? { modelControls: controls } : {}),
    })) { /* drain */ }
    return (native.prompt as unknown as { mock: { calls: Array<[{ variant?: string }]> } }).mock.calls[0][0].variant;
  }

  it('sends the selected variant and leaves Default or no selection unset', async () => {
    await expect(promptVariant({ 'opencode.variant': 'high' })).resolves.toBe('high');
    await expect(promptVariant({ 'opencode.variant': 'default' })).resolves.toBeUndefined();
    await expect(promptVariant()).resolves.toBeUndefined();
  });
});
