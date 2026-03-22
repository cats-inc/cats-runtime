import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderTargetDescriptor } from '../providerCatalog.js';
import { ProviderCompatibilityService } from './ProviderCompatibilityService.js';
import type { ProviderName } from '../../backends/cli/providers/types.js';

function createCliTarget(
  providerName: ProviderName,
  instanceId = 'default',
): ProviderTargetDescriptor {
  return {
    providerName,
    backend: 'cli',
    instanceId,
    defaultTarget: true,
    cliInstance: {
      id: instanceId,
      providerName,
      commandConfig: {
        path: `${providerName}-cli`,
        runner: 'direct',
        runtime: {
          mode: 'native',
          environmentId: 'native',
        },
      },
    },
  };
}

describe('ProviderCompatibilityService', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it('selects the ready profile when version and help signature match', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-compat-service-'));
    tempDirs.push(root);
    const runner = {
      run: vi.fn(async (_providerName, _commandConfig, args: string[]) => {
        if (args[0] === '--version') {
          return {
            exitCode: 0,
            stdout: 'claude 1.2.3\n',
            stderr: '',
            timedOut: false,
            durationMs: 5,
          };
        }

        return {
          exitCode: 0,
          stdout: 'Usage: claude --input-format --output-format --include-partial-messages\n',
          stderr: '',
          timedOut: false,
          durationMs: 5,
        };
      }),
    };
    const service = new ProviderCompatibilityService({
      dataDir: join(root, 'data'),
      sessionBaseDir: join(root, 'sessions'),
    }, {
      runner,
      now: () => Date.parse('2026-03-23T00:00:00.000Z'),
    });

    const assessment = await service.assessCliTarget(createCliTarget('claude'));
    expect(assessment.classification).toBe('ready');
    expect(assessment.status).toBe('ok');
    expect(assessment.profile.id).toBe('claude-cli-stream-json-v1');
    expect(assessment.fingerprint.version.normalized).toBe('1.2.3');
    expect(assessment.fingerprint.features).toContain('token:--output-format');
    expect(assessment.evidence).toBeUndefined();
  });

  it('returns cached assessments until the ttl expires', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-compat-cache-'));
    tempDirs.push(root);
    const runner = {
      run: vi.fn(async (_providerName, _commandConfig, args: string[]) => ({
        exitCode: 0,
        stdout: args[0] === '--version'
          ? 'gemini 1.0.0\n'
          : '--output-format --resume\n',
        stderr: '',
        timedOut: false,
        durationMs: 3,
      })),
    };
    const service = new ProviderCompatibilityService({
      dataDir: join(root, 'data'),
      sessionBaseDir: join(root, 'sessions'),
    }, {
      cacheTtlMs: 60_000,
      runner,
      now: () => Date.parse('2026-03-23T00:00:00.000Z'),
    });

    const first = await service.assessCliTarget(createCliTarget('gemini'));
    const second = await service.assessCliTarget(createCliTarget('gemini'));
    expect(first.cache.hit).toBe(false);
    expect(second.cache.hit).toBe(true);
    expect(runner.run).toHaveBeenCalledTimes(2);
  });

  it('captures replay-friendly evidence for degraded compatibility paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-compat-evidence-'));
    tempDirs.push(root);
    const service = new ProviderCompatibilityService({
      dataDir: join(root, 'data'),
      sessionBaseDir: join(root, 'sessions'),
    }, {
      runner: {
        run: vi.fn(async (_providerName, _commandConfig, args: string[]) => ({
          exitCode: 0,
          stdout: args[0] === '--version' ? 'codex 0.99.0\n' : 'Usage: codex\n',
          stderr: '',
          timedOut: false,
          durationMs: 4,
        })),
      },
      now: () => Date.parse('2026-03-23T00:00:10.000Z'),
    });

    const assessment = await service.assessCliTarget(createCliTarget('codex'));
    expect(assessment.classification).toBe('degraded');
    expect(assessment.evidence?.relativePath).toMatch(/^codex\//);

    const evidencePath = join(service.getEvidenceDir(), assessment.evidence!.relativePath);
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as {
      classification: string;
      profile: { id: string };
      probes: { version?: { stdoutSample?: string } };
    };
    expect(evidence.classification).toBe('degraded');
    expect(evidence.profile.id).toBe('codex-cli-json-rpc-best-fit');
    expect(evidence.probes.version?.stdoutSample).toContain('codex 0.99.0');
  });

  it('falls back to a generic degraded profile for providers without family knowledge', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-compat-generic-'));
    tempDirs.push(root);
    const service = new ProviderCompatibilityService({
      dataDir: join(root, 'data'),
      sessionBaseDir: join(root, 'sessions'),
    }, {
      runner: {
        run: vi.fn(async () => ({
          exitCode: 0,
          stdout: 'cursor-agent 5.0.0\n',
          stderr: '',
          timedOut: false,
          durationMs: 2,
        })),
      },
      now: () => Date.parse('2026-03-23T00:00:20.000Z'),
    });

    const assessment = await service.assessCliTarget(createCliTarget('cursor'));
    expect(assessment.classification).toBe('degraded');
    expect(assessment.profile.id).toBe('cursor-cli-runtime-default');
    expect(assessment.summary).toContain('No provider-specific compatibility profile');
  });
});
