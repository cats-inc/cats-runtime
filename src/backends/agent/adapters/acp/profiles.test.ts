import { describe, expect, it } from 'vitest';
import type { RemoteProviderInstanceConfig } from '../../../cli/config.js';
import { resolveAcpProviderProfile } from './profiles.js';

function createInstance(
  command: string,
  args: string[],
): RemoteProviderInstanceConfig {
  return {
    id: 'acp-test',
    providerName: 'generic',
    backend: 'agent',
    transport: 'acp_stdio',
    command,
    args,
  };
}

describe('resolveAcpProviderProfile', () => {
  it.each([
    {
      label: 'Codex',
      instance: createInstance('npx', ['-y', '@zed-industries/codex-acp@latest', 'serve']),
      expected: { id: 'codex-acp', tier: 1 },
    },
    {
      label: 'Claude',
      instance: createInstance('pnpm', ['dlx', '@agentclientprotocol/claude-agent-acp@0.9.0', 'serve']),
      expected: { id: 'claude-acp', tier: 1 },
    },
    {
      label: 'Gemini',
      instance: createInstance('npx', ['-y', '@google/gemini-acp@latest', 'serve']),
      expected: { id: 'gemini-acp', tier: 1 },
    },
    {
      label: 'Cursor',
      instance: createInstance('bunx', ['@cursor/cursor-acp@beta', 'serve']),
      expected: { id: 'cursor-acp', tier: 1 },
    },
    {
      label: 'Copilot',
      instance: createInstance('npx', ['-y', '@github/copilot-acp@next', 'serve']),
      expected: { id: 'copilot-acp', tier: 1 },
    },
    {
      label: 'Claude Windows wrapper',
      instance: createInstance('C:\\tools\\claude-agent-acp.cmd', ['serve']),
      expected: { id: 'claude-acp', tier: 1 },
    },
    {
      label: 'Codex Node script',
      instance: createInstance('node', ['/opt/acp/codex-acp.mjs', 'serve']),
      expected: { id: 'codex-acp', tier: 1 },
    },
  ])('resolves $label Tier 1 profile from common launch forms', ({ instance, expected }) => {
    expect(resolveAcpProviderProfile(instance)).toEqual(
      expect.objectContaining(expected),
    );
  });

  it.each([
    {
      label: 'OpenCode',
      instance: createInstance('opencode', ['acp']),
      expected: { id: 'opencode-acp', tier: 2 },
    },
    {
      label: 'Kilo npm CLI',
      instance: createInstance('npx', ['-y', '@kilocode/cli@latest', 'acp']),
      expected: { id: 'kilo-acp', tier: 2 },
    },
    {
      label: 'Goose',
      instance: createInstance('goose', ['acp']),
      expected: { id: 'goose-acp', tier: 2 },
    },
    {
      label: 'Pi',
      instance: createInstance('npx', ['-y', 'pi-acp@latest']),
      expected: { id: 'pi-acp', tier: 2 },
    },
    {
      label: 'Auggie',
      instance: createInstance('npx', ['-y', '@augmentcode/auggie@latest', '--acp']),
      expected: { id: 'auggie-acp', tier: 2 },
    },
    {
      label: 'Junie',
      instance: createInstance('/Applications/junie.app/Contents/MacOS/junie', ['--acp=true']),
      expected: { id: 'junie-acp', tier: 2 },
    },
    {
      label: 'Kiro',
      instance: createInstance('kiro-cli', ['acp']),
      expected: { id: 'kiro-acp', tier: 2 },
    },
    {
      label: 'Auggie alternate name',
      instance: createInstance('augment-code-acp', ['serve']),
      expected: { id: 'auggie-acp', tier: 2 },
    },
  ])('resolves $label Tier 2 profile from common launch forms', ({ instance, expected }) => {
    expect(resolveAcpProviderProfile(instance)).toEqual(
      expect.objectContaining(expected),
    );
  });
});
