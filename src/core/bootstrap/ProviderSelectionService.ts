import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseDocument } from 'yaml';
import { providerConfigRevision, type BackendKind } from '../../backends/cli/config.js';
import { KNOWN_PROVIDERS } from '../../backends/cli/providers/types.js';
import { copyRuntimeConfigEnv, getRuntimeConfigEnv, loadConfig, type RuntimeConfig } from '../config.js';
import { listProviderCatalog, type ProviderTargetDescriptor } from '../providerCatalog.js';
import { getProviderInstallKnowledge } from '../provider-install/knowledge.js';

export interface SelectedProviderTarget {
  provider: string;
  backend: BackendKind;
  instance: string;
}

export interface ProviderSelectionEntry extends SelectedProviderTarget {
  /** Only needed when adding a target without a built-in template. */
  configuration?: Record<string, unknown>;
}

export interface ProviderSelectionSnapshot {
  state: 'missing' | 'invalid' | 'empty' | 'selected';
  revision: string;
  targets: SelectedProviderTarget[];
  nativeSetupTargets: SelectedProviderTarget[];
  diskChanged: boolean;
  error: string | null;
}

export interface ProviderSelectionCatalogEntry extends SelectedProviderTarget {
  familyLabel: string;
  binaryName: string;
}

export class ProviderSelectionError extends Error {
  constructor(message: string, readonly status: 400 | 409 = 400) {
    super(message);
    this.name = 'ProviderSelectionError';
  }
}

export function providerSelectionKey(target: SelectedProviderTarget): string {
  return JSON.stringify([target.provider, target.backend, target.instance]);
}

export function selectedTarget(target: ProviderTargetDescriptor): SelectedProviderTarget {
  return { provider: target.providerName, backend: target.backend, instance: target.instanceId };
}

export function configuredTargets(config: RuntimeConfig): ProviderTargetDescriptor[] {
  return Object.values(listProviderCatalog(config)).flatMap((provider) => provider.instances);
}

export function providerSelectionCatalog(): ProviderSelectionCatalogEntry[] {
  return [
    ...KNOWN_PROVIDERS.map((provider): ProviderSelectionCatalogEntry => {
      const knowledge = getProviderInstallKnowledge(provider);
      return {
        provider,
        backend: provider === 'devin' ? 'agent' : 'cli',
        instance: provider === 'devin' ? 'acp' : 'native',
        familyLabel: knowledge.familyLabel,
        binaryName: knowledge.binaryName,
      };
    }),
    { provider: 'ollama', backend: 'local', instance: 'local', familyLabel: 'Ollama', binaryName: 'ollama' },
    { provider: 'openclaw', backend: 'agent', instance: 'gateway', familyLabel: 'OpenClaw', binaryName: 'openclaw' },
  ];
}

function templateFor(target: SelectedProviderTarget): Record<string, unknown> | undefined {
  const entry = providerSelectionCatalog().find((candidate) =>
    providerSelectionKey(candidate) === providerSelectionKey(target));
  if (!entry) return undefined;
  if (entry.backend === 'cli') {
    return { command: entry.binaryName, runner: 'auto', runtime: 'native' };
  }
  if (entry.provider === 'devin') {
    return { transport: 'acp_stdio', command: 'devin', args: ['acp'], startup_timeout_ms: 15_000 };
  }
  if (entry.provider === 'ollama') {
    return { transport: 'ollama', base_url: 'http://127.0.0.1:11434' };
  }
  return {
    transport: 'openclaw_gateway', url_env: 'OPENCLAW_URL', auth_token_env: 'OPENCLAW_TOKEN',
    client_id: 'gateway-client',
  };
}

function readSource(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function parseSelectionTargets(input: unknown): ProviderSelectionEntry[] {
  if (!Array.isArray(input)) throw new ProviderSelectionError('targets must be an array');
  const seen = new Set<string>();
  return input.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ProviderSelectionError('Each target must specify provider, backend, and instance');
    }
    const entry = value as Record<string, unknown>;
    if (typeof entry.provider !== 'string' || !entry.provider.trim()
      || typeof entry.instance !== 'string' || !entry.instance.trim()
      || !['cli', 'api', 'local', 'agent'].includes(String(entry.backend))) {
      throw new ProviderSelectionError('Each target must specify provider, backend, and instance');
    }
    if (entry.configuration !== undefined && (!entry.configuration
      || typeof entry.configuration !== 'object' || Array.isArray(entry.configuration))) {
      throw new ProviderSelectionError('Target configuration must be an object');
    }
    const target: ProviderSelectionEntry = {
      provider: entry.provider, backend: entry.backend as BackendKind, instance: entry.instance,
      ...(entry.configuration ? { configuration: entry.configuration as Record<string, unknown> } : {}),
    };
    const key = providerSelectionKey(target);
    if (seen.has(key)) throw new ProviderSelectionError('Duplicate selected target');
    seen.add(key);
    return target;
  });
}

export class ProviderSelectionService {
  private revision: string;
  private state: ProviderSelectionSnapshot['state'];
  private error: string | null = null;
  private readonly operations = new Map<string, SelectedProviderTarget>();
  private readonly releasedOperations = new Set<string>();

  constructor(private readonly options: {
    config: RuntimeConfig;
    configPath: string;
    beforeActivate?: (candidate: RuntimeConfig, changed: SelectedProviderTarget[]) => void;
    activated?: () => void;
    activationRequired?: () => boolean;
  }) {
    const source = readSource(options.configPath);
    this.revision = providerConfigRevision(source);
    this.state = source === null ? 'missing' : 'selected';
    if (source === null && options.config.providerSelectionRevision && options.config.providerSelectionRevision !== 'missing') {
      this.revision = options.config.providerSelectionRevision;
      this.state = configuredTargets(options.config).length ? 'selected' : 'empty';
      this.error = 'Provider configuration changed on disk. Reload before editing.';
    }
    if (source !== null) {
      try {
        loadConfig(getRuntimeConfigEnv(options.config), { providerYaml: source });
        const loadedRevision = options.config.providerSelectionRevision;
        if (loadedRevision && loadedRevision !== this.revision) {
          this.revision = loadedRevision;
          this.error = 'Provider configuration changed on disk. Reload before editing.';
        }
        this.state = this.revision === 'missing' ? 'missing'
          : configuredTargets(options.config).length === 0 ? 'empty' : 'selected';
      } catch {
        const loadedRevision = options.config.providerSelectionRevision;
        if (loadedRevision && loadedRevision !== 'missing') {
          this.revision = loadedRevision;
          this.state = configuredTargets(options.config).length ? 'selected' : 'empty';
        } else {
          this.state = 'invalid';
        }
        this.error = 'Provider configuration is invalid. Repair the file or save a new selection.';
      }
    }
    options.config.providerSelectionRevision = this.revision;
  }

  getSnapshot(): ProviderSelectionSnapshot {
    const targets = configuredTargets(this.options.config);
    const presets = new Set(providerSelectionCatalog().map(providerSelectionKey));
    const env = getRuntimeConfigEnv(this.options.config);
    return {
      state: this.state,
      revision: this.revision,
      targets: targets.map(selectedTarget),
      nativeSetupTargets: targets.filter((target) => {
        if (!presets.has(providerSelectionKey(selectedTarget(target)))) return false;
        if (target.backend === 'cli') return target.cliInstance?.commandConfig.runtime.mode === 'native';
        if (target.providerName === 'devin') return target.remoteInstance?.transport === 'acp_stdio';
        if (target.providerName !== 'ollama' || target.remoteInstance?.transport !== 'ollama') return false;
        const remote = target.remoteInstance;
        const url = remote.baseUrl || (remote.baseUrlEnv ? env[remote.baseUrlEnv] : undefined) || 'http://127.0.0.1:11434';
        try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname); } catch { return false; }
      }).map(selectedTarget),
      diskChanged: providerConfigRevision(readSource(this.options.configPath)) !== this.revision,
      error: this.error,
    };
  }

  resolveTargets(input?: unknown): ProviderTargetDescriptor[] {
    if (this.state === 'missing' || this.state === 'invalid') {
      throw new ProviderSelectionError('Save a valid provider selection before scanning', 409);
    }
    const targets = configuredTargets(this.options.config);
    if (input === undefined) return targets;
    const requested = parseSelectionTargets(input);
    return requested.map((target) => {
      const match = targets.find((candidate) =>
        providerSelectionKey(selectedTarget(candidate)) === providerSelectionKey(target));
      if (!match) throw new ProviderSelectionError(`Target '${target.provider}/${target.backend}/${target.instance}' is not selected`);
      return match;
    });
  }

  acquireOperation(target: unknown, expectedRevision: unknown, requestedId?: unknown): string {
    this.assertRevision(expectedRevision);
    const [resolved] = this.resolveTargets([target]);
    if (requestedId !== undefined && (typeof requestedId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestedId))) {
      throw new ProviderSelectionError('operationId must be a UUID');
    }
    const operationId = typeof requestedId === 'string' ? requestedId : randomUUID();
    if (this.releasedOperations.has(operationId)) throw new ProviderSelectionError('Operation was already released', 409);
    const existing = this.operations.get(operationId);
    if (existing && providerSelectionKey(existing) !== providerSelectionKey(selectedTarget(resolved!))) {
      throw new ProviderSelectionError('Operation identity belongs to a different target', 409);
    }
    this.operations.set(operationId, selectedTarget(resolved!));
    return operationId;
  }

  releaseOperation(operationId: string): void {
    this.operations.delete(operationId);
    this.releasedOperations.add(operationId);
    if (this.releasedOperations.size > 1024) this.releasedOperations.delete(this.releasedOperations.values().next().value!);
  }

  save(input: unknown, expectedRevision: unknown): ProviderSelectionSnapshot {
    this.assertRevision(expectedRevision);
    const desired = parseSelectionTargets(input);
    const source = readSource(this.options.configPath);
    const document = parseDocument(this.state === 'invalid' || source === null
      ? 'version: 1\nbackends: {}\n' : source);
    // Normalize the existing CLI shape once without losing provider options.
    if (document.has('providers')) {
      document.setIn(['backends', 'cli', 'providers'], document.get('providers'));
      document.delete('providers');
    }
    const retainedKeys = new Set(desired.map(providerSelectionKey));
    for (const target of configuredTargets(this.options.config)) {
      if (retainedKeys.has(providerSelectionKey(selectedTarget(target)))) continue;
      const path = ['backends', target.backend, 'providers', target.providerName];
      const provider = document.getIn(path) as { toJSON?: () => Record<string, unknown> } | undefined;
      const providerDoc = provider?.toJSON?.();
      if (providerDoc && !providerDoc.instances) {
        document.deleteIn(path);
      } else {
        document.deleteIn([...path, 'instances', target.instanceId]);
        const instances = document.getIn([...path, 'instances']) as { items?: unknown[] } | undefined;
        if (!instances?.items?.length) document.deleteIn(path);
      }
      // Remove references only when their target was explicitly removed.
      const defaultInstance = [providerDoc?.default_instance, providerDoc?.defaultInstance]
        .find((value) => typeof value === 'string' && value.trim()) as string | undefined;
      if (defaultInstance?.trim() === target.instanceId) {
        document.deleteIn([...path, 'default_instance']);
        document.deleteIn([...path, 'defaultInstance']);
      }
      const routePath = ['routing', 'providers', target.providerName];
      const route = document.getIn(routePath) as { toJSON?: () => Record<string, unknown> } | undefined;
      const defaultTarget = this.options.config.providerDefaultTargets?.[target.providerName];
      if (route && defaultTarget?.backend === target.backend && defaultTarget.instance === target.instanceId) {
        document.deleteIn(routePath);
      }
    }
    const currentKeys = new Set(configuredTargets(this.options.config).map((target) =>
      providerSelectionKey(selectedTarget(target))));
    for (const target of desired) {
      if (currentKeys.has(providerSelectionKey(target)) && target.configuration === undefined) continue;
      const configuration = target.configuration ?? templateFor(target);
      if (!configuration) throw new ProviderSelectionError('New custom targets require configuration');
      document.setIn(['backends', target.backend, 'providers', target.provider, 'instances', target.instance], configuration);
    }
    const yaml = document.toString({ lineWidth: 0 });
    const candidate = this.validate(yaml);
    const actualKeys = configuredTargets(candidate).map((target) => providerSelectionKey(selectedTarget(target)));
    if (actualKeys.length !== retainedKeys.size || actualKeys.some((key) => !retainedKeys.has(key))) {
      throw new ProviderSelectionError('Configuration does not match the requested selection');
    }
    if (yaml === source && !this.options.activationRequired?.()) return this.getSnapshot();
    this.prepare(candidate);
    this.assertRevision(expectedRevision);
    mkdirSync(dirname(this.options.configPath), { recursive: true });
    const temporary = `${this.options.configPath}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, yaml, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      this.assertRevision(expectedRevision);
      renameSync(temporary, this.options.configPath);
    } finally {
      try { unlinkSync(temporary); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    this.activate(candidate, yaml);
    return this.getSnapshot();
  }

  reload(expectedRevision: unknown): ProviderSelectionSnapshot {
    if (expectedRevision !== this.revision) throw new ProviderSelectionError('Selection changed; reload before editing', 409);
    const source = readSource(this.options.configPath);
    if (source === null) throw new ProviderSelectionError('Provider configuration is missing', 409);
    const candidate = this.validate(source);
    this.prepare(candidate);
    if (readSource(this.options.configPath) !== source) {
      throw new ProviderSelectionError('Selection changed; reload before editing', 409);
    }
    if (providerConfigRevision(source) === this.revision && !this.options.activationRequired?.()) return this.getSnapshot();
    this.activate(candidate, source);
    return this.getSnapshot();
  }

  private validate(yaml: string): RuntimeConfig {
    try {
      return loadConfig(getRuntimeConfigEnv(this.options.config), { providerYaml: yaml });
    } catch {
      throw new ProviderSelectionError('Invalid provider configuration or routing. Repair the configuration before saving.');
    }
  }

  private assertRevision(expectedRevision: unknown): void {
    if (expectedRevision !== this.revision
      || providerConfigRevision(readSource(this.options.configPath)) !== this.revision) {
      throw new ProviderSelectionError('Selection changed; reload before editing', 409);
    }
  }

  private prepare(candidate: RuntimeConfig): void {
    const next = new Map(configuredTargets(candidate).map((target) =>
      [providerSelectionKey(selectedTarget(target)), target]));
    const changed = configuredTargets(this.options.config).filter((target) => {
      const replacement = next.get(providerSelectionKey(selectedTarget(target)));
      return !replacement || JSON.stringify(target) !== JSON.stringify(replacement);
    }).map(selectedTarget);
    const changedKeys = new Set(changed.map(providerSelectionKey));
    if ([...this.operations.values()].some((target) => changedKeys.has(providerSelectionKey(target)))) {
      throw new ProviderSelectionError('Finish or stop the running provider operation before changing this target', 409);
    }
    this.options.beforeActivate?.(candidate, changed);
  }

  private activate(candidate: RuntimeConfig, source: string): void {
    // The registry retains these map references for historical session routing.
    for (const key of ['providerDefaultInstances', 'providerDefaultTargets'] as const) {
      const current = this.options.config[key];
      const next = candidate[key];
      if (current && next) {
        for (const name of Object.keys(current)) delete (current as Record<string, unknown>)[name];
        Object.assign(current, next);
        Object.assign(candidate, { [key]: current });
      }
    }
    Object.assign(this.options.config, candidate);
    copyRuntimeConfigEnv(this.options.config, candidate);
    this.revision = providerConfigRevision(source);
    this.state = configuredTargets(candidate).length ? 'selected' : 'empty';
    this.error = null;
    try {
      this.options.activated?.();
    } catch {
      this.error = 'Selection saved; some runtime services could not restart. Restart Runtime to retry.';
    }
  }
}
