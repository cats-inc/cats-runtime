export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const IMAGE_MAX_PROMPT = 2000;
export const IMAGE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** Providers with a bounded Runtime runner. A provider appears in capabilities only with an enabled profile. */
export const IMAGE_PROVIDERS = ['grok', 'muse', 'codex', 'antigravity', 'cursor'] as const;
export type ImageProvider = typeof IMAGE_PROVIDERS[number];
export type ImageOperation = 'image.generate';
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
  operation: ImageOperation; prompt: string; sourceIds: []; options: Record<string, never>;
  /** Trusted host may yield only the originating idle session; Apps never supply this field. */
  sourceSessionId?: string;
}
export interface ImageMetadata {
  mimeType: 'image/jpeg' | 'image/png'; bytes: number; width: number; height: number; sha256: string;
  transparency: 'opaque' | 'has-transparency';
}
export type ImageStatus = 'running' | 'succeeded' | 'failed' | 'cancelling' | 'cancelled' | 'interrupted';
export interface ImageJob {
  schemaVersion: 2;
  id: string; targetId: string; provider: ImageProvider; instance: string;
  profileId: string; profileRevision: string;
  /** Null only on receipts upgraded from schema 1, which did not record a configuration. */
  agentConfigId: string | null; agentModel: string; agentEffort: string | null;
  operation: ImageOperation; prompt: string; sourceIds: string[]; options: Record<string, never>;
  status: ImageStatus;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  warnings: string[];
  executionOutcome: 'completed' | 'stopped_after_image' | null;
  output: ImageMetadata | null;
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
  if (Object.keys(input).some((name) => !REQUEST_KEYS.includes(name) && name !== 'sourceSessionId')
    || REQUEST_KEYS.some((name) => !(name in input))
    || typeof input.id !== 'string' || !IMAGE_ID.test(input.id)
    || typeof input.targetId !== 'string' || !parseImageTargetId(input.targetId)
    || !key(input.profileId) || !key(input.profileRevision, 40) || !key(input.agentConfigId)
    || input.operation !== 'image.generate'
    || !Array.isArray(input.sourceIds) || input.sourceIds.length
    || !input.options || typeof input.options !== 'object' || Array.isArray(input.options) || Object.keys(input.options).length
    || typeof input.prompt !== 'string' || !input.prompt.trim()
    || Array.from(input.prompt).length > IMAGE_MAX_PROMPT
    || (input.sourceSessionId !== undefined && (!key(input.sourceSessionId, 200) || input.sourceSessionId === input.id))) {
    throw new ImageError('invalid_image_request');
  }
  return { id: input.id, targetId: input.targetId, profileId: input.profileId as string, profileRevision: input.profileRevision as string,
    agentConfigId: input.agentConfigId as string, operation: 'image.generate', prompt: input.prompt.trim(), sourceIds: [], options: {},
    ...(typeof input.sourceSessionId === 'string' ? { sourceSessionId: input.sourceSessionId } : {}) };
}
