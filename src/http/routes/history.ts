import { createReadStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Hono } from 'hono';
import {
  getRuntimeBrowserService,
  getRuntimeMeteringService,
  getRuntimeSessionManager,
  type AppContext,
} from '../app.js';
import type { SessionInfo } from '../../backends/cli/pool/types.js';
import { toSessionView } from '../../backends/cli/pool/sessionView.js';
import { buildSessionInspection } from '../../core/runtime/sessionInspection.js';
import {
  getAuggieSessions,
  getCursorNative,
  getKiroNative,
  getOpencodeNative,
} from '../providerServices.js';
import type { PiMessagePart, PiStreamEvent } from '../../backends/cli/pi/parser.js';

export const historyRoutes = new Hono();

/**
 * Extract text from Gemini content which can be a string or a part-list array.
 * Part-list format: [{ text: "..." }, { functionCall: ... }, ...]
 */
function geminiExtractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: Record<string, unknown>) => {
        if (typeof part.text === 'string') return part.text;
        return '';
      })
      .filter(Boolean)
      .join('');
  }
  return '';
}

interface HistoryMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp?: string;
}

interface HistoryTranscriptMetadata {
  ownership: 'provider' | 'runtime' | 'none';
  source: 'service' | 'jsonl' | 'json' | 'none';
  parser:
    | 'cursor_native'
    | 'kiro_native'
    | 'auggie_native'
    | 'opencode_native'
    | 'gemini_native'
    | 'generic_jsonl'
    | 'pi_native'
    | 'none';
}

function buildHistoryMetadata(ctx: AppContext, session: SessionInfo) {
  const wakeup = ctx.wakeup?.getSessionWakeState(session.id);
  const runtime = getRuntimeSessionManager(ctx);
  const view = toSessionView(session, {
    attached: runtime.isAttached(session.id),
    externalSessionLiveWindowMs: ctx.config.externalSessionLiveWindowMs,
  });
  return {
    sessionKey: session.sessionKey,
    outputDir: session.outputDir,
    artifacts: session.artifacts || [],
    context: session.context,
    skills: session.skills,
    hydration: session.hydration,
    ...(wakeup ? { wakeup } : {}),
    inspection: buildSessionInspection({
      session,
      view,
      trackedState: runtime.getTrackedState(session.id),
      metering: getRuntimeMeteringService(ctx).buildSessionSnapshot(session),
      wakeupPending: Boolean(wakeup?.pending),
      browserSessions: getRuntimeBrowserService(ctx).listSessions({
        runtimeSessionId: session.id,
      }),
    }),
  };
}

function buildHistoryResponse(
  ctx: AppContext,
  session: SessionInfo,
  messages: HistoryMessage[],
  transcript: HistoryTranscriptMetadata,
) {
  return {
    messages,
    transcript,
    ...buildHistoryMetadata(ctx, session),
  };
}

function extractPiTextContent(content: string | PiMessagePart[] | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text!)
    .join('');
}

async function loadPiHistory(filePath: string): Promise<HistoryMessage[]> {
  const messages: HistoryMessage[] = [];
  let streamingAssistantText = '';
  let streamingAssistantTimestamp: string | undefined;

  const pushMessage = (
    role: HistoryMessage['role'],
    textValue: string,
    timestamp?: string,
  ) => {
    const text = textValue.trim();
    if (!text) {
      return;
    }

    const previous = messages.at(-1);
    if (
      previous?.role === role
      && previous.text === text
      && previous.timestamp === timestamp
    ) {
      return;
    }

    messages.push({
      role,
      text,
      timestamp,
    });
  };

  const flushStreamingAssistant = () => {
    pushMessage('assistant', streamingAssistantText, streamingAssistantTimestamp);
    streamingAssistantText = '';
    streamingAssistantTimestamp = undefined;
  };

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let obj: PiStreamEvent & { timestamp?: string };
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    const timestamp = typeof obj.timestamp === 'string' ? obj.timestamp : undefined;
    if (obj.type === 'message') {
      const role = obj.message?.role;
      const text = extractPiTextContent(obj.message?.content);
      if (role === 'user' && text) {
        pushMessage('user', text, timestamp);
      } else if (role === 'assistant' && text) {
        flushStreamingAssistant();
        pushMessage('assistant', text, timestamp);
      }
      continue;
    }

    if (
      obj.type === 'message_update'
      && obj.assistantMessageEvent?.type === 'text_delta'
      && obj.assistantMessageEvent.delta
    ) {
      streamingAssistantText += obj.assistantMessageEvent.delta;
      streamingAssistantTimestamp = streamingAssistantTimestamp || timestamp;
      continue;
    }

    if (obj.type === 'turn_end') {
      if (obj.message?.stopReason !== 'toolUse') {
        flushStreamingAssistant();
      }
      continue;
    }

    if (obj.type === 'agent_end') {
      let lastAssistant:
        | {
          role?: string;
          content?: string | PiMessagePart[];
        }
        | undefined;
      if (Array.isArray(obj.messages)) {
        for (let index = obj.messages.length - 1; index >= 0; index -= 1) {
          const candidate = obj.messages[index];
          if (candidate?.role === 'assistant') {
            lastAssistant = candidate;
            break;
          }
        }
      }
      const text = extractPiTextContent(lastAssistant?.content);
      if (text) {
        flushStreamingAssistant();
        const previous = messages.at(-1);
        if (previous?.role !== 'assistant' || previous.text !== text.trim()) {
          pushMessage('assistant', text, timestamp);
        }
      } else {
        flushStreamingAssistant();
      }
    }
  }

  flushStreamingAssistant();
  return messages;
}

/** GET /sessions/:id/history — load conversation history from .jsonl */
historyRoutes.get('/sessions/:id/history', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const id = c.req.param('id');
  const session = ctx.registry.get(id);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  if (session.providerName === 'cursor') {
    if (!session.providerSessionId) {
      return c.json(buildHistoryResponse(ctx, session, [], {
        ownership: 'provider',
        source: 'none',
        parser: 'cursor_native',
      }));
    }

    try {
      const messages = await getCursorNative(
        ctx,
        session.providerInstanceId,
      ).loadHistory(session.cwd, session.providerSessionId);
      return c.json(buildHistoryResponse(ctx, session, messages, {
        ownership: 'provider',
        source: 'service',
        parser: 'cursor_native',
      }));
    } catch (err) {
      return c.json({ error: `Failed to load Cursor history: ${err}` }, 500);
    }
  }

  if (session.providerName === 'kiro') {
    if (!session.providerSessionId) {
      return c.json(buildHistoryResponse(ctx, session, [], {
        ownership: 'provider',
        source: 'none',
        parser: 'kiro_native',
      }));
    }

    try {
      const messages = await getKiroNative(
        ctx,
        session.providerInstanceId,
      ).loadHistory(session.cwd, session.providerSessionId);
      return c.json(buildHistoryResponse(ctx, session, messages, {
        ownership: 'provider',
        source: 'service',
        parser: 'kiro_native',
      }));
    } catch (err) {
      return c.json({ error: `Failed to load Kiro history: ${err}` }, 500);
    }
  }

  if (session.providerName === 'auggie') {
    try {
      const messages = await getAuggieSessions(ctx, session.providerInstanceId).loadHistory({
        providerSessionId: session.providerSessionId,
        sourcePath: session.providerSourcePath || session.sourcePath,
      });
      return c.json(buildHistoryResponse(ctx, session, messages, {
        ownership: 'provider',
        source: 'service',
        parser: 'auggie_native',
      }));
    } catch (err) {
      return c.json({ error: `Failed to load Auggie history: ${err}` }, 500);
    }
  }

  if (session.providerName === 'opencode') {
    if (!session.providerSessionId) {
      return c.json(buildHistoryResponse(ctx, session, [], {
        ownership: 'provider',
        source: 'none',
        parser: 'opencode_native',
      }));
    }

    try {
      const messages = await getOpencodeNative(
        ctx,
        session.providerInstanceId,
      ).loadHistory(session.cwd, session.providerSessionId);
      return c.json(buildHistoryResponse(ctx, session, messages, {
        ownership: 'provider',
        source: 'service',
        parser: 'opencode_native',
      }));
    } catch (err) {
      return c.json({ error: `Failed to load OpenCode history: ${err}` }, 500);
    }
  }

  // Collect paths: provider transcript first, then runtime-managed (if different)
  const paths: string[] = [];
  if (session.providerSourcePath) paths.push(session.providerSourcePath);
  if (session.sourcePath && session.sourcePath !== session.providerSourcePath) {
    paths.push(session.sourcePath);
  }
  if (paths.length === 0) {
    return c.json(buildHistoryResponse(ctx, session, [], {
      ownership: 'none',
      source: 'none',
      parser: 'none',
    }));
  }

  const messages: HistoryMessage[] = [];
  let transcript: HistoryTranscriptMetadata = {
    ownership: session.providerSourcePath ? 'provider' : 'runtime',
    source: 'jsonl',
    parser: 'generic_jsonl',
  };

  for (const filePath of paths) {
    if (session.providerName === 'pi' && filePath === session.providerSourcePath) {
      try {
        const piMessages = await loadPiHistory(filePath);
        messages.push(...piMessages);
        transcript = {
          ownership: 'provider',
          source: 'jsonl',
          parser: 'pi_native',
        };
      } catch {
        // Fall through to the generic parser for any unreadable Pi transcripts.
      }
      continue;
    }

    // Gemini single-JSON session format
    if (filePath.endsWith('.json')) {
      try {
        const raw = readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw);
        for (const msg of data.messages || []) {
          const text = geminiExtractText(msg.content);
          if (msg.type === 'user' && text)
            messages.push({ role: 'user', text, timestamp: msg.timestamp });
          else if (msg.type === 'gemini' && text)
            messages.push({ role: 'assistant', text, timestamp: msg.timestamp });
        }
        transcript = {
          ownership: filePath === session.providerSourcePath ? 'provider' : 'runtime',
          source: 'json',
          parser: 'gemini_native',
        };
      } catch {
        // Non-fatal
      }
      continue;
    }

    let hasEventMsgUser = false;
    const pendingResponseUsers: HistoryMessage[] = [];

    try {
      const rl = createInterface({
        input: createReadStream(filePath, { encoding: 'utf-8' }),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);

          // --- managed session / Claude-written format ---
          if (obj.type === 'user' && obj.message?.content) {
            const content = typeof obj.message.content === 'string'
              ? obj.message.content
              : '';
            if (content) {
              messages.push({ role: 'user', text: content, timestamp: obj.timestamp });
            }
          } else if (obj.type === 'compaction_summary' && typeof obj.text === 'string') {
            const text = obj.text.trim();
            if (text) {
              messages.push({ role: 'assistant', text, timestamp: obj.timestamp });
            }
          } else if (obj.type === 'assistant' && obj.message?.content) {
            const parts = obj.message.content;
            if (Array.isArray(parts)) {
              const textParts = parts
                .filter((p: { type?: string }) => p.type === 'text')
                .map((p: { text?: string }) => p.text || '')
                .join('\n');
              if (textParts) {
                messages.push({ role: 'assistant', text: textParts, timestamp: obj.timestamp });
              }
            }
          }

          // --- Codex CLI native format ---
          // User messages from event_msg
          else if (obj.type === 'event_msg' && obj.payload?.type === 'user_message') {
            hasEventMsgUser = true;
            const text = typeof obj.payload.message === 'string' ? obj.payload.message : '';
            if (text) {
              messages.push({ role: 'user', text, timestamp: obj.timestamp });
            }
          }
          // User messages from response_item (buffer — only used if no event_msg.user_message)
          else if (obj.type === 'response_item' && obj.payload?.role === 'user') {
            const content = obj.payload.content;
            if (Array.isArray(content)) {
              const textParts = content
                .map((p: { text?: string }) => p.text || '')
                .filter(Boolean)
                .join('\n');
              if (textParts) {
                pendingResponseUsers.push({ role: 'user', text: textParts, timestamp: obj.timestamp });
              }
            }
          }
          // Assistant messages from response_item
          else if (obj.type === 'response_item' && obj.payload?.role === 'assistant' && obj.payload?.type === 'message') {
            const content = obj.payload.content;
            if (Array.isArray(content)) {
              const textParts = content
                .filter((p: { type?: string }) => p.type === 'output_text')
                .map((p: { text?: string }) => p.text || '')
                .join('\n');
              if (textParts) {
                messages.push({ role: 'assistant', text: textParts, timestamp: obj.timestamp });
              }
            }
          }
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }

    // Use response_item user messages only if no event_msg user messages were found
    if (!hasEventMsgUser) {
      messages.push(...pendingResponseUsers);
    }
  }

  return c.json(buildHistoryResponse(ctx, session, messages, transcript));
});
