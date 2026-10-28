import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { cleanupTempDirWithRetries } from '../../../../tests/tempCleanup.js';
import { parseExecutionPolicy, assertExecutionPolicyAdmission } from '../../../core/interactions/policy.js';
import { assertCodexMcpOverrideNames, codexInteractionWithinPolicy, codexPolicyParameters, inspectCodexConfiguration, verifyCodexPolicy } from './codexPolicy.js';

describe('Codex execution policy admission', () => {
  const explicit = parseExecutionPolicy({ version: 1, mode: 'explicit', approval: 'on-request', access: 'workspace-write', network: false })!;
  const provider = parseExecutionPolicy({ version: 1, mode: 'provider', constraints: { maxAccess: 'workspace-write', network: false } })!;
  const cwd = process.cwd();
  const observed = { cwd, approvalPolicy: 'on-request', approvalsReviewer: 'user',
    sandbox: { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false } };

  it('preserves native inheritance and keeps explicit approval separate from access', () => {
    expect(codexPolicyParameters(provider)).toEqual({});
    expect(codexPolicyParameters(explicit)).toMatchObject({ sandbox: 'workspace-write', approvalPolicy: 'on-request',
      config: { 'sandbox_workspace_write.network_access': false } });
    expect(verifyCodexPolicy(explicit, observed, cwd).status).toBe('verified');
    expect(verifyCodexPolicy(provider, observed, cwd).status).toBe('verified');
  });
  it('rejects inherited network, full access, outside writable roots and reviewer mismatches', () => {
    for (const response of [
      { ...observed, sandbox: { ...observed.sandbox, networkAccess: true } },
      { ...observed, sandbox: { type: 'dangerFullAccess' } },
      { ...observed, sandbox: { ...observed.sandbox, writableRoots: [join(cwd, '..')] } },
    ]) expect(verifyCodexPolicy(provider, response, cwd).status).toBe('mismatch');
    expect(verifyCodexPolicy(explicit, { ...observed, approvalsReviewer: 'auto_review' }, cwd).status).toBe('mismatch');
    expect(verifyCodexPolicy(provider, { ...observed, sandbox: { type: 'externalSandbox' } }, cwd).status).toBe('unsupported');
    expect(verifyCodexPolicy(provider, { ...observed, cwd: join(cwd, '..'), sandbox: { ...observed.sandbox, writableRoots: [] } }, cwd).status).toBe('mismatch');
    expect(verifyCodexPolicy(provider, { ...observed, cwd: undefined }, cwd).status).not.toBe('verified');
  });
  it('requires explicit admission for full access and rejects incompatible host constraints', () => {
    expect(() => parseExecutionPolicy({ version: 1, mode: 'explicit', access: 'full-access', network: false, approval: 'never' })).toThrow();
    expect(() => parseExecutionPolicy({ version: 1, mode: 'explicit', access: 'read-only', network: true, approval: 'never' })).toThrow();
    expect(() => assertExecutionPolicyAdmission(provider, {})).toThrow('interaction host');
    const host = { version: 1 as const, kinds: ['user_input' as const], timeoutMs: 60_000 };
    expect(() => assertExecutionPolicyAdmission(provider, { interactionHost: host, workspaceMode: 'read_only' })).toThrow('read-only');
    expect(() => assertExecutionPolicyAdmission(provider, { interactionHost: host, permissionMode: 'whitelist' })).toThrow('allowlists');
  });
  it('detects MCP shadowing without exposing endpoints or credentials', () => {
    const layers = [{ name: { type: 'user', file: '/private/config' }, config: { mcp_servers: { injected: { url: 'https://private?token=secret' } } } }];
    expect(() => inspectCodexConfiguration({ layers }, ['injected'])).toThrow('name conflicts');
    expect(inspectCodexConfiguration({ layers }, ['unique'])).toEqual(['user']);
    expect(() => inspectCodexConfiguration({}, ['unique'])).toThrow('unavailable');
    for (const args of [['-c', 'mcp_servers.injected.url="secret"'], ['--config=mcp_servers."injected".command="secret"'],
      ['-c=mcp_servers={}'], ['-c', 'profiles.worker.mcp_servers.injected.command="secret"']]) {
      expect(() => assertCodexMcpOverrideNames(args, ['injected'])).toThrow('name conflicts');
    }
    expect(() => assertCodexMcpOverrideNames(['-c', 'mcp_servers.other.url="fixture"'], ['injected'])).not.toThrow();
  });
  it('applies the admitted access/network ceiling to later approval requests', () => {
    const readonly = parseExecutionPolicy({ version: 1, mode: 'provider', constraints: { maxAccess: 'read-only', network: false } })!;
    for (const permissions of [{ network: { enabled: true } }, { fileSystem: { write: [cwd] } }]) {
      expect(codexInteractionWithinPolicy('item/permissions/requestApproval', { permissions }, readonly, cwd)).toBe(false);
    }
    expect(codexInteractionWithinPolicy('item/permissions/requestApproval', { permissions: { fileSystem: { write: [join(cwd, 'fixture')] } } }, explicit, cwd)).toBe(true);
    expect(codexInteractionWithinPolicy('item/permissions/requestApproval', { permissions: { fileSystem: { write: [join(cwd, '..')] } } }, explicit, cwd)).toBe(false);
    expect(codexInteractionWithinPolicy('item/commandExecution/requestApproval', {}, explicit, cwd)).toBe(false);
    expect(codexInteractionWithinPolicy('item/fileChange/requestApproval', {}, readonly, cwd)).toBe(false);
  });
  it('rejects a native auto-reviewer that could approve escapes beyond a restricted ceiling', () => {
    expect(verifyCodexPolicy(provider, { ...observed, approvalsReviewer: 'auto_review' }, cwd))
      .toMatchObject({ status: 'mismatch', reason: 'native_auto_review_cannot_enforce_host_ceiling' });
    expect(verifyCodexPolicy(provider, { ...observed, approvalPolicy: 'never', approvalsReviewer: 'auto_review' }, cwd).status).toBe('verified');
    const unrestricted = parseExecutionPolicy({ version: 1, mode: 'provider', constraints: { maxAccess: 'full-access', network: true } })!;
    expect(verifyCodexPolicy(unrestricted, { ...observed, approvalsReviewer: 'auto_review' }, cwd).status).toBe('verified');
  });
  it('rejects an unresolved junction instead of treating it as an absent directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-policy-junction-'));
    try {
      const workspace = join(root, 'workspace'); const outside = join(root, 'outside');
      mkdirSync(workspace); symlinkSync(outside, join(workspace, 'link'), 'junction');
      const params = { permissions: { fileSystem: { write: [join(workspace, 'link', 'data')] } } };
      expect(codexInteractionWithinPolicy('item/permissions/requestApproval', params, explicit, workspace)).toBe(false);
      mkdirSync(outside);
      expect(codexInteractionWithinPolicy('item/permissions/requestApproval', params, explicit, workspace)).toBe(false);
    } finally { await cleanupTempDirWithRetries(root); }
  });
});
