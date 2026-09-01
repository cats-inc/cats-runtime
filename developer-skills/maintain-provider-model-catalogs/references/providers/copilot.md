# Copilot Catalog Evidence

Treat Copilot's interactive `/model` picker as account-resolved evidence. Current repository notes
record no complete machine-readable model enumeration: an invalid `--model` response and the shipped
bundle do not establish the full account list. Recheck the current CLI before relying on that
limitation, but do not turn help/version output into a refreshed list.

Capture provider grouping, visible model label, and each model's effort screen separately. A provider
group's shared option block may be represented as shared YAML only after the observed scope supports
that inheritance. Preserve models that expose no option separately from models whose options were
merely not captured.

The picker may be account-, organization-, rollout-, or region-dependent. Record that scope and
redact organization/account identifiers before saving or echoing output.
