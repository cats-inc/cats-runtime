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
      label: 'Antigravity',
      instance: createInstance('agy-acp', ['serve']),
      expected: { id: 'agy-acp', tier: 1 },
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
      label: 'Devin',
      instance: createInstance('devin', ['acp']),
      expected: { id: 'devin-acp', tier: 1 },
    },
    {
      label: 'Devin with an absolute Windows path',
      instance: createInstance(
        String.raw`C:\Users\dev\AppData\Local\devin\cli\bin\devin.exe`,
        ['acp'],
      ),
      expected: { id: 'devin-acp', tier: 1 },
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

  it.each([
    {
      label: 'OpenCode bare binary',
      instance: {
        ...createInstance('opencode', []),
        providerName: 'opencode',
      } satisfies RemoteProviderInstanceConfig,
    },
    {
      label: 'Kilo bare binary',
      instance: {
        ...createInstance('kilo', []),
        providerName: 'kilo',
      } satisfies RemoteProviderInstanceConfig,
    },
    {
      label: 'Goose bare binary',
      instance: {
        ...createInstance('goose', []),
        providerName: 'goose',
      } satisfies RemoteProviderInstanceConfig,
    },
    {
      label: 'Pi provider name only',
      instance: {
        ...createInstance('npx', []),
        providerName: 'pi',
      } satisfies RemoteProviderInstanceConfig,
    },
    {
      label: 'Auggie without --acp',
      instance: {
        ...createInstance('auggie', []),
        providerName: 'auggie',
      } satisfies RemoteProviderInstanceConfig,
    },
    {
      label: 'Junie without --acp flag',
      instance: {
        ...createInstance('/Applications/junie.app/Contents/MacOS/junie', []),
        providerName: 'junie',
      } satisfies RemoteProviderInstanceConfig,
    },
    {
      label: 'Kiro CLI without acp subcommand',
      instance: {
        ...createInstance('kiro-cli', []),
        providerName: 'kiro',
      } satisfies RemoteProviderInstanceConfig,
    },
    {
      // Bare `devin` is the CLI backend's plain-prose surface, not an ACP
      // server. Resolving it here would route sessions at a transport that
      // does not exist on that command.
      label: 'Devin without the acp subcommand',
      instance: createInstance('devin', ['--print', 'hello']),
    },
  ])('does not resolve $label without an ACP-specific launch signal', ({ instance }) => {
    expect(resolveAcpProviderProfile(instance)).toBeUndefined();
  });

  it('resolves Devin ACP and probes help behind the acp subcommand', () => {
    const profile = resolveAcpProviderProfile(createInstance('devin', ['acp']));

    expect(profile).toEqual(expect.objectContaining({ id: 'devin-acp', family: 'devin', tier: 1 }));
    // Devin has no standalone *-acp binary, so `devin --help` describes the CLI
    // rather than the ACP server.
    expect(profile?.probe.helpArgs).toEqual(['acp', '--help']);
  });

  it('pins Devin session modes so a conservative turn cannot edit un-gated', () => {
    // Live probe (Devin 3000.3.27): in the default accept-edits mode Devin calls
    // fs/write_text_file with no session/request_permission at all, so leaving
    // the mode unset would let a runtime `default` turn edit the workspace.
    const profile = resolveAcpProviderProfile(createInstance('devin', ['acp']));

    expect(profile?.sessionModes).toEqual({
      skip: 'bypass',
      default: 'ask',
      whitelist: null,
    });
  });

  it('leaves agents without a declared mapping governed by permission requests', () => {
    expect(resolveAcpProviderProfile(createInstance('codex-acp', ['serve']))?.sessionModes)
      .toBeUndefined();
  });

  it('resolves Antigravity provider-managed ACP without treating raw agy stdio as ACP', () => {
    expect(resolveAcpProviderProfile({
      ...createInstance('', []),
      providerName: 'antigravity',
      transport: 'acp',
    })).toEqual(expect.objectContaining({ id: 'agy-acp' }));

    expect(resolveAcpProviderProfile({
      ...createInstance('agy', []),
      providerName: 'antigravity',
    })).toBeUndefined();
  });
});
