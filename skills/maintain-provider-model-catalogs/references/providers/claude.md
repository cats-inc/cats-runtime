# Claude Catalog Evidence

Claude's authenticated interactive `/model` picker is the account-resolved model source. Capture
`/effort` separately for each selected model whose option axis matters; one model's values/default do
not establish another model's values/default.

The CLI has no stable `models` subcommand in the currently documented repository evidence. Static
strings extracted read-only from the installed native executable can reveal compiled aliases,
descriptions, filters, and option text, but they form a possible superset. They do not prove account
entitlement, picker visibility, raw selectable ids, or defaults. Label them `static-artifact` and let
a current picker paste override them.

Do not infer that `opus`, `sonnet`, or `haiku` aliases identify a visible generation without reading
the relevant normalizer and observed picker label. A compiled default or first row is not an account
default. Avoid platform-specific extraction commands unless the installed artifact and read-only tool
are first identified; retain exact CLI version/platform provenance.
