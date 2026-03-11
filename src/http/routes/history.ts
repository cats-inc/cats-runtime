import { createReadStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Hono } from 'hono';
import type { AppContext } from '../app.js';

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
      return c.json({ messages: [] });
    }

    try {
      const messages = await ctx.cursorNative.loadHistory(session.cwd, session.providerSessionId);
      return c.json({ messages });
    } catch (err) {
      return c.json({ error: `Failed to load Cursor history: ${err}` }, 500);
    }
  }

  if (session.providerName === 'kiro') {
    if (!session.providerSessionId) {
      return c.json({ messages: [] });
    }

    try {
      const messages = await ctx.kiroNative.loadHistory(session.cwd, session.providerSessionId);
      return c.json({ messages });
    } catch (err) {
      return c.json({ error: `Failed to load Kiro history: ${err}` }, 500);
    }
  }

  if (session.providerName === 'auggie') {
    try {
      const messages = await ctx.auggieSessions.loadHistory({
        providerSessionId: session.providerSessionId,
        sourcePath: session.providerSourcePath || session.sourcePath,
      });
      return c.json({ messages });
    } catch (err) {
      return c.json({ error: `Failed to load Auggie history: ${err}` }, 500);
    }
  }

  if (session.providerName === 'opencode') {
    if (!session.providerSessionId) {
      return c.json({ messages: [] });
    }

    try {
      const messages = await ctx.opencodeNative.loadHistory(session.cwd, session.providerSessionId);
      return c.json({ messages });
    } catch (err) {
      return c.json({ error: `Failed to load OpenCode history: ${err}` }, 500);
    }
  }

  // Collect paths: provider transcript first, then fleet-managed (if different)
  const paths: string[] = [];
  if (session.providerSourcePath) paths.push(session.providerSourcePath);
  if (session.sourcePath && session.sourcePath !== session.providerSourcePath) {
    paths.push(session.sourcePath);
  }
  if (paths.length === 0) return c.json({ messages: [] });

  const messages: HistoryMessage[] = [];

  for (const filePath of paths) {
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

  return c.json({ messages });
});
