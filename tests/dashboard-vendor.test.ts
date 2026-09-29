import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { vendorAssets, verifyDashboardVendor, verifyVendorBytes } from '../scripts/verify-dashboard-vendor.mjs';
import { loadConfig } from '../src/core/config.js';
import { createRuntimeServer } from '../src/server.js';
import { createRuntimeTestEnv } from './support/runtimeTestPaths.js';
import { cleanupTempDirWithRetriesAsync } from './tempCleanup.js';

interface VendorAsset { file: string; url: string; integrity: string }
const assets = vendorAssets as VendorAsset[];

describe('dashboard vendored dependencies', () => {
  it('verifies the exact pinned bytes including original license texts', async () => {
    await verifyDashboardVendor();
    expect(assets.filter((asset) => asset.file.endsWith('.LICENSE'))).toHaveLength(3);
    for (const asset of assets) {
      expect(() => verifyVendorBytes(asset, Buffer.from('changed bytes'))).toThrow('integrity mismatch');
      expect(() => verifyVendorBytes({ ...asset, url: asset.url.replace(/@\d+\.\d+\.\d+/u, '@latest') }, Buffer.from('')))
        .toThrow('Unpinned');
    }
  });

  it.each(['src/http/ui/pages', 'public'])('binds %s HTML to pinned local assets', (directory) => {
    for (const page of ['index', 'playground', 'provider-setup']) {
      const html = readFileSync(join(directory, `${page}.html`), 'utf8');
      const tags = html.match(/<(?:script|link)\b[^>]*>/gu) ?? [];
      const linked: string[] = [];
      for (const tag of tags) {
        const url = /(?:src|href)="([^"]+)"/u.exec(tag)?.[1];
        if (!url) continue;
        expect(url, tag).not.toMatch(/^(?:https?:)?\/\//u);
        if (!url.startsWith('/vendor/')) continue;
        linked.push(url.slice('/vendor/'.length));
        const asset = assets.find((entry) => entry.file === linked.at(-1));
        expect(asset, tag).toBeDefined();
        expect(tag).toContain(`integrity="${asset!.integrity}"`);
        expect(tag).toContain('crossorigin="anonymous"');
      }
      if (page !== 'provider-setup') {
        expect(linked.sort()).toEqual(assets.filter((asset) => !asset.file.endsWith('.LICENSE')).map((asset) => asset.file).sort());
      }
    }
  });

  it('serves only the shipped allowlist with correct bytes, MIME and no-sniff', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-vendor-route-'));
    const runtime = createRuntimeServer(loadConfig(createRuntimeTestEnv(root, { CATS_RUNTIME_API_KEY: 'fixture' })));
    try {
      for (const asset of assets) {
        const response = await runtime.app.request(`/vendor/${asset.file}`);
        expect(response.status).toBe(200);
        const integrity = `sha384-${createHash('sha384').update(Buffer.from(await response.arrayBuffer())).digest('base64')}`;
        expect(integrity).toBe(asset.integrity);
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.get('content-type')).toContain(asset.file.endsWith('.js') ? 'text/javascript'
          : asset.file.endsWith('.css') ? 'text/css' : 'text/plain');
      }
      for (const path of ['/vendor/unknown.js', '/vendor/manifest.json', '/vendor/%2e%2e%2fpackage.json']) {
        expect((await runtime.app.request(path)).status).not.toBe(200);
      }
    } finally {
      await runtime.close();
      await cleanupTempDirWithRetriesAsync(root);
    }
  }, 30_000);
});
