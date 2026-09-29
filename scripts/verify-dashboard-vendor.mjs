/**
 * Verify pinned dashboard assets and licenses without network access.
 * Usage: node scripts/verify-dashboard-vendor.mjs [--upstream] [--help]
 * --upstream also downloads each exact source URL and verifies its SHA-384.
 * This command never rewrites assets or hashes; updates require review.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const vendorRoot = new URL('../public/vendor/', import.meta.url);
export const vendorAssets = JSON.parse(readFileSync(new URL('manifest.json', vendorRoot), 'utf8'));

export function verifyVendorBytes(asset, bytes) {
  if (!/^https:\/\/cdn\.jsdelivr\.net\/(?:npm|gh)\/.+@\d+\.\d+\.\d+\//u.test(asset.url)) {
    throw new Error(`Unpinned vendor URL: ${asset.url}`);
  }
  const actual = `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
  if (actual !== asset.integrity) throw new Error(`Vendor integrity mismatch: ${asset.file}`);
}

export async function verifyDashboardVendor(upstream = false) {
  for (const asset of vendorAssets) {
    if (!/^[a-z][a-zA-Z0-9.-]+$/u.test(asset.file) || asset.file.includes('..')) {
      throw new Error(`Invalid vendor filename: ${asset.file}`);
    }
    verifyVendorBytes(asset, readFileSync(new URL(asset.file, vendorRoot)));
    if (upstream) {
      const response = await fetch(asset.url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${asset.url}`);
      verifyVendorBytes(asset, Buffer.from(await response.arrayBuffer()));
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: node scripts/verify-dashboard-vendor.mjs [--upstream] [--help]');
  } else {
    if (args.some((arg) => arg !== '--upstream')) throw new Error('Unknown argument; use --help');
    await verifyDashboardVendor(args.includes('--upstream'));
    console.log(`Verified ${vendorAssets.length} dashboard assets/licenses${args.includes('--upstream') ? ' against upstream' : ''}.`);
  }
}
