# CLI provider branches outside the adapters

Date: 2026-09-29. Scope: code outside `src/backends/cli/providers/` and the per-provider
directories that branches on a CLI provider's name. Measured at `d1cd9ae`. The owner asked
for a reminder of where to refine later; nothing here is scheduled or approved.

## Why this is a refinement, not a redesign

The layering is sound and the rules already say where provider knowledge belongs:
- provider-specific types stay in the owning `src/backends/*` adapter (AGENTS.md, Coding
  Conventions);
- provider failures are normalized in the adapter rather than escaping into `core/` or `http/`
  (AGENTS.md, Error Handling);
- agent adapters register in `src/backends/agent/adapters/registry.ts` "instead of branching in
  `RuntimeSessionManager` or HTTP routes" ([architecture](../architecture.md), Adding a
  Third-Party Agent Adapter).

The CLI side has no equivalent of that registry for anything beyond launching a turn. The
`Provider` interface in `src/backends/cli/providers/types.ts` covers spawn arguments, stdin,
stream parsing and turn hooks, so every other per-provider behaviour was added as a name check
where it was needed. Nothing here is a known bug. The cost is that adding or changing a CLI
provider means editing `http/` and `core/` files as well as its adapter.

## Measurement

238 lines at `d1cd9ae`, by layer:
- `src/http/`: 67 (`routes/sessions.ts` 48, `routes/history.ts` 10,
  `sessionProviderTarget.ts` 6, `routes/messages.ts` 3). These break the stated rules.
- `src/core/`: 37 (`compatibility/providerEvolutionEntry.ts` 14,
  `models/providerModelCatalog.ts` 6, `bootstrap/ProviderSelectionService.ts` 4,
  `usage/usageSnapshot.ts` 3, and 1 or 2 each in `RuntimeMeteringService.ts`,
  `skills/catalog.ts`, `runtime/sessionWakeup.ts`, `runtime/WorkspaceSubstrateService.ts`,
  `runtime/sessionBranching.ts` and `providerActiveConfig.ts`). These also break the stated
  rules.
- `src/server.ts`: 12. It is the composition root, so wiring is expected there, but quota and
  discovery dispatch by name is provider knowledge.
- `src/backends/cli/` outside the adapters: 115 (`config.ts` 72, `pool/WorkerPool.ts` 16,
  `pool/sessionView.ts` 12, `runtime/` 11, `discovery/wslDiscovery.ts` 2,
  `pool/SessionRegistry.ts` 1, `pool/WorkerProcess.ts` 1). This is inside the backend layer,
  so it is not a breach, but a per-provider module would absorb most of it.
- `src/backends/agent/`: 7, the declarative ACP profile mapping. Fine as is.

Re-measure from the repository root:

```sh
P='(claude|codex|antigravity|cursor|copilot|opencode|kilo|goose|pi|auggie|junie|kiro|grok|cline|devin|muse)'
grep -rnE "(providerName|provider|name) (===|!==) '$P'|case '$P':" src --include=*.ts \
  | grep -v '\.test\.ts' \
  | grep -vE "src/backends/cli/(providers|pi|kiro|kilo|goose|cursor|opencode|junie|auggie)/"
```

It is an indicator, not an exact count. It misses double-quoted names, `.includes(...)`, set or
map membership, and provider-named service getters that `http/` imports directly
(`getCursorNative`, `getAuggieSessions` and similar in `routes/sessions.ts`).

## Where to refine

Function names are stable anchors; line numbers drift.

1. **Native session handling (largest cluster).** This covers where each CLI keeps its own
   sessions, and how Runtime lists, reads, resumes, clones and deletes them.
   - `http/routes/sessions.ts`: `listManualDiscoverySessions`,
     `tracksNativeSessionState`, `tracksProviderDiscoveryState`,
     `scanProviderDiscoveryArtifactsForDelete`.
   - `http/routes/history.ts`: the per-provider history loaders (Cursor, Kiro, Kilo, Auggie,
     OpenCode, and file-backed Cline, Grok, Muse and Pi).
   - `http/routes/messages.ts`: `recoverPiUnknownSession`.
   - `http/sessionProviderTarget.ts`: `buildFallbackCapabilities`.
   - `core/runtime/sessionWakeup.ts`: `ensureSessionAwake`; `core/runtime/sessionBranching.ts`.
   - `backends/cli/pool/sessionView.ts`: `sessionOwnership`; `pool/SessionRegistry.ts`.
   - `backends/cli/config.ts`: the per-provider session locations (`*SessionsDir`,
     `claudeProjectsDir`, `cursorChatsDir`, `kiroDbPath`), repeated in four blocks.
2. **Per-provider services chosen by name.**
   - Quota readers: the quota `collect` callback in `server.ts`; `core/usage/usageSnapshot.ts`
     `supportsQuotaRefresh`.
   - Live model discovery: `core/models/providerModelCatalog.ts` (Cursor, Junie, Pi, OpenCode,
     Kilo).
   - Provider evolution probes: `core/compatibility/providerEvolutionEntry.ts`.
   - Metering source: `core/usage/RuntimeMeteringService.ts` (Goose, Junie).
   - Discovery controller and labels: `server.ts` `createDiscoveryController`;
     `backends/cli/discovery/wslDiscovery.ts`.
   - Kilo and OpenCode local server settings in `backends/cli/config.ts`.
3. **Skill and workspace delivery.** `core/skills/catalog.ts` (Codex, Pi) and
   `core/runtime/WorkspaceSubstrateService.ts` (Claude, Codex).

## Leave as is

These are not defects; do not "fix" them while refining the list above:
- `KNOWN_PROVIDERS` and other provider lists.
- Data tables: install knowledge, compatibility knowledge, catalog bindings.
- ACP profiles in `backends/agent/adapters/acp/profiles.ts`.
- The provider factory switch in `backends/cli/pool/WorkerPool.ts`. It is a composition point.
  A registry like the agent adapters' one would be optional polish, not a fix.
- The Devin-to-ACP routing in `core/bootstrap/ProviderSelectionService.ts`.
- Launch policy in `backends/cli/runtime/` (`runtime.ts`, `providerProcessPolicy.ts`,
  `windowsCodexHost.ts`). It is platform launch behaviour inside the backend layer. Move it only
  if a per-provider module makes that natural.

## Candidate direction

This is not a decision. Give the CLI provider module optional capabilities next to `Provider`:
- native sessions: locate, list, read history, resume, clone, delete artifacts, ownership;
- `readQuota`, `discoverModels` and `probeEvolution`;
- a provider-owned config section in place of the flat `*SessionsDir` and server fields.

Then `http/` and `core/` ask the provider for a capability instead of checking its name. The
pre-release policy allows this as one cut, with no aliases or shims. If it is picked up, record
the shape in an ADR first.

This is internal module consolidation. It does not make the built-in CLIs installable Plugins.
Under cats-platform ADR-122, provider Plugins stay protocol-based (ACP and similar), where a
provider is a descriptor rather than bespoke parsing and session code.

## When to pick this up

- Before adding a 17th CLI provider.
- The next time a provider's native session handling changes (history, resume, delete or
  discovery).
- Before any CLI provider is moved into its own package.
