import {
  buildToolPolicyInspection,
  LocalToolRuntime,
  type ToolExecutionContext,
} from '../../../core/tools/LocalToolRuntime.js';
import type {
  AgentAcpHostBridge,
  AgentAcpHostContext,
  AgentAcpHostDescription,
  AgentAcpHostMcpServer,
  AgentAcpHostToolCall,
  AgentAcpHostToolDefinition,
  AgentAcpHostToolResult,
} from '../types.js';

export interface RuntimeAcpHostBridgeOptions {
  tools?: LocalToolRuntime;
}

function buildToolContext(context: AgentAcpHostContext): ToolExecutionContext {
  return {
    sessionId: context.sessionId,
    cwd: context.cwd,
    workspaceMode: context.workspaceMode,
    permissionMode: context.permissionMode,
    allowedTools: context.allowedTools ? [...context.allowedTools] : undefined,
    toolProfile: context.toolProfile,
  };
}

export class RuntimeAcpHostBridge implements AgentAcpHostBridge {
  private readonly tools: LocalToolRuntime;

  constructor(options: RuntimeAcpHostBridgeOptions = {}) {
    this.tools = options.tools ?? new LocalToolRuntime();
  }

  describe(context: AgentAcpHostContext): AgentAcpHostDescription {
    const toolPolicy = buildToolPolicyInspection({
      toolProfile: context.toolProfile,
      permissionMode: context.permissionMode,
      workspaceMode: context.workspaceMode,
      allowedTools: context.allowedTools,
    });
    const workspace = {
      kind: context.workspace.kind,
      access: context.workspace.access,
      runtimeCwd: context.workspace.runtimeCwd,
      ...(context.workspace.sourceCwd ? { sourceCwd: context.workspace.sourceCwd } : {}),
      ...(context.workspace.worktree?.worktreePath
        ? { worktreePath: context.workspace.worktree.worktreePath }
        : {}),
    };
    const summary = `Runtime ACP host bridge is ready for session '${context.sessionId}' with `
      + `${toolPolicy.counts.fullAccess}/${toolPolicy.counts.total} full-access tool(s) `
      + `under ${context.workspace.kind}/${context.workspace.access} workspace policy.`;

    return {
      summary,
      workspace,
      toolPolicy,
      capabilities: {
        permissionPolicy: true,
        filesystem: true,
        terminal: true,
        toolExecution: true,
        clientMcpServers: false,
      },
    };
  }

  listTools(context: AgentAcpHostContext): AgentAcpHostToolDefinition[] {
    return this.tools.listTools(context.toolProfile).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  listMcpServers(_context: AgentAcpHostContext): AgentAcpHostMcpServer[] {
    return [];
  }

  async executeTool(
    context: AgentAcpHostContext,
    call: AgentAcpHostToolCall,
  ): Promise<AgentAcpHostToolResult> {
    return this.tools.execute(buildToolContext(context), call);
  }
}
