import { toSessionView } from '../backends/cli/pool/sessionView.js';
import type { SessionInfo } from '../core/types.js';
import { buildSessionInspection } from '../core/runtime/sessionInspection.js';
import {
  getRuntimeMeteringService,
  getRuntimeSessionManager,
  type AppContext,
} from '../http/app.js';

export function buildMcpSessionSummary(
  ctx: AppContext,
  session: SessionInfo,
  options: {
    includeInspection?: boolean;
  } = {},
) {
  const runtime = getRuntimeSessionManager(ctx);
  const wakeup = ctx.wakeup?.getSessionWakeState(session.id);
  const view = toSessionView(session, {
    attached: runtime.isAttached(session.id),
    externalSessionLiveWindowMs: ctx.config.externalSessionLiveWindowMs,
  });

  return {
    ...view,
    ...(wakeup ? { wakeup } : {}),
    ...(options.includeInspection
      ? {
          inspection: buildSessionInspection({
            session,
            view,
            trackedState: runtime.getTrackedState(session.id),
            metering: getRuntimeMeteringService(ctx).buildSessionSnapshot(session),
          }),
        }
      : {}),
    historyPath: `/sessions/${session.id}/history`,
    observePath: `/sessions/${session.id}/observe`,
  };
}

export function buildMcpObserveSessionPayload(
  ctx: AppContext,
  session: SessionInfo,
) {
  const runtime = getRuntimeSessionManager(ctx);
  const wakeup = ctx.wakeup?.getSessionWakeState(session.id);
  const view = toSessionView(session, {
    attached: runtime.isAttached(session.id),
    externalSessionLiveWindowMs: ctx.config.externalSessionLiveWindowMs,
  });

  return {
    session: {
      ...view,
      ...(wakeup ? { wakeup } : {}),
      inspection: buildSessionInspection({
        session,
        view,
        trackedState: runtime.getTrackedState(session.id),
        metering: getRuntimeMeteringService(ctx).buildSessionSnapshot(session),
      }),
    },
    historyPath: `/sessions/${session.id}/history`,
    observePath: `/sessions/${session.id}/observe`,
    stream: {
      path: `/sessions/${session.id}/stream`,
      available: Boolean(runtime.get(session.id)?.active),
    },
  };
}
