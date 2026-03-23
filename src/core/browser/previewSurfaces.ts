import { extname, isAbsolute, resolve } from 'node:path';
import type {
  RuntimeBrowserPage,
  RuntimePreviewSurface,
  RuntimePreviewSurfaceRenderHint,
} from '../types.js';

const HTML_EXTENSIONS = new Set(['.htm', '.html']);
const DOWNLOADABLE_EXTENSIONS = new Set([
  '.csv',
  '.gif',
  '.jpeg',
  '.jpg',
  '.json',
  '.pdf',
  '.png',
  '.svg',
  '.txt',
  '.webp',
]);
const HTTP_URL_PREFIX = /^https?:\/\//i;

export function resolveBrowserArtifactPath(
  workspacePath: string,
  artifactPath: string | undefined,
): string | undefined {
  if (!artifactPath) {
    return undefined;
  }
  if (isAbsolute(artifactPath)) {
    return artifactPath;
  }
  return resolve(workspacePath, artifactPath);
}

export function guessBrowserPreviewMediaType(
  pathValue: string | undefined,
  explicitMediaType: string | undefined,
): string | undefined {
  if (explicitMediaType) {
    return explicitMediaType;
  }

  const extension = extname(pathValue || '').toLowerCase();
  if (HTML_EXTENSIONS.has(extension)) {
    return 'text/html';
  }
  if (extension === '.pdf') {
    return 'application/pdf';
  }
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(extension)) {
    return `image/${extension.slice(1) === 'jpg' ? 'jpeg' : extension.slice(1)}`;
  }
  return undefined;
}

export function createBrowserPagePreviewSurface(
  page: Omit<RuntimeBrowserPage, 'previewSurface'>,
): RuntimePreviewSurface {
  let status: RuntimePreviewSurface['status'] = 'blocked';
  let renderHint: RuntimePreviewSurfaceRenderHint = 'none';

  const mediaType = guessBrowserPreviewMediaType(page.path || page.url, page.mediaType);
  const extension = extname(page.path || '').toLowerCase();
  if (!page.url && !page.path) {
    status = 'blocked';
  } else if (page.url) {
    if (HTTP_URL_PREFIX.test(page.url)) {
      status = 'ready';
      renderHint = 'iframe';
    } else {
      status = 'degraded';
      renderHint = 'open_external';
    }
  } else if (mediaType === 'text/html' || HTML_EXTENSIONS.has(extension)) {
    status = 'ready';
    renderHint = 'iframe';
  } else if (
    (mediaType && (mediaType.startsWith('image/') || mediaType === 'application/pdf'))
    || DOWNLOADABLE_EXTENSIONS.has(extension)
  ) {
    status = 'degraded';
    renderHint = 'download';
  } else if (page.path) {
    status = 'unsupported';
    renderHint = 'download';
  }

  return {
    id: `browser_page:${page.id}`,
    kind: 'browser_page',
    source: 'browser_page',
    status,
    label: page.label || page.title || page.id,
    renderHint,
    ...(page.url ? { url: page.url } : {}),
    ...(page.path ? { path: page.path } : {}),
    ...(mediaType ? { mediaType } : {}),
    provenance: {
      ...(page.binding.runtimeSessionId ? { sessionId: page.binding.runtimeSessionId } : {}),
      ...(page.binding.serviceId ? { serviceId: page.binding.serviceId } : {}),
      ...(page.binding.artifactId ? { artifactId: page.binding.artifactId } : {}),
      browserSessionId: page.browserSessionId,
      browserPageId: page.id,
    },
    metadata: page.metadata,
  };
}
