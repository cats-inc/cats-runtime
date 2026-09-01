# Kiro Catalog Evidence

Use authenticated `kiro-cli model list` output when it succeeds for the current account. Logged-out
or account-gated output proves only the gate; a newer `--version` does not refresh the model list.

`kiro-cli chat --effort` exposes an effort control, but a help-declared value range alone does not
prove picker visibility, per-model applicability, or the current default. Capture option behavior in
the selected model context before projecting it, and do not promote a CLI-wide flag declaration into
shared YAML when models may differ.

Keep native/WSL, channel, account, and CLI-version scope explicit. If runtime static fallback and the
account list disagree, report both and inspect resolution behavior rather than silently replacing one
with the other.
