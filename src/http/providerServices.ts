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
