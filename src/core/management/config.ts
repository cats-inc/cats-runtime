import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { parse } from 'yaml';

const CONFIG_FILE_DEFAULT = 'config/management.yaml';
const SUPPORTED_VERSION = 1;

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface ManagementAdapterInstanceConfig {
  transport: 'cli' | 'api';
  command?: string;
  url?: string;
  timeout_ms?: number;
}

export interface ManagementDomainConfig {
  default: string;
  instances: Record<string, ManagementAdapterInstanceConfig>;
}

export interface ManagementConfig {
  version: number;
  adapters: Record<string, ManagementDomainConfig>;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export function loadManagementConfig(
  configPathOverride?: string,
  cwd?: string,
): ManagementConfig | undefined {
  const configPath = resolveManagementConfigPath(configPathOverride, cwd);
  if (!existsSync(configPath)) {
    return undefined;
  }

  const raw = parse(readFileSync(configPath, 'utf-8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }

  const doc = raw as Record<string, unknown>;
  if (doc.version !== SUPPORTED_VERSION) {
    throw new Error(
      `Unsupported management config version: ${String(doc.version)} (expected ${SUPPORTED_VERSION})`,
    );
  }

  const adapters: Record<string, ManagementDomainConfig> = {};
  const rawAdapters = doc.adapters;
  if (rawAdapters && typeof rawAdapters === 'object' && !Array.isArray(rawAdapters)) {
    for (const [domain, domainRaw] of Object.entries(rawAdapters as Record<string, unknown>)) {
      const parsed = parseDomainConfig(domainRaw);
      if (parsed) {
        adapters[domain] = parsed;
      }
    }
  }

  return { version: SUPPORTED_VERSION, adapters };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function resolveManagementConfigPath(value?: string, cwd?: string): string {
  const base = cwd || process.cwd();
  if (!value) {
    return resolve(base, CONFIG_FILE_DEFAULT);
  }
  return isAbsolute(value) ? value : resolve(base, value);
}

function parseDomainConfig(raw: unknown): ManagementDomainConfig | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const doc = raw as Record<string, unknown>;
  const defaultAdapter = typeof doc.default === 'string' ? doc.default : '';
  if (!defaultAdapter) return undefined;

  const instances: Record<string, ManagementAdapterInstanceConfig> = {};
  const rawInstances = doc.instances;
  if (rawInstances && typeof rawInstances === 'object' && !Array.isArray(rawInstances)) {
    for (const [id, instRaw] of Object.entries(rawInstances as Record<string, unknown>)) {
      const parsed = parseInstanceConfig(instRaw);
      if (parsed) {
        instances[id] = parsed;
      }
    }
  }

  return { default: defaultAdapter, instances };
}

function parseInstanceConfig(raw: unknown): ManagementAdapterInstanceConfig | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const doc = raw as Record<string, unknown>;
  const transport = doc.transport === 'cli' || doc.transport === 'api'
    ? doc.transport
    : 'cli';

  return {
    transport,
    ...(typeof doc.command === 'string' ? { command: doc.command } : {}),
    ...(typeof doc.url === 'string' ? { url: doc.url } : {}),
    ...(typeof doc.timeout_ms === 'number' ? { timeout_ms: doc.timeout_ms } : {}),
  };
}
