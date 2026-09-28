import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import type { RuntimeSkillManifest, SessionSkillState, ResolvedRuntimeSkill } from '../types.js';
import { RuntimeSkillError } from './errors.js';
import { acquirePluginWriter } from './pluginWriter.js';

export const AGENCY_DIGEST = '26afae3f0c5f551cc3bbce267c82d574963c4c2f94f48f9e8d3dcb0aa0ca07a5';
export const AGENCY_SKILLS: Record<string, string> = {
  'plugin:agency-agents/work/agency-code-reviewer': 'ad27d120f978d410a3a84f1a49fa7a7e863dcc0c05403471dba8c7ae818db605',
  'plugin:agency-agents/work/agency-ux-researcher': '2396d472e525ad800d887fc86b12fb2024f796dcd2ec0bb92dc01678db2ca5d7',
};
const BOOT = randomUUID();
export const PLUGIN_LEASE_MS = 30_000;
export interface PluginIdentity { hostId: string; id: string; version: string; digest: string; generation: number }
export interface PluginDescriptor extends PluginIdentity { protocol: 1; enabled: boolean; skills: Array<{ id: string; markdown: string }> }
export interface ManagedPluginContext extends PluginIdentity { sessionBaseDir: string; sessionId: string }
interface Observation extends PluginDescriptor { boot: string; leaseUntil: number; stopRequested?: boolean }
interface PluginState {
  schema: 1;
  runtimeId: string;
  plugin?: Observation;
  exposures: Record<string, PluginIdentity[]>;
  runs: Record<string, { runId: string; boot: string }>;
  native: Record<string, PluginIdentity[]>;
}
function conflict(message: string): never { throw new RuntimeSkillError(message, 'managed_plugin_conflict'); }
function statePath(root: string): string { return join(root, '.managed-plugins', 'state.json'); }
function read(root: string): PluginState {
  const file = statePath(root);
  if (!existsSync(file)) return { schema: 1, runtimeId: BOOT, exposures: {}, runs: {}, native: {} };
  try {
    const state = JSON.parse(readFileSync(file, 'utf8')) as PluginState;
    if (state.schema !== 1 || typeof state.runtimeId !== 'string' || !state.exposures || !state.runs || !state.native
      || Array.isArray(state.exposures) || Array.isArray(state.runs)) throw new Error('Invalid state');
    for (const refs of [...Object.values(state.exposures), ...Object.values(state.native)]) {
      if (!Array.isArray(refs) || refs.some(ref => !validIdentity(ref))) throw new Error('Invalid exposure');
    }
    if (state.plugin) validateDescriptor(state.plugin);
    for (const run of Object.values(state.runs)) {
      if (!run || typeof run.runId !== 'string' || typeof run.boot !== 'string') throw new Error('Invalid run receipt');
    }
    if (state.plugin && (typeof state.plugin.boot !== 'string' || !Number.isFinite(state.plugin.leaseUntil))) throw new Error('Invalid lease');
    return state;
  } catch { return conflict('Managed Plugin state cannot be verified. Preserve it for recovery.'); }
}
function mutate<T>(root: string, operation: (state: PluginState) => T): T {
  const directory = join(root, '.managed-plugins');
  mkdirSync(directory, { recursive: true });
  const lock = join(directory, 'writer.lock');
  const release = acquirePluginWriter(lock);
  const temp = join(directory, `${randomUUID()}.tmp`);
  try {
    const state = read(root);
    const result = operation(state);
    const fd = openSync(temp, 'wx');
    try { writeFileSync(fd, JSON.stringify(state)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, statePath(root));
    return result;
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
    release();
  }
}
function validIdentity(value: PluginIdentity): boolean {
  return Boolean(value && /^[a-zA-Z0-9-]{16,80}$/.test(value.hostId)
    && value.id === 'agency-agents' && value.version === '0.1.0' && value.digest === AGENCY_DIGEST
    && Number.isSafeInteger(value.generation) && value.generation > 0);
}
export function validateDescriptor(value: PluginDescriptor): void {
  if (!validIdentity(value) || value.protocol !== 1 || typeof value.enabled !== 'boolean' || !Array.isArray(value.skills)) conflict('Invalid managed Plugin descriptor.');
  if (!value.enabled) {
    if (value.skills.length !== 0) conflict('A fenced descriptor must omit executable content.');
    return;
  }
  if (value.skills.length !== 2 || new Set(value.skills.map(s => s.id)).size !== 2) conflict('The Agency pilot requires its two reviewed skills.');
  for (const skill of value.skills) {
    if (typeof skill.markdown !== 'string' || skill.markdown.length > 64_000
      || !AGENCY_SKILLS[skill.id] || createHash('sha256').update(skill.markdown).digest('hex') !== AGENCY_SKILLS[skill.id]) conflict('Unreviewed Plugin skill content.');
  }
}
function same(a: PluginIdentity, b: PluginIdentity): boolean {
  return a.hostId === b.hostId && a.id === b.id && a.version === b.version && a.digest === b.digest && a.generation === b.generation;
}
function live(plugin: Observation | undefined): boolean {
  return Boolean(plugin?.enabled && plugin.boot === BOOT && plugin.leaseUntil > Date.now());
}
function assertIdentity(state: PluginState, identity: PluginIdentity): void {
  if (!state.plugin || !live(state.plugin) || !same(state.plugin, identity)) conflict('This context contains an unavailable Plugin generation. Start a new conversation without replaying its history.');
}
export function observeManagedPlugin(root: string) {
  const state = read(root);
  return {
    protocol: 1 as const, runtimeId: state.runtimeId,
    stopAuthorized: Boolean(state.plugin && !live(state.plugin) && (state.plugin.enabled || state.plugin.stopRequested)),
    plugin: state.plugin ? { ...identityOf(state.plugin), enabled: live(state.plugin), leaseUntil: state.plugin.leaseUntil } : null,
    affectedSessions: Object.keys(state.exposures).sort(),
    pendingRuns: Object.entries(state.runs).map(([sessionId, run]) => ({ sessionId, runId: run.runId, orphaned: run.boot !== BOOT })),
  };
}
function identityOf(value: PluginIdentity): PluginIdentity {
  return { hostId: value.hostId, id: value.id, version: value.version, digest: value.digest, generation: value.generation };
}
export function registerManagedPlugin(root: string, descriptor: PluginDescriptor): void {
  validateDescriptor(descriptor);
  mutate(root, state => {
    const previous = state.plugin;
    if (previous && (previous.hostId !== descriptor.hostId || previous.generation > descriptor.generation)) conflict('Stale generation or different Platform profile.');
    if (previous?.generation === descriptor.generation) {
      if (!same(previous, descriptor) || previous.enabled !== descriptor.enabled || (descriptor.enabled && !live(previous))) conflict('Generation cannot be reused. Enable a new generation explicitly.');
      return;
    }
    if (descriptor.enabled && Object.keys(state.runs).length) conflict('Prior Plugin executions still need stop confirmation.');
    state.plugin = { protocol: 1, ...identityOf(descriptor), enabled: descriptor.enabled, skills: descriptor.skills.map(skill => ({ id: skill.id, markdown: skill.markdown })), boot: BOOT, leaseUntil: descriptor.enabled ? Date.now() + PLUGIN_LEASE_MS : 0 };
  });
}
export function renewManagedPlugin(root: string, identity: PluginIdentity): void {
  mutate(root, state => {
    assertIdentity(state, identity);
    state.plugin!.leaseUntil = Date.now() + PLUGIN_LEASE_MS;
  });
}
export function authorizeManagedPluginStop(root: string): void {
  mutate(root, state => {
    if (!state.plugin || live(state.plugin)) conflict('Fence before authorizing stop.');
    state.plugin.stopRequested = true;
  });
}
export function assertManagedPluginContext(root: string, sessionId: string, skills?: SessionSkillState): void {
  const state = read(root);
  for (const ref of state.exposures[sessionId] ?? []) assertIdentity(state, ref);
  const context = skills?.managedPlugin;
  if (context) {
    if (resolve(context.sessionBaseDir) !== resolve(root) || context.sessionId !== sessionId
      || !state.exposures[sessionId]?.some(ref => same(ref, context))) conflict('Managed Plugin provenance is not recorded for this session.');
    assertIdentity(state, context);
  }
}
export function inheritManagedPluginContext(root: string, sourceId: string, targetId: string): void {
  assertManagedPluginContext(root, sourceId);
  const refs = read(root).exposures[sourceId];
  if (refs?.length) mutate(root, state => { state.exposures[targetId] = structuredClone(refs); });
}
export function hasManagedPluginExposure(root: string, sessionId: string): boolean {
  return Boolean(read(root).exposures[sessionId]?.length);
}
export function recordManagedPluginRun(root: string, sessionId: string, runId: string): void {
  if (!hasManagedPluginExposure(root, sessionId)) return;
  mutate(root, state => {
    for (const ref of state.exposures[sessionId] ?? []) assertIdentity(state, ref);
    if (state.runs[sessionId]) conflict('Previous Plugin execution has no terminal observation.');
    state.runs[sessionId] = { runId, boot: BOOT };
  });
}
export function bindManagedNativeIdentity(root: string, session: { id: string; providerName: string; providerBackend?: string; providerInstanceId?: string }, nativeId?: string, freshNative = false): void {
  if (!nativeId || !existsSync(statePath(root))) return;
  const key = createHash('sha256').update(JSON.stringify([session.providerBackend ?? 'cli', session.providerName, session.providerInstanceId ?? 'default', nativeId])).digest('hex');
  const state = read(root);
  const nativeRefs = state.native[key] ?? [];
  const sessionRefs = state.exposures[session.id] ?? [];
  if (!freshNative && !Object.hasOwn(state.native, key) && !sessionRefs.length && Object.values(state.runs).some(run => run.boot !== BOOT)) conflict('An interrupted Plugin execution has unknown native lineage. Preserve this context and use a fresh session.');
  if (!nativeRefs.length && !sessionRefs.length) {
    if (freshNative && !Object.hasOwn(state.native, key)) mutate(root, next => { next.native[key] = []; });
    return;
  }
  mutate(root, next => {
    const refs = [...nativeRefs, ...sessionRefs].filter((ref, index, all) => all.findIndex(candidate => same(candidate, ref)) === index);
    next.native[key] = refs; next.exposures[session.id] = refs;
  });
  assertManagedPluginContext(root, session.id);
}
export function finishManagedPluginRun(root: string, sessionId: string, runId: string): void {
  if (!existsSync(statePath(root)) || read(root).runs[sessionId]?.runId !== runId) return;
  mutate(root, state => { if (state.runs[sessionId]?.runId === runId) delete state.runs[sessionId]; });
}
function resolvedSkill(skill: { id: string; markdown: string }): ResolvedRuntimeSkill {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(skill.markdown)!;
  const metadata = parse(match[1]) as { name: string; description: string; role: string; capabilityTags: string[]; productTags: string[] };
  return { id: skill.id, slug: metadata.name, family: 'work', version: '0.1.0', title: metadata.name, description: metadata.description,
    status: 'resolved', source: 'runtime_catalog', sourcePath: `plugin://${skill.id}`, entryFile: `plugin://${skill.id}/SKILL.md`, fingerprint: AGENCY_SKILLS[skill.id],
    library: { family: 'work', slug: metadata.name, role: metadata.role, packageKind: 'role', version: '0.1.0', capabilityTags: metadata.capabilityTags, productTags: metadata.productTags, deliveryHints: ['instructions'], recommendedCompanions: [] } };
}
export function listManagedPluginSkills(root: string): ResolvedRuntimeSkill[] {
  const plugin = read(root).plugin;
  return plugin && live(plugin) ? plugin.skills.map(resolvedSkill) : [];
}
export function resolveManagedPluginSkills(manifest: RuntimeSkillManifest | undefined, options: {
  sessionBaseDir: string; sessionId: string; providerName: string; providerBackend?: string;
}): SessionSkillState | undefined {
  const requested = manifest?.requestedSkills.map(ref => typeof ref === 'string' ? ref : ref.id ?? '');
  if (!requested?.some(id => id.startsWith('plugin:'))) return undefined;
  if (requested.some(id => !AGENCY_SKILLS[id]) || options.providerBackend !== 'cli'
    || !['codex', 'claude'].includes(options.providerName)) conflict('The Agency instruction pilot supports Codex and Claude CLI, with managed skills only.');
  let result!: SessionSkillState;
  mutate(options.sessionBaseDir, state => {
    const plugin = state.plugin;
    if (!plugin || !live(plugin)) conflict('Enable Agency Agents in Desktop before selecting its skills.');
    for (const ref of state.exposures[options.sessionId] ?? []) assertIdentity(state, ref);
    const selected = plugin.skills.filter(skill => requested.includes(skill.id));
    for (const ref of manifest!.requestedSkills) {
      if (typeof ref !== 'string' && (ref.version && ref.version !== plugin.version || ref.fingerprint && ref.fingerprint !== AGENCY_SKILLS[ref.id ?? ''])) conflict('Managed skill pin does not match the reviewed generation.');
    }
    state.exposures[options.sessionId] = [identityOf(plugin)];
    result = { managedPlugin: { ...identityOf(plugin), sessionBaseDir: options.sessionBaseDir, sessionId: options.sessionId },
      profileId: manifest!.profileId, requestedSkills: requested, context: manifest!.context, resolvedSkills: selected.map(resolvedSkill), strict: manifest!.strict === true,
      delivery: { provider: options.providerName, backend: 'cli', preferredMode: 'instructions', mode: 'instructions', status: 'applied', warnings: [] },
      warnings: [], appliedSkillIds: requested, updatedAt: new Date().toISOString() };
  });
  return result;
}
export function managedPluginInstructions(skills: SessionSkillState): string {
  const context = skills.managedPlugin!;
  assertManagedPluginContext(context.sessionBaseDir, context.sessionId, skills);
  const plugin = read(context.sessionBaseDir).plugin!;
  return plugin.skills.filter(skill => skills.appliedSkillIds.includes(skill.id)).map(skill => `## ${skill.id}\n${skill.markdown.replace(/^---\n[\s\S]*?\n---\n/, '')}`).join('\n\n');
}
