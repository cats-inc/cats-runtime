import { createHash, randomUUID } from 'node:crypto';
import {
  InteractionError, type InteractionAnswer, type InteractionHost, type InteractionKind, type InteractionPrompt,
  type InteractionSnapshot, type InteractionStatus, type ProviderInteraction,
} from './types.js';
import { parseInteractionResponse, validateAnswer } from './validation.js';

interface Entry {
  view: ProviderInteraction;
  respond?: (answer: InteractionAnswer) => Promise<void>;
  fallback?: (reason: string) => Promise<void>;
  abortDelivery?: () => void;
  cleanup?: () => void;
  response?: { key: string; digest: string; pending: Promise<ProviderInteraction> };
  settle?: (view: ProviderInteraction) => void;
}

export interface InteractionRegistration {
  executionId: string;
  prompt: InteractionPrompt;
  signal: AbortSignal;
  deadlineMs?: number;
  respond(answer: InteractionAnswer): Promise<void>;
  fallback(reason: string): Promise<void>;
  abortDelivery?(): void;
}

/** One store per worker identity; no callback or answer is serialized to disk. */
export class InteractionStore {
  readonly generation = randomUUID();
  private revision = 0;
  private readonly entries = new Map<string, Entry>();

  constructor(
    readonly sessionId: string,
    readonly host: InteractionHost,
    private readonly changed: (view: ProviderInteraction) => void = () => undefined,
    private readonly now: () => number = Date.now,
  ) {}

  get waiting(): boolean {
    return [...this.entries.values()].some(entry => ['pending', 'responding'].includes(entry.view.status));
  }

  snapshot(): InteractionSnapshot {
    return { version: 1, sessionId: this.sessionId, workerGeneration: this.generation,
      revision: this.revision, interactions: [...this.entries.values()].map(entry => structuredClone(entry.view)) };
  }

  unavailable(executionId: string, kind: InteractionKind, reason: string): string {
    const at = new Date(this.now()).toISOString();
    const view: ProviderInteraction = { interactionId: randomUUID(), sessionId: this.sessionId,
      workerGeneration: this.generation, executionId, revision: ++this.revision,
      createdAt: at, expiresAt: at, status: 'unsupported', kind, reason };
    this.entries.set(view.interactionId, { view });
    this.prune();
    this.changed(structuredClone(view));
    return view.interactionId;
  }

  register(input: InteractionRegistration): string {
    if (input.signal.aborted) throw new InteractionError('interaction_conflict', 'Execution has ended.');
    if (!this.host.kinds.includes(input.prompt.kind)) {
      throw new InteractionError('interaction_unsupported', 'Host does not support this interaction kind.');
    }
    if ([...this.entries.values()].filter(entry => entry.view.status === 'pending'
      || entry.view.status === 'responding').length >= 16) {
      throw new InteractionError('interaction_limit', 'Too many pending provider interactions.');
    }
    if (JSON.stringify(input.prompt).length > 65_536) {
      throw new InteractionError('interaction_limit', 'Provider interaction is too large.');
    }
    const created = this.now();
    const deadline = Math.min(created + this.host.timeoutMs, input.deadlineMs ?? Infinity);
    const view: ProviderInteraction = {
      interactionId: randomUUID(), sessionId: this.sessionId, workerGeneration: this.generation,
      executionId: input.executionId, revision: ++this.revision,
      createdAt: new Date(created).toISOString(), expiresAt: new Date(deadline).toISOString(),
      status: 'pending', kind: input.prompt.kind, prompt: structuredClone(input.prompt),
    };
    const entry: Entry = { view, respond: input.respond, fallback: input.fallback, abortDelivery: input.abortDelivery };
    const abort = () => this.finish(entry, 'interrupted', 'execution_ended');
    const timer = setTimeout(() => { void this.expire(entry); }, Math.max(0, deadline - created));
    timer.unref?.();
    input.signal.addEventListener('abort', abort, { once: true });
    entry.cleanup = () => { clearTimeout(timer); input.signal.removeEventListener('abort', abort); };
    this.entries.set(view.interactionId, entry);
    this.prune();
    this.changed(structuredClone(view));
    return view.interactionId;
  }

  async respond(id: string, value: unknown): Promise<ProviderInteraction> {
    const input = parseInteractionResponse(value);
    const entry = this.entries.get(id);
    if (!entry) throw new InteractionError('interaction_not_found', 'Provider interaction not found.');
    // The digest is memory-only. Idempotency never retains the plaintext answer.
    const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    if (entry.response) {
      if (entry.response.key === input.idempotencyKey && entry.response.digest === digest) return entry.response.pending;
      throw new InteractionError('interaction_conflict', 'Provider interaction already has a response.');
    }
    if (entry.view.status !== 'pending' || entry.view.revision !== input.expectedRevision
      || this.now() >= Date.parse(entry.view.expiresAt) || !entry.view.prompt) {
      if (entry.view.status === 'pending' && this.now() >= Date.parse(entry.view.expiresAt)) void this.expire(entry);
      throw new InteractionError('interaction_conflict', 'Provider interaction is no longer pending at this revision.');
    }
    validateAnswer(entry.view.prompt, input.answer);
    const send = entry.respond!;
    entry.view = { ...entry.view, status: 'responding', decision: input.answer.action, revision: ++this.revision };
    // Install the latch before notifying or invoking provider code (which may reenter).
    let resolve!: (view: ProviderInteraction) => void;
    const pending = new Promise<ProviderInteraction>(done => { resolve = done; });
    entry.settle = resolve;
    entry.response = { key: input.idempotencyKey, digest, pending };
    this.changed(structuredClone(entry.view));
    void Promise.resolve().then(async () => {
      if (entry.view.status === 'responding') {
        try {
          await send(input.answer);
          if (entry.view.status === 'responding') {
            this.finish(entry, input.answer.action === 'cancel' ? 'cancelled' : 'resolved', 'response_sent', false);
          }
        } catch { this.finish(entry, 'interrupted', 'response_delivery_failed'); }
      }
      resolve(structuredClone(entry.view));
    });
    return pending;
  }

  resolve(id: string): void {
    const entry = this.entries.get(id);
    if (entry) this.finish(entry, 'resolved', 'provider_resolved', true);
  }

  interrupt(): void {
    for (const entry of this.entries.values()) {
      if (entry.view.status === 'pending' || entry.view.status === 'responding') {
        this.finish(entry, 'interrupted', 'worker_stopped');
      }
    }
  }

  private async expire(entry: Entry): Promise<void> {
    if (entry.view.status === 'responding') {
      const abortDelivery = entry.abortDelivery;
      this.finish(entry, 'interrupted', 'response_delivery_timeout');
      abortDelivery?.();
      return;
    }
    if (entry.view.status !== 'pending') return;
    const fallback = entry.fallback;
    const abortDelivery = entry.abortDelivery;
    this.finish(entry, 'expired', 'deadline_exceeded');
    try { await fallback?.('deadline_exceeded'); } catch { abortDelivery?.(); }
  }

  private finish(entry: Entry, status: InteractionStatus, reason: string, providerConfirmed = false): void {
    if (entry.view.status !== 'pending' && entry.view.status !== 'responding'
      && !(status === 'resolved' && entry.view.status === 'resolved' && providerConfirmed && !entry.view.providerConfirmed)) return;
    entry.cleanup?.();
    entry.cleanup = undefined;
    entry.respond = undefined;
    entry.fallback = undefined;
    entry.abortDelivery = undefined;
    const { prompt: _prompt, ...receipt } = entry.view;
    entry.view = { ...receipt, status, reason, providerConfirmed, revision: ++this.revision };
    this.changed(structuredClone(entry.view));
    entry.settle?.(structuredClone(entry.view));
    entry.settle = undefined;
    this.prune();
  }

  private prune(): void {
    const terminal = [...this.entries.values()].filter(entry => !['pending', 'responding'].includes(entry.view.status));
    for (const entry of terminal.slice(0, Math.max(0, terminal.length - 64))) this.entries.delete(entry.view.interactionId);
  }
}
