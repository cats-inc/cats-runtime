import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const testsDir = dirname(fileURLToPath(import.meta.url));
const runtimeRoot = resolve(testsDir, '..');

function readScript(...segments: string[]): string {
  return readFileSync(join(runtimeRoot, ...segments), 'utf8');
}

function expectCleanupAfterBuildAndBeforeStart(
  script: string,
  buildMarker: string,
  cleanupMarker: string,
  startMarker: string,
): void {
  const buildIndex = script.indexOf(buildMarker);
  const cleanupIndex = script.lastIndexOf(cleanupMarker);
  const startIndex = script.indexOf(startMarker);

  expect(buildIndex, `Missing build marker: ${buildMarker}`).toBeGreaterThanOrEqual(0);
  expect(cleanupIndex, `Missing cleanup marker: ${cleanupMarker}`).toBeGreaterThanOrEqual(0);
  expect(startIndex, `Missing start marker: ${startMarker}`).toBeGreaterThanOrEqual(0);
  expect(cleanupIndex).toBeGreaterThan(buildIndex);
  expect(cleanupIndex).toBeLessThan(startIndex);
}

describe('restart helpers', () => {
  it('runs Windows stale temp cleanup after the build step', () => {
    const script = readScript('scripts', 'windows', 'Restart-Server.ps1');

    expectCleanupAfterBuildAndBeforeStart(
      script,
      'Write-Host "Building TypeScript..." -ForegroundColor Cyan',
      'Invoke-StaleTempCleanup $repoRoot',
      'Write-Host "Starting cats-runtime..." -ForegroundColor Cyan',
    );
  });

  it('runs Linux stale temp cleanup after the build step', () => {
    const script = readScript('scripts', 'linux', 'restart-server.sh');

    expectCleanupAfterBuildAndBeforeStart(
      script,
      'echo "Building TypeScript..."',
      'cleanup_stale_temp_dirs',
      'echo "Starting cats-runtime',
    );
  });

  it('runs macOS stale temp cleanup after the build step', () => {
    const script = readScript('scripts', 'macos', 'restart-server.sh');

    expectCleanupAfterBuildAndBeforeStart(
      script,
      'echo "Building TypeScript..."',
      'cleanup_stale_temp_dirs',
      'echo "Starting cats-runtime',
    );
  });
});
