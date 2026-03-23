import { Hono } from 'hono';
import type { AppContext } from '../app.js';
import {
  RuntimeWakeupConflictError,
  RuntimeWakeupNotFoundError,
  RuntimeWakeupValidationError,
} from '../../core/wakeup/RuntimeWakeupService.js';
import type {
  RuntimeWakeupRecurrence,
  RuntimeWakeupStatus,
  RuntimeWakeupTarget,
} from '../../core/types.js';
import { parseOptionalString } from '../parsing.js';

type WakeupRouteEnv = {
  Variables: {
    ctx: AppContext;
  };
};

export const wakeupRoutes = new Hono<WakeupRouteEnv>();

const WAKEUP_STATUSES = new Set<RuntimeWakeupStatus>([
  'scheduled',
  'triggering',
  'triggered',
  'cancelled',
  'failed',
]);

function getWakeupService(ctx: AppContext) {
  if (!ctx.wakeup) {
    throw new Error('RuntimeWakeupService is not initialized');
  }

  return ctx.wakeup;
}

function parseWakeupTarget(value: unknown): RuntimeWakeupTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RuntimeWakeupValidationError('target must be an object.');
  }

  const record = value as Record<string, unknown>;
  const kind = parseOptionalString(record.kind);
  if (kind !== 'session') {
    throw new RuntimeWakeupValidationError('target.kind must be \'session\'.');
  }

  return {
    kind: 'session',
    sessionId: parseOptionalString(record.sessionId) || '',
  };
}

function parseWakeupMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function parseWakeupRecurrence(value: unknown): RuntimeWakeupRecurrence | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const kind = parseOptionalString(record.kind);
  const expression = parseOptionalString(record.expression);
  const timezone = parseOptionalString(record.timezone);
  if (!kind && !expression && !timezone) {
    return undefined;
  }

  return {
    kind: (kind || '') as RuntimeWakeupRecurrence['kind'],
    expression: expression || '',
    ...(timezone ? { timezone: timezone as RuntimeWakeupRecurrence['timezone'] } : {}),
  };
}

function toWakeupErrorResponse(error: unknown): { status: number; body: { error: string } } | undefined {
  if (error instanceof RuntimeWakeupValidationError) {
    return {
      status: error.code === 'unknown_session' ? 404 : 400,
      body: { error: error.message },
    };
  }
  if (error instanceof RuntimeWakeupNotFoundError) {
    return {
      status: 404,
      body: { error: error.message },
    };
  }
  if (error instanceof RuntimeWakeupConflictError) {
    return {
      status: 409,
      body: { error: error.message },
    };
  }

  return undefined;
}

wakeupRoutes.get('/wakeups', (c) => {
  const ctx = c.get('ctx');
  const status = c.req.query('status');
  const sessionId = c.req.query('sessionId');
  const wakeup = getWakeupService(ctx);

  return c.json({
    wakeups: wakeup.list({
      status: status && WAKEUP_STATUSES.has(status as RuntimeWakeupStatus)
        ? status as RuntimeWakeupStatus
        : undefined,
      sessionId: parseOptionalString(sessionId),
    }),
  });
});

wakeupRoutes.get('/wakeups/:id', (c) => {
  const ctx = c.get('ctx');
  const wakeup = getWakeupService(ctx);
  const request = wakeup.get(c.req.param('id'));

  if (!request) {
    return c.json({
      error: `Wakeup request '${c.req.param('id')}' was not found.`,
    }, 404);
  }

  return c.json({ request });
});

wakeupRoutes.post('/wakeups', async (c) => {
  const ctx = c.get('ctx');
  const wakeup = getWakeupService(ctx);
  const body = await c.req.json<{
    reason?: string;
    target?: unknown;
    scheduleAt?: string;
    recurrence?: unknown;
    coalesceKey?: string;
    metadata?: unknown;
  }>();

  try {
    const created = wakeup.create({
      reason: parseOptionalString(body.reason) || '',
      target: parseWakeupTarget(body.target),
      scheduleAt: parseOptionalString(body.scheduleAt) || undefined,
      recurrence: parseWakeupRecurrence(body.recurrence),
      coalesceKey: parseOptionalString(body.coalesceKey),
      metadata: parseWakeupMetadata(body.metadata),
    });
    return c.json({
      request: created.request,
      coalesced: created.coalesced,
    }, created.coalesced ? 200 : 201);
  } catch (error) {
    const wakeupError = toWakeupErrorResponse(error);
    if (wakeupError) {
      return c.json(wakeupError.body, { status: wakeupError.status as 400 | 404 | 409 });
    }
    throw error;
  }
});

wakeupRoutes.post('/wakeups/:id/cancel', (c) => {
  const ctx = c.get('ctx');
  const wakeup = getWakeupService(ctx);

  try {
    return c.json({
      request: wakeup.cancel(c.req.param('id')),
    });
  } catch (error) {
    const wakeupError = toWakeupErrorResponse(error);
    if (wakeupError) {
      return c.json(wakeupError.body, { status: wakeupError.status as 400 | 404 | 409 });
    }
    throw error;
  }
});

wakeupRoutes.post('/wakeups/:id/trigger', async (c) => {
  const ctx = c.get('ctx');
  const wakeup = getWakeupService(ctx);

  try {
    return c.json({
      request: await wakeup.trigger(c.req.param('id'), 'manual'),
    });
  } catch (error) {
    const wakeupError = toWakeupErrorResponse(error);
    if (wakeupError) {
      return c.json(wakeupError.body, { status: wakeupError.status as 400 | 404 | 409 });
    }
    throw error;
  }
});
