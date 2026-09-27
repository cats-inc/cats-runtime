import { describe, expect, it } from 'vitest';
import { CodexProvider } from './codex.js';
import type { ProviderSpawnOptions } from './types.js';

const workspaceWrite = { type: 'workspaceWrite', writableRoots: [], networkAccess: false,
  excludeTmpdirEnvVar: false, excludeSlashTmp: false };
const readOnly = { type: 'readOnly', networkAccess: false };
const accepted = { thread: { id: 'thread' }, sandbox: workspaceWrite, approvalPolicy: 'never' };

function bootstrap(options: Partial<ProviderSpawnOptions> = {}) {
  const provider = new CodexProvider();
  provider.buildSpawnArgs({ cwd: '/workspace', permissionMode: 'skip', ...options });
  const lines = provider.buildStdinMessage('Pending work').trim().split('\n')
    .map((line) => JSON.parse(line));
  const request = lines[2];
  return { provider, request, respond: (result: unknown, id = request.id) =>
    provider.parseStreamLine(JSON.stringify({ id, result })) };
}

function started(provider: CodexProvider) {
  return provider.parseStreamLine(JSON.stringify({ method: 'thread/started',
    params: { thread: { id: 'notification-thread' } } }));
}

describe('Codex effective bootstrap permission checks', () => {
  it('explains sandbox setup after a write-to-read downgrade without changing the request', () => {
    const { provider, request, respond } = bootstrap();
    expect(respond({ ...accepted, sandbox: readOnly })).toMatchObject({ type: 'error',
      text: expect.stringContaining('check windows.sandbox') });
    expect(request.params).toMatchObject({ sandbox: 'workspace-write', approvalPolicy: 'never' });
    expect(request.params.config).toBeUndefined();
    expect(provider.getPendingTurnStart()).toBeNull();
  });

  it('does not suggest Windows sandbox setup for an approval-only mismatch', () => {
    const { respond } = bootstrap();
    expect(JSON.stringify(respond({ ...accepted, approvalPolicy: 'untrusted' })))
      .not.toContain('windows.sandbox');
  });

  it.each([
    { options: {}, method: 'thread/start' },
    { options: { resumeSessionId: 'previous' }, method: 'thread/resume' },
    { options: { resumeSessionId: 'previous', forkSession: true }, method: 'thread/fork' },
  ])('waits for the correlated $method response, not an early notification', ({ options, method }) => {
    const { provider, request, respond } = bootstrap(options);
    expect(request.method).toBe(method);
    expect(started(provider)).toBeNull();
    expect(respond(accepted, 0)).toBeNull(); // initialize cannot supply a thread
    expect(respond(accepted, 99)).toBeNull();
    expect(respond(accepted, String(request.id))).toBeNull();
    expect(provider.getPendingTurnStart()).toBeNull();
    expect(respond(accepted)).toEqual({ type: 'init', sessionId: 'thread' });
    expect(started(provider)).toBeNull();
    expect(respond(accepted)).toBeNull();
    const turn = JSON.parse(provider.getPendingTurnStart()!);
    expect(turn).toMatchObject({ method: 'turn/start', params: { threadId: 'thread',
      approvalPolicy: 'never', input: [{ type: 'text', text: 'Pending work' }] } });
    expect(provider.getPendingTurnStart()).toBeNull();
  });

  it.each(['default', 'skip', 'whitelist'] as const)('accepts matching read-only / %s', (permissionMode) => {
    const { provider, respond } = bootstrap({ workspaceMode: 'read_only', permissionMode });
    expect(respond({ ...accepted, sandbox: readOnly,
      approvalPolicy: permissionMode === 'whitelist' ? 'untrusted' : 'never' }))
      .toMatchObject({ type: 'init' });
    expect(JSON.parse(provider.getPendingTurnStart()!).method).toBe('turn/start');
  });

  it.each([
    { options: {}, sandbox: readOnly },
    { options: { resumeSessionId: 'previous' }, sandbox: readOnly },
    { options: { resumeSessionId: 'previous', forkSession: true }, sandbox: readOnly },
    { options: {}, sandbox: { type: 'dangerFullAccess' } },
    { options: {}, sandbox: { type: 'externalSandbox', networkAccess: 'enabled' } },
    { options: { workspaceMode: 'read_only' as const }, sandbox: workspaceWrite },
  ])('blocks narrowed or widened native permissions and cannot revive ($options, $sandbox.type)',
    ({ options, sandbox }) => {
      const { provider, respond } = bootstrap(options);
      started(provider);
      expect(respond({ ...accepted, sandbox })).toMatchObject({ type: 'error',
        text: expect.stringContaining('effective permission mismatch') });
      expect(provider.getPendingTurnStart()).toBeNull();
      expect(started(provider)).toBeNull();
      expect(respond(accepted)).toBeNull();
      expect(provider.getPendingTurnStart()).toBeNull();
      expect(() => provider.buildStdinMessage('Do not retry')).toThrow('bootstrap failed');
    });

  it.each([
    { sandbox: undefined }, { sandbox: null }, { sandbox: [] },
    { sandbox: 'workspace-write' }, { sandbox: { type: 'private-response-marker' } },
    { approvalPolicy: undefined }, { approvalPolicy: null },
    { approvalPolicy: 'untrusted' }, { approvalPolicy: 'on-request' },
    { approvalPolicy: { granular: { private: 'private-response-marker' } } },
  ])('blocks absent, malformed or mismatched permission proof without echoing raw data (%j)', (fields) => {
    const { provider, respond } = bootstrap();
    const event = respond({ ...accepted, ...fields });
    expect(event).toMatchObject({ type: 'error', text: expect.stringContaining('No model turn was started') });
    expect(JSON.stringify(event)).not.toContain('private-response-marker');
    expect(provider.getPendingTurnStart()).toBeNull();
  });

  it.each([{}, [], null, { ...accepted, thread: { id: ' ' } }])(
    'fails explicitly on a malformed bootstrap response (%j)', (response) => {
      const { provider, respond } = bootstrap();
      expect(respond(response)).toMatchObject({ type: 'error',
        text: expect.stringContaining('valid thread') });
      expect(provider.getPendingTurnStart()).toBeNull();
      expect(() => provider.buildStdinMessage('Retry')).toThrow('bootstrap failed');
    });

  it('cannot revive failed initialization from a late success or notification', () => {
    const { provider, respond } = bootstrap();
    expect(provider.parseStreamLine(JSON.stringify({ id: 0,
      error: { code: -32600, message: 'Initialization refused' } }))).toMatchObject({ type: 'error' });
    expect(started(provider)).toBeNull();
    expect(respond(accepted)).toBeNull();
    expect(provider.getPendingTurnStart()).toBeNull();
    expect(() => provider.buildStdinMessage('Retry')).toThrow('bootstrap failed');
  });
});
