import { describe, expect, it } from 'vitest';
import { buildProviderContinuitySummary } from './providerContinuity.js';
import type { ProviderTargetDescriptor } from './providerCatalog.js';

describe('buildProviderContinuitySummary', () => {
  it('describes runtime-owned continuity for api targets', () => {
    const summary = buildProviderContinuitySummary({
      providerName: 'claude',
      backend: 'api',
      instanceId: 'sonnet',
      defaultTarget: true,
      remoteInstance: {
        id: 'sonnet',
        providerName: 'claude',
        backend: 'api',
        transport: 'anthropic',
      },
    } as ProviderTargetDescriptor, {
      capabilities: {
        resume: true,
        fork: true,
        permissions: true,
      },
    });

    expect(summary).toEqual({
      source: 'runtime_stateful',
      summary: expect.stringContaining('cats-runtime owns the host-visible session lifecycle'),
      resume: true,
      fork: true,
      permissions: true,
      sessionMcpServers: false,
      providerManagedSessions: false,
      sessionKey: false,
      providerSessionState: true,
      remoteCancel: false,
    });
  });

  it('describes provider-native continuity for cli targets', () => {
    const summary = buildProviderContinuitySummary({
      providerName: 'cursor',
      backend: 'cli',
      instanceId: 'ubuntu',
      defaultTarget: true,
      cliInstance: {
        id: 'ubuntu',
        providerName: 'cursor',
        commandConfig: {
          path: 'cursor-agent',
          runner: 'auto',
          runtime: { mode: 'wsl', distro: 'Ubuntu' },
        },
      },
    } as ProviderTargetDescriptor, {
      capabilities: {
        resume: true,
        fork: false,
        permissions: false,
      },
    });

    expect(summary).toEqual({
      source: 'provider_native',
      summary: expect.stringContaining('CLI provider owns native conversation continuity'),
      resume: true,
      fork: false,
      permissions: false,
      sessionMcpServers: false,
      providerManagedSessions: true,
      sessionKey: false,
      providerSessionState: false,
      remoteCancel: false,
    });
  });

  it('reports session MCP server support for supporting CLI adapters in a native runtime', () => {
    const target = (providerName: 'claude' | 'codex', mode: 'native' | 'wsl') => ({
      providerName,
      backend: 'cli',
      instanceId: 'default',
      defaultTarget: true,
      cliInstance: {
        id: 'default',
        providerName,
        commandConfig: {
          path: providerName,
          runner: 'auto',
          runtime: mode === 'native' ? { mode: 'native' } : { mode: 'wsl', distro: 'Ubuntu' },
        },
      },
    }) as ProviderTargetDescriptor;
    const capabilities = {
      resume: true,
      fork: true,
      permissions: true,
      sessionMcpServers: true,
    };

    for (const providerName of ['claude', 'codex'] as const) {
      expect(buildProviderContinuitySummary(target(providerName, 'native'), { capabilities }))
        .toMatchObject({ source: 'provider_native', sessionMcpServers: true });
      // Delivery requires a native runtime, so a WSL instance of the same adapter reports false.
      expect(buildProviderContinuitySummary(target(providerName, 'wsl'), { capabilities }))
        .toMatchObject({ source: 'provider_native', sessionMcpServers: false });
    }
    expect(buildProviderContinuitySummary(target('claude', 'native'), {
      capabilities: { resume: true, fork: true, permissions: true },
    }).sessionMcpServers).toBe(false);
  });

  it('never reports session MCP server support for api, local or agent targets', () => {
    const capabilities = {
      resume: true,
      fork: true,
      permissions: true,
      sessionMcpServers: true,
    };
    for (const backend of ['api', 'local', 'agent'] as const) {
      const summary = buildProviderContinuitySummary({
        providerName: 'claude',
        backend,
        instanceId: 'remote',
        defaultTarget: true,
        remoteInstance: {
          id: 'remote',
          providerName: 'claude',
          backend,
          transport: backend === 'agent' ? 'agent_sdk_bridge' : 'anthropic',
        },
      } as ProviderTargetDescriptor, { capabilities });
      expect(summary.sessionMcpServers).toBe(false);
    }
  });

  it('describes provider-managed continuity for agent targets', () => {
    const summary = buildProviderContinuitySummary({
      providerName: 'claude',
      backend: 'agent',
      instanceId: 'sdk',
      defaultTarget: true,
      remoteInstance: {
        id: 'sdk',
        providerName: 'claude',
        backend: 'agent',
        transport: 'agent_sdk_bridge',
      },
    } as ProviderTargetDescriptor, {
      capabilities: {
        resume: true,
        fork: true,
        permissions: false,
      },
      agentRuntime: {
        adapter: 'agent_sdk_bridge',
        family: 'bridge',
        summary: 'Agent SDK bridge',
        transport: {
          kind: 'http',
          protocol: 'agent_sdk_http_v1',
          liveProbe: 'providers_get',
          modelDiscovery: 'providers_get',
          toolDiscovery: 'none',
          streaming: 'sse',
        },
        request: {
          headerNames: ['authorization'],
        },
        auth: {
          mechanisms: ['bearer_header'],
          credentials: [],
        },
        continuity: {
          providerManagedSessions: true,
          sessionKey: true,
          providerSessionState: true,
          cancel: true,
        },
        capabilities: {
          probe: true,
          modelDiscovery: true,
          toolCatalog: false,
          effectiveToolCatalog: false,
          cancel: true,
          runtimeServices: true,
          toolCallEvents: true,
        },
      },
    });

    expect(summary).toEqual({
      source: 'provider_managed',
      summary: expect.stringContaining('external agent runtime owns provider-managed session continuity'),
      resume: true,
      fork: true,
      permissions: false,
      sessionMcpServers: false,
      providerManagedSessions: true,
      sessionKey: true,
      providerSessionState: true,
      remoteCancel: true,
    });
  });
});
