import { describe, expect, it } from 'vitest';
import { resolveAcpSessionModeId } from './AcpAdapter.js';
import { resolveAcpProviderProfile } from './profiles.js';
import type { RemoteProviderInstanceConfig } from '../../../cli/config.js';

function devinInstance(): RemoteProviderInstanceConfig {
  return {
    id: 'acp',
    providerName: 'devin',
    backend: 'agent',
    transport: 'acp_stdio',
    command: 'devin',
    args: ['acp'],
  };
}

const devinProfile = resolveAcpProviderProfile(devinInstance());

describe('resolveAcpSessionModeId', () => {
  it('pins Devin to bypass when the runtime skips permission checks', () => {
    expect(resolveAcpSessionModeId(devinProfile, 'skip', 'devin')).toBe('bypass');
  });

  it('pins Devin to ask for the conservative default', () => {
    // Devin's own default is accept-edits, which writes files without ever
    // issuing session/request_permission. Not setting the mode would let a
    // `default` turn edit the workspace un-gated.
    expect(resolveAcpSessionModeId(devinProfile, 'default', 'devin')).toBe('ask');
  });

  it('treats an unset permission mode as default rather than leaving it unpinned', () => {
    expect(resolveAcpSessionModeId(devinProfile, undefined, 'devin')).toBe('ask');
  });

  it('refuses whitelist mode instead of falling back to a weaker session mode', () => {
    // accept-edits lets edits through un-gated and ask blocks them outright, so
    // no Devin mode can both permit and constrain an edit tool.
    expect(() => resolveAcpSessionModeId(devinProfile, 'whitelist', 'devin'))
      .toThrow(/cannot enforce the 'whitelist' permission mode over ACP/);
  });

  it('leaves agents without a declared mapping alone', () => {
    // Agents that route every tool through session/request_permission are
    // already governed by the runtime's request-time decision.
    const codex = resolveAcpProviderProfile({
      ...devinInstance(),
      providerName: 'codex',
      command: 'codex-acp',
      args: ['serve'],
    });

    for (const mode of ['skip', 'default', 'whitelist'] as const) {
      expect(resolveAcpSessionModeId(codex, mode, 'codex')).toBeUndefined();
    }
    expect(resolveAcpSessionModeId(undefined, 'default', 'unknown')).toBeUndefined();
  });
});
