import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ClaudeProvider } from './claude.js';
import { CodexProvider } from './codex.js';
import { GrokProvider } from './grok.js';
import { HostedAcpProvider } from './hostedAcp.js';
import type { StreamEvent } from './types.js';

// ADR-006 rule 8: each provider's own "this native session cannot be resumed"
// answer, captured live without a model turn, becomes `provider_session_unavailable`.
const captures = new URL('../../../../tests/fixtures/provider-captures/', import.meta.url);
const hostedPolicy = {
  interactionHost: { version: 1 as const, kinds: ['command_approval' as const], timeoutMs: 60_000 },
  executionPolicy: { version: 1 as const, mode: 'provider' as const,
    constraints: { maxAccess: 'full-access' as const, network: true } },
};

function capture(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, captures)), 'utf8').trim();
}

function events(parsed: StreamEvent | StreamEvent[] | null): StreamEvent[] {
  if (!parsed) return [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

describe('provider session unavailable classification', () => {
  it('classifies the Grok streaming-json answer to a resume id it no longer has', () => {
    const provider = new GrokProvider();
    expect(events(provider.parseStreamLine(capture('grok-1.0.77/resume-missing.error.redacted.ndjson'))))
      .toMatchObject([{
        type: 'error',
        code: 'provider_session_unavailable',
        text: expect.stringContaining('No saved copy of session'),
      }]);
  });

  it('keeps other Grok errors generic', () => {
    const provider = new GrokProvider();
    const [event] = events(provider.parseStreamLine(capture('grok-1.0.0/auth-missing.error.redacted.ndjson')));
    expect(event).toMatchObject({ type: 'error' });
    expect(event).not.toHaveProperty('code');
  });

  it('classifies the Claude result frame for a conversation it does not have, without its stale id', () => {
    const provider = new ClaudeProvider();
    const parsed = events(provider.parseStreamLine(capture('claude-2.1.322/resume-missing.error.redacted.ndjson')));
    expect(parsed).toMatchObject([{
      type: 'error',
      code: 'provider_session_unavailable',
      text: expect.stringContaining('No conversation found with session ID'),
    }]);
    // A result with this id would make the pool record it as the live native session.
    expect(parsed[0]).not.toHaveProperty('sessionId');
  });

  it('keeps a Claude error result that is not a missing conversation as a result', () => {
    const provider = new ClaudeProvider();
    const frame = JSON.parse(capture('claude-2.1.322/resume-missing.error.redacted.ndjson')) as Record<string, unknown>;
    const parsed = events(provider.parseStreamLine(JSON.stringify({ ...frame, errors: ['Some other failure'] })));
    expect(parsed).toMatchObject([{ type: 'result' }]);
  });

  it('classifies the Codex thread/resume rejection for a thread without a rollout', () => {
    const provider = new CodexProvider();
    provider.buildSpawnArgs({ cwd: '/tmp/test', resumeSessionId: '11111111-2222-4333-8444-555555555555' });
    const bootstrap = provider.buildStdinMessage('hello').trim().split('\n').map(line => JSON.parse(line));
    const resume = bootstrap.find(message => message.method === 'thread/resume');
    expect(resume).toBeDefined();
    // The capture answered request id 2; the adapter assigns its own ids.
    const reply = { ...JSON.parse(capture('codex-0.167.0/thread-resume-missing.error.redacted.ndjson')), id: resume.id };
    expect(events(provider.parseStreamLine(JSON.stringify(reply)))).toMatchObject([{
      type: 'error',
      code: 'provider_session_unavailable',
      text: expect.stringContaining('no rollout found for thread id'),
    }]);
  });

  it('keeps a Codex thread/start rejection generic', () => {
    const provider = new CodexProvider();
    provider.buildSpawnArgs({ cwd: '/tmp/test' });
    const bootstrap = provider.buildStdinMessage('hello').trim().split('\n').map(line => JSON.parse(line));
    const start = bootstrap.find(message => message.method === 'thread/start');
    const reply = { ...JSON.parse(capture('codex-0.167.0/thread-resume-missing.error.redacted.ndjson')), id: start.id };
    const [event] = events(provider.parseStreamLine(JSON.stringify(reply)));
    expect(event).toMatchObject({ type: 'error' });
    expect(event).not.toHaveProperty('code');
  });

  it('classifies the hosted Grok ACP session/resume answer for a missing session', () => {
    const provider = new HostedAcpProvider('grok');
    provider.configureExecution({ localWorkspaceCwd: '/workspace', sessionMcpToken: () => 'fixture-secret' });
    provider.buildSpawnArgs({
      cwd: '/workspace',
      resumeSessionId: '11111111-2222-4333-8444-555555555555',
      ...hostedPolicy,
    });
    const init = JSON.parse(provider.buildInitialization()!);
    provider.parseStreamLine(JSON.stringify({ id: init.id, result: { protocolVersion: 1,
      agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } } } }));
    const resume = JSON.parse(provider.getPendingControlMessages()!);
    expect(resume.method).toBe('session/resume');
    const reply = { ...JSON.parse(capture('grok-1.0.77/acp-resume-missing.error.redacted.ndjson')), id: resume.id };
    expect(events(provider.parseStreamLine(JSON.stringify(reply)))).toMatchObject([{
      type: 'error',
      code: 'provider_session_unavailable',
    }]);
    expect(provider.isSessionFailed()).toBe(true);
  });

  it('keeps other hosted ACP resume rejections generic', () => {
    const provider = new HostedAcpProvider('grok');
    provider.configureExecution({ localWorkspaceCwd: '/workspace', sessionMcpToken: () => 'fixture-secret' });
    provider.buildSpawnArgs({
      cwd: '/workspace',
      resumeSessionId: 'native-session',
      ...hostedPolicy,
    });
    const init = JSON.parse(provider.buildInitialization()!);
    provider.parseStreamLine(JSON.stringify({ id: init.id, result: { protocolVersion: 1,
      agentCapabilities: { sessionCapabilities: { resume: {} } } } }));
    const resume = JSON.parse(provider.getPendingControlMessages()!);
    const [event] = events(provider.parseStreamLine(JSON.stringify({ id: resume.id,
      error: { code: -32603, message: 'Internal error' } })));
    expect(event).toMatchObject({ type: 'error' });
    expect(event).not.toHaveProperty('code');
  });
});
