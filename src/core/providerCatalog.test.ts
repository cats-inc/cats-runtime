import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import {
  listConfiguredProviders,
  listProviderCatalog,
  resolveProviderTarget,
} from './providerCatalog.js';

describe('provider catalog ordering', () => {
  it('uses the runtime canonical provider order for configured providers', () => {
    const config = loadConfig({
      HOME: '/tmp/cats-runtime-provider-order',
      USERPROFILE: '/tmp/cats-runtime-provider-order',
    });

    config.remoteProviderCatalog.local.ollama = {
      local: {
        id: 'local',
        providerName: 'ollama',
        backend: 'local',
        transport: 'ollama',
        model: 'qwen3:latest',
        baseUrl: 'http://127.0.0.1:11434',
      },
    };
    config.remoteProviderCatalog.agent.openclaw = {
      gateway: {
        id: 'gateway',
        providerName: 'openclaw',
        backend: 'agent',
        transport: 'openclaw_gateway',
        model: 'openclaw-coder',
        url: 'http://127.0.0.1:8088',
      },
    };

    expect(listConfiguredProviders(config)).toEqual([
      'claude',
      'codex',
      'antigravity',
      'cursor',
      'copilot',
      'opencode',
      'kilo',
      'goose',
      'pi',
      'auggie',
      'junie',
      'kiro',
      'grok',
      'cline',
      'devin',
      'ollama',
      'openclaw',
    ]);
    expect(Object.keys(listProviderCatalog(config))).toEqual([
      'claude',
      'codex',
      'antigravity',
      'cursor',
      'copilot',
      'opencode',
      'kilo',
      'goose',
      'pi',
      'auggie',
      'junie',
      'kiro',
      'grok',
      'cline',
      'devin',
      'ollama',
      'openclaw',
    ]);
  });

  it('treats instance=default as the configured provider default target alias', () => {
    const config = loadConfig({
      HOME: '/tmp/cats-runtime-provider-default-alias',
      USERPROFILE: '/tmp/cats-runtime-provider-default-alias',
    });
    const nativeCursor = config.providerInstances.cursor?.native;
    expect(nativeCursor).toBeDefined();

    config.providerDefaultInstances = {
      ...config.providerDefaultInstances,
      cursor: 'ubuntu',
    };
    config.providerDefaultTargets = {
      ...config.providerDefaultTargets,
      cursor: { backend: 'cli', instance: 'ubuntu' },
    };
    config.providerInstances.cursor = {
      ubuntu: {
        id: 'ubuntu',
        providerName: 'cursor',
        commandConfig: {
          path: 'cursor-agent',
          runner: 'auto',
          runtime: { mode: 'wsl', distro: 'Ubuntu', environmentId: 'ubuntu' },
        },
        cursorChatsDir: '/wsl/ubuntu/.cursor/chats',
      },
      native: nativeCursor!,
    };

    expect(resolveProviderTarget(config, 'cursor', 'default')).toMatchObject({
      backend: 'cli',
      instanceId: 'ubuntu',
      defaultTarget: true,
    });
  });
});
