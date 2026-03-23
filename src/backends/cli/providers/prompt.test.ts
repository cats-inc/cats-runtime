import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveRuntimeSkillManifest } from '../../../core/skills/catalog.js';
import { compileRuntimeTurnInstructions, compileRuntimeTurnPrompt } from './prompt.js';

describe('runtime turn prompt compilation', () => {
  const cleanupPaths: string[] = [];

  afterEach(() => {
    while (cleanupPaths.length > 0) {
      const target = cleanupPaths.pop();
      if (target) {
        rmSync(target, { recursive: true, force: true });
      }
    }
  });

  it('layers skill, session, and turn instructions in order for prompt-driven CLI providers', () => {
    const sessionBaseDir = mkdtempSync(join(tmpdir(), 'cats-runtime-cli-prompt-'));
    cleanupPaths.push(sessionBaseDir);
    const cwd = join(sessionBaseDir, 'repo');
    mkdirSync(cwd, { recursive: true });

    const skillState = resolveRuntimeSkillManifest({
      requestedSkills: ['companion'],
    }, {
      sessionId: 'prompt-session',
      providerName: 'claude',
      providerBackend: 'cli',
      cwd,
      workspaceMode: 'shared',
      sessionBaseDir,
    });

    const instructions = compileRuntimeTurnInstructions({
      sessionInstructions: 'Session-level instructions.',
      instructions: 'Turn-level instructions.',
      skills: skillState,
    });

    expect(instructions).toContain('Runtime Skill:');
    expect(instructions).toContain('Session-level instructions.');
    expect(instructions).toContain('Turn-level instructions.');
    expect(instructions).toMatch(
      /Runtime Skill:[\s\S]+Session-level instructions\.\s+Turn-level instructions\./,
    );

    const prompt = compileRuntimeTurnPrompt('Hello there', {
      sessionInstructions: 'Session-level instructions.',
      instructions: 'Turn-level instructions.',
      skills: skillState,
    });
    expect(prompt).toContain('Instructions:');
    expect(prompt).toContain('User message:');
    expect(prompt).toContain('Hello there');
  });
});
