import type {
  SessionArtifact,
  SessionBranchLineage,
  SessionBranchMode,
  SessionContextTransplant,
  SessionInfo,
  SessionInvocationContext,
  SessionLineageNode,
} from '../types.js';

const BRANCH_METADATA_NAMESPACE = 'catsRuntime';

interface BranchMetadata {
  lineage?: SessionBranchLineage;
  transplant?: SessionContextTransplant;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneMetadata<T>(value: T): T {
  return structuredClone(value);
}

function toLineageNode(sessionId: string, provider: string): SessionLineageNode {
  return { sessionId, provider };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isSessionLineageNode(value: unknown): value is SessionLineageNode {
  return isRecord(value)
    && typeof value.sessionId === 'string'
    && typeof value.provider === 'string';
}

function isSessionBranchLineage(value: unknown): value is SessionBranchLineage {
  return isRecord(value)
    && typeof value.rootSessionId === 'string'
    && typeof value.parentSessionId === 'string'
    && (value.branchMode === 'native_fork' || value.branchMode === 'context_transplant')
    && typeof value.parentProvider === 'string'
    && typeof value.childProvider === 'string'
    && typeof value.createdAt === 'string'
    && typeof value.depth === 'number'
    && Array.isArray(value.chain)
    && value.chain.every(isSessionLineageNode);
}

function isSessionArtifact(value: unknown): value is SessionArtifact {
  return isRecord(value)
    && typeof value.id === 'string'
    && (value.kind === undefined || typeof value.kind === 'string')
    && (value.label === undefined || typeof value.label === 'string')
    && (value.path === undefined || typeof value.path === 'string')
    && (value.uri === undefined || typeof value.uri === 'string')
    && (value.mediaType === undefined || typeof value.mediaType === 'string')
    && (value.createdAt === undefined || typeof value.createdAt === 'string')
    && (value.sizeBytes === undefined || typeof value.sizeBytes === 'number')
    && (value.metadata === undefined || isRecord(value.metadata));
}

function isTranscriptExcerptEntry(value: unknown): value is NonNullable<SessionContextTransplant['transcriptExcerpt']>[number] {
  return isRecord(value)
    && (value.role === 'user' || value.role === 'assistant')
    && typeof value.content === 'string';
}

function isSessionContextTransplant(value: unknown): value is SessionContextTransplant {
  return isRecord(value)
    && (value.summary === undefined || typeof value.summary === 'string')
    && (value.checkpoint === undefined || typeof value.checkpoint === 'string')
    && (value.transcriptExcerpt === undefined
      || (Array.isArray(value.transcriptExcerpt) && value.transcriptExcerpt.every(isTranscriptExcerptEntry)))
    && (value.structuredBlocks === undefined || Array.isArray(value.structuredBlocks))
    && (value.artifacts === undefined || (Array.isArray(value.artifacts) && value.artifacts.every(isSessionArtifact)))
    && (value.labels === undefined || isStringArray(value.labels))
    && (value.metadata === undefined || isRecord(value.metadata));
}

function extractBranchMetadata(
  context?: SessionInvocationContext,
): BranchMetadata | undefined {
  if (!isRecord(context?.metadata)) {
    return undefined;
  }

  const namespace = context.metadata[BRANCH_METADATA_NAMESPACE];
  if (!isRecord(namespace)) {
    return undefined;
  }

  const lineage = namespace.lineage;
  const transplant = namespace.transplant;

  return {
    lineage: isSessionBranchLineage(lineage) ? lineage : undefined,
    transplant: isSessionContextTransplant(transplant) ? transplant : undefined,
  };
}

export function getSessionLineage(
  session: Pick<SessionInfo, 'context'>,
): SessionBranchLineage | undefined {
  return extractBranchMetadata(session.context)?.lineage;
}

export function getSessionContextTransplant(
  session: Pick<SessionInfo, 'context'>,
): SessionContextTransplant | undefined {
  return extractBranchMetadata(session.context)?.transplant;
}

function mergeLabels(
  ...sources: Array<string[] | undefined>
): string[] | undefined {
  const merged = new Set<string>();
  for (const source of sources) {
    for (const label of source || []) {
      const normalized = label.trim();
      if (normalized) {
        merged.add(normalized);
      }
    }
  }

  return merged.size > 0 ? Array.from(merged) : undefined;
}

function mergeMetadata(
  base?: Record<string, unknown>,
  override?: Record<string, unknown>,
  branch?: BranchMetadata,
): Record<string, unknown> | undefined {
  const merged: Record<string, unknown> = {
    ...(base ? cloneMetadata(base) : {}),
    ...(override ? cloneMetadata(override) : {}),
  };

  if (branch) {
    merged[BRANCH_METADATA_NAMESPACE] = cloneMetadata({
      ...(isRecord(merged[BRANCH_METADATA_NAMESPACE])
        ? merged[BRANCH_METADATA_NAMESPACE] as Record<string, unknown>
        : {}),
      ...(branch.lineage ? { lineage: branch.lineage } : {}),
      ...(branch.transplant ? { transplant: branch.transplant } : {}),
    });
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function mergeInvocationContext(
  base?: SessionInvocationContext,
  override?: SessionInvocationContext,
): SessionInvocationContext | undefined {
  const merged: SessionInvocationContext = {
    source: override?.source ?? base?.source,
    reason: override?.reason ?? base?.reason,
    taskId: override?.taskId ?? base?.taskId,
    issueId: override?.issueId ?? base?.issueId,
    commentId: override?.commentId ?? base?.commentId,
    approvalId: override?.approvalId ?? base?.approvalId,
    workspace: override?.workspace
      ? cloneMetadata(override.workspace)
      : base?.workspace
        ? cloneMetadata(base.workspace)
        : undefined,
    labels: mergeLabels(base?.labels, override?.labels),
    metadata: mergeMetadata(base?.metadata, override?.metadata),
  };

  return Object.values(merged).some((entry) => entry !== undefined)
    ? merged
    : undefined;
}

function describeArtifacts(artifacts: SessionArtifact[] | undefined): string[] {
  return (artifacts || []).map((artifact) => {
    const location = artifact.path || artifact.uri || artifact.id;
    return artifact.label ? `- ${artifact.label}: ${location}` : `- ${location}`;
  });
}

function describeStructuredBlocks(blocks: unknown[] | undefined): string[] {
  return (blocks || []).map((block) => `- ${JSON.stringify(block)}`);
}

function renderTranscriptExcerpt(
  excerpt: SessionContextTransplant['transcriptExcerpt'],
): string[] {
  return (excerpt || []).map((entry) => `- ${entry.role.toUpperCase()}: ${entry.content}`);
}

export function buildDefaultContextTransplant(
  session: Pick<
    SessionInfo,
    'id'
    | 'providerName'
    | 'summary'
    | 'messageCount'
    | 'lastActivity'
    | 'artifacts'
    | 'context'
  >,
  transplant?: SessionContextTransplant,
): SessionContextTransplant {
  const fallbackSummary = [
    `Parent session: ${session.id}`,
    `Parent provider: ${session.providerName}`,
    session.summary ? `Summary: ${session.summary}` : undefined,
    session.messageCount > 0 ? `Observed messages: ${session.messageCount}` : undefined,
    session.lastActivity ? `Last activity: ${session.lastActivity}` : undefined,
  ].filter((line): line is string => Boolean(line)).join('\n');

  return {
    summary: transplant?.summary || fallbackSummary,
    checkpoint: transplant?.checkpoint,
    transcriptExcerpt: transplant?.transcriptExcerpt,
    structuredBlocks: transplant?.structuredBlocks,
    artifacts: transplant?.artifacts ?? session.artifacts,
    labels: mergeLabels(session.context?.labels, transplant?.labels),
    metadata: mergeMetadata(session.context?.metadata, transplant?.metadata),
  };
}

export function buildContextTransplantInstructions(
  baseInstructions: string | undefined,
  transplant: SessionContextTransplant,
): string | undefined {
  const sections: string[] = [];
  if (transplant.summary) {
    sections.push(`Summary:\n${transplant.summary}`);
  }
  if (transplant.checkpoint) {
    sections.push(`Checkpoint:\n${transplant.checkpoint}`);
  }

  const excerpt = renderTranscriptExcerpt(transplant.transcriptExcerpt);
  if (excerpt.length > 0) {
    sections.push(`Transcript excerpt:\n${excerpt.join('\n')}`);
  }

  const artifacts = describeArtifacts(transplant.artifacts);
  if (artifacts.length > 0) {
    sections.push(`Artifacts:\n${artifacts.join('\n')}`);
  }

  const structuredBlocks = describeStructuredBlocks(transplant.structuredBlocks);
  if (structuredBlocks.length > 0) {
    sections.push(`Structured blocks:\n${structuredBlocks.join('\n')}`);
  }

  if (sections.length === 0) {
    return baseInstructions;
  }

  const transplantBlock = [
    'Context transplant bundle:',
    sections.join('\n\n'),
  ].join('\n\n');

  return [baseInstructions, transplantBlock]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join('\n\n');
}

export function buildChildLineage(input: {
  childSessionId: string;
  childProvider: string;
  parentSession: Pick<SessionInfo, 'id' | 'providerName' | 'context'>;
  branchMode: SessionBranchMode;
  createdAt?: string;
}): SessionBranchLineage {
  const parentLineage = getSessionLineage(input.parentSession);
  const parentChain = parentLineage?.chain?.length
    ? parentLineage.chain
    : [toLineageNode(input.parentSession.id, input.parentSession.providerName)];
  const chain = [
    ...parentChain,
    toLineageNode(input.childSessionId, input.childProvider),
  ];

  return {
    rootSessionId: chain[0].sessionId,
    parentSessionId: input.parentSession.id,
    branchMode: input.branchMode,
    parentProvider: input.parentSession.providerName,
    childProvider: input.childProvider,
    createdAt: input.createdAt || new Date().toISOString(),
    depth: chain.length - 1,
    chain,
  };
}

export function attachBranchMetadata(
  baseContext: SessionInvocationContext | undefined,
  overrideContext: SessionInvocationContext | undefined,
  lineage: SessionBranchLineage,
  transplant?: SessionContextTransplant,
): SessionInvocationContext | undefined {
  const merged = mergeInvocationContext(baseContext, overrideContext) || {};
  const labels = mergeLabels(
    merged.labels,
    transplant?.labels,
  );
  const metadata = mergeMetadata(
    merged.metadata,
    transplant?.metadata,
    { lineage, transplant },
  );

  const context: SessionInvocationContext = {
    ...merged,
    labels,
    metadata,
  };

  return Object.values(context).some((entry) => entry !== undefined)
    ? context
    : undefined;
}
