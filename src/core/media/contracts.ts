export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const IMAGE_MAX_PROMPT = 2000;
export const IMAGE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export interface ImageRequest { id: string; instance: string; prompt: string; }
export interface ImageMetadata {
  mimeType: 'image/jpeg'; bytes: number; width: number; height: number; sha256: string;
}
export interface ImageJob extends ImageRequest {
  schemaVersion: 1;
  provider: 'grok';
  agentModel: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelling' | 'cancelled' | 'interrupted';
  createdAt: string;
  updatedAt: string;
  error: string | null;
  output: ImageMetadata | null;
}
export class ImageError extends Error {
  constructor(readonly code: string, readonly status: 400 | 404 | 409 | 429 | 503 = 400) { super(code); }
}
export function parseImageRequest(value: unknown): ImageRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ImageError('invalid_image_request');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['id', 'instance', 'prompt'].includes(key))
    || typeof input.id !== 'string' || !IMAGE_ID.test(input.id)
    || typeof input.instance !== 'string' || !input.instance || input.instance.length > 100
    || typeof input.prompt !== 'string' || !input.prompt.trim()
    || Array.from(input.prompt).length > IMAGE_MAX_PROMPT) throw new ImageError('invalid_image_request');
  return { id: input.id, instance: input.instance, prompt: input.prompt.trim() };
}
