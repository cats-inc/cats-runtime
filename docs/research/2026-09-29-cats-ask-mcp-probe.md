# Cats Ask: MCP round trip and authenticated bookmarks probe

Date: 2026-09-29

## Scope and evidence

Ownership correction from the subsequent user discussion (2026-09-29): Ask owns
its frontends, backend APIs, question/answer data and MCP within one installable
App. Multiple frontend/backend components share that App's lifecycle; its private
API traffic uses ordinary web protocols. Platform supplies generic hosting,
routing and isolation, while Runtime remains optional shared execution substrate.
This standalone experiment's location does not assign production Ask services to
Runtime. Coordinated Platform ADR-125/SPEC-122/PLAN-115 and Apps ADR-003/SPEC-004/
PLAN-005 record this boundary; component hosting is not implemented.

The user authorized preparing a reachable standalone MCP test endpoint so their
Grok Bot can retrieve a question and return an answer before building the full
Cats Ask App. The governing App scope is [cats-apps ADR-003](https://github.com/cats-inc/cats-apps/blob/main/docs/decisions/003-delegate-personal-questions-to-first-party-assistants.md),
[SPEC-004](https://github.com/cats-inc/cats-apps/blob/main/docs/specs/SPEC-004-personal-assistant-questions-mvp.md)
and [PLAN-005](https://github.com/cats-inc/cats-apps/blob/main/docs/plans/PLAN-005-personal-assistant-questions-mvp.md).
This experiment tries Grok Bot first. Both the synthetic round trip and the
authenticated bookmarks answer have now been correlated with server receipts.
The App documents linked above remain the original baseline; this note records
the subsequent acceptance evidence and its limits.

The user supplied their actual Bot's tool description: `cursor.AddMcpServer`
accepts `name` and either remote `url` or local `command` with optional
`args`/`env`. Remote configuration also exposes `headers` and preregistered OAuth
`auth.CLIENT_ID`. The subsequent synthetic call verifies `name`/`url` registration
and tool delivery for that Bot. The bookmarks submission also verifies that its
static bearer header reaches Cats. OAuth remains unverified. The Bot settings
page had no custom MCP control. Grok web, Grok Build
and the model API are not substitutes for the requested Bot/X Connector identity.

## Implementation

The uncommitted experiment in the local `spike/ask-mcp-probe` worktree contains
an isolated private package under `scripts/ask-mcp-probe`, using the official MCP
TypeScript SDK 1.31.0, resolved from npm on this date. Dependencies and lockfile
are local to the experiment. Runtime's dependencies, API, npm exports and version
are unchanged. That worktree's root test configuration excludes this package, whose SDK is
installed and tested independently. This is temporary evidence tooling under the existing App ADR,
not adoption of the SDK in Runtime's production MCP server.

- Stateless Streamable HTTP with per-request server/transport instances.
- Default synthetic mode has exactly two tools: issue a challenge and submit its exact answer.
- Random request ID/challenge, bounded body/answer/question count/request rate,
  idempotent receipt ID, and no false success when receipt recording fails.
- Loopback listener on an OS-assigned configurable port; optional ngrok HTTPS
  tunnel rewrites Host. Browser Origins are rejected; traffic inspection is off.
- Four-hour default expiry, launcher stops the other child on normal child exit.
  Forced launcher termination requires explicit child-first cleanup.
- No filesystem/shell/runtime MCP tools or remote reading of received answers.
- Optional `x-connector` mode uses a generated 32-byte bearer token for every MCP
  request and exposes only a fixed bookmarks inquiry plus a bounded answer sink.
  It stores one answer in ignored local state, supports identical retries and
  rejects conflicting retries. No provider credentials are collected.

The experiment's local README records build, start, verification, Bot prompt and
stop commands. Its executable files, test-configuration change and README remain
with that uncommitted prototype; this documentation-only delivery does not make
the probe available from a main checkout. Live URLs, process IDs and receipt
records stay in ignored local state, not tracked documentation.

## Validation checkpoint

- TypeScript build passed on Windows, Node 24.21.0.
- Focused Vitest 3.2.7: 5 tests passed (HTTP/MCP round trip, exact tool surface,
  duplicate/concurrent submission, invalid/oversized data, sink failure, HTTP
  restrictions and expiry). The sandbox blocked esbuild spawn; rerun outside
  the sandbox passed. This is not a full Runtime test-suite result.
- The focused repository documentation-boundary test passed (1 test) after
  excluding this independently installed experiment from root test discovery.
- Independent read-only review found no round-trip blocker. Its forced-launcher
  cleanup finding was addressed in the launcher help and manual stop guide.
- Installed ngrok 3.3.1 was rejected with `ERR_NGROK_121`; the account requires
  3.20.0 or newer. The failed launch stopped the synthetic server as intended.
- Public HTTPS preflight passed with isolated ngrok 3.39.11: an official SDK
  client initialized over the public URL, listed exactly the two tools, retrieved
  the synthetic question and submitted its exact answer. The returned request ID
  and receipt ID matched the local `answer_received` record. No special HTTP
  headers or authentication were needed for that client.
- Grok Bot synthetic registration/read/submit confirmed by matching the user's
  returned IDs and exact challenge to local events. The question was issued at
  2026-09-29 09:58:12 and the answer received at 09:58:18 (Asia/Taipei), distinct
  from the SDK preflight. The reply was accepted once (`duplicate: false`).
- Authenticated bookmarks mode: TypeScript build and 10 focused tests passed
  (5 synthetic, 5 authenticated inquiry). Independent review found no blocker.
  Public HTTPS preflight rejected both absent and incorrect credentials with
  HTTP 401, then initialized/listed/read the fixed question with the generated
  bearer credential. It did not submit an answer.
- At 2026-09-29 10:27:36 (Asia/Taipei), the authenticated endpoint received the
  Bot's answer. Its request ID and receipt ID exactly match the user's pasted
  tool result. The persisted answer contains the connected account, three source
  URLs, summaries, identity/order evidence and limitations. The submitted status
  is `answered`; the record is retained as received.
- The user reports actual `get_users_me` and `get_users_bookmarks` calls; the
  answer describes using the same connected user ID for both and requesting three
  bookmarks. This native-call evidence is user/Bot-reported, not independently
  instrumented by Cats. Cats independently observes authenticated submission and
  persistence, including the three source URLs matching the user's report.
- Most-recent-save ordering is **not independently established**: the stored
  `bookmarkOrderEvidence` and `limitations` explicitly infer it from returned
  array order, with no bookmark save timestamp. Keep that requirement partially
  verified despite the Bot's reported `answered` status. Do not relabel inferred
  order as documented connector semantics.
- Video understanding is **unverified**: the Bot explicitly says it summarized
  the accompanying post text, not the videos.

The preflight client identifies itself as `cats-ask-preflight` and prints a
receipt ID. That result must not be counted as Grok Bot acceptance. Correlate a
later Bot tool result's request/receipt IDs with local `events.jsonl`.

## Completed inquiry: the user's three latest saved bookmarks

The user corrected the next inquiry: they have never posted on X, and want the
three latest bookmarks. The actual fixed MCP question therefore asks the Bot's
connected X Connector for the user's **most recently saved** bookmarks. Publication
date is not a substitute for bookmark save order. Record the actual connector's
account binding, bookmark membership and ordering evidence; an unavailable save
timestamp must remain unknown. If newest-saved-first order cannot be established,
use `partial` and explain the limitation.

Only concise summaries, authors, known dates, up to three canonical post URLs,
and the evidence/limitations are submitted. The generated credential and received
private data stay outside tracked files. The public preflight does not fill this
single answer slot. An `accepted` receipt establishes storage, not truth of the
Bot's account/data claims; match it to actual connector calls and user validation.

## Product consequence and remaining scope

For this user's tested Bot, a private custom MCP connection can retrieve a Cats
question and submit the result of a user-authorized X Connector query. No plugin
marketplace listing was required in this test. This supports starting the Cats
Ask MVP with Grok Bot and a user-triggered asynchronous question/answer flow.
It does not establish availability in every account or client version.

The test was manually started in Grok Bot. It does not prove that Cats can wake
the Bot, push a question into a new turn, or make the Bot poll in the background.
The App UI, arbitrary question queue, Copy action, production authentication and
durable product answer storage remain implementation work. Gemini Spark, Meta AI,
OAuth, video analysis and independent recency validation remain separate probes.

Raw account identifiers, bookmark URLs, answer text, receipt IDs and credentials
remain in ignored local run files. Tracked documentation retains only the
non-personal acceptance summary. After verification, the temporary tunnel and
its probe were stopped at 2026-09-29 10:30:43 (Asia/Taipei). The supervisor's
cleanup marker confirms shutdown; local receipt evidence was retained.

## Follow-up: direct X MCP from Cursor CLI

The user asked whether `cursor-agent` could use the same X capability directly.
Public primary sources reveal a concrete alternative to Bot-mediated retrieval:

- The [official Cursor X plugin](https://cursor.com/marketplace/cursor/x) includes
  bookmark tools. Its [pinned MCP configuration](https://github.com/cursor/plugins/blob/ecc249f1e306fc64ddf83c7bed16cacf7c2239db/third_party/x/mcp.json)
  declares `https://api.x.com/mcp`, an HTTP transport, a preregistered OAuth client
  ID and scopes including `users.read` and `bookmark.read`. The full plugin also
  requests write/chat/billing scopes; do not silently treat that full grant as a
  read-only bookmarks authorization.
- [Cursor CLI MCP documentation](https://cursor.com/docs/cli/mcp) supports local
  MCP configuration, tool enumeration and OAuth login. This establishes a
  configuration route, not successful CLI/X authorization in this environment.
- Local `cursor-agent --version` returned `2026.09.26-dd393fe`; `mcp --help`
  exposed list/list-tools/login. Initially, `mcp list` returned no configured
  servers. Subsequent user-authorized configuration and OAuth results are below;
  this does not demonstrate reuse of the Bot's account connection.
- The [X plugin guide](https://github.com/cursor/plugins/blob/ecc249f1e306fc64ddf83c7bed16cacf7c2239db/third_party/x/skills/x-api-mcp-guide/SKILL.md)
  describes OAuth connection, `get_users_me`, `get_usage_credits` and user-ID-bound
  bookmarks. X usage credits are a separate consideration; a successful Bot
  subscription does not establish unlimited free MCP use.

If the CLI can complete the X provider's OAuth flow and retrieve the same
bookmarks, Cats could invoke its existing Cursor CLI backend and receive results
through that process. Manual Bot kickoff and a public answer callback would no
longer be needed for this route. This is an architectural inference pending that
specific acceptance test. CLI OAuth redirect compatibility has since passed,
but data access and the existing Bot grant's portability have not. A Cats-native
MCP client is another candidate but has its own OAuth client-registration
acceptance boundary.
Keep the successful Bot probe as evidence, while evaluating this simpler route
before committing the X MVP to Bot-only orchestration.

### Local OAuth acceptance and data-access failure

At the user's request, the previously absent global Cursor MCP configuration
was created with the official plugin's public preregistered client ID and only
`tweet.read`, `users.read`, `bookmark.read`, and `offline.access`. The user
completed `cursor-agent mcp enable x` and `cursor-agent mcp login x`; the CLI
reported a successful authorization-code callback. The consent page identified
the application as **Grok Bot**, by Cursor. The displayed application name is
consistent with the configured OAuth client identity; it does not establish a
restriction on which MCP client can use the endpoint.

The installed CLI persists MCP credentials per project even when the server
definition is global. Initial checks from this research worktree therefore
reported `requires_authentication`. Repeating `cursor-agent mcp list-tools x`
from the parent workspace where the user authorized X succeeded (exit 0) and
listed **41 tools**, including current-user, usage-credit and bookmark reads.
Do not copy tokens between projects to make an acceptance check pass.

The user's subsequent Cursor CLI conversation called `get_users_me` and
`get_usage_credits`. Read-only inspection of that specific conversation's local
tool results confirmed both returned `Client Forbidden`, reason
`client-not-enrolled`, and a requirement for an eligible developer App attached
to a Project. No bookmark read succeeded in this CLI test. The error concerns
the application behind the presented token; it does not by itself establish
that creating an unrelated App under the user's account would fix this shared
client configuration. The agent's developer/Project/App advice matches the
official plugin guide's generic enrollment-error response.

The [official X MCP documentation](https://docs.x.com/tools/mcp) separately
describes a general integration using one's own developer App with user-context
OAuth via `xurl`, as well as app-only Bearer access without user context. The
official Cursor plugin guide describes automatic developer-account provisioning
and starter credits in its managed connection flow. Whether that provisioning,
additional scopes, or other host context explains the successful Bot versus
failed local CLI remains **unverified**. Our four-scope grant deliberately differs
from the plugin's full grant, which also includes developer/billing write access;
do not silently expand permissions or present a scope change as a proven fix.

Current acceptance: OAuth callback and MCP discovery **passed**; authenticated
X data retrieval through the local CLI **blocked by application enrollment**.
The prior Bot bookmark probe remains the demonstrated retrieval path. No new
developer account, paid credit purchase, or expanded OAuth grant was performed.

## Sources

- [Official SDK stateless example](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/examples/server/simpleStatelessStreamableHttp.ts)
  informs per-request transport lifetime; the installed SDK is the executable
  authority for this version.
- [Official ngrok Windows download](https://ngrok.com/download/windows)
  supplies an isolated current Windows executable when the installed one fails.

Last updated: 2026-09-29
