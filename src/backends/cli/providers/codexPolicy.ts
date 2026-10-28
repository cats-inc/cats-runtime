import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';
import { EXECUTION_ACCESS, type EffectiveExecutionPolicy, type SessionExecutionPolicy } from '../../../core/interactions/policy.js';
import { record } from '../../../core/interactions/validation.js';

function insideWorkspace(path: unknown, cwd: string): boolean {
  if (typeof path !== 'string' || !isAbsolute(path)) return false;
  const contains = (root: string, target: string) => {
    const child = relative(root, target);
    return !isAbsolute(child) && child !== '..' && !child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`);
  };
  if (!contains(resolve(cwd), resolve(path))) return false;
  try {
    const root = realpathSync(cwd);
    let ancestor = resolve(path);
    const suffix: string[] = [];
    while (true) {
      try { return contains(root, join(realpathSync(ancestor), ...suffix)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(ancestor) === ancestor) return false;
        // ENOENT can mean an existing dangling junction, not an absent path.
        try { if (lstatSync(ancestor, { throwIfNoEntry: false })) return false; } catch { return false; }
        suffix.unshift(basename(ancestor)); ancestor = dirname(ancestor);
      }
    }
  } catch { return false; }
}

/** A human answer cannot exceed the execution policy admitted by the host. */
export function codexInteractionWithinPolicy(method: string, params: Record<string, unknown>,
  policy: SessionExecutionPolicy, cwd: string): boolean {
  const access = policy.mode === 'provider' ? policy.constraints.maxAccess : policy.access;
  const network = policy.mode === 'provider' ? policy.constraints.network : policy.network;
  if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
    // These decisions can authorize a sandbox retry; the wire reply cannot bind
    // that retry to narrower filesystem/network limits. Do not guess its scope.
    return access === 'full-access' && network;
  }
  if (method !== 'item/permissions/requestApproval') return true;
  const permissions = record(params.permissions);
  if (record(permissions?.network)?.enabled === true && !network) return false;
  const write = record(permissions?.fileSystem)?.write;
  if (Array.isArray(write) && write.length && (access === 'read-only'
    || access === 'workspace-write' && write.some(path => !insideWorkspace(path, cwd)))) return false;
  return true;
}

/** Existing command-line overrides share a layer with our injected flags. Inspect before merging. */
export function assertCodexMcpOverrideNames(args: readonly string[], injectedNames: readonly string[]): void {
  if (!injectedNames.length) return;
  if (injectedNames.some(name => ['codex_apps', 'codex_app'].includes(name))) {
    throw new Error('Session MCP name conflicts with a reserved native Codex server.');
  }
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    const value = argument === '-c' || argument === '--config' ? args[++index]
      : argument.startsWith('--config=') ? argument.slice(9)
        : /^-c=?[^=]+=/.test(argument) ? argument.slice(2).replace(/^=/, '') : undefined;
    if (!value) continue;
    const key = value.split('=', 1)[0]!.replace(/["'\s]/g, '');
    const segments = key.split('.');
    const serverIndex = segments.indexOf('mcp_servers');
    if (serverIndex >= 0 && (!segments[serverIndex + 1] || injectedNames.includes(segments[serverIndex + 1]!))) {
      throw new Error('Session MCP name conflicts with configured command overrides. Rename the injected server.');
    }
  }
}

export function codexPolicyParameters(policy: SessionExecutionPolicy): Record<string, unknown> {
  if (policy.mode === 'provider') return {};
  return { approvalPolicy: policy.approval, approvalsReviewer: 'user',
    sandbox: policy.access === 'full-access' ? 'danger-full-access' : policy.access,
    ...(policy.access === 'workspace-write' ? { config: {
      'sandbox_workspace_write.network_access': policy.network,
      'sandbox_workspace_write.writable_roots': [],
    } } : {}),
  };
}

/** Examine only policy discriminants; never return provider config or raw errors. */
export function verifyCodexPolicy(policy: SessionExecutionPolicy, response: Record<string, unknown>, cwd: string,
  configurationSources: string[] = []): EffectiveExecutionPolicy {
  const base: EffectiveExecutionPolicy = { requested: structuredClone(policy), source: policy.mode,
    status: 'unsupported', coverage: 'local-process-only', configurationSources };
  try {
    if (typeof response.cwd !== 'string' || !isAbsolute(response.cwd)
      || relative(realpathSync(cwd), realpathSync(response.cwd)) !== '') {
      return { ...base, status: 'mismatch', reason: 'effective_workspace_differs_from_host_admission' };
    }
  } catch { return { ...base, reason: 'effective_workspace_unavailable' }; }
  const sandbox = record(response.sandbox);
  const access = sandbox?.type === 'readOnly' ? 'read-only' : sandbox?.type === 'workspaceWrite' ? 'workspace-write'
    : sandbox?.type === 'dangerFullAccess' ? 'full-access' : undefined;
  const network = access === 'full-access' ? true : sandbox?.networkAccess;
  const approval = response.approvalPolicy;
  const reviewer = response.approvalsReviewer;
  if (!access || typeof network !== 'boolean' || typeof approval !== 'string'
    || !['never', 'untrusted', 'on-request', 'on-failure'].includes(approval)
    || typeof reviewer !== 'string' || !['user', 'auto_review'].includes(reviewer)) {
    return { ...base, reason: 'effective_policy_not_reported_or_unsupported' };
  }
  const observed: NonNullable<EffectiveExecutionPolicy['observed']> = { access, network, approval, reviewer };
  const limit = policy.mode === 'explicit' ? policy.access : policy.constraints.maxAccess;
  let matches = policy.mode === 'explicit'
    ? access === policy.access && network === policy.network && approval === policy.approval && reviewer === 'user'
    : EXECUTION_ACCESS.indexOf(access) <= EXECUTION_ACCESS.indexOf(limit) && (!network || policy.constraints.network);
  if (policy.mode === 'provider' && reviewer === 'auto_review' && approval !== 'never'
    && (policy.constraints.maxAccess !== 'full-access' || !policy.constraints.network)) {
    return { ...base, observed, status: 'mismatch', reason: 'native_auto_review_cannot_enforce_host_ceiling' };
  }
  if (access === 'workspace-write' && limit !== 'full-access') {
    const roots = sandbox?.writableRoots;
    matches &&= Array.isArray(roots) && roots.every(root => {
      return insideWorkspace(root, cwd);
    });
  }
  return { ...base, observed, status: matches ? 'verified' : 'mismatch',
    ...(matches ? {} : { reason: 'effective_policy_exceeds_or_differs_from_host_admission' }) };
}

/** Check lower configuration layers before launching a thread with an MCP overlay. */
export function inspectCodexConfiguration(result: Record<string, unknown>, injectedNames: readonly string[]): string[] {
  if (!Array.isArray(result.layers)) throw new Error('Codex configuration layer evidence is unavailable.');
  const sources = new Set<string>();
  for (const value of result.layers) {
    const layer = record(value);
    const type = record(layer?.name)?.type;
    if (!layer || typeof type !== 'string' || layer.disabledReason) continue;
    if (!['packagedDefaults', 'mdm', 'system', 'enterpriseManaged', 'user', 'project', 'sessionFlags',
      'legacyManagedConfigTomlFromFile', 'legacyManagedConfigTomlFromMdm'].includes(type)) {
      if (injectedNames.length) throw new Error('Codex configuration layer is unsupported.');
      continue;
    }
    sources.add(type);
    const config = record(layer.config);
    if (injectedNames.length && !config) throw new Error('Codex configuration layer evidence is unsupported.');
    const servers = record(config?.mcp_servers);
    if (type !== 'sessionFlags' && servers && injectedNames.some(name => Object.hasOwn(servers, name))) {
      throw new Error('Session MCP name conflicts with provider configuration. Rename the injected server.');
    }
  }
  return [...sources];
}
