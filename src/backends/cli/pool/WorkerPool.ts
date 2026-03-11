import type { FleetConfig } from '../config.js';
import { AuggieSessionService } from '../auggie/AuggieSessionService.js';
import { KiroNativeSessionService } from '../kiro/KiroNativeSessionService.js';
import { OpencodeNativeSessionService } from '../opencode/OpencodeNativeSessionService.js';
import type { Provider, ProviderCapabilities, ProviderName, ProviderSpawnOptions } from '../providers/types.js';
import { AuggieProvider } from '../providers/auggie.js';
import { ClaudeProvider } from '../providers/claude.js';
import { CodexProvider } from '../providers/codex.js';
import { CopilotProvider } from '../providers/copilot.js';
import { CursorProvider } from '../providers/cursor.js';
import { GeminiProvider } from '../providers/gemini.js';
import { KiroProvider } from '../providers/kiro.js';
import { OpencodeProvider } from '../providers/opencode.js';
import { WorkerProcess } from './WorkerProcess.js';
import type { SessionRegistry } from './SessionRegistry.js';

export class WorkerPool {
  private workers = new Map<string, WorkerProcess>();
  private config: FleetConfig;
  private registry: SessionRegistry;
  private kiroNative: KiroNativeSessionService;
  private auggieSessions: AuggieSessionService;
  private opencodeNative: OpencodeNativeSessionService;

  constructor(
    config: FleetConfig,
    registry: SessionRegistry,
    kiroNative: KiroNativeSessionService,
    auggieSessions: AuggieSessionService,
    opencodeNative: OpencodeNativeSessionService,
  ) {
    this.config = config;
    this.registry = registry;
    this.kiroNative = kiroNative;
    this.auggieSessions = auggieSessions;
    this.opencodeNative = opencodeNative;
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
  ): { provider: Provider; commandConfig: FleetConfig['providerCommands'][ProviderName] } {
    switch (name) {
      case 'auggie':
        return {
          provider: new AuggieProvider(this.auggieSessions, this.config.auggieMaxTurns),
          commandConfig: this.config.providerCommands.auggie,
        };
      case 'codex':
        return { provider: new CodexProvider(), commandConfig: this.config.providerCommands.codex };
      case 'claude':
        return { provider: new ClaudeProvider(), commandConfig: this.config.providerCommands.claude };
      case 'gemini':
        return { provider: new GeminiProvider(), commandConfig: this.config.providerCommands.gemini };
      case 'copilot':
        return { provider: new CopilotProvider(), commandConfig: this.config.providerCommands.copilot };
      case 'cursor':
        return { provider: new CursorProvider(), commandConfig: this.config.providerCommands.cursor };
      case 'kiro':
        return {
          provider: new KiroProvider(this.kiroNative),
          commandConfig: this.config.providerCommands.kiro,
        };
      case 'opencode':
        return {
          provider: new OpencodeProvider(this.opencodeNative),
          commandConfig: this.config.providerCommands.opencode,
        };
      default:
        throw new Error(`Unknown provider: '${name}'. Valid: claude, codex, gemini, copilot, cursor, kiro, auggie, opencode`);
    }
  }

  getCapabilities(providerName: string): ProviderCapabilities {
    return this.resolveProvider(providerName as ProviderName).provider.capabilities;
  }

  spawn(sessionId: string, providerName: string, opts: ProviderSpawnOptions): WorkerProcess {
    if (this.activeCount >= this.config.maxSessions) {
      throw new Error(`Max sessions (${this.config.maxSessions}) reached`);
    }

    const { provider, commandConfig } = this.resolveProvider(providerName as ProviderName);
    const worker = new WorkerProcess(provider, opts, commandConfig);

    worker.on('event', (event) => {
      if ((event.type === 'init' || event.type === 'result') && event.sessionId) {
        this.registry.setProviderSessionId(sessionId, event.sessionId);
        this.registry.updateStatus(sessionId, 'ready');
      }
    });

    worker.on('exit', (code) => {
      // Ephemeral providers normally exit after each turn; keep the logical worker alive
      // unless it was explicitly killed.
      if (provider.ephemeral && worker.alive) return;
      this.registry.updateStatus(sessionId, 'closed');
      this.workers.delete(sessionId);
    });

    worker.on('error', (err) => {
      console.error(`[pool] Worker ${sessionId} error:`, err.message);
    });

    this.workers.set(sessionId, worker);
    if (!provider.ephemeral) {
      worker.start();
    }

    return worker;
  }

  get(sessionId: string): WorkerProcess | undefined {
    return this.workers.get(sessionId);
  }

  isAttached(sessionId: string): boolean {
    return Boolean(this.workers.get(sessionId)?.alive);
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
