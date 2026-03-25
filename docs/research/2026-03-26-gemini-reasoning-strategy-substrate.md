# Research Log: Gemini Reasoning Strategy Substrate

Date: 2026-03-26
Topic: Decoupling Reasoning Patterns from Tool Execution via Pluggable Strategies
Status: Proposal

## Overview

As the Cats Suite transitions to multi-product usage (Chat, Work, Code), the runtime must support diverse "thinking modes." A simple linear loop is insufficient for the high-stakes logic required in `Cats Code` or the process-heavy auditing in `Cats Work`.

This document proposes a decoupled architecture where the reasoning loop (the "Strategy") is a pluggable module that drives the runtime's execution services.

## The Strategy Interface

The core of this architecture is a standardized interface that allows `cats-runtime` to hand over control to a specialized strategy.

```typescript
interface ReasoningStrategy {
  id: string; // 'react' | 'tot' | 'pdca' | 'deps' | ...
  version: string;
  
  /**
   * Called when a session is initialized or resumed.
   * Allows the strategy to set up its private state (e.g., plan nodes).
   */
  onTaskBound(task: CoreTaskRecord, env: ExecutionEnvironment): Promise<void>;
  
  /**
   * Executes a single discrete iteration of the reasoning loop.
   * Returns whether the session should continue, stop, or wait for human input.
   */
  next(task: CoreTaskRecord, env: ExecutionEnvironment): Promise<ExecutionStepResult>;
}
```

## Strategy Catalog (Targeted Reasoning)

We define 7 canonical strategies to be supported as first-class citizens:

1. **Linear**: High performance, zero reasoning overhead. Suitable for basic Q&A.
2. **ReAct**: Dynamic observation-based loop. The standard for tool-heavy Chat.
3. **ToT (Tree of Thoughts)**: Branching path exploration with automated scoring and backtracking. Essential for `Cats Code`.
4. **DEPS (Describe-Explain-Plan-Select)**: Context-rich loop for handling complex environment states.
5. **Reflexion**: Iterative self-critique loop. The agent reviews its own work (Check) before finalizing (Action).
6. **PDCA**: A management-heavy loop where every action must be preceded by a plan and followed by a validation check.
7. **Interactive-Guardian**: A safety-first mode that requires manual human confirmation for every tool execution.

## Strategy Resolution & Fallback

The runtime uses a three-tier resolution logic to determine the active strategy:

1. **Explicit Request**: Specified via prompt metadata or API flags (e.g., `execution_mode: 'tot'`).
2. **Product-Strategy Affinity**: Default mapping (e.g., `Cats Work` defaults to `PDCA`).
3. **Kernel Default**: System-wide fallback to `ReAct`.

## Integration with Persistent Task State

To ensure strategies are resumable, the `ReasoningStrategy` must serialize its specific internal state (e.g., the current "Tree" or "Plan") into the `CoreTaskRecord` metadata. This allows a session to be resumed on a different node or by a different strategy without loss of context.
