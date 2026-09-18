import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('./pages/playground.html', import.meta.url), 'utf8');

function buildChatHarness(turns: Record<string, unknown>[][]) {
  const protocol = html.slice(html.indexOf('const MAX_DELEGATION_DEPTH'), html.indexOf('const AGENTS_MD_INSTRUCTION'));
  const classes = html.slice(html.indexOf('class RuntimeError'), html.indexOf('const DEFAULT_CHAT_PROMPTS'));
  const { ChatRoom } = vm.runInNewContext(`${protocol}\n${classes}\n({ ChatRoom })`, { AbortController });
  const events: Record<string, any>[] = [];
  const requests: Array<{ sessionId: string; prompt: string }> = [];
  const room = new ChatRoom({
    client: {
      async *streamMessage(sessionId: string, prompt: string) {
        requests.push({ sessionId, prompt });
        yield* turns.shift() ?? [];
      },
    },
    agents: [
      { name: 'Agent-1', provider: 'devin', sessionId: 'devin-session', tags: ['orchestrator'] },
      { name: 'Agent-2', provider: 'cursor', sessionId: 'cursor-session', tags: ['coder'] },
    ],
    onEvent: async (event: Record<string, any>) => { events.push(event); },
  });
  return { room, events, requests };
}

describe('Playground ACP chat', () => {
  it('displays normalized Devin text, delegates NEXT to Cursor and returns to the CEO', async () => {
    const chunks = ['已完成分工。', '\n\n', '@Agent-2 請實作計算機。', '\n\n', 'NEXT:', ' ', 'Agent-2'];
    const harness = buildChatHarness([
      [
        { type: 'progress', text: '檢查工作區。', metadata: { kind: 'reasoning' } },
        ...chunks.map(text => ({ type: 'text', text })),
        { type: 'result', summary: 'ACP stop reason: end_turn' },
      ],
      [{ type: 'text', text: '計算機已完成。' }, { type: 'result' }],
      [{ type: 'text', text: '已完成網站。' }, { type: 'result', summary: 'ACP stop reason: end_turn' }],
    ]);
    await harness.room.handleMessage('幫我寫個計算機網站。');
    expect(harness.requests.map(request => request.sessionId)).toEqual(['devin-session', 'cursor-session', 'devin-session']);
    expect(harness.requests[1].prompt).toContain('請實作計算機。');
    expect(harness.events).toContainEqual(expect.objectContaining({ type: 'delegation', targets: ['Agent-2'] }));
    expect(harness.events).toContainEqual(expect.objectContaining({ type: 'agent_progress', progress: '檢查工作區。' }));
    expect(harness.events.filter(event => event.type === 'agent_streaming_text' && event.agent === 'Agent-1')
      .slice(0, chunks.length).map(event => event.text).join('')).toBe(chunks.join(''));
    expect(harness.events.filter(event => event.type === 'error')).toEqual([]);
    expect(harness.events.at(-1)).toEqual({ type: 'ready' });
  });

  it('reports a missing response instead of treating the ACP stop reason as assistant output', async () => {
    const harness = buildChatHarness([[{ type: 'result', summary: 'ACP stop reason: end_turn' }]]);
    await harness.room.handleMessage('hello');
    expect(harness.events).toContainEqual({ type: 'error', message: 'Runtime error for Agent-1: Provider returned no assistant output.' });
    expect(harness.requests).toHaveLength(1);
    expect(harness.room.history).toHaveLength(1);
  });

  it('renders an actual result-only response even when no streaming bubble exists', async () => {
    const start = html.indexOf('async function handleEvent(event)');
    const end = html.indexOf('\nfunction clearStreamingState', start);
    const content = { innerHTML: '', querySelectorAll: () => [] };
    const tokens = { textContent: '' };
    let bubbles = 0;
    const handleEvent = vm.runInNewContext(`(${html.slice(start, end)})`, {
      streamingMessages: { 'Agent-1': { element: null, fullText: '' } },
      hideThinking() {}, updateAgentStatus() {}, stripNextDirective: (text: string) => text,
      createAgentBubble: () => {
        bubbles++;
        return { querySelector: (selector: string) => selector === '.msg-content' ? content : tokens };
      },
      DOMPurify: { sanitize: (value: string) => value }, marked: { parse: (value: string) => value },
      totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0,
      document: { getElementById: () => tokens },
    });
    await handleEvent({ type: 'agent_streaming_end', agent: 'Agent-1', content: 'A real reply.' });
    expect(bubbles).toBe(1);
    expect(content.innerHTML).toBe('A real reply.');
  });

  it('labels the configured Devin execution path as ACP', () => {
    const start = html.indexOf('function getProviderBadgeLabel(');
    const end = html.indexOf('\nfunction ', start + 1);
    const label = vm.runInNewContext(`(${html.slice(start, end)})`);
    expect(label('devin')).toBe('DEVIN-ACP');
    expect(label('cursor')).toBe('CURSOR-CLI');
  });
});
