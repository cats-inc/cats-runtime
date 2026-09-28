# SPEC-034: Internal managed Plugin skills

- `GET /plugins/managed` returns protocol 1, Runtime identity and observed state.
- `PUT /plugins/managed` accepts a bounded descriptor: hostId, id, version, digest,
  generation, enabled and skills (ID and Markdown body). Runtime checks the pinned
  Markdown fingerprints and derives metadata itself. The body limit is 128,000 bytes.
- `POST /plugins/managed/renew` renews the exact live identity only.
- Disabled descriptors fence synchronously before collecting affected session IDs.
  Platform confirms the impact before cancellation through `POST /plugins/managed/stop`.
- Generation reuse with different contents, profile takeover, invalid skills,
  stale writes, expired renewal and missing authentication are rejected.
- Only the reviewed Agency artifact digest and its two skill fingerprints are
  accepted by the pilot. The allowlist belongs to the host, not the artifact.
- Runtime catalog and manifest resolution use the same live registry. Managed
  skills use instruction delivery and never overwrite built-in or manual skills.
- Durable exposure and run receipts precede execution. Revoked provenance blocks
  resume/fork/reset reuse and stale cached instruction reconstruction.
- Actual owned process close is required before reporting a CLI lifetime stopped;
  result, cancellation request and synthetic exit events do not clear the receipt.
  Unknown receipts remain pending across restart. Read-only history still works.

These routes require an explicit bearer key and the experiment policy. A configured
Runtime API key takes precedence; otherwise the dedicated
`CATS_PLUGIN_MANAGEMENT_KEY` authenticates only management requests. It is removed
from provider child environments. Default-off hosts cannot register descriptors.

Delivery supports direct native Codex and Claude only. Shell wrappers, WSL, Docker
and peer dispatch are rejected. The descriptor is local host data, not a public SDK.
Exposure is persisted before instruction delivery and attached to discovered native
identities. Reset/fork and Platform conversation replay cannot erase it. An existing
ordinary CLI must be replaced by a fresh conversation to select managed skills.
Damaged state and unverifiable writer ownership fail closed. Crash orphan receipts
remain pending for operator recovery; restarting Desktop does not prove termination.
