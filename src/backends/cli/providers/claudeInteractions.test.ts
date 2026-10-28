import { describe, expect, it } from 'vitest';
import {
  CLAUDE_CONTROL, claudeFallback, claudeInteractionKind, mapClaudeInteraction, parseClaudeControlFrame,
} from './claudeInteractions.js';

// Frame provenance: Claude Code 2.1.312 `-p` stream-json with `--permission-prompt-tool stdio`.
// Values are synthetic; no account, path or form answer from the probe is captured.
const tool = (name: string, input: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  subtype: 'can_use_tool', tool_name: name, display_name: name, input, tool_use_id: 'toolu_fixture', ...extra,
});

describe('Claude host control mapping', () => {
  it('parses CLI requests and cancellations and correlates replies by request_id', () => {
    expect(parseClaudeControlFrame(JSON.stringify({ type: 'control_request', request_id: 'r', request: { subtype: 'can_use_tool' } })))
      .toEqual({ type: 'request', requestId: 'r', request: { subtype: 'can_use_tool' } });
    expect(parseClaudeControlFrame(JSON.stringify({ type: 'control_cancel_request', request_id: 'r' })))
      .toEqual({ type: 'cancel', requestId: 'r' });
    expect(parseClaudeControlFrame(JSON.stringify({ type: 'assistant', message: {} }))).toBeUndefined();
    expect(CLAUDE_CONTROL.requestId({ type: 'control_request', request_id: 'cats-runtime-control-1' })).toBe('cats-runtime-control-1');
    expect(CLAUDE_CONTROL.reply({ type: 'control_response', response: { subtype: 'success', request_id: 'x', response: { a: 1 } } }))
      .toEqual({ id: 'x', result: { a: 1 }, failed: false });
    expect(CLAUDE_CONTROL.reply({ type: 'control_response', response: { subtype: 'error', request_id: 'x', error: 'private' } }))
      .toEqual({ id: 'x', result: undefined, failed: true });
    expect(CLAUDE_CONTROL.reply({ id: 'x', result: {} })).toBeUndefined();
  });

  it('maps AskUserQuestion to typed questions and answers keyed by question text', () => {
    const input = { questions: [
      { question: 'Which color?', header: 'Color', multiSelect: false, options: [{ label: 'Red', description: 'warm' }, { label: 'Blue' }] },
      { question: 'Which days?', header: 'Days', multiSelect: true, options: [{ label: 'Mon' }, { label: 'Tue' }] },
    ] };
    const mapped = mapClaudeInteraction(tool('AskUserQuestion', input, { requires_user_interaction: true }), '/w');
    expect(mapped.approval).toBe(false);
    expect(mapped.prompt.kind).toBe('user_input');
    expect(mapped.prompt.fields).toMatchObject([
      { id: 'q0', label: 'Color', description: 'Which color?', type: 'string', allowOther: true, options: [{ id: 'Red' }, { id: 'Blue' }] },
      { id: 'q1', type: 'strings', allowOther: true },
    ]);
    expect(mapped.response({ action: 'accept', values: { q0: 'Blue', q1: ['Mon', 'Tue'] } })).toEqual({ behavior: 'allow',
      updatedInput: { ...input, answers: { 'Which color?': 'Blue', 'Which days?': 'Mon, Tue' } } });
    expect(mapped.response({ action: 'cancel' })).toMatchObject({ behavior: 'deny', interrupt: true });
  });

  it('shows commands and file paths, never file contents', () => {
    const command = mapClaudeInteraction(tool('Bash', { command: 'echo fixture', description: 'Print' }), '/w');
    expect(command.prompt).toMatchObject({ kind: 'command_approval', command: 'echo fixture', message: 'Print', cwd: '/w' });
    const write = mapClaudeInteraction(tool('Write', { file_path: '/w/a.txt', content: 'private-content' }), '/w');
    expect(write.prompt).toMatchObject({ kind: 'file_approval', message: 'Write /w/a.txt (15 characters)' });
    expect(JSON.stringify(write.prompt)).not.toContain('private-content');
    expect(write.response({ action: 'accept', choice: 'accept' })).toEqual({ behavior: 'allow',
      updatedInput: { file_path: '/w/a.txt', content: 'private-content' } });
    expect(write.response({ action: 'decline' })).toEqual({ behavior: 'deny', message: 'The owner declined this request.' });
  });

  it('maps every other tool to a bounded tool approval and keeps suggested rules in the session', () => {
    const request = tool('mcp__claude-in-chrome__navigate', { url: 'https://example.com', blob: 'x'.repeat(6000) }, {
      display_name: 'Navigate', mcp_server: { name: 'claude-in-chrome', source: 'dynamic' },
      permission_suggestions: [
        { type: 'addRules', rules: [{ toolName: 'mcp__claude-in-chrome__navigate' }], behavior: 'allow', destination: 'localSettings' },
        { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
      ],
    });
    expect(claudeInteractionKind(request)).toBe('tool_approval');
    const mapped = mapClaudeInteraction(request, '/w');
    expect(mapped.prompt).toMatchObject({ kind: 'tool_approval', message: 'Navigate', server: 'claude-in-chrome',
      choices: [{ id: 'accept' }, { id: 'acceptForSession' }] });
    expect(mapped.prompt.command!.length).toBeLessThan(4200);
    expect(mapped.prompt.command).toContain('more characters not shown');
    const allowed = mapped.response({ action: 'accept', choice: 'acceptForSession' });
    expect(allowed.updatedPermissions).toEqual([{ type: 'addRules', rules: [{ toolName: 'mcp__claude-in-chrome__navigate' }],
      behavior: 'allow', destination: 'session' }]);
    expect(mapClaudeInteraction(tool('WebFetch', { url: 'https://example.com' }), '/w').prompt.choices).toEqual([{ id: 'accept', label: 'Allow once' }]);
  });

  it('maps form and URL elicitation and rejects unsafe shapes', () => {
    const form = mapClaudeInteraction({ subtype: 'elicitation', mcp_server_name: 'fixture', message: 'Pick', mode: 'form',
      requested_schema: { type: 'object', properties: { b: { type: 'string' }, a: { type: 'string', enum: ['x', 'y'] } }, required: ['a'] },
      property_order: ['a', 'b'] }, '/w');
    expect(form.prompt.fields!.map(field => field.id)).toEqual(['a', 'b']);
    expect(form.response({ action: 'accept', values: { a: 'x' } })).toEqual({ action: 'accept', content: { a: 'x' } });
    expect(form.response({ action: 'decline' })).toEqual({ action: 'decline' });
    const url = mapClaudeInteraction({ subtype: 'elicitation', mcp_server_name: 'fixture', message: 'Sign in', mode: 'url',
      url: 'https://example.test/path', elicitation_id: 'e' }, '/w');
    expect(url.prompt).toMatchObject({ kind: 'mcp_url', url: 'https://example.test/path' });
    expect(url.response({ action: 'accept' })).toEqual({ action: 'accept' });
    expect(() => mapClaudeInteraction({ subtype: 'elicitation', mode: 'url', url: 'file:///secret' }, '/w')).toThrow('Unsupported');
    expect(() => mapClaudeInteraction(tool('AskUserQuestion', { questions: [] }), '/w')).toThrow('Unsupported');
    expect(() => mapClaudeInteraction(tool('Bash', {}), '/w')).toThrow('Unsupported');
    expect(claudeFallback({ subtype: 'elicitation' })).toEqual({ action: 'decline' });
    expect(claudeFallback({ subtype: 'can_use_tool' })).toMatchObject({ behavior: 'deny' });
  });
});
