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
});
