export class RuntimeWakeupCronError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeWakeupCronError';
  }
}

interface CronFieldSpec {
  min: number;
  max: number;
  label: string;
}

interface ParsedCronExpression {
  expression: string;
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
}

const CRON_FIELD_SPECS: CronFieldSpec[] = [
  { min: 0, max: 59, label: 'minute' },
  { min: 0, max: 23, label: 'hour' },
  { min: 1, max: 31, label: 'day of month' },
  { min: 1, max: 12, label: 'month' },
  { min: 0, max: 6, label: 'day of week' },
];

const parsedCronCache = new Map<string, ParsedCronExpression>();

export function validateWakeupCronExpression(expression: string): string {
  const normalized = expression.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    throw new RuntimeWakeupCronError('recurrence.expression is required.');
  }

  parseWakeupCronExpression(normalized);
  return normalized;
}

export function getNextWakeupCronOccurrence(
  expression: string,
  after: Date,
): Date {
  const parsed = parseWakeupCronExpression(expression);
  const cursor = new Date(after.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  for (let index = 0; index < 527_040; index += 1) {
    if (matchesCronExpression(parsed, cursor)) {
      return new Date(cursor);
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }

  throw new RuntimeWakeupCronError(
    `Could not resolve the next occurrence for cron expression '${expression}'.`,
  );
}

function parseWakeupCronExpression(expression: string): ParsedCronExpression {
  const cached = parsedCronCache.get(expression);
  if (cached) {
    return cached;
  }

  const fields = expression.split(' ');
  if (fields.length !== 5) {
    throw new RuntimeWakeupCronError(
      'recurrence.expression must be a five-field cron expression in UTC.',
    );
  }

  const parsed: ParsedCronExpression = {
    expression,
    minute: parseCronField(fields[0], CRON_FIELD_SPECS[0]),
    hour: parseCronField(fields[1], CRON_FIELD_SPECS[1]),
    dayOfMonth: parseCronField(fields[2], CRON_FIELD_SPECS[2]),
    month: parseCronField(fields[3], CRON_FIELD_SPECS[3]),
    dayOfWeek: parseCronField(fields[4], CRON_FIELD_SPECS[4]),
  };
  parsedCronCache.set(expression, parsed);
  return parsed;
}

function parseCronField(
  value: string,
  spec: CronFieldSpec,
): Set<number> {
  const normalized = value.trim();
  if (!normalized) {
    throw new RuntimeWakeupCronError(`Cron ${spec.label} field cannot be empty.`);
  }

  if (normalized === '*') {
    return buildFullRange(spec.min, spec.max);
  }

  const values = new Set<number>();
  for (const token of normalized.split(',')) {
    const trimmed = token.trim();
    if (!trimmed) {
      throw new RuntimeWakeupCronError(`Cron ${spec.label} field contains an empty token.`);
    }

    if (trimmed === '*') {
      for (const number of buildFullRange(spec.min, spec.max)) {
        values.add(number);
      }
      continue;
    }

    if (trimmed.startsWith('*/')) {
      const step = Number.parseInt(trimmed.slice(2), 10);
      if (!Number.isInteger(step) || step <= 0) {
        throw new RuntimeWakeupCronError(
          `Cron ${spec.label} field has invalid step '${trimmed}'.`,
        );
      }
      for (let current = spec.min; current <= spec.max; current += step) {
        values.add(current);
      }
      continue;
    }

    const numeric = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(numeric) || numeric < spec.min || numeric > spec.max) {
      throw new RuntimeWakeupCronError(
        `Cron ${spec.label} field has invalid value '${trimmed}'.`,
      );
    }
    values.add(numeric);
  }

  if (values.size === 0) {
    throw new RuntimeWakeupCronError(`Cron ${spec.label} field cannot be empty.`);
  }

  return values;
}

function buildFullRange(min: number, max: number): Set<number> {
  const values = new Set<number>();
  for (let current = min; current <= max; current += 1) {
    values.add(current);
  }
  return values;
}

function matchesCronExpression(
  parsed: ParsedCronExpression,
  candidate: Date,
): boolean {
  return parsed.minute.has(candidate.getUTCMinutes())
    && parsed.hour.has(candidate.getUTCHours())
    && parsed.dayOfMonth.has(candidate.getUTCDate())
    && parsed.month.has(candidate.getUTCMonth() + 1)
    && parsed.dayOfWeek.has(candidate.getUTCDay());
}
