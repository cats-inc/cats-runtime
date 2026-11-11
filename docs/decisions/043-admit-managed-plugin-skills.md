# ADR-043: Admit managed Plugin skills through a fenced local host boundary

Status: Accepted for the Agency pilot (2026-09-29), extended to packaged Desktop
preview installation on the owner's request (2026-11-11).

Platform owns package installation, desired state and removal. Runtime accepts an
authenticated, versioned descriptor for instructions-only skills. Neither side
executes package hooks. This adds instruction delivery without introducing a
provider adapter or a second installer.

The isolated pilot uses `CATS_PLUGIN_POLICY=internal-experiment`. A Desktop host
with a verified preview bundle can instead pass `CATS_PLUGIN_POLICY=desktop-preview`
and explicit data directories, including its ordinary profile. Management requires a bearer key: the normal
Runtime API key when configured, otherwise `CATS_PLUGIN_MANAGEMENT_KEY`.
Descriptors identify the Platform profile, package digest and monotonic generation.
Thirty-second leases fence disconnected hosts. Expired generations cannot be renewed.
Runtime restart invalidates leases. An authenticated owner may restore the same
still-enabled generation only after a clean restart with no pending CLI lifetime
receipts. Disabled/mismatched generations and same-boot expiry are rejected;
explicit re-enable still creates a new generation. Restore changes no schema and
preserves all session/native exposure, so existing conversations remain usable
only when their original generation is valid. A restart never proves process exit.

Before delivery, Runtime atomically persists source exposure independently of the
session registry. Re-entry, fork and execution admission check this ledger. Removing
a requested skill or resetting a session does not erase exposure. Revoked contexts
require a new conversation with no transcript replay. History remains readable.

Active execution receipts are durable. Cancellation is a request, not stop proof;
only the owned child process closing (and its owned Codex host closing, when used)
clears a receipt. A completed model turn does not end the CLI lifetime.
Unresolved receipts after a process
crash keep removal pending. The pilot does not claim automatic orphan recovery.
This conservative limitation must be visible in Desktop.

The new state namespace starts at schema 1. Unknown or damaged state fails closed;
no existing format is migrated. Runtime built-in skill identities remain unchanged.
Managed skills have namespaced IDs and immutable provenance. Peer dispatch is not
supported. No package files are projected into user projects.

See SPEC-034 and PLAN-044. Public SDK, remote hosts, executable hooks and publication
remain outside this implementation.
