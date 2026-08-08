import type { BackendKind } from '../backends/cli/config.js';
import type { ProviderTargetDescriptor } from './providerCatalog.js';
import type { ProviderEvolutionLatestArtifactReadModel } from './compatibility/providerEvolutionReadModel.js';

export type ProviderEventCapabilitySupport = 'none' | 'derived' | 'native' | 'unknown';
export type ProviderTextStreamingMode =
  | 'none'
  | 'final'
  | 'chunk'
  | 'line'
  | 'token'
  | 'unknown';
export type ProviderRecommendedPresentation =
  | 'final_message'
  | 'event_tape'
  | 'content_blocks'
  | 'unknown';

export interface ProviderEventTextCapabilityTruth {
  mode: ProviderTextStreamingMode;
  stepwise: boolean;
}

export interface ProviderNormalizedStreamCapabilityTruth {
  text: ProviderEventTextCapabilityTruth;
  toolUse: ProviderEventCapabilitySupport;
  toolResult: ProviderEventCapabilitySupport;
  progress: ProviderEventCapabilitySupport;
  reasoning: ProviderEventCapabilitySupport;
}

export interface ProviderTranscriptCapabilityTruth {
  contentBlocks: ProviderEventCapabilitySupport;
}

export interface ProviderPresentationCapabilityTruth {
  recommended: ProviderRecommendedPresentation;
}

export interface ProviderEventCapabilityValidation {
  artifactId: string;
  capturedAt: string;
  transport: string;
  runtimeMode?: string;
  executionStatus: 'completed' | 'failed';
  observed: {
    incrementalText: boolean;
    toolUse: boolean;
    toolResult: boolean;
    progress: boolean;
    finalResult: boolean;
  };
}

export interface ProviderEventCapabilityTruth {
  normalizedStream: ProviderNormalizedStreamCapabilityTruth;
  transcript: ProviderTranscriptCapabilityTruth;
  presentation: ProviderPresentationCapabilityTruth;
  notes: string[];
  validation?: ProviderEventCapabilityValidation;
}

type ProviderEventCapabilityTemplate = Omit<ProviderEventCapabilityTruth, 'validation'>;

const UNKNOWN_EVENT_CAPABILITIES: ProviderEventCapabilityTemplate = {
  normalizedStream: {
    text: {
      mode: 'unknown',
      stepwise: false,
    },
    toolUse: 'unknown',
    toolResult: 'unknown',
    progress: 'unknown',
    reasoning: 'unknown',
  },
  transcript: {
    contentBlocks: 'unknown',
  },
  presentation: {
    recommended: 'unknown',
  },
  notes: [],
};

const CLI_PROVIDER_EVENT_CAPABILITIES: Record<string, ProviderEventCapabilityTemplate> = {
  claude: {
    normalizedStream: {
      text: { mode: 'token', stepwise: true },
      toolUse: 'native',
      toolResult: 'native',
      progress: 'derived',
      reasoning: 'native',
    },
    transcript: {
      contentBlocks: 'native',
    },
    presentation: {
      recommended: 'content_blocks',
    },
    notes: [
      'Native content blocks and tool blocks arrive mid-turn.',
      'Runtime still projects these as normalized text/tool/progress events today.',
    ],
  },
  codex: {
    normalizedStream: {
      text: { mode: 'chunk', stepwise: true },
      toolUse: 'native',
      toolResult: 'none',
      progress: 'derived',
      reasoning: 'derived',
    },
    transcript: {
      contentBlocks: 'none',
    },
    presentation: {
      recommended: 'content_blocks',
    },
    notes: [
      'Rich mid-turn progress is available, including plan/reasoning-style updates.',
      'Standardized tool_result events are still missing from the normalized stream.',
    ],
  },
  copilot: {
    normalizedStream: {
      text: { mode: 'chunk', stepwise: true },
      toolUse: 'native',
      toolResult: 'native',
      progress: 'derived',
      reasoning: 'none',
    },
    transcript: {
      contentBlocks: 'none',
    },
    presentation: {
      recommended: 'content_blocks',
    },
    notes: [
      'Assistant deltas stream mid-turn and explicit tool requests/results are exposed.',
    ],
  },
  cursor: {
    normalizedStream: {
      text: { mode: 'chunk', stepwise: true },
      toolUse: 'native',
      toolResult: 'native',
      progress: 'derived',
      reasoning: 'none',
    },
    transcript: {
      contentBlocks: 'native',
    },
    presentation: {
      recommended: 'content_blocks',
    },
    notes: [
      'Assistant content blocks include tool_use/tool_result payloads.',
      'Progress remains a runtime-derived view over those native blocks and deltas.',
    ],
  },
  antigravity: {
    normalizedStream: {
      text: { mode: 'unknown', stepwise: false },
      toolUse: 'unknown',
      toolResult: 'unknown',
      progress: 'unknown',
      reasoning: 'none',
    },
    transcript: {
      contentBlocks: 'unknown',
    },
    presentation: {
      recommended: 'unknown',
    },
    notes: [
      'Raw agy subprocess streaming has not been probed yet.',
      'Treat Antigravity execution semantics as unknown until a verified compatibility profile exists.',
    ],
  },
  goose: {
    normalizedStream: {
      text: { mode: 'final', stepwise: false },
      toolUse: 'native',
      toolResult: 'native',
      progress: 'derived',
      reasoning: 'none',
    },
    transcript: {
      contentBlocks: 'native',
    },
    presentation: {
      recommended: 'content_blocks',
    },
    notes: [
      'The runtime can reconstruct tool milestones from Goose content blocks.',
      'Incremental assistant text is still not exposed as stepwise deltas.',
    ],
  },
  junie: {
    normalizedStream: {
      text: { mode: 'final', stepwise: false },
      toolUse: 'derived',
      toolResult: 'derived',
      progress: 'derived',
      reasoning: 'none',
    },
    transcript: {
      contentBlocks: 'none',
    },
    presentation: {
      recommended: 'content_blocks',
    },
    notes: [
      'Tool and progress milestones are reconstructed from session-state polling.',
      'Stdout still resolves to a final message blob instead of stepwise text.',
    ],
  },
  kiro: {
    normalizedStream: {
      text: { mode: 'line', stepwise: true },
      toolUse: 'none',
      toolResult: 'none',
      progress: 'none',
      reasoning: 'none',
    },
    transcript: {
      contentBlocks: 'none',
    },
    presentation: {
      recommended: 'final_message',
    },
    notes: [
      'Only shallow line-oriented text streaming is currently available.',
    ],
  },
  grok: {
    normalizedStream: {
      text: { mode: 'unknown', stepwise: false },
      toolUse: 'unknown',
      toolResult: 'unknown',
      progress: 'unknown',
      reasoning: 'unknown',
    },
    transcript: {
      contentBlocks: 'unknown',
    },
    presentation: {
      recommended: 'unknown',
    },
    notes: [
      'Grok CLI subprocess and streaming behavior have not been probed yet.',
      'Treat Grok execution semantics as unknown until a verified compatibility profile exists.',
    ],
  },
  auggie: {
    normalizedStream: {
      text: { mode: 'final', stepwise: false },
      toolUse: 'none',
      toolResult: 'none',
      progress: 'none',
      reasoning: 'none',
    },
    transcript: {
      contentBlocks: 'none',
    },
    presentation: {
      recommended: 'final_message',
    },
    notes: [
      'The runtime currently only receives final-message style output from Auggie.',
    ],
  },
  opencode: {
    normalizedStream: {
      text: { mode: 'final', stepwise: false },
      toolUse: 'native',
      toolResult: 'none',
      progress: 'none',
      reasoning: 'none',
    },
    transcript: {
      contentBlocks: 'none',
    },
    presentation: {
      recommended: 'content_blocks',
    },
    notes: [
      'OpenCode exposes live tool milestones but still resolves assistant text as final output.',
    ],
  },
  kilo: {
    normalizedStream: {
      text: { mode: 'final', stepwise: false },
      toolUse: 'native',
      toolResult: 'none',
      progress: 'none',
      reasoning: 'none',
    },
    transcript: {
      contentBlocks: 'none',
    },
    presentation: {
      recommended: 'content_blocks',
    },
    notes: [
      'Kilo exposes live tool milestones but still resolves assistant text as final output.',
    ],
  },
  pi: {
    normalizedStream: {
      text: { mode: 'chunk', stepwise: true },
      toolUse: 'native',
      toolResult: 'native',
      progress: 'native',
      reasoning: 'native',
    },
    transcript: {
      contentBlocks: 'none',
    },
    presentation: {
      recommended: 'content_blocks',
    },
    notes: [
      'Pi exposes the richest normalized CLI stream, including reasoning and tool results.',
    ],
  },
};

function cloneTemplate(
  template: ProviderEventCapabilityTemplate,
): ProviderEventCapabilityTemplate {
  return {
    normalizedStream: {
      text: { ...template.normalizedStream.text },
      toolUse: template.normalizedStream.toolUse,
      toolResult: template.normalizedStream.toolResult,
      progress: template.normalizedStream.progress,
      reasoning: template.normalizedStream.reasoning,
    },
    transcript: {
      contentBlocks: template.transcript.contentBlocks,
    },
    presentation: {
      recommended: template.presentation.recommended,
    },
    notes: [...template.notes],
  };
}

function buildUnknownBackendCapabilities(
  backend: BackendKind,
): ProviderEventCapabilityTemplate {
  return {
    ...cloneTemplate(UNKNOWN_EVENT_CAPABILITIES),
    notes: [`Runtime has not published a host-facing event capability classification for ${backend} targets yet.`],
  };
}

function resolveBaseTemplate(
  target: Pick<ProviderTargetDescriptor, 'providerName' | 'backend'>,
): ProviderEventCapabilityTemplate {
  if (target.backend === 'cli') {
    const template = CLI_PROVIDER_EVENT_CAPABILITIES[target.providerName];
    return template ? cloneTemplate(template) : cloneTemplate(UNKNOWN_EVENT_CAPABILITIES);
  }

  return buildUnknownBackendCapabilities(target.backend);
}

function buildValidation(
  latestProbeArtifact?: ProviderEvolutionLatestArtifactReadModel | null,
): ProviderEventCapabilityValidation | undefined {
  if (!latestProbeArtifact) {
    return undefined;
  }

  const snapshot = latestProbeArtifact.capabilitySnapshot;
  return {
    artifactId: latestProbeArtifact.artifactId,
    capturedAt: latestProbeArtifact.capturedAt,
    transport: latestProbeArtifact.transport,
    ...(latestProbeArtifact.runtimeMode ? { runtimeMode: latestProbeArtifact.runtimeMode } : {}),
    executionStatus: latestProbeArtifact.execution.status,
    observed: {
      incrementalText: snapshot.incrementalText.observed,
      toolUse: snapshot.toolUse.observed,
      toolResult: snapshot.toolResult.observed,
      progress: snapshot.progress.observed,
      finalResult: snapshot.finalResult.observed,
    },
  };
}

export function buildProviderEventCapabilityTruth(
  target: Pick<ProviderTargetDescriptor, 'providerName' | 'backend'>,
  latestProbeArtifact?: ProviderEvolutionLatestArtifactReadModel | null,
): ProviderEventCapabilityTruth {
  const template = resolveBaseTemplate(target);
  const validation = buildValidation(latestProbeArtifact);

  return {
    ...template,
    ...(validation ? { validation } : {}),
  };
}
