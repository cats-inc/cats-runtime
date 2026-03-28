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

  it('accepts current 0.x CLI families when their compatibility signature matches', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-compat-current-zero-major-'));
    tempDirs.push(root);

    const cases: Array<{
      providerName: ProviderName;
      versionOutput: string;
      helpOutput: string;
    }> = [
      {
        providerName: 'gemini',
        versionOutput: '0.35.3\n',
        helpOutput: 'Usage: gemini --output-format --resume\n',
      },
      {
        providerName: 'pi',
        versionOutput: '0.63.1\n',
        helpOutput: 'Usage: pi --mode rpc --session <path>\n',
      },
      {
        providerName: 'auggie',
        versionOutput: '0.21.0\n',
        helpOutput: 'Usage: auggie --output-format json --workspace-root . --resume\n',
      },
    ];

    for (const currentCase of cases) {
      const service = new ProviderCompatibilityService({
        dataDir: join(root, 'data'),
        sessionBaseDir: join(root, 'sessions'),
      }, {
        runner: {
          run: vi.fn(async (_providerName, _commandConfig, args: string[]) => ({
            exitCode: 0,
            stdout: args[0] === '--version'
              ? currentCase.versionOutput
              : currentCase.helpOutput,
            stderr: '',
            timedOut: false,
            durationMs: 4,
          })),
        },
        installCheckRunner: createInstallCheckRunner(),
        now: () => Date.parse('2026-03-23T00:00:01.000Z'),
      });

      const assessment = await service.assessCliTarget(createCliTarget(currentCase.providerName));
      expect(assessment.classification).toBe('ready');
      expect(assessment.status).toBe('ok');
    }
  });

  it('treats timed-out probes with usable version/help output as command-available', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-compat-timeout-output-'));
    tempDirs.push(root);
    const service = new ProviderCompatibilityService({
      dataDir: join(root, 'data'),
      sessionBaseDir: join(root, 'sessions'),
    }, {
      runner: {
        run: vi.fn(async (_providerName, _commandConfig, args: string[]) => ({
          exitCode: null,
          stdout: args[0] === '--version'
            ? 'codex-cli 0.117.0\n'
            : 'Codex CLI\n\nCommands:\n  app-server  [experimental] Run the app server or related tooling\n',
          stderr: '',
          timedOut: true,
          durationMs: 3_500,
          error: 'Timed out after 3000ms',
        })),
      },
      installCheckRunner: createInstallCheckRunner(),
      now: () => Date.parse('2026-03-23T00:00:02.000Z'),
    });

    const assessment = await service.assessCliTarget(createCliTarget('codex'));
    expect(assessment.classification).toBe('ready');
    expect(assessment.status).toBe('ok');
    expect(assessment.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'command_available',
        status: 'ok',
      }),
      expect.objectContaining({
        code: 'profile_selected',
        status: 'ok',
      }),
    ]));
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

  it('limits concurrent compatibility assessments to the configured slot count', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-compat-limit-'));
    tempDirs.push(root);
    const pendingRuns = new Map<string, () => void>();
    const startedProviders: string[] = [];
    const runner = {
      run: vi.fn((providerName: ProviderName, _commandConfig, args: string[]) => new Promise((resolve) => {
        startedProviders.push(`${providerName}:${args[0]}`);
        pendingRuns.set(`${providerName}:${args[0]}`, () => resolve({
          exitCode: 0,
          stdout: args[0] === '--version'
            ? `${providerName} 1.2.3\n`
            : 'Usage: command --output-format --resume app-server --include-partial-messages\n',
          stderr: '',
          timedOut: false,
          durationMs: 2,
        }));
      })),
    };
    const service = new ProviderCompatibilityService({
      dataDir: join(root, 'data'),
      sessionBaseDir: join(root, 'sessions'),
    }, {
      maxConcurrentAssessments: 1,
      runner,
      installCheckRunner: createInstallCheckRunner(),
      now: () => Date.parse('2026-03-23T00:00:05.000Z'),
    });

    const firstAssessment = service.assessCliTarget(createCliTarget('claude'));
    await Promise.resolve();
    const secondAssessment = service.assessCliTarget(createCliTarget('codex'));
    await Promise.resolve();

    expect(startedProviders).toEqual([
      'claude:--version',
      'claude:--help',
    ]);

    pendingRuns.get('claude:--version')?.();
    pendingRuns.get('claude:--help')?.();
    await firstAssessment;
    await Promise.resolve();

    expect(startedProviders).toEqual([
      'claude:--version',
      'claude:--help',
      'codex:--version',
      'codex:--help',
    ]);

    pendingRuns.get('codex:--version')?.();
    pendingRuns.get('codex:--help')?.();

    await Promise.all([firstAssessment, secondAssessment]);
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

  it('uses first-class family knowledge for Cursor instead of the generic fallback', async () => {
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
    expect(assessment.profile.id).toBe('cursor-cli-stream-json-best-fit');
    expect(assessment.summary).toContain('Cursor Agent CLI');
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

  it('does not infer missing auth from help text that mentions provider env vars', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-compat-auth-help-'));
    tempDirs.push(root);
    const service = new ProviderCompatibilityService({
      dataDir: join(root, 'data'),
      sessionBaseDir: join(root, 'sessions'),
    }, {
      runner: {
        run: vi.fn(async (_providerName, _commandConfig, args: string[]) => ({
          exitCode: args[0] === '--version' ? 0 : null,
          stdout: args[0] === '--version'
            ? '2026.03.25-933d5a6\n'
            : 'Usage: cursor-agent --output-format --stream-partial-output --resume\n'
              + '--api-key <key> (can also use CURSOR_API_KEY env var)\n',
          stderr: '',
          timedOut: args[0] !== '--version',
          durationMs: 4,
          ...(args[0] !== '--version' ? { error: 'Timed out after 5000ms' } : {}),
        })),
      },
      installCheckRunner: createInstallCheckRunner(),
      now: () => Date.parse('2026-03-23T00:00:33.000Z'),
    });

    const assessment = await service.assessCliTarget(createCliTarget('cursor'));
    expect(assessment.classification).toBe('ready');
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

  it('expands first-class compatibility coverage to Pi and records live probe metadata', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-compat-pi-live-'));
    tempDirs.push(root);
    const service = new ProviderCompatibilityService({
      dataDir: join(root, 'data'),
      sessionBaseDir: join(root, 'sessions'),
    }, {
      runner: {
        run: vi.fn(async (_providerName, _commandConfig, args: string[]) => {
          if (args[0] === '--version') {
            return {
              exitCode: 0,
              stdout: 'pi 1.4.0\n',
              stderr: '',
              timedOut: false,
              durationMs: 3,
            };
          }

          return {
            exitCode: 0,
            stdout: 'Usage: pi --mode rpc --session <path>\n',
            stderr: '',
            timedOut: false,
            durationMs: 3,
          };
        }),
      },
      installCheckRunner: createInstallCheckRunner(),
      now: () => Date.parse('2026-03-23T00:00:45.000Z'),
    });

    const assessment = await service.assessCliTarget(createCliTarget('pi'), {
      probeMode: 'live',
    });
    expect(assessment.classification).toBe('ready');
    expect(assessment.profile.id).toBe('pi-cli-rpc-v1');
    expect(assessment.probe).toEqual({
      mode: 'live',
      supportsLive: true,
      liveValidated: true,
    });
    expect(assessment.probes.live).toEqual(expect.objectContaining({
      kind: 'live',
      commandSummary: '--mode rpc --help',
      ok: true,
    }));
    expect(assessment.fingerprint.features).toEqual(expect.arrayContaining([
      'token:--mode',
      'live:--mode',
    ]));
  });

  it('validates the OpenCode models subcommand as the live compatibility seam', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-compat-opencode-live-'));
    tempDirs.push(root);
    const service = new ProviderCompatibilityService({
      dataDir: join(root, 'data'),
      sessionBaseDir: join(root, 'sessions'),
    }, {
      runner: {
        run: vi.fn(async (_providerName, _commandConfig, args: string[]) => {
          if (args[0] === '--version') {
            return {
              exitCode: 0,
              stdout: 'opencode 1.1.0\n',
              stderr: '',
              timedOut: false,
              durationMs: 3,
            };
          }

          if (args[0] === 'models') {
            return {
              exitCode: 0,
              stdout: 'Usage: opencode models [provider]\n  --refresh\n  --verbose\n',
              stderr: '',
              timedOut: false,
              durationMs: 3,
            };
          }

          return {
            exitCode: 0,
            stdout: 'Usage: opencode serve\n  models\n  serve\n',
            stderr: '',
            timedOut: false,
            durationMs: 3,
          };
        }),
      },
      installCheckRunner: createInstallCheckRunner(),
      now: () => Date.parse('2026-03-23T00:00:47.000Z'),
    });

    const assessment = await service.assessCliTarget(createCliTarget('opencode'), {
      probeMode: 'live',
    });
    expect(assessment.classification).toBe('ready');
    expect(assessment.profile.id).toBe('opencode-cli-native-v1');
    expect(assessment.probe).toEqual({
      mode: 'live',
      supportsLive: true,
      liveValidated: true,
    });
    expect(assessment.probes.live).toEqual(expect.objectContaining({
      kind: 'live',
      commandSummary: 'models --help',
      ok: true,
    }));
    expect(assessment.fingerprint.features).toEqual(expect.arrayContaining([
      'token:models',
      'live:--refresh',
    ]));
  });

  it('marks cached summaries as stale once the ttl expires', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-compat-cache-summary-'));
    tempDirs.push(root);
    let now = Date.parse('2026-03-23T00:01:00.000Z');
    const service = new ProviderCompatibilityService({
      dataDir: join(root, 'data'),
      sessionBaseDir: join(root, 'sessions'),
    }, {
      cacheTtlMs: 1_000,
      runner: {
        run: vi.fn(async (_providerName, _commandConfig, args: string[]) => ({
          exitCode: 0,
          stdout: args[0] === '--version'
            ? 'claude 1.2.3\n'
            : 'Usage: claude --input-format --output-format --include-partial-messages\n',
          stderr: '',
          timedOut: false,
          durationMs: 2,
        })),
      },
      installCheckRunner: createInstallCheckRunner(),
      now: () => now,
    });

    await service.assessCliTarget(createCliTarget('claude'));
    now += 1_500;

    const summary = service.getCachedSummary('claude', 'default');
    expect(summary).toEqual(expect.objectContaining({
      probe: expect.objectContaining({
        mode: 'light',
      }),
      cache: expect.objectContaining({
        stale: true,
        ttlMs: 1_000,
        ageMs: 1_500,
      }),
      attentionCodes: [],
    }));
  });

  it('prefers a fresh live cached summary over a newer light cached summary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-compat-cache-live-'));
    tempDirs.push(root);
    let now = Date.parse('2026-03-23T00:01:05.000Z');
    const service = new ProviderCompatibilityService({
      dataDir: join(root, 'data'),
      sessionBaseDir: join(root, 'sessions'),
    }, {
      cacheTtlMs: 60_000,
      runner: {
        run: vi.fn(async (_providerName, _commandConfig, args: string[]) => ({
          exitCode: 0,
          stdout: args[0] === '--version'
            ? 'pi 1.4.0\n'
            : 'Usage: pi --mode rpc --session <path>\n',
          stderr: '',
          timedOut: false,
          durationMs: 2,
        })),
      },
      installCheckRunner: createInstallCheckRunner(),
      now: () => now,
    });

    await service.assessCliTarget(createCliTarget('pi'), { probeMode: 'live' });
    now += 5_000;
    await service.assessCliTarget(createCliTarget('pi'), { probeMode: 'light' });

    const summary = service.getCachedSummary('pi', 'default');
    expect(summary).toEqual(expect.objectContaining({
      probe: expect.objectContaining({
        mode: 'live',
        liveValidated: true,
      }),
      cache: expect.objectContaining({
        stale: false,
      }),
    }));
  });

  it('turns otherwise-ready assessments into probe_failed when the live runtime probe fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-compat-live-fail-'));
    tempDirs.push(root);
    const service = new ProviderCompatibilityService({
      dataDir: join(root, 'data'),
      sessionBaseDir: join(root, 'sessions'),
    }, {
      runner: {
        run: vi.fn(async (_providerName, _commandConfig, args: string[]) => {
          if (args[0] === '--version') {
            return {
              exitCode: 0,
              stdout: 'gemini 1.3.0\n',
              stderr: '',
              timedOut: false,
              durationMs: 2,
            };
          }

          if (args.includes('--yolo')) {
            return {
              exitCode: 2,
              stdout: '',
              stderr: 'unknown option --yolo',
              timedOut: false,
              durationMs: 2,
            };
          }

          return {
            exitCode: 0,
            stdout: 'Usage: gemini --output-format --resume\n',
            stderr: '',
            timedOut: false,
            durationMs: 2,
          };
        }),
      },
      installCheckRunner: createInstallCheckRunner(),
      now: () => Date.parse('2026-03-23T00:01:10.000Z'),
    });

    const assessment = await service.assessCliTarget(createCliTarget('gemini'), {
      probeMode: 'live',
    });
    expect(assessment.classification).toBe('probe_failed');
    expect(assessment.profile.confidence).toBe('weak');
    expect(assessment.probe.liveValidated).toBe(false);
    expect(assessment.evidence?.relativePath).toMatch(/^gemini\//);
    expect(assessment.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'live_probe_failed',
        status: 'unavailable',
      }),
    ]));
  });
});
