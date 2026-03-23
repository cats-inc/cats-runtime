import { describe, it, expect } from 'vitest';
import type { SessionSkillState } from '../../../core/types.js';
import { PiProvider } from './pi.js';

describe('PiProvider', () => {
  const provider = new PiProvider();

  function buildSkillState(filePath?: string): SessionSkillState {
    return {
      requestedSkills: ['delivery-auditor'],
      requestedSkillRefs: [{
        id: 'delivery-auditor',
        slug: 'delivery-auditor',
        requestedAs: 'delivery-auditor',
      }],
      resolvedSkills: [{
        id: 'delivery-auditor',
        slug: 'delivery-auditor',
        title: 'Delivery Auditor',
        description: 'Checks delivery and outputs.',
        status: 'resolved',
        source: 'runtime_catalog',
        sourcePath: 'skills/delivery-auditor',
        entryFile: 'skills/delivery-auditor/SKILL.md',
        fingerprint: 'delivery-auditor-fingerprint',
      }],
      strict: false,
      delivery: {
        provider: 'pi',
        backend: 'cli',
        preferredMode: 'instructions',
        mode: 'instructions',
        status: 'applied',
        warnings: [],
        instructions: {
          filePath,
          byteLength: 120,
        },
      },
      warnings: [],
      appliedSkillIds: ['delivery-auditor'],
      updatedAt: '2026-03-23T00:00:00.000Z',
    };
  }

  it('has correct name and capabilities', () => {
    expect(provider.name).toBe('pi');
    expect(provider.capabilities).toEqual({
      resume: true,
      fork: false,
      permissions: false,
    });
  });

  describe('buildSpawnArgs', () => {
    it('builds basic args with RPC mode', () => {
      const args = provider.buildSpawnArgs({ cwd: '/tmp/test' });
      expect(args).toEqual(['--mode', 'rpc']);
    });

    it('splits model into --provider and --model flags', () => {
      const args = provider.buildSpawnArgs({
        cwd: '/tmp',
        model: 'xai/grok-4',
      });
      expect(args).toContain('--provider');
      expect(args).toContain('xai');
      expect(args).toContain('--model');
      expect(args).toContain('grok-4');
    });

    it('includes session flag for resume', () => {
      const args = provider.buildSpawnArgs({
        cwd: '/tmp',
        resumeSourcePath: '/home/user/.pi/agent/sessions/session.jsonl',
      });
      expect(args).toContain('--session');
      expect(args).toContain('/home/user/.pi/agent/sessions/session.jsonl');
    });

    it('combines model and resume', () => {
      const args = provider.buildSpawnArgs({
        cwd: '/tmp',
        model: 'openai/gpt-4o',
        resumeSourcePath: '/tmp/session.jsonl',
      });
      expect(args).toEqual([
        '--mode', 'rpc',
        '--provider', 'openai',
        '--model', 'gpt-4o',
        '--session', '/tmp/session.jsonl',
      ]);
    });

    it('includes append-system-prompt when an instructions file is configured', () => {
      const configuredProvider = new PiProvider({
        instructionsFile: '/tmp/pi-system-prompt.md',
      });

      const args = configuredProvider.buildSpawnArgs({ cwd: '/tmp' });

      expect(args).toEqual([
        '--mode', 'rpc',
        '--append-system-prompt', '/tmp/pi-system-prompt.md',
      ]);
    });

    it('prefers a session-scoped instructions file over the provider default', () => {
      const configuredProvider = new PiProvider({
        instructionsFile: '/tmp/pi-system-prompt.md',
      });

      const args = configuredProvider.buildSpawnArgs({
        cwd: '/tmp',
        instructionsFile: '/tmp/runtime-skill-prompt.md',
      });

      expect(args).toEqual([
        '--mode', 'rpc',
        '--append-system-prompt', '/tmp/runtime-skill-prompt.md',
      ]);
    });

    it('throws for invalid model format', () => {
      expect(() => provider.buildSpawnArgs({
        cwd: '/tmp',
        model: 'grok-4',
      })).toThrow(/Invalid Pi model format/);
    });
  });

  describe('buildStdinMessage', () => {
    it('formats as Pi RPC prompt JSON', () => {
      const msg = provider.buildStdinMessage('Hello world');
      const parsed = JSON.parse(msg.trim());
      expect(parsed.type).toBe('prompt');
      expect(parsed.message).toBe('Hello world');
    });

    it('prefixes explicit instructions into the prompt payload', () => {
      const msg = provider.buildStdinMessage('Hello world', {
        message: 'Hello world',
        instructions: 'Stay terse.',
      });
      const parsed = JSON.parse(msg.trim());
      expect(parsed.message).toContain('Instructions:\nStay terse.');
      expect(parsed.message).toContain('User message:\nHello world');
    });

    it('does not duplicate runtime skill overlays when the active prompt file already matches', () => {
      provider.buildSpawnArgs({
        cwd: '/tmp',
        instructionsFile: '/tmp/runtime-skill-prompt.md',
      });

      const msg = provider.buildStdinMessage('Hello world', {
        message: 'Hello world',
        instructions: 'Stay terse.',
        skills: buildSkillState('/tmp/runtime-skill-prompt.md'),
      });
      const parsed = JSON.parse(msg.trim());

      expect(parsed.message).toContain('Instructions:\nStay terse.');
      expect(parsed.message).not.toContain('Runtime Skill: Delivery Auditor');
    });

    it('inlines runtime skill overlays when the turn skill prompt file differs from spawn state', () => {
      provider.buildSpawnArgs({
        cwd: '/tmp',
        instructionsFile: '/tmp/runtime-skill-prompt-a.md',
      });

      const msg = provider.buildStdinMessage('Hello world', {
        message: 'Hello world',
        instructions: 'Stay terse.',
        skills: buildSkillState('/tmp/runtime-skill-prompt-b.md'),
      });
      const parsed = JSON.parse(msg.trim());

      expect(parsed.message).toContain('Instructions:\nThe following runtime-managed skills');
      expect(parsed.message).toContain('Runtime Skill: Delivery Auditor');
      expect(parsed.message).toContain('Stay terse.');
      expect(parsed.message).toContain('User message:\nHello world');
    });
  });

  describe('parseStreamLine', () => {
    it('parses text delta from message_update', () => {
      const line = JSON.stringify({
        type: 'message_update',
        assistantMessageEvent: {
          type: 'text_delta',
          delta: 'Hello!',
        },
      });
      const event = provider.parseStreamLine(line);
      expect(event?.type).toBe('text');
      expect(event?.text).toBe('Hello!');
    });

    it('parses turn_end as result with usage', () => {
      const line = JSON.stringify({
        type: 'turn_end',
        message: {
          role: 'assistant',
          content: 'done',
          usage: { input: 200, output: 100, cacheRead: 50 },
        },
      });
      const event = provider.parseStreamLine(line);
      expect(event?.type).toBe('result');
      expect(event?.usage?.inputTokens).toBe(250);
      expect(event?.usage?.outputTokens).toBe(100);
    });

    it('parses tool_execution_start', () => {
      const line = JSON.stringify({
        type: 'tool_execution_start',
        toolCallId: 'tc_1',
        toolName: 'read',
      });
      const event = provider.parseStreamLine(line);
      expect(Array.isArray(event)).toBe(true);
      expect(event).toEqual([
        expect.objectContaining({
          type: 'progress',
        }),
        expect.objectContaining({
          type: 'tool_use',
          toolName: 'read',
        }),
      ]);
    });

    it('returns null for empty lines', () => {
      expect(provider.parseStreamLine('')).toBeNull();
      expect(provider.parseStreamLine('  ')).toBeNull();
    });

    it('returns raw for non-JSON lines', () => {
      const event = provider.parseStreamLine('Pi starting...');
      expect(event?.type).toBe('raw');
    });
  });
});
