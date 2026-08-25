import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import type { RuntimeConfig } from '../core/config.js';
import { RuntimeSessionManager } from '../core/runtime/RuntimeSessionManager.js';
import { RuntimeBrowserService } from '../core/browser/RuntimeBrowserService.js';
import { RuntimeBrowserMaintenanceService } from '../core/browser/RuntimeBrowserMaintenanceService.js';
import type { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import type { ApiBackendManager } from '../backends/api/runtime/ApiBackendManager.js';
import type { AgentBackendManager } from '../backends/agent/runtime/AgentBackendManager.js';
import type { CursorNativeSessionService } from '../backends/cli/cursor/CursorNativeSessionService.js';
import type { KiroNativeSessionService } from '../backends/cli/kiro/KiroNativeSessionService.js';
import type { KiloNativeSessionService } from '../backends/cli/kilo/KiloNativeSessionService.js';
import type { AuggieSessionService } from '../backends/cli/auggie/AuggieSessionService.js';
import type { GooseNativeSessionService } from '../backends/cli/goose/GooseNativeSessionService.js';
import type { OpencodeNativeSessionService } from '../backends/cli/opencode/OpencodeNativeSessionService.js';
import type { WslDiscoveryStatusStore } from '../backends/cli/discovery/wslDiscovery.js';
import { ProviderModelCatalogService } from '../core/models/providerModelCatalog.js';
import { ProviderCompatibilityService } from '../core/compatibility/ProviderCompatibilityService.js';
import { AgentTargetEvidenceService } from '../core/diagnostics/AgentTargetEvidenceService.js';
import { RuntimeDeliveryService } from '../core/runtime/RuntimeDeliveryService.js';
import { RuntimeManagementService } from '../core/management/RuntimeManagementService.js';
import { loadManagementConfig } from '../core/management/config.js';
import { GithubReviewAdapter } from '../core/management/adapters/github/GithubReviewAdapter.js';
import { ZeaburDeploymentAdapter } from '../core/management/adapters/zeabur/ZeaburDeploymentAdapter.js';
import { WorkspaceSubstrateService } from '../core/runtime/WorkspaceSubstrateService.js';
import { RuntimeMeteringService } from '../core/usage/RuntimeMeteringService.js';
import { RuntimeWorktreeMaintenanceService } from '../core/workspace/RuntimeWorktreeMaintenanceService.js';
import type { RuntimeWakeupService } from '../core/wakeup/RuntimeWakeupService.js';
import type { PeerRegistry } from '../core/peers/PeerRegistry.js';
import type { PeerDiscoveryController } from '../core/peers/PeerDiscoveryController.js';
import type { PeerCapabilitySnapshotService } from '../core/peers/PeerCapabilitySnapshotService.js';
import type { PeerTrustService } from '../core/peers/PeerTrustService.js';
import type { PeerRoutingService } from '../core/peers/PeerRoutingService.js';
import type { PeerExecutionClient } from '../core/peers/PeerExecutionClient.js';
import type { PeerExecutionService } from '../core/peers/PeerExecutionService.js';
import type { PeerExecutionAdmissionService } from '../core/peers/PeerExecutionAdmissionService.js';
import type { PeerExecutionReplayService } from '../core/peers/PeerExecutionReplayService.js';
import type { BootstrapService } from '../core/bootstrap/BootstrapService.js';
import { createRuntimeBrowserDrivers } from '../backends/browser/createDrivers.js';
import { bearerAuth } from './auth.js';
import { injectRuntimeDashboardHealthOverlay } from './dashboardHealthOverlay.js';
import { injectSharedUI } from './uiInjector.js';
import { injectRuntimeShellState, type RuntimeSurface } from './ui/runtimeShell.js';
import { bootstrapGuard } from './routes/bootstrapGuard.js';
import { discoveryRoutes } from './routes/discovery.js';
import { agentSessionRoutes } from './routes/agentSessions.js';
import { browserRoutes } from './routes/browser.js';
import { deliveryRoutes } from './routes/delivery.js';
import { diagnosticsRoutes } from './routes/diagnostics.js';
import { compatibilityEvidenceRoutes } from './routes/compatibilityEvidence.js';
import { setupDiagnosticsRoutes } from './routes/setupDiagnostics.js';
import { healthRoutes } from './routes/health.js';
import { sessionRoutes } from './routes/sessions.js';
import { setupRoutes } from './routes/setup.js';
import { messageRoutes } from './routes/messages.js';
import { acpRoutes } from './routes/acp.js';
import { mcpRoutes } from './routes/mcp.js';
import { poolRoutes } from './routes/pool.js';
import { historyRoutes } from './routes/history.js';
import { browseRoutes } from './routes/browse.js';
import { observeRoutes } from './routes/observe.js';
import { codexRoutes } from './routes/codex.js';
import { cursorRoutes } from './routes/cursor.js';
import { kiroRoutes } from './routes/kiro.js';
import { kiloRoutes } from './routes/kilo.js';
import { auggieRoutes } from './routes/auggie.js';
import { opencodeRoutes } from './routes/opencode.js';
import { providerRoutes } from './routes/providers.js';
import { peerRoutes } from './routes/peers.js';
import { peerExecutionRoutes } from './routes/peerExecutions.js';
import { skillRoutes } from './routes/skills.js';
import { wakeupRoutes } from './routes/wakeup.js';
import { managementRoutes } from './routes/management.js';
import { workspaceSubstrateRoutes } from './routes/workspaceSubstrate.js';
import type { RuntimeStartupState } from '../startup.js';

export interface AppContext {
  config: RuntimeConfig;
  startup: RuntimeStartupState;
  registry: SessionRegistry;
  pool: WorkerPool;
  apiBackend?: ApiBackendManager;
  agentBackend?: AgentBackendManager;
  runtime?: RuntimeSessionManager;
  cursorNative: CursorNativeSessionService;
  gooseNative: GooseNativeSessionService;
  kiroNative: KiroNativeSessionService;
  kiloNative: KiloNativeSessionService;
  auggieSessions: AuggieSessionService;
  opencodeNative: OpencodeNativeSessionService;
  wslDiscoveryStatus?: WslDiscoveryStatusStore;
  providerModelCatalog: ProviderModelCatalogService;
  compatibility?: ProviderCompatibilityService;
  agentTargetEvidence?: AgentTargetEvidenceService;
  delivery?: RuntimeDeliveryService;
  management?: RuntimeManagementService;
  workspaceSubstrate?: WorkspaceSubstrateService;
  metering?: RuntimeMeteringService;
  wakeup?: RuntimeWakeupService;
  browser?: RuntimeBrowserService;
  browserMaintenance?: RuntimeBrowserMaintenanceService;
  worktreeMaintenance?: RuntimeWorktreeMaintenanceService;
  peerRegistry?: PeerRegistry;
  peerDiscovery?: PeerDiscoveryController;
  peerCapabilities?: PeerCapabilitySnapshotService;
  peerTrust?: PeerTrustService;
  peerRouting?: PeerRoutingService;
  peerExecutionClient?: PeerExecutionClient;
  peerExecutionService?: PeerExecutionService;
  peerExecutionAdmission?: PeerExecutionAdmissionService;
  peerExecutionReplay?: PeerExecutionReplayService;
  bootstrapService?: BootstrapService;
  completeBootstrap?: () => void;
  resolveCursorNative?: (instanceId?: string) => CursorNativeSessionService;
  resolveGooseNative?: (instanceId?: string) => GooseNativeSessionService;
  resolveKiroNative?: (instanceId?: string) => KiroNativeSessionService;
  resolveKiloNative?: (instanceId?: string) => KiloNativeSessionService;
  resolveAuggieSessions?: (instanceId?: string) => AuggieSessionService;
  resolveOpencodeNative?: (instanceId?: string) => OpencodeNativeSessionService;
}

const RUNTIME_PUBLIC_ROOT_CANDIDATES = [
  ['..', '..', 'public'],
  ['..', '..', '..', 'public'],
] as const;

export function resolveRuntimePublicAssetPath(
  relativePath: string,
  moduleUrl: string = import.meta.url,
): string {
  const moduleDir = dirname(fileURLToPath(moduleUrl));

  for (const segments of RUNTIME_PUBLIC_ROOT_CANDIDATES) {
    const candidatePath = resolve(moduleDir, ...segments, relativePath);
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  throw new Error(
    `Could not locate runtime public asset '${relativePath}' from ${moduleDir}. `
    + `Checked: ${RUNTIME_PUBLIC_ROOT_CANDIDATES.map((segments) => resolve(moduleDir, ...segments, relativePath)).join(', ')}`,
  );
}

export function getRuntimeSessionManager(ctx: AppContext): RuntimeSessionManager {
  if (!ctx.runtime) {
    ctx.runtime = new RuntimeSessionManager(ctx.config, ctx.pool, ctx.apiBackend, ctx.agentBackend);
  }
  return ctx.runtime;
}

export function getRuntimeMeteringService(ctx: AppContext): RuntimeMeteringService {
  if (!ctx.metering) {
    throw new Error('RuntimeMeteringService is not initialized');
  }
  return ctx.metering;
}

export function getProviderCompatibilityService(ctx: AppContext): ProviderCompatibilityService {
  if (!ctx.compatibility) {
    ctx.compatibility = new ProviderCompatibilityService(
      ctx.config,
      process.env.VITEST
        ? {
            runner: {
              run: async () => ({
                exitCode: null,
                stdout: '',
                stderr: '',
                timedOut: false,
                durationMs: 0,
                error: 'Compatibility probing disabled for auto-initialized test app context.',
              }),
            },
            installCheckRunner: {
              lookupCommand: async () => ({
                available: false,
                timedOut: false,
              }),
              checkPath: async () => ({
                exists: false,
                timedOut: false,
              }),
              checkNpmPackage: async () => ({
                exists: false,
                timedOut: false,
              }),
              checkShellRcEntry: async () => ({
                exists: false,
                timedOut: false,
              }),
              getNpmPrefix: async () => ({
                value: undefined,
                timedOut: false,
              }),
            },
          }
        : undefined,
    );
  }
  return ctx.compatibility;
}

export function getAgentTargetEvidenceService(ctx: AppContext): AgentTargetEvidenceService {
  if (!ctx.agentTargetEvidence) {
    const storageFile = typeof ctx.config.dataDir === 'string' && ctx.config.dataDir.length > 0
      ? join(ctx.config.dataDir, 'diagnostics', 'agent-target-evidence.json')
      : undefined;
    ctx.agentTargetEvidence = new AgentTargetEvidenceService(storageFile);
  }
  return ctx.agentTargetEvidence;
}

export function getRuntimeDeliveryService(ctx: AppContext): RuntimeDeliveryService {
  if (!ctx.delivery) {
    ctx.delivery = new RuntimeDeliveryService({
      registry: ctx.registry,
    });
  }
  return ctx.delivery;
}

export function getRuntimeManagementService(ctx: AppContext): RuntimeManagementService {
  if (!ctx.management) {
    const config = loadManagementConfig();
    ctx.management = new RuntimeManagementService({ config });
    ctx.management.registerAdapter(new GithubReviewAdapter({
      command: config?.adapters.review?.instances.github?.command,
      timeoutMs: config?.adapters.review?.instances.github?.timeout_ms,
    }));
    ctx.management.registerAdapter(new ZeaburDeploymentAdapter({
      command: config?.adapters.deployment?.instances.zeabur?.command,
      timeoutMs: config?.adapters.deployment?.instances.zeabur?.timeout_ms,
    }));
  }
  return ctx.management;
}

export function getWorkspaceSubstrateService(ctx: AppContext): WorkspaceSubstrateService {
  if (!ctx.workspaceSubstrate) {
    ctx.workspaceSubstrate = new WorkspaceSubstrateService();
  }
  return ctx.workspaceSubstrate;
}

export function getRuntimeBrowserService(ctx: AppContext): RuntimeBrowserService {
  if (!ctx.browser) {
    const browserStorageFile = typeof ctx.config.dataDir === 'string' && ctx.config.dataDir.length > 0
      ? join(ctx.config.dataDir, 'browser', 'sessions.json')
      : undefined;
    ctx.browser = new RuntimeBrowserService({
      drivers: createRuntimeBrowserDrivers(ctx.config),
      sessionExists: (sessionId) => Boolean(ctx.registry.get(sessionId)),
      ...(browserStorageFile ? { storageFile: browserStorageFile } : {}),
    });
  }
  return ctx.browser;
}

export function createRuntimeApp(ctx: AppContext) {
  ctx.runtime = getRuntimeSessionManager(ctx);
  ctx.metering ??= new RuntimeMeteringService(ctx.config.metering);
  ctx.compatibility = getProviderCompatibilityService(ctx);
  ctx.browser = getRuntimeBrowserService(ctx);
  ctx.providerModelCatalog ??= new ProviderModelCatalogService(ctx.config, {
    ...(ctx.agentBackend ? { agentBackend: ctx.agentBackend } : {}),
  });
  const app = new Hono<{ Variables: { ctx: AppContext } }>();
  const __dirname = dirname(fileURLToPath(import.meta.url));

  function renderRuntimePage(
    assetPath: string,
    surface: RuntimeSurface,
    options: {
      includeHealthOverlay?: boolean;
    } = {},
  ): string {
    let html = readFileSync(resolveRuntimePublicAssetPath(assetPath), 'utf-8');
    html = injectRuntimeShellState(html, {
      surface,
      bootstrapRequired: ctx.startup?.bootstrapRequired === true,
    });
    html = injectSharedUI(html);
    if (options.includeHealthOverlay) {
      html = injectRuntimeDashboardHealthOverlay(html);
    }
    return html;
  }

  app.get('/favicon.ico', (c) => {
    try {
      const iconPath = resolveRuntimePublicAssetPath('favicon.ico');
      const iconBuffer = readFileSync(iconPath);
      return c.body(iconBuffer, 200, {
        'content-type': 'image/x-icon',
        'cache-control': 'public, max-age=86400',
      });
    } catch {
      return c.notFound();
    }
  });

  // Surface pages redirect into /setup while bootstrap remains incomplete.
  app.get('/', (c) => {
    if (ctx.startup?.bootstrapRequired) {
      return c.redirect('/setup', 302);
    }
    return c.html(renderRuntimePage('index.html', 'dashboard', {
      includeHealthOverlay: true,
    }));
  });

  // Dashboard is gated behind bootstrap completion.
  app.get('/dashboard', (c) => {
    if (ctx.startup?.bootstrapRequired) {
      return c.redirect('/setup', 302);
    }
    return c.html(renderRuntimePage('index.html', 'dashboard', {
      includeHealthOverlay: true,
    }));
  });

  // Provider setup page — always accessible regardless of bootstrap mode.
  app.get('/setup', (c) => {
    return c.html(renderRuntimePage('provider-setup.html', 'setup', {
      includeHealthOverlay: true,
    }));
  });

  // Playground is gated behind bootstrap completion.
  app.get('/playground', (c) => {
    if (ctx.startup?.bootstrapRequired) {
      return c.redirect('/setup', 302);
    }
    return c.html(renderRuntimePage('playground.html', 'playground', {
      includeHealthOverlay: true,
    }));
  });

  app.use('*', async (c, next) => {
    const path = c.req.path;
    if (
      path === '/'
      || path === '/dashboard'
      || path === '/playground'
      || path === '/sessions'
      || path === '/health'
      || path === '/diagnostics/health'
      || path === '/diagnostics/runtime'
      || path === '/diagnostics/providers'
      || path === '/pool/status'
      || path === '/discovery/status'
      || path === '/providers/config'
      || path === '/setup'
      || path === '/setup-state'
      || path === '/setup-scan'
      || path === '/setup-apply'
    ) {
      return await next();
    }
    return logger()(c, next);
  });
  app.use('*', async (c, next) => {
    // In bootstrap mode, exempt provider setup routes from bearer auth.
    // The setup page has no API key input and the operator may not have one
    // yet — the whole point of bootstrap is first-run before full config.
    // After bootstrap completes, normal auth applies to setup routes.
    if (ctx.startup?.bootstrapRequired && c.req.path.startsWith('/providers/setup')) {
      return await next();
    }
    if (c.req.path.startsWith('/peer/')) {
      return await next();
    }
    return bearerAuth(ctx.config)(c, next);
  });

  app.use('*', async (c, next) => {
    c.set('ctx', ctx);
    await next();
  });

  // Bootstrap guard: return 409 for session/execution routes when in bootstrap mode.
  app.use('*', bootstrapGuard());

  app.route('/', healthRoutes);
  app.route('/', diagnosticsRoutes);
  app.route('/', compatibilityEvidenceRoutes);
  app.route('/', setupDiagnosticsRoutes);
  app.route('/', setupRoutes);
  app.route('/', discoveryRoutes);
  app.route('/', agentSessionRoutes);
  app.route('/', browserRoutes);
  app.route('/', deliveryRoutes);
  app.route('/', sessionRoutes);
  app.route('/', messageRoutes);
  app.route('/', acpRoutes);
  app.route('/', mcpRoutes);
  app.route('/', historyRoutes);
  app.route('/', poolRoutes);
  app.route('/', browseRoutes);
  app.route('/', observeRoutes);
  app.route('/', peerRoutes);
  app.route('/', peerExecutionRoutes);
  app.route('/', codexRoutes);
  app.route('/', cursorRoutes);
  app.route('/', kiroRoutes);
  app.route('/', kiloRoutes);
  app.route('/', auggieRoutes);
  app.route('/', opencodeRoutes);
  app.route('/', providerRoutes);
  app.route('/', skillRoutes);
  app.route('/', wakeupRoutes);
  app.route('/', managementRoutes);
  app.route('/', workspaceSubstrateRoutes);

  return app;
}
