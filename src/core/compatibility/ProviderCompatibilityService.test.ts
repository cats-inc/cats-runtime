import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderTargetDescriptor } from '../providerCatalog.js';
import { ProviderCompatibilityService } from './ProviderCompatibilityService.js';
import type { ProviderName } from '../../backends/cli/providers/types.js';
import type { ProviderInstallCheckRunner } from '../provider-install/ProviderInstallCheckRunner.js';

function createCliTarget(
  providerName: ProviderName,
  instanceId = 'default',
  runtimeOverride: Record<string, unknown> = {},
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
          ...runtimeOverride,
        },
      },
    },
  };
}

function createInstallCheckRunner(
  overrides: Partial<ProviderInstallCheckRunner> = {},
): ProviderInstallCheckRunner {
  return {
    lookupCommand: vi.fn(async (command: string) => ({
      available: true,
      resolvedPath: `/runtime/bin/${command}`,
      timedOut: false,
    })),
    checkPath: vi.fn(async () => ({
      exists: false,
      timedOut: false,
    })),
    checkNpmPackage: vi.fn(async () => ({
      exists: false,
      timedOut: false,
    })),
    checkShellRcEntry: vi.fn(async () => ({
      exists: false,
      timedOut: false,
    })),
    getNpmPrefix: vi.fn(async () => ({
      value: undefined,
      timedOut: false,
    })),
    ...overrides,
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
      installCheckRunner: createInstallCheckRunner(),
      now: () => Date.parse('2026-03-23T00:00:00.000Z'),
    });

    const assessment = await service.assessCliTarget(createCliTarget('claude'));
    expect(assessment.classification).toBe('ready');
    expect(assessment.status).toBe('ok');
    expect(assessment.profile.id).toBe('claude-cli-stream-json-v1');
    expect(assessment.fingerprint.version.normalized).toBe('1.2.3');
    expect(assessment.fingerprint.features).toContain('token:--output-format');
    expect(assessment.setup.command.status).toBe('ready');
    expect(assessment.setup.install.install.installerId).toBe('claude-code');
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
      installCheckRunner: createInstallCheckRunner(),
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
      installCheckRunner: createInstallCheckRunner({
        checkNpmPackage: vi.fn(async () => ({
          exists: true,
          timedOut: false,
        })),
      }),
      now: () => Date.parse('2026-03-23T00:00:10.000Z'),
    });

    const assessment = await service.assessCliTarget(createCliTarget('codex'));
    expect(assessment.classification).toBe('degraded');
    expect(assessment.evidence?.relativePath).toMatch(/^codex\//);
    expect(assessment.setup.command.status).toBe('ready');

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

  it('redacts Windows paths and secret-like values in evidence bundles', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-compat-redaction-'));
    tempDirs.push(root);
    const service = new ProviderCompatibilityService({
      dataDir: join(root, 'data'),
      sessionBaseDir: join(root, 'sessions'),
    }, {
      runner: {
        run: vi.fn(async (_providerName, _commandConfig, args: string[]) => ({
          exitCode: 0,
          stdout: args[0] === '--version'
            ? 'codex 0.99.0\n'
            : 'Usage: codex config at "C:\\Users\\Alice\\AppData\\Local\\Codex\\config.json" OPENAI_API_KEY=sk-secret-value Bearer ghp_supersecret\n',
          stderr: '',
          timedOut: false,
          durationMs: 4,
        })),
      },
      installCheckRunner: createInstallCheckRunner({
        lookupCommand: vi.fn(async (command: string) => ({
          available: true,
          resolvedPath: command === 'codex-cli'
            ? 'C:\\Users\\Alice\\AppData\\Local\\Programs\\Codex\\codex.exe'
            : '/home/alice/.npm-global/bin/codex',
          timedOut: false,
        })),
        checkNpmPackage: vi.fn(async () => ({
          exists: true,
          timedOut: false,
        })),
      }),
      now: () => Date.parse('2026-03-23T00:00:15.000Z'),
    });

    const assessment = await service.assessCliTarget(createCliTarget('codex'));
    const evidencePath = join(service.getEvidenceDir(), assessment.evidence!.relativePath);
    const evidenceText = readFileSync(evidencePath, 'utf8');
    const evidence = JSON.parse(evidenceText) as {
      probes: { help?: { stdoutSample?: string } };
    };

    expect(evidenceText).not.toContain('C:\\Users\\Alice');
    expect(evidenceText).not.toContain('/home/alice');
    expect(evidenceText).not.toContain('sk-secret-value');
    expect(evidenceText).not.toContain('ghp_supersecret');
    expect(evidence.probes.help?.stdoutSample).toContain('<path>');
    expect(evidence.probes.help?.stdoutSample).toContain('OPENAI_API_KEY=<redacted>');
    expect(evidence.probes.help?.stdoutSample).toContain('Bearer <redacted>');
    expect(evidenceText).toContain('"resolvedCommand": "<path>"');
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
      installCheckRunner: createInstallCheckRunner(),
      now: () => Date.parse('2026-03-23T00:00:20.000Z'),
    });

    const assessment = await service.assessCliTarget(createCliTarget('cursor'));
    expect(assessment.classification).toBe('degraded');
    expect(assessment.profile.id).toBe('cursor-cli-runtime-default');
    expect(assessment.summary).toContain('No provider-specific compatibility profile');
    expect(assessment.setup.install.familyLabel).toBe('Cursor Agent CLI');
  });

  it('classifies missing PATH separately when the binary exists at the expected install path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-compat-path-'));
    tempDirs.push(root);
    const service = new ProviderCompatibilityService({
      dataDir: join(root, 'data'),
      sessionBaseDir: join(root, 'sessions'),
    }, {
      runner: {
        run: vi.fn(async () => ({
          exitCode: null,
          stdout: '',
          stderr: '',
          timedOut: false,
          durationMs: 2,
          error: 'spawn ENOENT',
        })),
      },
      installCheckRunner: createInstallCheckRunner({
        lookupCommand: vi.fn(async () => ({
          available: false,
          timedOut: false,
        })),
        checkPath: vi.fn(async () => ({
          exists: true,
          timedOut: false,
        })),
      }),
      now: () => Date.parse('2026-03-23T00:00:25.000Z'),
    });

    const assessment = await service.assessCliTarget(createCliTarget(
      'claude',
      'default',
      { mode: 'wsl', distro: 'Ubuntu', environmentId: 'ubuntu' },
    ));
    expect(assessment.setup.command.status).toBe('missing_path');
    expect(assessment.setup.pathPersistence.status).toBe('missing');
    expect(assessment.setup.remediation.map((step) => step.code)).toContain('fix_path');
    expect(assessment.setup.remediation.map((step) => step.code)).toContain('persist_path');
    expect(assessment.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'path_missing',
        status: 'degraded',
      }),
      expect.objectContaining({
        code: 'path_persistence_missing',
        status: 'degraded',
      }),
    ]));
  });

  it('surfaces missing install prerequisites for npm-global providers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-compat-prereq-'));
    tempDirs.push(root);
    const service = new ProviderCompatibilityService({
      dataDir: join(root, 'data'),
      sessionBaseDir: join(root, 'sessions'),
    }, {
      runner: {
        run: vi.fn(async () => ({
          exitCode: null,
          stdout: '',
          stderr: '',
          timedOut: false,
          durationMs: 2,
          error: 'spawn ENOENT',
        })),
      },
      installCheckRunner: createInstallCheckRunner({
        lookupCommand: vi.fn(async (command: string) => {
          if (command === 'node' || command === 'npm') {
            return {
              available: false,
              timedOut: false,
            };
          }

          return {
            available: false,
            timedOut: false,
          };
        }),
      }),
      now: () => Date.parse('2026-03-23T00:00:27.000Z'),
    });

    const assessment = await service.assessCliTarget(createCliTarget('codex'));
    expect(assessment.setup.prerequisites).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'node',
        status: 'missing',
      }),
      expect.objectContaining({
        id: 'npm',
        status: 'missing',
      }),
    ]));
    expect(assessment.setup.remediation.map((step) => step.code)).toContain('install_prerequisite');
    expect(assessment.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'prerequisite_missing',
        status: 'unavailable',
      }),
    ]));
  });

  it('flags missing auth when probes report a login requirement', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-compat-auth-'));
    tempDirs.push(root);
    const service = new ProviderCompatibilityService({
      dataDir: join(root, 'data'),
      sessionBaseDir: join(root, 'sessions'),
    }, {
      runner: {
        run: vi.fn(async (providerName, _commandConfig, args: string[]) => ({
          exitCode: 1,
          stdout: '',
          stderr: args[0] === '--version'
            ? `${providerName} login required`
            : 'authentication required',
          timedOut: false,
          durationMs: 3,
        })),
      },
      installCheckRunner: createInstallCheckRunner(),
      now: () => Date.parse('2026-03-23T00:00:30.000Z'),
    });

    const assessment = await service.assessCliTarget(createCliTarget('claude'));
    expect(assessment.setup.auth.status).toBe('missing');
    expect(assessment.setup.remediation.map((step) => step.code)).toContain('authenticate_provider');
    expect(assessment.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'auth_missing',
        status: 'unavailable',
      }),
    ]));
  });

  it('does not infer missing auth from incidental stderr text when probes otherwise succeed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-compat-auth-noise-'));
    tempDirs.push(root);
    const service = new ProviderCompatibilityService({
      dataDir: join(root, 'data'),
      sessionBaseDir: join(root, 'sessions'),
    }, {
      runner: {
        run: vi.fn(async (_providerName, _commandConfig, args: string[]) => ({
          exitCode: 0,
          stdout: args[0] === '--version'
            ? 'claude 1.2.3\n'
            : 'Usage: claude --input-format --output-format --include-partial-messages\n',
          stderr: 'copyright text about unauthorized reproduction',
          timedOut: false,
          durationMs: 3,
        })),
      },
      installCheckRunner: createInstallCheckRunner(),
      now: () => Date.parse('2026-03-23T00:00:32.000Z'),
    });

    const assessment = await service.assessCliTarget(createCliTarget('claude'));
    expect(assessment.setup.auth.status).toBe('unknown');
    expect(assessment.checks.find((check) => check.code === 'auth_missing')).toBeUndefined();
  });

  it('emits upgrade remediation for unsupported versions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-compat-version-'));
    tempDirs.push(root);
    const service = new ProviderCompatibilityService({
      dataDir: join(root, 'data'),
      sessionBaseDir: join(root, 'sessions'),
    }, {
      runner: {
        run: vi.fn(async (_providerName, _commandConfig, args: string[]) => ({
          exitCode: 0,
          stdout: args[0] === '--version'
            ? 'claude 0.9.0\n'
            : 'Usage: claude --input-format --output-format --include-partial-messages\n',
          stderr: '',
          timedOut: false,
          durationMs: 4,
        })),
      },
      installCheckRunner: createInstallCheckRunner(),
      now: () => Date.parse('2026-03-23T00:00:35.000Z'),
    });

    const assessment = await service.assessCliTarget(createCliTarget('claude'));
    expect(assessment.classification).toBe('unsupported_version');
    expect(assessment.setup.version.status).toBe('unsupported');
    expect(assessment.setup.remediation.map((step) => step.code)).toContain('upgrade_provider');
  });

  it('reports npm prefix drift when npm-global packages are installed off the expected prefix', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-compat-npm-prefix-'));
    tempDirs.push(root);
    const service = new ProviderCompatibilityService({
      dataDir: join(root, 'data'),
      sessionBaseDir: join(root, 'sessions'),
    }, {
      runner: {
        run: vi.fn(async () => ({
          exitCode: null,
          stdout: '',
          stderr: '',
          timedOut: false,
          durationMs: 2,
          error: 'spawn ENOENT',
        })),
      },
      installCheckRunner: createInstallCheckRunner({
        lookupCommand: vi.fn(async () => ({
          available: false,
          timedOut: false,
        })),
        checkNpmPackage: vi.fn(async () => ({
          exists: true,
          timedOut: false,
        })),
        getNpmPrefix: vi.fn(async () => ({
          value: '/usr/local',
          timedOut: false,
        })),
      }),
      now: () => Date.parse('2026-03-23T00:00:40.000Z'),
    });

    const assessment = await service.assessCliTarget(createCliTarget('codex'));
    if (process.platform === 'win32') {
      // Windows native targets do not ship a runtime-owned ~/.npm-global prefix baseline yet.
      expect(assessment.setup.npm.status).toBe('not_applicable');
      return;
    }

    expect(assessment.setup.command.status).toBe('missing_path');
    expect(assessment.setup.npm.status).toBe('missing_prefix');
    expect(assessment.setup.remediation.map((step) => step.code)).toContain('configure_npm_prefix');
    expect(assessment.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'npm_prefix_missing',
        status: 'degraded',
      }),
    ]));
  });
});
