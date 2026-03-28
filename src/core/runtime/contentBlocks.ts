import type {
  ContentBlockStreamEvent,
  RuntimeContentBlock,
  RuntimeContentBlockStatus,
  StreamEvent,
} from '../types.js';

function cloneMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return metadata ? { ...metadata } : undefined;
}

function cloneBlock(
  block: RuntimeContentBlock,
): RuntimeContentBlock {
  return {
    ...block,
    ...(block.metadata ? { metadata: cloneMetadata(block.metadata) } : {}),
  };
}

function createContentBlockEvent(
  sourceEvent: StreamEvent,
  block: RuntimeContentBlock,
): ContentBlockStreamEvent {
  return {
    type: 'content_block',
    ...(sourceEvent.sessionId ? { sessionId: sourceEvent.sessionId } : {}),
    ...(sourceEvent.providerSessionId ? { providerSessionId: sourceEvent.providerSessionId } : {}),
    ...(block.text ? { text: block.text } : {}),
    ...(block.toolName ? { toolName: block.toolName } : {}),
    ...(block.toolId ? { toolId: block.toolId } : {}),
    ...(block.status === 'error' ? { isError: true } : {}),
    block: cloneBlock(block),
  };
}

function titleFromProgressKind(kind: unknown): string {
  if (typeof kind !== 'string' || kind.trim().length === 0) {
    return 'Status';
  }

  return kind
    .split(/[_\s-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

interface RuntimeContentBlockProjector {
  project(event: StreamEvent): ContentBlockStreamEvent[];
}

export function createRuntimeContentBlockProjector(): RuntimeContentBlockProjector {
  let nextIndex = 0;
  let activeTextBlockId: string | null = null;
  const blocks = new Map<string, RuntimeContentBlock>();
  const toolBlockIds = new Map<string, string>();

  function allocateBlock(
    input: Omit<RuntimeContentBlock, 'id' | 'index'> & { idPrefix: string },
  ): RuntimeContentBlock {
    const block = {
      id: `${input.idPrefix}:${nextIndex}`,
      index: nextIndex,
      kind: input.kind,
      status: input.status,
      ...(input.title ? { title: input.title } : {}),
      ...(input.text ? { text: input.text } : {}),
      ...(input.toolName ? { toolName: input.toolName } : {}),
      ...(input.toolId ? { toolId: input.toolId } : {}),
      ...(input.metadata ? { metadata: cloneMetadata(input.metadata) } : {}),
    } satisfies RuntimeContentBlock;
    nextIndex += 1;
    blocks.set(block.id, block);
    return block;
  }

  function closeActiveTextBlock(
    sourceEvent: StreamEvent,
    status: RuntimeContentBlockStatus = 'complete',
  ): ContentBlockStreamEvent[] {
    if (!activeTextBlockId) {
      return [];
    }

    const block = blocks.get(activeTextBlockId);
    activeTextBlockId = null;
    if (!block) {
      return [];
    }

    if (block.status === status) {
      return [];
    }

    block.status = status;
    return [createContentBlockEvent(sourceEvent, block)];
  }

  function getOrCreateTextBlock(sourceEvent: StreamEvent): RuntimeContentBlock {
    if (activeTextBlockId) {
      const existing = blocks.get(activeTextBlockId);
      if (existing) {
        return existing;
      }
    }

    const block = allocateBlock({
      idPrefix: 'text',
      kind: 'text',
      status: 'streaming',
      title: 'Response',
    });
    activeTextBlockId = block.id;
    return block;
  }

  function getToolBlockIdentity(event: StreamEvent): string {
    return event.toolId?.trim()
      || event.toolName?.trim()
      || `tool:${nextIndex}`;
  }

  return {
    project(event: StreamEvent): ContentBlockStreamEvent[] {
      switch (event.type) {
        case 'text': {
          const block = getOrCreateTextBlock(event);
          block.text = `${block.text ?? ''}${event.text}`;
          return [createContentBlockEvent(event, block)];
        }
        case 'tool_use': {
          const toolName = event.toolName?.trim() || 'Tool';
          const toolIdentity = getToolBlockIdentity(event);
          const block = allocateBlock({
            idPrefix: 'tool',
            kind: 'tool',
            status: 'streaming',
            title: toolName,
            toolName,
            ...(event.toolId?.trim() ? { toolId: event.toolId.trim() } : {}),
            ...(event.text ? { text: event.text } : {}),
            ...(event.metadata ? { metadata: event.metadata } : {}),
          });
          toolBlockIds.set(toolIdentity, block.id);
          return [
            ...closeActiveTextBlock(event),
            createContentBlockEvent(event, block),
          ];
        }
        case 'tool_result': {
          const toolIdentity = getToolBlockIdentity(event);
          const existingId = toolBlockIds.get(toolIdentity);
          const existing = existingId ? blocks.get(existingId) : undefined;
          const block = existing || allocateBlock({
            idPrefix: 'tool',
            kind: 'tool',
            status: event.isError ? 'error' : 'complete',
            title: event.toolName?.trim() || 'Tool',
            ...(event.toolName?.trim() ? { toolName: event.toolName.trim() } : {}),
            ...(event.toolId?.trim() ? { toolId: event.toolId.trim() } : {}),
          });
          block.status = event.isError ? 'error' : 'complete';
          if (event.text) {
            block.text = event.text;
          }
          if (event.toolName?.trim()) {
            block.title = event.toolName.trim();
            block.toolName = event.toolName.trim();
          }
          if (event.toolId?.trim()) {
            block.toolId = event.toolId.trim();
          }
          if (event.metadata) {
            block.metadata = cloneMetadata(event.metadata);
          }
          return [createContentBlockEvent(event, block)];
        }
        case 'progress': {
          const metadata = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
            ? event.metadata as Record<string, unknown>
            : undefined;
          const block = allocateBlock({
            idPrefix: 'status',
            kind: 'status',
            status: event.isError ? 'error' : 'complete',
            title: titleFromProgressKind(metadata?.kind),
            text: event.text,
            ...(event.toolName?.trim() ? { toolName: event.toolName.trim() } : {}),
            ...(event.toolId?.trim() ? { toolId: event.toolId.trim() } : {}),
            ...(metadata ? { metadata } : {}),
          });
          return [createContentBlockEvent(event, block)];
        }
        case 'result': {
          if (event.text) {
            const block = activeTextBlockId ? blocks.get(activeTextBlockId) : undefined;
            const textBlock = block || allocateBlock({
              idPrefix: 'text',
              kind: 'text',
              status: 'complete',
              title: 'Response',
            });
            textBlock.text = `${textBlock.text ?? ''}${event.text}`;
            textBlock.status = 'complete';
            activeTextBlockId = null;
            return [createContentBlockEvent(event, textBlock)];
          }

          return closeActiveTextBlock(event);
        }
        case 'error': {
          const statusBlock = allocateBlock({
            idPrefix: 'status',
            kind: 'status',
            status: 'error',
            title: 'Error',
            text: event.text,
            ...(event.metadata ? { metadata: event.metadata } : {}),
          });
          return [
            ...closeActiveTextBlock(event, 'error'),
            createContentBlockEvent(event, statusBlock),
          ];
        }
        default:
          return [];
      }
    },
  };
}
