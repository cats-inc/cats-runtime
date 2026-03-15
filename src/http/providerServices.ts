import { resolveProviderInstance } from '../backends/cli/config.js';
import type { AppContext } from './app.js';

export function getCursorNative(ctx: AppContext, instanceId?: string) {
  return ctx.resolveCursorNative?.(instanceId) || ctx.cursorNative;
}

export function getKiroNative(ctx: AppContext, instanceId?: string) {
  return ctx.resolveKiroNative?.(instanceId) || ctx.kiroNative;
}

export function getAuggieSessions(ctx: AppContext, instanceId?: string) {
  return ctx.resolveAuggieSessions?.(instanceId) || ctx.auggieSessions;
}

export function getOpencodeNative(ctx: AppContext, instanceId?: string) {
  return ctx.resolveOpencodeNative?.(instanceId) || ctx.opencodeNative;
}

export function getClaudeProjectsDir(ctx: AppContext, instanceId?: string) {
  return resolveProviderInstance(ctx.config, 'claude', instanceId).claudeProjectsDir
    || ctx.config.claudeProjectsDir;
}

export function getCodexSessionsDir(ctx: AppContext, instanceId?: string) {
  return resolveProviderInstance(ctx.config, 'codex', instanceId).codexSessionsDir
    || ctx.config.codexSessionsDir;
}

export function getCopilotSessionsDir(ctx: AppContext, instanceId?: string) {
  return resolveProviderInstance(ctx.config, 'copilot', instanceId).copilotSessionsDir
    || ctx.config.copilotSessionsDir;
}

export function getGeminiSessionsDir(ctx: AppContext, instanceId?: string) {
  return resolveProviderInstance(ctx.config, 'gemini', instanceId).geminiSessionsDir
    || ctx.config.geminiSessionsDir;
}
