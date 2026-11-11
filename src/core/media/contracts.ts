export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const IMAGE_MAX_PROMPT = 2000;
export const IMAGE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** Providers with a bounded Runtime runner. A provider appears in capabilities only with an enabled profile. */
export const IMAGE_PROVIDERS = ['grok', 'muse', 'codex', 'antigravity', 'cursor'] as const;
export type ImageProvider = typeof IMAGE_PROVIDERS[number];
export type ImageOperation = 'image.generate' | 'image.edit' | 'video.generate';
export type ImageAspectRatio = { mode: 'native'; options: [string] } | { mode: 'service' };
/** One provider x operation execution profile from `catalogs/media-profiles.json`. */
export interface ImageProfile {
  id: string; revision: number; provider: ImageProvider; operation: ImageOperation; enabled: boolean;
  agentConfig: { id: string; model: string; effort: string };
  aspectRatio: ImageAspectRatio;
  evidence: string;
}
/** Contract 2 submission. Generation takes no sources and no options yet. */
export interface ImageRequest {
  id: string; targetId: string; profileId: string; profileRevision: string; agentConfigId: string;
  contractVersion?: 3;
  operation: ImageOperation; prompt: string; sourceIds: string[]; options: { durationSeconds?: 6 | 10 };
  /** Trusted host may yield only the originating idle session; Apps never supply this field. */
  sourceSessionId?: string;
}
export interface ImageMetadata {
  mimeType: 'image/jpeg' | 'image/png'; bytes: number; width: number; height: number; sha256: string;
  transparency: 'opaque' | 'has-transparency';
}
export interface VideoMetadata { mimeType: 'video/mp4'; bytes: number; width: number; height: number; sha256: string;
  transparency: 'opaque'; durationSeconds: number; }
export type MediaMetadata = (ImageMetadata & { durationSeconds?: never }) | VideoMetadata;
export type ImageStatus = 'running' | 'succeeded' | 'failed' | 'cancelling' | 'cancelled' | 'interrupted';
export interface ImageJob {
  schemaVersion: 2 | 3;
  id: string; targetId: string; provider: ImageProvider; instance: string;
  profileId: string; profileRevision: string;
  /** Null only on receipts upgraded from schema 1, which did not record a configuration. */
  agentConfigId: string | null; agentModel: string; agentEffort: string | null;
  operation: ImageOperation; prompt: string; sourceIds: string[]; options: { durationSeconds?: 6 | 10 };
  status: ImageStatus;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  warnings: string[];
  executionOutcome: 'completed' | 'stopped_after_image' | null;
  output: MediaMetadata | null;
  sourceSessionId?: string;
}
export class ImageError extends Error {
  constructor(readonly code: string, readonly status: 400 | 404 | 409 | 429 | 503 = 400) { super(code); }
}

export const imageTargetId = (provider: ImageProvider, instance: string) => `${provider}/${instance}`;
export function parseImageTargetId(value: string): { provider: ImageProvider; instance: string } | null {
  const index = value.indexOf('/');
  const provider = value.slice(0, index) as ImageProvider;
  const instance = value.slice(index + 1);
  return index > 0 && IMAGE_PROVIDERS.includes(provider) && instance && instance.length <= 100 ? { provider, instance } : null;
}

const REQUEST_KEYS = ['id', 'targetId', 'profileId', 'profileRevision', 'agentConfigId', 'operation', 'prompt', 'sourceIds', 'options'];
const key = (value: unknown, max = 120) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
export function parseImageRequest(value: unknown): ImageRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ImageError('invalid_image_request');
  const input = value as Record<string, unknown>;
  const version3 = input.contractVersion === 3;
  const sources = input.sourceIds;
  const options = input.options as Record<string, unknown> | undefined;
  if (Object.keys(input).some((name) => !REQUEST_KEYS.includes(name) && name !== 'sourceSessionId' && name !== 'contractVersion')
    || REQUEST_KEYS.some((name) => !(name in input))
    || typeof input.id !== 'string' || !IMAGE_ID.test(input.id)
    || typeof input.targetId !== 'string' || !parseImageTargetId(input.targetId)
    || !key(input.profileId) || !key(input.profileRevision, 40) || !key(input.agentConfigId)
    || (input.contractVersion !== undefined && !version3)
    || !(version3 ? ['image.edit', 'video.generate'].includes(String(input.operation)) : input.operation === 'image.generate')
    || !Array.isArray(sources) || (version3 ? sources.length < 1 || sources.length > (input.operation === 'video.generate' ? 1 : 3)
      || sources.some(id => typeof id !== 'string' || !IMAGE_ID.test(id)) || new Set(sources).size !== sources.length : sources.length !== 0)
    || !options || typeof options !== 'object' || Array.isArray(options)
    || (input.operation === 'video.generate' ? Object.keys(options).length !== 1 || ![6, 10].includes(options.durationSeconds as number)
      : Object.keys(options).length !== 0)
    || typeof input.prompt !== 'string' || !input.prompt.trim()
    || Array.from(input.prompt).length > IMAGE_MAX_PROMPT
    || (input.sourceSessionId !== undefined && (!key(input.sourceSessionId, 200) || input.sourceSessionId === input.id))) {
    throw new ImageError('invalid_image_request');
  }
  return { id: input.id, targetId: input.targetId, profileId: input.profileId as string, profileRevision: input.profileRevision as string,
    agentConfigId: input.agentConfigId as string, operation: input.operation as ImageOperation, prompt: input.prompt.trim(),
    sourceIds: [...sources as string[]], options: { ...options } as ImageRequest['options'], ...(version3 ? { contractVersion: 3 as const } : {}),
    ...(typeof input.sourceSessionId === 'string' ? { sourceSessionId: input.sourceSessionId } : {}) };
}
