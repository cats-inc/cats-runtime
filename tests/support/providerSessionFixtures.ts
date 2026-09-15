import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Sanitized Muse 1.0.3 durable-log shapes, distinct from exec stdout fixtures. */
export function museRecords(sessionId: string, cwd: string): Record<string, unknown>[] {
  const record = (sequence: number, payloadType: string, payload: unknown) => ({
    schema_version: 1,
    id: `record-${sequence}`,
    stream: { kind: 'session', id: sessionId },
    sequence,
    recorded_at: 1_788_545_200_000_000 + sequence * 1_000_000,
    record_type: 'event',
    payload_type: payloadType,
    payload,
  });
  return [
    record(1, 'runtime.session.metadata', {
      kind: 'metadata', record: { workspace_root: cwd, model_id: 'muse-spark-1.3' },
    }),
    record(2, 'runtime.user_intent.accepted', {
      refill_blocks: [{ kind: 'text', text: 'Check this workspace' }],
    }),
    record(3, 'runtime.session', {
      kind: 'run', run_id: 'run-1', event: { kind: 'started', prompt: 'Check this workspace' },
    }),
    record(4, 'runtime.session', {
      kind: 'task', task_id: 'tool-1', event: { kind: 'output', chunk: 'Tool output' },
    }),
    record(5, 'runtime.session', {
      kind: 'run', run_id: 'run-1',
      event: { kind: 'reasoning_committed', text: 'Internal reasoning' },
    }),
    record(6, 'runtime.session', {
      kind: 'run', run_id: 'run-1',
      event: { kind: 'assistant_message_committed', text: 'Workspace checked.' },
    }),
    record(7, 'runtime.session', {
      kind: 'run', run_id: 'run-1', event: { kind: 'terminal', terminal: 'completed' },
    }),
  ];
}

export function writeProviderSession(
  provider: 'cline' | 'grok' | 'muse', root: string, sessionId: string, cwd: string,
): string {
  const sessionDir = provider === 'grok' ? join(root, encodeURIComponent(cwd), sessionId)
    : provider === 'muse' ? join(root, '2026', '09', '16', sessionId)
      : join(root, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  if (provider === 'cline') {
    writeFileSync(join(sessionDir, `${sessionId}.json`), JSON.stringify({
      session_id: sessionId, cwd, model: 'model-1', metadata: { title: 'Check this workspace' },
    }));
    writeFileSync(join(sessionDir, `${sessionId}.messages.json`), JSON.stringify({ messages: [
      { role: 'user', content: 'Check this workspace' },
      { role: 'assistant', content: 'Workspace checked.' },
    ] }));
  } else if (provider === 'grok') {
    writeFileSync(join(sessionDir, 'summary.json'), JSON.stringify({
      info: { id: sessionId, cwd }, generated_title: 'Check this workspace', num_messages: 2,
      current_model_id: 'grok-4.6',
    }));
    writeFileSync(join(sessionDir, 'chat_history.jsonl'), [
      { type: 'user', content: 'Check this workspace' },
      { type: 'assistant', content: 'Workspace checked.' },
    ].map((record) => JSON.stringify(record)).join('\n'));
  } else {
    writeFileSync(join(sessionDir, 'session.jsonl'),
      museRecords(sessionId, cwd).map((record) => JSON.stringify(record)).join('\n'));
  }
  return sessionDir;
}
