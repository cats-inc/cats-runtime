import { mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupTempDirWithRetries } from '../../../tests/tempCleanup.js';
import { SessionAdmissionStore } from './SessionAdmissionStore.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await cleanupTempDirWithRetries(root); });
function fixture() { const root = mkdtempSync(join(tmpdir(), 'cats-session-admission-')); roots.push(root); return root; }

describe('protected session admission markers', () => {
  it('upgrades an unmarked legacy session additively and retains requirements across a new reader', () => {
    const root = fixture();
    const store = new SessionAdmissionStore(root);
    expect(store.get('session:legacy')).toBeUndefined();
    store.stage('session:fixture', true);
    const restarted = new SessionAdmissionStore(root);
    expect(restarted.get('session:fixture')).toMatchObject({ version: 1, requiresHost: true, requiresPolicy: true });
    restarted.stage('session:fixture', false);
    expect(restarted.get('session:fixture')?.requiresPolicy).toBe(true);
    expect(readdirSync(root)).toHaveLength(2);
    expect(readdirSync(root).every(file => !file.includes('fixture'))).toBe(true);
  });
  it('recovers a corrupted primary from the validated current backup without weakening admission', () => {
    const root = fixture(); const store = new SessionAdmissionStore(root);
    store.stage('session:fixture', true);
    const primary = join(root, readdirSync(root).find(file => file.endsWith('.json'))!);
    writeFileSync(primary, '{broken');
    expect(new SessionAdmissionStore(root).get('session:fixture')?.requiresPolicy).toBe(true);
    store.stage('session:fixture', true);
    expect(JSON.parse(readFileSync(primary, 'utf8')).version).toBe(1);
  });
  it('fails closed on an unknown format and never changes its evidence', () => {
    const root = fixture(); const store = new SessionAdmissionStore(root);
    store.stage('session:fixture', true);
    const backup = join(root, readdirSync(root).find(file => file.endsWith('.bak'))!);
    const future = JSON.stringify({ version: 99, identity: 'session:fixture' });
    writeFileSync(backup, future);
    expect(() => store.get('session:fixture')).toThrow('could not be validated');
    expect(() => store.stage('session:fixture', false)).toThrow();
    expect(readFileSync(backup, 'utf8')).toBe(future);
  });
  it('does not downgrade an unknown primary format to an older valid backup', () => {
    const root = fixture(); const store = new SessionAdmissionStore(root);
    store.stage('session:fixture', false);
    const primary = join(root, readdirSync(root).find(file => file.endsWith('.json'))!);
    for (const value of [{ version: 2, identity: 'session:fixture', requiresHost: true, requiresPolicy: true },
      { version: 1, identity: 'session:fixture', requiresHost: true, requiresPolicy: 'future-mode' }]) {
      const serialized = JSON.stringify(value); writeFileSync(primary, serialized);
      expect(() => store.get('session:fixture')).toThrow('could not be validated');
      expect(readFileSync(primary, 'utf8')).toBe(serialized);
    }
  });
  it('compensates a failed atomic replacement and explicit spawn failure without leaving new settings', () => {
    const root = fixture(); let fail = true;
    const store = new SessionAdmissionStore(root, (from, to) => {
      if (String(to).endsWith('.json') && fail) { fail = false; throw new Error('fixture disk failure'); }
      renameSync(from, to);
    });
    expect(() => store.stage('session:fixture', true)).toThrow('could not be saved');
    expect(store.get('session:fixture')).toBeUndefined(); expect(readdirSync(root)).toEqual([]);
    store.stage('session:fixture', false);
    const rollback = store.stage('session:fixture', true);
    rollback();
    expect(store.get('session:fixture')?.requiresPolicy).toBe(false);
    expect(readdirSync(root).some(file => file.endsWith('.tmp'))).toBe(false);
  });
});
