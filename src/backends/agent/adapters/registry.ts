import type { RemoteProviderInstanceConfig } from '../../cli/config.js';
import { AgentSdkBridgeAdapter } from './agent-sdk/AgentSdkBridgeAdapter.js';
import { OpenClawAdapter } from './openclaw/OpenClawAdapter.js';
import type { AgentAdapter, AgentBackendOptions } from '../types.js';

export function buildAgentAdapter(
  instance: RemoteProviderInstanceConfig,
  options: AgentBackendOptions = {},
): AgentAdapter {
  switch (instance.transport) {
    case 'openclaw':
    case 'openclaw_gateway':
      return new OpenClawAdapter(options);
    case 'agent_sdk':
    case 'agent_sdk_bridge':
      return new AgentSdkBridgeAdapter(options);
    default:
      throw new Error(
        `Unsupported agent transport '${instance.transport || 'unknown'}' `
        + `for ${instance.providerName}/${instance.id}`,
      );
  }
}
