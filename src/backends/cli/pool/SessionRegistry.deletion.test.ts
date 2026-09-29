import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compactRuntimeManagedTranscript } from '../../../core/runtime/sessionCompaction.js';
import { runtimeCompactionDirectory } from '../../../core/runtime/transcriptPaths.js';
import { SessionRegistry } from './SessionRegistry.js';

describe('Runtime-owned transcript deletion', () => {
  let root: string;
  let sessions: string;
  let registry: SessionRegistry;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cats-deletion-'));
    sessions = join(root, 'sessions');
    mkdirSync(sessions);
    registry = new SessionRegistry(undefined, sessions);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    registry.flush();
    rmSync(root, { recursive: true, force: true });
  });

  function fixture(id = 'session-1') {
    const session = registry.create({ id, providerName: 'codex', cwd: root });
    const source = join(sessions, 'history', `${id}.jsonl`);
    mkdirSync(join(sessions, 'history'), { recursive: true });
    writeFileSync(source, Array.from({ length: 12 }, (_, index) => JSON.stringify({
      type: index % 2 ? 'assistant' : 'user', message: { content: `Test message ${index}` },
    })).join('\n') + '\n');
    registry.setSourcePath(session.id, source);
    return { session, source };
  }

  it('stages and rolls back actual compaction archives, then deletes only the selected session', () => {
    const { session, source } = fixture();
    const compacted = compactRuntimeManagedTranscript({
      sessionId: session.id, session, sessionBaseDir: sessions,
      now: new Date('2026-09-29T00:00:00Z'),
    });
    const archive = compacted!.record.archivePath!;
    expect(existsSync(archive)).toBe(true);
    const retained = runtimeCompactionDirectory(sessions, 'other-session');
    mkdirSync(retained, { recursive: true });
    writeFileSync(join(retained, 'retained.jsonl'), 'retain me');
    const before = readFileSync(archive, 'utf8');
    const staged = registry.prepareManagedTranscriptDeletion(session.id);
    expect(staged.ready).toBe(true);
    expect(existsSync(archive)).toBe(false);
    staged.rollback();
    expect(readFileSync(archive, 'utf8')).toBe(before);
    expect(existsSync(source)).toBe(true);
    expect(registry.remove(session.id)).toEqual({ deleted: true, fileDeleted: true });
    expect(existsSync(archive)).toBe(false);
    expect(existsSync(source)).toBe(false);
    expect(readFileSync(join(retained, 'retained.jsonl'), 'utf8')).toBe('retain me');
  });

  it('reports a final removal failure, restores its surviving archive and supports explicit retry', () => {
    const { session, source } = fixture();
    const archives = runtimeCompactionDirectory(sessions, session.id);
    mkdirSync(archives, { recursive: true });
    writeFileSync(join(archives, 'original.jsonl'), 'private history');
    const internal = registry as unknown as { removeStagedArtifact(path: string): void };
    const remove = internal.removeStagedArtifact.bind(internal);
    const spy = vi.spyOn(internal, 'removeStagedArtifact').mockImplementation((path) => {
      if (path.includes(`${session.id}.pending-delete`)) throw new Error('fixture locked archive');
      remove(path);
    });
    const prepared = registry.prepareManagedTranscriptDeletion(session.id);
    const result = prepared.finalize();
    expect(result).toEqual({ fileDeleted: false, failedPaths: [archives] });
    expect(prepared.finalize()).toEqual(result);
    expect(existsSync(source)).toBe(false); // A finalization failure can be partial.
    expect(readFileSync(join(archives, 'original.jsonl'), 'utf8')).toBe('private history');
    expect(registry.get(session.id)).toBeDefined();
    expect(registry.remove(session.id).deleted).toBe(false);
    spy.mockRestore();
    expect(registry.remove(session.id)).toEqual({ deleted: true, fileDeleted: true });
    expect(existsSync(archives)).toBe(false);
  });

  it.each(['../outside', '..\\outside', '/outside', 'C:\\outside', '.', 'con', 'COM¹.txt', 'con .txt', 'CONOUT$', 'trailing.', 'trailing '])(
    'rejects unsafe compaction id %s before staging any transcript', (id) => {
      const source = join(sessions, 'safe.jsonl');
      writeFileSync(source, 'private history');
      registry.create({ id, providerName: 'codex', cwd: root });
      registry.setSourcePath(id, source);
      expect(registry.prepareManagedTranscriptDeletion(id).ready).toBe(false);
      expect(registry.remove(id).deleted).toBe(false);
      expect(readFileSync(source, 'utf8')).toBe('private history');
      expect(() => runtimeCompactionDirectory(sessions, id)).toThrow();
    },
  );

  it.each(['工作 討論', 'café session', '_internal', '.hidden-session'])(
    'preserves safe supplied session id %s for compaction and deletion', (id) => {
      const { session } = fixture(id);
      const compacted = compactRuntimeManagedTranscript({ sessionId: id, session, sessionBaseDir: sessions });
      expect(existsSync(compacted!.record.archivePath!)).toBe(true);
      expect(registry.remove(id).deleted).toBe(true);
      expect(existsSync(compacted!.record.archivePath!)).toBe(false);
    },
  );

  it('persists a compound removal/restore failure fence across retry and restart until manual resolution', () => {
    const data = join(root, 'data');
    registry = new SessionRegistry(data, sessions);
    const { session } = fixture();
    const archives = runtimeCompactionDirectory(sessions, session.id);
    mkdirSync(archives, { recursive: true });
    writeFileSync(join(archives, 'private.jsonl'), 'retained history');
    const internal = registry as unknown as { removeStagedArtifact(path: string): void };
    const remove = internal.removeStagedArtifact.bind(internal);
    const spy = vi.spyOn(internal, 'removeStagedArtifact').mockImplementation((path) => {
      if (path.includes(`${session.id}.pending-delete`)) {
        mkdirSync(archives); // A competing writer prevents rename back to the original path.
        throw new Error('fixture removal failed');
      }
      remove(path);
    });
    expect(registry.remove(session.id).deleted).toBe(false);
    spy.mockRestore();
    const pending = registry.getPendingFileDeletionPaths(session.id);
    expect(pending).toHaveLength(1);
    expect(readFileSync(join(pending[0], 'private.jsonl'), 'utf8')).toBe('retained history');
    expect(registry.remove(session.id).deleted).toBe(false);
    registry = new SessionRegistry(data, sessions);
    expect(registry.getPendingFileDeletionPaths(session.id)).toEqual(pending);
    expect(registry.remove(session.id).deleted).toBe(false);
    expect(registry.unregister(session.id)).toBe(false);
    expect(() => registry.create({ id: session.id, providerName: 'codex', cwd: root })).toThrow('unresolved');
    registry.get(session.id)!.origin = 'discovered';
    registry.get(session.id)!.providerSessionId = 'native-fixture';
    expect(registry.pruneMissingDiscovered('codex', [])).toBe(0);
    // Operator resolution, limited to the staged directory created by this fixture.
    expect(pending[0]).toMatch(/^.+[\\/]compactions[\\/]\.cats-runtime-delete-.+\.pending-delete$/u);
    expect(pending[0].startsWith(join(sessions, 'compactions'))).toBe(true);
    rmSync(pending[0], { recursive: true });
    expect(registry.remove(session.id).deleted).toBe(true);
  });

  it('fails closed on malformed persisted pending-removal metadata without using it as a deletion target', () => {
    const data = join(root, 'data');
    registry = new SessionRegistry(data, sessions);
    const { session, source } = fixture();
    session.pendingFileDeletionPaths = [source]; // Not a Runtime-staged deletion path.
    registry.flush();
    registry = new SessionRegistry(data, sessions);
    expect(registry.remove(session.id).deleted).toBe(false);
    expect(existsSync(source)).toBe(true);
  });

  it('preserves the pending-removal fence when persisted native-session duplicates merge', () => {
    const data = join(root, 'data');
    registry = new SessionRegistry(data, sessions);
    const first = registry.create({ id: 'first', providerName: 'codex', cwd: root });
    const second = registry.create({ id: 'second', providerName: 'codex', cwd: root });
    first.providerSessionId = second.providerSessionId = 'same-native';
    const pending = join(sessions, '.cats-runtime-delete-fixture.pending-delete');
    writeFileSync(pending, 'retained history');
    registry.retainPendingFileDeletions(second.id, [pending]);
    registry = new SessionRegistry(data, sessions);
    expect(registry.list()).toHaveLength(1);
    expect(registry.getPendingFileDeletionPaths(first.id)).toEqual([pending]);
    expect(registry.remove(first.id).deleted).toBe(false);
    expect(readFileSync(pending, 'utf8')).toBe('retained history');
  });

  it.each(['compactions', 'compactions/session-1'])('rejects a linked %s without following it', (linked) => {
    const { session, source } = fixture();
    const outside = join(root, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'private.jsonl'), 'outside history');
    if (linked.includes('/')) mkdirSync(join(sessions, 'compactions'));
    symlinkSync(outside, join(sessions, linked), process.platform === 'win32' ? 'junction' : 'dir');
    expect(registry.prepareManagedTranscriptDeletion(session.id).ready).toBe(false);
    expect(registry.remove(session.id).deleted).toBe(false);
    expect(existsSync(source)).toBe(true);
    expect(readFileSync(join(outside, 'private.jsonl'), 'utf8')).toBe('outside history');
    expect(() => compactRuntimeManagedTranscript({ sessionId: session.id, session, sessionBaseDir: sessions })).toThrow('Linked');
  });

  it('does not classify a sibling with the same path prefix as Runtime-owned', () => {
    const session = registry.create({ providerName: 'codex', cwd: root });
    const sibling = join(root, 'sessions-other');
    mkdirSync(sibling);
    const external = join(sibling, 'native.jsonl');
    writeFileSync(external, 'provider history');
    registry.setSourcePath(session.id, external);
    expect(registry.prepareManagedTranscriptDeletion(session.id).finalize()).toEqual({ fileDeleted: false });
    expect(readFileSync(external, 'utf8')).toBe('provider history');
  });
});
