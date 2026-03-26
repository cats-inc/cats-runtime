import { describe, expect, it, vi } from 'vitest';
import {
  buildProviderToolingSummary,
  loadProviderRemoteToolCatalog,
} from './providerTooling.js';
import type { ProviderTargetDescriptor } from '../providerCatalog.js';

describe('buildProviderToolingSummary', () => {
  it('builds a discoverable runtime-local summary for API targets', () => {
    const summary = buildProviderToolingSummary({
      providerName: 'claude',
      backend: 'api',
      instanceId: 'sonnet',
      defaultTarget: true,
      remoteInstance: {
        id: 'sonnet',
        providerName: 'claude',
        backend: 'api',
        transport: 'anthropic',
        toolProfile: 'read_only',
      },
    } as ProviderTargetDescriptor);

    expect(summary).toEqual({
      source: 'runtime_local',
      discoverable: true,
      sessionScopedOverrides: true,
      summary: expect.stringContaining(`'read_only' profile`),
      policy: expect.objectContaining({
        profile: 'read_only',
        counts: {
          total: 16,
          fullAccess: 16,
          previewOnly: 0,
          blocked: 0,
        },
      }),
      observability: {
        catalog: 'runtime_enumerated',
        toolCallEvents: true,
        runtimeServices: false,
      },
    });
  });

  it('keeps CLI targets honest about provider-owned tooling', () => {
    const summary = buildProviderToolingSummary({
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
    } as ProviderTargetDescriptor);

    expect(summary).toEqual({
      source: 'provider_native',
      discoverable: false,
      sessionScopedOverrides: false,
      summary: expect.stringContaining('does not enumerate provider-native tools'),
      observability: {
        catalog: 'not_enumerated',
        toolCallEvents: false,
        runtimeServices: false,
      },
    });
  });

  it('keeps agent targets honest about provider-managed tooling and remote observability', () => {
    const summary = buildProviderToolingSummary({
      providerName: 'openclaw',
      backend: 'agent',
      instanceId: 'gateway',
      defaultTarget: true,
      remoteInstance: {
        id: 'gateway',
        providerName: 'openclaw',
        backend: 'agent',
        transport: 'openclaw_gateway',
      },
    } as ProviderTargetDescriptor, {
      agentRuntime: {
        adapter: 'openclaw',
        family: 'gateway',
        summary: 'OpenClaw gateway',
        transport: {
          kind: 'websocket',
          protocol: 'openclaw_gateway_v3',
          liveProbe: 'rpc_health',
          modelDiscovery: 'models_list',
          toolDiscovery: 'tools_catalog',
          streaming: 'agent_event_frames',
        },
        request: {
          headerNames: [],
        },
        auth: {
          mechanisms: [],
          credentials: [],
        },
        continuity: {
          providerManagedSessions: true,
          sessionKey: true,
          providerSessionState: true,
          cancel: false,
        },
        capabilities: {
          probe: true,
          modelDiscovery: true,
          toolCatalog: true,
          cancel: false,
          runtimeServices: true,
          toolCallEvents: false,
        },
      },
    });

    expect(summary).toEqual({
      source: 'provider_managed',
      discoverable: true,
      sessionScopedOverrides: false,
      summary: expect.stringContaining('can query a bounded remote tool catalog'),
      observability: {
        catalog: 'provider_remote_enumerated',
        toolCallEvents: false,
        runtimeServices: true,
      },
    });
  });

  it('loads a bounded remote tool catalog for catalog-capable agent targets', async () => {
    const target = {
      providerName: 'openclaw',
      backend: 'agent',
      instanceId: 'gateway',
      defaultTarget: true,
      remoteInstance: {
        id: 'gateway',
        providerName: 'openclaw',
        backend: 'agent',
        transport: 'openclaw_gateway',
      },
    } as ProviderTargetDescriptor;

    const catalog = await loadProviderRemoteToolCatalog(target, {
      agentRuntime: {
        adapter: 'openclaw',
        family: 'gateway',
        summary: 'OpenClaw gateway',
        transport: {
          kind: 'websocket',
          protocol: 'openclaw_gateway_v3',
          liveProbe: 'rpc_health',
          modelDiscovery: 'models_list',
          toolDiscovery: 'tools_catalog',
          streaming: 'agent_event_frames',
        },
        request: {
          headerNames: [],
        },
        auth: {
          mechanisms: [],
          credentials: [],
        },
        continuity: {
          providerManagedSessions: true,
          sessionKey: true,
          providerSessionState: true,
          cancel: false,
        },
        capabilities: {
          probe: true,
          modelDiscovery: true,
          toolCatalog: true,
          cancel: false,
          runtimeServices: true,
          toolCallEvents: false,
        },
      },
      agentBackend: {
        listTools: vi.fn(async () => ({
          method: 'tools_catalog',
          summary: '3 tool(s) across 2 group(s) advertised by the OpenClaw gateway.',
          toolCount: 3,
          groupCount: 2,
          groups: [
            { id: 'core', label: 'Core', toolCount: 2 },
            { id: 'plugin:media', label: 'Media', toolCount: 1 },
          ],
          tools: [
            { name: 'read_file', source: 'core' },
            { name: 'write_file', source: 'core' },
            { name: 'share_image', source: 'plugin', groupId: 'plugin:media' },
          ],
        })),
      },
    });

    expect(catalog).toEqual({
      source: 'provider_remote',
      status: 'ready',
      method: 'tools_catalog',
      summary: '3 tool(s) across 2 group(s) advertised by the OpenClaw gateway.',
      toolCount: 3,
      groupCount: 2,
      groups: [
        { id: 'core', label: 'Core', toolCount: 2 },
        { id: 'plugin:media', label: 'Media', toolCount: 1 },
      ],
      tools: [
        { name: 'read_file', source: 'core' },
        { name: 'write_file', source: 'core' },
        { name: 'share_image', source: 'plugin', groupId: 'plugin:media' },
      ],
    });
  });

  it('surfaces an unavailable remote tool catalog when discovery fails', async () => {
    const target = {
      providerName: 'openclaw',
      backend: 'agent',
      instanceId: 'gateway',
      defaultTarget: true,
      remoteInstance: {
        id: 'gateway',
        providerName: 'openclaw',
        backend: 'agent',
        transport: 'openclaw_gateway',
      },
    } as ProviderTargetDescriptor;

    const catalog = await loadProviderRemoteToolCatalog(target, {
      agentRuntime: {
        adapter: 'openclaw',
        family: 'gateway',
        summary: 'OpenClaw gateway',
        transport: {
          kind: 'websocket',
          protocol: 'openclaw_gateway_v3',
          liveProbe: 'rpc_health',
          modelDiscovery: 'models_list',
          toolDiscovery: 'tools_catalog',
          streaming: 'agent_event_frames',
        },
        request: {
          headerNames: [],
        },
        auth: {
          mechanisms: [],
          credentials: [],
        },
        continuity: {
          providerManagedSessions: true,
          sessionKey: true,
          providerSessionState: true,
          cancel: false,
        },
        capabilities: {
          probe: true,
          modelDiscovery: true,
          toolCatalog: true,
          cancel: false,
          runtimeServices: true,
          toolCallEvents: false,
        },
      },
      agentBackend: {
        listTools: vi.fn(async () => {
          throw new Error('remote tools unavailable');
        }),
      },
    });

    expect(catalog).toEqual({
      source: 'provider_remote',
      status: 'unavailable',
      method: 'tools_catalog',
      summary: 'Remote tool catalog could not be loaded: remote tools unavailable',
      toolCount: 0,
      groupCount: 0,
      groups: [],
      tools: [],
      error: 'remote tools unavailable',
    });
  });
});
