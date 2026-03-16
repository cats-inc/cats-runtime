interface ParsedSseEvent {
  event?: string;
  data: string;
}

async function* readTextChunks(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<string> {
  if (!body) {
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        const tail = decoder.decode();
        if (tail) {
          yield tail;
        }
        return;
      }

      yield decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* parseSseEvents(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<ParsedSseEvent> {
  let buffer = '';

  for await (const chunk of readTextChunks(body)) {
    buffer += chunk;

    while (true) {
      const delimiterIndex = buffer.indexOf('\n\n');
      if (delimiterIndex < 0) {
        break;
      }

      const rawEvent = buffer.slice(0, delimiterIndex);
      buffer = buffer.slice(delimiterIndex + 2);

      let eventName: string | undefined;
      const dataLines: string[] = [];
      for (const rawLine of rawEvent.split(/\r?\n/)) {
        if (!rawLine || rawLine.startsWith(':')) {
          continue;
        }

        if (rawLine.startsWith('event:')) {
          eventName = rawLine.slice(6).trim();
          continue;
        }
        if (rawLine.startsWith('data:')) {
          dataLines.push(rawLine.slice(5).trim());
        }
      }

      if (dataLines.length === 0) {
        continue;
      }

      yield {
        event: eventName,
        data: dataLines.join('\n'),
      };
    }
  }

  const trimmed = buffer.trim();
  if (!trimmed) {
    return;
  }

  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim());

  if (dataLines.length > 0) {
    yield {
      data: dataLines.join('\n'),
    };
  }
}

export async function* parseNdjson(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<Record<string, unknown>> {
  let buffer = '';

  for await (const chunk of readTextChunks(body)) {
    buffer += chunk;

    while (true) {
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex < 0) {
        break;
      }

      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }

      yield JSON.parse(line) as Record<string, unknown>;
    }
  }

  const tail = buffer.trim();
  if (tail) {
    yield JSON.parse(tail) as Record<string, unknown>;
  }
}

export async function readErrorBody(response: Response): Promise<string> {
  try {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await response.json() as Record<string, unknown>;
      return JSON.stringify(body);
    }

    return await response.text();
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}
