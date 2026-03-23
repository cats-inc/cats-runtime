import type { RuntimeConfig } from '../config.js';
import type { SessionRegistry } from '../../backends/cli/pool/SessionRegistry.js';
import type { RuntimeSessionManager } from './RuntimeSessionManager.js';
import type { KiroNativeSessionService } from '../../backends/cli/kiro/KiroNativeSessionService.js';
import { toSessionView } from '../../backends/cli/pool/sessionView.js';
import { resolvePiResumeTarget } from '../../backends/cli/pi/resume.js';
import type { RuntimeWakeupTriggerOutcome } from '../types.js';

export interface EnsureSessionAwakeResult {
  sessionId: string;
  providerSessionId?: string;
  outcome: RuntimeWakeupTriggerOutcome;
}

export interface EnsureSessionAwakeOptions {
  config: Pick<RuntimeConfig, 'externalSessionLiveWindowMs'> & RuntimeConfig;
  registry: SessionRegistry;
  runtime: RuntimeSessionManager;
  sessionId: string;
  getKiroNative?: (instanceId?: string) => KiroNativeSessionService;
}

export async function ensureSessionAwake(
  options: EnsureSessionAwakeOptions,
): Promise<EnsureSessionAwakeResult> {
  const session = options.registry.get(options.sessionId);
  if (!session) {
    throw new Error(`Session '${options.sessionId}' not found.`);
  }

  const attached = options.runtime.isAttached(session.id);
  const view = toSessionView(session, {
    attached,
    externalSessionLiveWindowMs: options.config.externalSessionLiveWindowMs,
  });
  if (!view.attached && view.activity === 'interactive') {
    throw new Error(
      'This session appears to be active outside cats-runtime already and can only be observed right now.',
    );
  }

  const existing = options.runtime.get(session.id);
  if (existing?.active) {
    options.registry.updateStatus(session.id, 'ready');
    return {
      sessionId: session.id,
      providerSessionId: session.providerSessionId,
      outcome: 'already_awake',
    };
  }

  if (session.providerBackend !== 'cli') {
    options.runtime.spawn(session.id, session.providerName, {
      cwd: session.cwd,
      workspaceMode: session.workspaceMode,
      model: session.model,
      instructionsFile: session.skills?.delivery.instructions?.filePath,
      permissionMode: session.permissionMode,
      allowedTools: session.allowedTools,
    }, session.providerInstanceId, session.providerBackend);
    options.registry.updateStatus(session.id, 'ready');
    const updated = options.registry.get(session.id) ?? session;
    return {
      sessionId: updated.id,
      providerSessionId: updated.providerSessionId,
      outcome: 'resumed',
    };
  }

  if (session.providerName === 'kiro') {
    if (!session.providerSessionId) {
      throw new Error('No provider session ID to resume.');
    }

    if (options.getKiroNative) {
      const canResume = await options.getKiroNative(session.providerInstanceId).canResumeSession(
        session.cwd,
        session.providerSessionId,
      );
      if (!canResume) {
        throw new Error(
          'Kiro can only resume the latest session in a workspace. '
          + 'This discovered session is no longer the newest one in its directory.',
        );
      }
    }

    // Kiro still resumes through the generic CLI provider-session path below after
    // enforcing its "latest session in workspace" constraint here.
  }

  if (session.providerName === 'pi') {
    const resumeTarget = resolvePiResumeTarget(options.config, session);
    options.runtime.spawn(session.id, session.providerName, {
      cwd: session.cwd,
      workspaceMode: session.workspaceMode,
      model: session.model,
      resumeSourcePath: resumeTarget.runtimeSourcePath,
      instructionsFile: session.skills?.delivery.instructions?.filePath,
      permissionMode: session.permissionMode,
      allowedTools: session.allowedTools,
    }, session.providerInstanceId, 'cli');
    options.registry.updateStatus(session.id, 'ready');
    const updated = options.registry.get(session.id) ?? session;
    return {
      sessionId: updated.id,
      providerSessionId: updated.providerSessionId,
      outcome: 'resumed',
    };
  }

  if (!session.providerSessionId) {
    throw new Error('No provider session ID to resume.');
  }

  options.runtime.spawn(session.id, session.providerName, {
    cwd: session.cwd,
    workspaceMode: session.workspaceMode,
    model: session.model,
    resumeSessionId: session.providerSessionId,
    instructionsFile: session.skills?.delivery.instructions?.filePath,
    permissionMode: session.permissionMode,
    allowedTools: session.allowedTools,
  }, session.providerInstanceId, 'cli');
  options.registry.updateStatus(session.id, 'ready');
  const updated = options.registry.get(session.id) ?? session;
  return {
    sessionId: updated.id,
    providerSessionId: updated.providerSessionId,
    outcome: 'resumed',
  };
}
