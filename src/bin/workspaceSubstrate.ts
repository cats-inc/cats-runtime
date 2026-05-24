#!/usr/bin/env node

import { resolve } from 'node:path';
import process from 'node:process';

import { WorkspaceSubstrateService } from '../core/runtime/WorkspaceSubstrateService.js';
import type {
  WorkspaceSubstrateActorRole,
  WorkspaceSubstrateHints,
  WorkspaceSubstrateOperation,
  WorkspaceSubstrateProfileId,
  WorkspaceSubstrateRequest,
} from '../core/types.js';

const VALID_OPERATIONS = new Set<WorkspaceSubstrateOperation>([
  'audit-workspace',
  'init-workspace',
  'update-workspace',
]);
const VALID_PROFILES = new Set<WorkspaceSubstrateProfileId>([
  'minimal',
  'standard',
  'a2a-enabled',
]);
const VALID_PROJECT_TYPES = new Set<NonNullable<WorkspaceSubstrateHints['projectType']>>([
  'single-project',
  'monorepo',
]);
const VALID_AGENTS = new Set(['claude', 'antigravity', 'codex']);
const VALID_ACTOR_ROLES = new Set<WorkspaceSubstrateActorRole>([
  'boss_cat',
  'specialist_cat',
  'system',
  'owner',
  'product_host',
  'operator',
]);

function printUsage(): void {
  process.stdout.write(`cats-runtime workspace substrate helper

Usage:
  node build/runtime/bin/workspaceSubstrate.js --operation <audit|init|update> [options]

Options:
  --workspace-path <path>         Target workspace path (default: current dir)
  --operation <name>              audit|init|update or full substrate operation id
  --profile <id>                  minimal|standard|a2a-enabled
  --agent <id[,id...]>            claude|antigravity|codex (repeatable)
  --include-a2a                   Force A2A starter artifacts on
  --no-include-a2a                Force A2A starter artifacts off
  --apply                         Apply changes instead of preview only
  --approved                      Mark approval as already granted
  --actor-role <role>             boss_cat|specialist_cat|system|owner|product_host|operator
  --project-type <value>          Workspace hint for AGENTS.md metadata
  --purpose <value>               Workspace hint for AGENTS.md metadata
  --background <value>            Workspace hint for AGENTS.md metadata
  --technology-label <value>      Repeatable technology label hint
  --documentation-style <value>   Workspace hint for AGENTS.md metadata
  --help                          Show this message
`);
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function normalizeOperation(raw: string): WorkspaceSubstrateOperation {
  switch (raw) {
    case 'audit':
      return 'audit-workspace';
    case 'init':
      return 'init-workspace';
    case 'update':
      return 'update-workspace';
    default:
      if (VALID_OPERATIONS.has(raw as WorkspaceSubstrateOperation)) {
        return raw as WorkspaceSubstrateOperation;
      }
      throw new Error(`Unsupported operation '${raw}'`);
  }
}

function normalizeProfile(raw: string): WorkspaceSubstrateProfileId {
  if (VALID_PROFILES.has(raw as WorkspaceSubstrateProfileId)) {
    return raw as WorkspaceSubstrateProfileId;
  }
  throw new Error(`Unsupported profile '${raw}'`);
}

function normalizeAgent(raw: string): 'claude' | 'antigravity' | 'codex' {
  if (VALID_AGENTS.has(raw)) {
    return raw as 'claude' | 'antigravity' | 'codex';
  }
  throw new Error(`Unsupported agent '${raw}'`);
}

function normalizeActorRole(raw: string): WorkspaceSubstrateActorRole {
  if (VALID_ACTOR_ROLES.has(raw as WorkspaceSubstrateActorRole)) {
    return raw as WorkspaceSubstrateActorRole;
  }
  throw new Error(`Unsupported actor role '${raw}'`);
}

function normalizeProjectType(raw: string): NonNullable<WorkspaceSubstrateHints['projectType']> {
  if (VALID_PROJECT_TYPES.has(raw as NonNullable<WorkspaceSubstrateHints['projectType']>)) {
    return raw as NonNullable<WorkspaceSubstrateHints['projectType']>;
  }
  throw new Error(`Unsupported project type '${raw}'`);
}

function parseArgs(argv: string[]): WorkspaceSubstrateRequest {
  const request: WorkspaceSubstrateRequest = {
    workspacePath: resolve(process.cwd()),
    operation: 'audit-workspace',
  };
  const enabledAgents = new Set<'claude' | 'antigravity' | 'codex'>();
  const technologyLabels = new Set<string>();
  let operationExplicit = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--help':
        printUsage();
        process.exit(0);
      case '--workspace-path':
        request.workspacePath = resolve(requireValue(argv, index, arg));
        index += 1;
        break;
      case '--operation':
        request.operation = normalizeOperation(requireValue(argv, index, arg));
        operationExplicit = true;
        index += 1;
        break;
      case '--profile':
        request.profile = normalizeProfile(requireValue(argv, index, arg));
        index += 1;
        break;
      case '--agent': {
        const raw = requireValue(argv, index, arg);
        for (const value of raw.split(',')) {
          const trimmed = value.trim();
          if (trimmed.length === 0) {
            continue;
          }
          enabledAgents.add(normalizeAgent(trimmed));
        }
        index += 1;
        break;
      }
      case '--include-a2a':
        request.includeA2A = true;
        break;
      case '--no-include-a2a':
        request.includeA2A = false;
        break;
      case '--apply':
        request.apply = true;
        break;
      case '--approved':
        request.authorization = {
          ...request.authorization,
          approved: true,
        };
        break;
      case '--actor-role':
        request.authorization = {
          ...request.authorization,
          actorRole: normalizeActorRole(requireValue(argv, index, arg)),
        };
        index += 1;
        break;
      case '--project-type':
        request.hints = {
          ...request.hints,
          projectType: normalizeProjectType(requireValue(argv, index, arg)),
        };
        index += 1;
        break;
      case '--purpose':
        request.hints = {
          ...request.hints,
          purpose: requireValue(argv, index, arg),
        };
        index += 1;
        break;
      case '--background':
        request.hints = {
          ...request.hints,
          background: requireValue(argv, index, arg),
        };
        index += 1;
        break;
      case '--technology-label':
        technologyLabels.add(requireValue(argv, index, arg));
        index += 1;
        break;
      case '--documentation-style':
        request.hints = {
          ...request.hints,
          documentationStyle: requireValue(argv, index, arg),
        };
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument '${arg}'`);
    }
  }

  if (!operationExplicit) {
    throw new Error('--operation is required');
  }
  if (enabledAgents.size > 0) {
    request.enabledAgents = Array.from(enabledAgents);
  }
  if (technologyLabels.size > 0) {
    request.hints = {
      ...request.hints,
      technologyLabels: Array.from(technologyLabels),
    };
  }

  return request;
}

try {
  const request = parseArgs(process.argv.slice(2));
  const service = new WorkspaceSubstrateService();
  const result = await service.execute(request);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[cats-runtime workspace] ${message}\n`);
  process.exitCode = 1;
}
