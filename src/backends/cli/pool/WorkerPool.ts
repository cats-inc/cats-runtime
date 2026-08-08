import {
  resolveProviderInstance,
  type CliRuntimeConfig,
} from '../config.js';
import { AuggieSessionService } from '../auggie/AuggieSessionService.js';
import { KiroNativeSessionService } from '../kiro/KiroNativeSessionService.js';
import { KiloNativeSessionService } from '../kilo/KiloNativeSessionService.js';
import { GooseNativeSessionService } from '../goose/GooseNativeSessionService.js';
import { OpencodeNativeSessionService } from '../opencode/OpencodeNativeSessionService.js';
import {
  KNOWN_PROVIDERS,
  type Provider,
  type ProviderCapabilities,
  type ProviderName,
  type ProviderSpawnOptions,
} from '../providers/types.js';
import type { CompatibilityProfileSelection } from '../../../core/compatibility/types.js';
import type { ProviderCompatibilityService } from '../../../core/compatibility/ProviderCompatibilityService.js';
import { AuggieProvider } from '../providers/auggie.js';
import { AntigravityProvider } from '../providers/antigravity.js';
import { GrokProvider } from '../providers/grok.js';
import { ClineProvider } from '../providers/cline.js';
import { ClaudeProvider } from '../providers/claude.js';
import { CodexProvider } from '../providers/codex.js';
import { CopilotProvider } from '../providers/copilot.js';
import { CursorProvider } from '../providers/cursor.js';
import { KiroProvider } from '../providers/kiro.js';
import { KiloProvider } from '../providers/kilo.js';
import { OpencodeProvider } from '../providers/opencode.js';
import { GooseProvider } from '../providers/goose.js';
import { JunieProvider } from '../providers/junie.js';
import { PiProvider } from '../providers/pi.js';
import { WorkerProcess, type SpawnResilienceConfig } from './WorkerProcess.js';
import type { SessionRegistry } from './SessionRegistry.js';

interface ProviderServiceResolvers {
  getAuggieSessions?: (instanceId?: string) => AuggieSessionService;
  getGooseNative?: (instanceId?: string) => GooseNativeSessionService;
  getKiroNative?: (instanceId?: string) => KiroNativeSessionService;
  getKiloNative?: (instanceId?: string) => KiloNativeSessionService;
  getOpencodeNative?: (instanceId?: string) => OpencodeNativeSessionService;
}

export class WorkerPool {
  private workers = new Map<string, WorkerProcess>();
  private workerSingletonResources = new Map<string, string>();
  private config: CliRuntimeConfig;
  private registry: SessionRegistry;
  private gooseNative: GooseNativeSessionService;
  private kiroNative: KiroNativeSessionService;
  private kiloNative: KiloNativeSessionService;
  private auggieSessions: AuggieSessionService;
  private opencodeNative: OpencodeNativeSessionService;
  private readonly compatibility: ProviderCompatibilityService;
  private resolvers: ProviderServiceResolvers;

  constructor(
    config: CliRuntimeConfig,
    registry: SessionRegistry,
    gooseNative: GooseNativeSessionService,
    kiroNative: KiroNativeSessionService,
    kiloNative: KiloNativeSessionService,
    auggieSessions: AuggieSessionService,
    opencodeNative: OpencodeNativeSessionService,
    compatibility: ProviderCompatibilityService,
    resolvers: ProviderServiceResolvers = {},
  ) {
    this.config = config;
    this.registry = registry;
    this.gooseNative = gooseNative;
    this.kiroNative = kiroNative;
    this.kiloNative = kiloNative;
    this.auggieSessions = auggieSessions;
    this.opencodeNative = opencodeNative;
    this.compatibility = compatibility;
    this.resolvers = resolvers;
  }

  get activeCount(): number {
    let count = 0;
    for (const w of this.workers.values()) {
      if (w.alive) count++;
    }
    return count;
  }

  private resolveProvider(
    name: ProviderName,
    instanceId?: string,
    compatibilityProfile?: CompatibilityProfileSelection,
  ): { provider: Provider; commandConfig: CliRuntimeConfig['providerCommands'][ProviderName] } {
    const instance = resolveProviderInstance(this.config, name, instanceId);
    switch (name) {
      case 'auggie':
        return {
          provider: new AuggieProvider(
            this.resolvers.getAuggieSessions?.(instance.id) || this.auggieSessions,
            this.config.auggieMaxTurns,
          ),
          commandConfig: instance.commandConfig,
        };
      case 'codex':
        return {
          provider: new CodexProvider(compatibilityProfile),
          commandConfig: instance.commandConfig,
        };
      case 'antigravity':
        return {
          provider: new AntigravityProvider(),
          commandConfig: instance.commandConfig,
        };
      case 'grok':
        return {
          provider: new GrokProvider(compatibilityProfile),
          commandConfig: instance.commandConfig,
        };
      case 'cline':
        return {
          provider: new ClineProvider(),
          commandConfig: instance.commandConfig,
        };
      case 'claude':
        return {
          provider: new ClaudeProvider(compatibilityProfile),
          commandConfig: instance.commandConfig,
        };
      case 'copilot':
        return {
          provider: new CopilotProvider(compatibilityProfile),
          commandConfig: instance.commandConfig,
        };
      case 'cursor':
        return { provider: new CursorProvider(), commandConfig: instance.commandConfig };
      case 'kiro':
        return {
          provider: new KiroProvider(
            this.resolvers.getKiroNative?.(instance.id) || this.kiroNative,
          ),
          commandConfig: instance.commandConfig,
        };
      case 'kilo':
        return {
          provider: new KiloProvider(
            this.resolvers.getKiloNative?.(instance.id) || this.kiloNative,
          ),
          commandConfig: instance.commandConfig,
        };
      case 'opencode':
        return {
          provider: new OpencodeProvider(
            this.resolvers.getOpencodeNative?.(instance.id) || this.opencodeNative,
          ),
          commandConfig: instance.commandConfig,
        };
      case 'pi':
        return {
          provider: new PiProvider({
            instructionsFile: instance.piInstructionsFile,
          }),
          commandConfig: instance.commandConfig,
        };
      case 'goose':
        return {
          provider: new GooseProvider(
            this.resolvers.getGooseNative?.(instance.id) || this.gooseNative,
          ),
          commandConfig: instance.commandConfig,
        };
      case 'junie':
        return {
          provider: new JunieProvider(instance.commandConfig),
          commandConfig: instance.commandConfig,
        };
      default:
        throw new Error(`Unknown provider: '${name}'. Valid: ${KNOWN_PROVIDERS.join(', ')}`);
    }
  }

  getCapabilities(providerName: string, providerInstanceId?: string): ProviderCapabilities {
    return this.resolveProvider(
      providerName as ProviderName,
      providerInstanceId,
    ).provider.capabilities;
  }

  spawn(
    sessionId: string,
    providerName: string,
    opts: ProviderSpawnOptions,
    providerInstanceId?: string,
  ): WorkerProcess {
    if (this.activeCount >= this.config.maxSessions) {
      throw new Error(`Max sessions (${this.config.maxSessions}) reached`);
    }

    const instance = resolveProviderInstance(
      this.config,
      providerName as ProviderName,
      providerInstanceId,
    );
    const singletonResource = instance.commandConfig.singleton;
    let singletonReserved = false;
    let worker: WorkerProcess | undefined;

    try {
      if (singletonResource) {
        this.reserveSingletonResource(singletonResource, sessionId);
        singletonReserved = true;
      }

      const { provider, commandConfig } = this.resolveProvider(
        providerName as ProviderName,
        providerInstanceId,
        this.compatibility.getCachedAssessment(
          providerName as ProviderName,
          instance.id,
        )?.profile,
      );
      const resilience: SpawnResilienceConfig = {
        retries: this.config.spawnRetries,
        timeoutMs: resolveCliSpawnTimeoutMs(
          providerName as ProviderName,
          instance.timeoutMs,
          this.config.spawnTimeoutMs,
        ),
      };
      worker = new WorkerProcess(provider, opts, commandConfig, resilience);

      worker.on('event', (event) => {
        if ((event.type === 'init' || event.type === 'result') && event.sessionId) {
          this.registry.setProviderSessionId(sessionId, event.sessionId);
          this.registry.updateStatus(sessionId, 'ready');
        }
      });

      worker.on('exit', (code) => {
        // Ephemeral providers normally exit after each turn; keep the logical worker alive
        // unless it was explicitly killed.
        if (provider.ephemeral && worker?.alive) return;
        if (this.workers.get(sessionId) === worker) {
          this.registry.updateStatus(sessionId, 'closed');
          this.workers.delete(sessionId);
          this.releaseSingletonResource(sessionId);
        }
      });

      worker.on('error', (err) => {
        console.error(`[pool] Worker ${sessionId} error:`, err.message);
      });

      this.workers.set(sessionId, worker);
      if (!provider.ephemeral) {
        worker.start();
      }

      return worker;
    } catch (error) {
      if (worker && this.workers.get(sessionId) === worker) {
        this.workers.delete(sessionId);
      }
      if (singletonReserved) {
        this.releaseSingletonResource(sessionId);
      }
      throw error;
    }
  }

  private reserveSingletonResource(resource: string, sessionId: string): void {
    for (const [activeSessionId, activeResource] of this.workerSingletonResources.entries()) {
      if (activeSessionId === sessionId || activeResource !== resource) {
        continue;
      }

      const worker = this.workers.get(activeSessionId);
      if (!worker || !worker.alive) {
        console.warn(
          `[pool] Reclaiming singleton '${resource}' from stale session '${activeSessionId}' `
          + '(worker missing or not alive). Exit handler may have been skipped.',
        );
        this.releaseSingletonResource(activeSessionId);
        continue;
      }

      throw new Error(
        `Provider singleton resource '${resource}' is already attached to active Cats session `
        + `'${activeSessionId}'. Close that session before starting another worker for this resource.`,
      );
    }

    this.workerSingletonResources.set(sessionId, resource);
  }

  private releaseSingletonResource(sessionId: string): void {
    this.workerSingletonResources.delete(sessionId);
  }

  get(sessionId: string): WorkerProcess | undefined {
    return this.workers.get(sessionId);
  }

  isAttached(sessionId: string): boolean {
    return Boolean(this.workers.get(sessionId)?.alive);
  }

  cancel(sessionId: string): void {
    const worker = this.workers.get(sessionId);
    if (worker) {
      worker.cancel();
    }
  }

  kill(sessionId: string): void {
    const worker = this.workers.get(sessionId);
    if (worker) {
      worker.kill();
    }
  }

  killAll(): void {
    for (const [id, worker] of this.workers) {
      worker.kill();
    }
  }

  status() {
    const providers: Record<string, number> = {};
    let busy = 0;
    let idle = 0;

    for (const worker of this.workers.values()) {
      if (!worker.alive) continue;
      if (worker.busy) busy++;
      else idle++;
    }

    for (const [sessionId] of this.workers) {
      const session = this.registry.get(sessionId);
      if (session) {
        providers[session.providerName] = (providers[session.providerName] ?? 0) + 1;
      }
    }

    return {
      active: this.activeCount,
      busy,
      idle,
      maxSessions: this.config.maxSessions,
      providers,
    };
  }
}

function resolveCliSpawnTimeoutMs(
  providerName: ProviderName,
  instanceTimeoutMs: number | undefined,
  fallbackTimeoutMs: number,
): number {
  if (typeof instanceTimeoutMs === 'number') {
    return instanceTimeoutMs;
  }
  return fallbackTimeoutMs;
}
