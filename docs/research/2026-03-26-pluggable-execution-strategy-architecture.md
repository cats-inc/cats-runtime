# Research Log: Pluggable Execution Strategy Architecture

Date: 2026-03-26
Topic: Pluggable agent execution strategies for cats-runtime
Last updated: 2026-03-26

## Sources

- Internal analysis: OpenManus ReActAgent / ToolCallAgent / PlanningFlow
  (`OpenManus/app/agent/`, `OpenManus/app/flow/`)
- Internal gap analysis:
  `cats/docs/research/2026-03-26-openmanus-killer-feature-gap-analysis.md`
- Academic references: ReAct (Yao et al. 2022), Tree of Thoughts
  (Yao et al. 2023), Reflexion (Shinn et al. 2023), DEPS (Wang et al. 2023)
- Internal discussion on PDCA applicability for agent execution loops

## Summary

cats-runtime's API and Agent backends currently lack a formalized agent
execution loop. CLI backends (Claude Code, Codex, etc.) own their own
loops, but API backends (Claude API, OpenAI, Gemini, Ollama) run through
cats-runtime directly with a simple tool-call handler that has no stuck
detection, no step limits, and no recovery semantics.

Rather than hardcoding a single execution pattern (e.g. ReAct), the
runtime should expose a **pluggable execution strategy** interface. This
allows different products (Chat, Work, Code) and different task types to
select the most appropriate execution pattern.

## Problem

The current API backend tool-call handling is a flat loop:

1. Send message to LLM
2. If response contains tool_calls, execute them
3. Send tool results back to LLM
4. Repeat until LLM produces a final response

This has no:

- Step limit enforcement
- Stuck detection (agent producing duplicate output)
- Graceful context overflow handling
- Tool output truncation policy
- Strategy-level structure (planning, evaluation, backtracking)

OpenManus demonstrates that even a simple ReAct loop with stuck detection
and step limits (~250 lines) dramatically improves reliability. But ReAct
is not the only valid pattern, and different task types benefit from
different strategies.

## Proposed Strategy Catalog

Each strategy implements the same `ExecutionStrategy` interface but has
different internal execution rhythms:

### SimpleToolCall (preserve existing behavior)

The current flat tool-call loop, wrapped as a strategy. No stuck detection,
no step limits. Exists for backward compatibility and simple single-turn
interactions.

### ReAct (Reasoning + Acting)

```
think → act → observe → think → act → observe → done
```

- Fine-grained: each iteration is one tool call
- Stuck detection via duplicate response tracking
- Step limit enforcement
- Best for: conversational interactions, reactive tasks, single-agent work

### PDCA (Plan-Do-Check-Act)

```
plan → do(multiple steps) → check(evaluate vs goal) → act(adjust or done)
```

- Coarse-grained: each cycle may include multiple tool calls
- Explicit evaluation phase (Check) against acceptance criteria
- Re-planning on Check failure
- Best for: quality-gated tasks, iterative refinement, structured workflows

### Tree of Thoughts (ToT)

```
branch → evaluate → prune → select → branch → ...
```

- Explores multiple solution paths
- Evaluates and prunes branches
- Selects best path or backtracks
- Most expensive but highest quality for complex reasoning
- Best for: complex implementation decisions, architectural exploration

### Plan-and-Execute

```
plan all steps → execute step 1 → execute step 2 → ... → re-plan if needed
```

- Upfront planning, sequential execution
- Re-planning triggered by step failure or new information
- Best for: multi-step tasks with clear decomposition

### DEPS (Describe, Explain, Plan, Select)

```
describe goal → explain constraints → plan approach → select action → execute
```

- Structured pre-execution reasoning
- Strong constraint awareness
- Best for: tasks with complex requirements or safety constraints

### Reflexion

```
ReAct loop → on failure: self-critique → write failure memory → retry with lessons
```

- ReAct with explicit self-critique on failure
- Maintains failure memory across retries
- More expensive than ReAct but learns from mistakes
- Best for: iterative code generation, debugging, tasks where the same
  mistake should not repeat

## Proposed Contract

### ExecutionStrategy Interface

```typescript
interface ExecutionStrategy {
  readonly name: string;
  execute(input: ExecutionStrategyInput): AsyncIterable<ExecutionEvent>;
}

interface ExecutionStrategyInput {
  goal: string;
  tools: ToolCatalog;
  context: MessageHistory;
  llm: LLMClient;
  constraints: ExecutionConstraints;
  acceptanceCriteria?: string;
  strategyContext?: Record<string, unknown>;
}

interface ExecutionConstraints {
  maxSteps: number;
  maxTokens?: number;
  stuckThreshold?: number;
  timeoutMs?: number;
}
```

### ExecutionEvent Types

```typescript
type ExecutionEvent =
  | { type: 'plan'; content: string }
  | { type: 'think'; content: string }
  | { type: 'act'; toolName: string; toolInput: unknown }
  | { type: 'observe'; toolName: string; toolResult: ToolResult }
  | { type: 'evaluate'; verdict: 'pass' | 'fail'; reasoning: string }
  | { type: 'replan'; reason: string; newPlan: string }
  | { type: 'branch'; branchId: string; description: string }
  | { type: 'prune'; branchId: string; reason: string }
  | { type: 'reflect'; failure: string; lesson: string }
  | { type: 'stuck'; duplicateCount: number; lastOutput: string }
  | { type: 'result'; content: string }
  | { type: 'error'; message: string }
```

### Integration with Streaming

`ExecutionEvent` maps naturally to the existing progress event contract
(SSE/NDJSON). Each event type can be normalized to a progress event for
the product layer to consume.

### Strategy Resolution

Strategy selection follows a three-layer fallback:

1. **Task-level override**: `CoreTaskRecord.metadata.strategyHint`
   (Boss Cat specifies when decomposing tasks)
2. **Cat skill profile**: `SKILL.md` declares preferred strategy
   (e.g. Coder Cat prefers Reflexion)
3. **Product default**: Chat=ReAct, Work=PDCA, Code=Reflexion
   (configurable per product)

The runtime resolves the strategy at session creation or task checkout
time. The product layer passes the hint; the runtime owns the registry
and instantiation.

## Scope Boundary

This architecture covers the **execution loop inside a single session**.
It does NOT cover:

- Task-level orchestration (owned by Cats Core task substrate)
- Cross-session plan management (owned by product layer)
- Fan-out / converge (owned by task substrate + Boss Cat)

The relationship is:

- **Task substrate** decides WHAT to execute and WHO executes it
- **ExecutionStrategy** decides HOW the assigned agent executes it
- **Product layer** decides which strategy to suggest

## Affected Code Paths

- `cats-runtime/src/backends/api/` — API backend transport (primary target)
- `cats-runtime/src/backends/agent/` — Agent backend adapter (secondary)
- `cats-runtime/src/core/types.ts` — ExecutionStrategy types
- Session creation and resume paths — strategy resolution

CLI backends are NOT affected. They own their execution loops.

## Relationship to OpenManus Gaps

This architecture addresses two gaps from the OpenManus killer-feature
gap analysis:

- **Gap 2: Agent Execution Loop with Stuck Detection** — each strategy
  implementation includes appropriate recovery semantics
- **Gap 6: Unified Tool Registry** — `ToolCatalog` in the strategy input
  is the natural place for a unified tool surface

## Suggested Next Steps

1. Draft an ADR for the ExecutionStrategy contract
2. Wrap existing API backend tool-call logic as `SimpleToolCallStrategy`
3. Implement `ReActStrategy` with stuck detection + step limit
4. Wire strategy resolution into session creation
5. Add product-level strategy defaults

---

*Research completed: 2026-03-26*
*Author: Claude*
