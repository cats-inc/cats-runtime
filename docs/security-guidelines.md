# Security Guidelines

> Internal security policies and best practices for development.

## Overview

This document outlines security practices for developers and AI agents working on this project.

## Sensitive Data Handling

### Never Commit

- API keys and secrets
- Passwords and credentials
- Private keys and certificates
- Personal identifiable information (PII)

### Environment Variables

```bash
# CORRECT: Use .env (not committed)
DATABASE_URL=postgresql://user:password@localhost/db

# Provide template in .env.example (committed)
DATABASE_URL=postgresql://user:password@localhost/db
```

### Pre-commit Check

Before committing, verify:
- [ ] No secrets in code
- [ ] No hardcoded credentials
- [ ] `.env` is in `.gitignore`

## Code Security

### Input Validation

- Validate all user inputs
- Sanitize data before database queries
- Use parameterized queries (prevent SQL injection)

### Authentication & Authorization

- `CATS_RUNTIME_API_KEY` protects host-facing runtime routes. Keep it distinct
  from any upstream provider secret.
- Remote API providers such as Anthropic, OpenAI, and Gemini should reference
  env names in the resolved `providers.yaml` config (default
  `~/.cats/runtime/providers.yaml`) (`api_key_env`, `organization_env`,
  `project_env`) rather than embedding secret values in config files.
- Peer execution uses a separate shared secret
  (`CATS_RUNTIME_PEER_SHARED_SECRET`), not the host-facing
  `CATS_RUNTIME_API_KEY`.
- If you expose runtime routes outside a fully trusted LAN, terminate TLS in
  front of `cats-runtime`; bearer-style host or peer credentials should not be
  sent over plaintext networks.

### Runtime-Specific Secret Boundaries

- Keep `.env.example` as placeholders only; never replace those entries with
  live secrets in git.
- Treat provider credentials independently:
  - `ANTHROPIC_API_KEY`
  - `OPENAI_API_KEY`
  - `OPENAI_ORG_ID`
  - `OPENAI_PROJECT_ID`
  - `GEMINI_API_KEY`
- Do not copy those values into `providers.yaml`, logs, retained probe
  artifacts, or setup reports.
- When adding diagnostics or evidence capture, prefer env-presence summaries and
  redacted header-name metadata over raw token values.

### Dependencies

- Keep dependencies updated
- Review security advisories
- Use lockfiles (`package-lock.json`, `poetry.lock`)

## Agent-Specific Rules

AI agents MUST NOT:

- Execute destructive commands (`rm -rf /`, `DROP DATABASE`, etc.)
- Access files outside project directory without explicit permission
- Commit secrets or credentials
- Disable security features

AI agents SHOULD:

- Flag potential security issues when reviewing code
- Suggest security improvements
- Follow principle of least privilege

## Incident Response

If a security issue is discovered:

1. Do not commit the vulnerability
2. Report to project maintainer
3. Document in `docs/decisions/` after resolution

## Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CWE Top 25](https://cwe.mitre.org/top25/)

---

*Last updated: YYYY-MM-DD*
