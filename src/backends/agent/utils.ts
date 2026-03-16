import type { AgentRuntimeService } from '../../core/types.js';

export function parseRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function prependInstructions(message: string, instructions?: string): string {
  if (!instructions) {
    return message;
  }

  return `${instructions.trim()}\n\n${message}`;
}

export function parseServices(value: unknown): AgentRuntimeService[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const services = value.flatMap((entry, index) => {
    const record = parseRecord(entry);
    if (!record) {
      return [];
    }

    return [{
      id: readString(record.id) || `service-${index + 1}`,
      name: readString(record.name) || readString(record.label) || `service-${index + 1}`,
      url: readString(record.url),
      status: readString(record.status),
      metadata: parseRecord(record.metadata) || undefined,
    } satisfies AgentRuntimeService];
  });

  return services.length > 0 ? services : undefined;
}
