# npm Trusted Publishing Readiness

Date: 2026-04-07

Topic: Repo-owned and external prerequisites for `cats-runtime` npm trusted
publishing.

Sources:

- npm Docs, "Trusted publishing for npm packages"
  (`https://docs.npmjs.com/trusted-publishers/`)
- npm Docs, "Generating provenance statements"
  (`https://docs.npmjs.com/generating-provenance-statements/`)
- GitHub Docs, "Publishing Node.js packages"
  (`https://docs.github.com/en/actions/tutorials/publish-packages/publish-nodejs-packages`)

Summary:

- npm trusted publishing currently requires npm CLI `11.5.1+` and Node
  `22.14.0+`.
- For GitHub Actions, npm trusted publisher matching is keyed by the GitHub
  org/user, repository name, exact workflow filename, and optional environment
  name.
- The workflow filename must already exist under `.github/workflows/`.
- GitHub Actions trusted publishing requires `permissions.id-token: write`.
- npm currently supports GitHub-hosted runners for this path; self-hosted
  runners are not supported yet.
- When trusted publishing is used from GitHub Actions, npm automatically
  generates provenance for public packages published from public repositories,
  so a separate `--provenance` flag is not required on that path.
- npm troubleshooting guidance also notes that `package.json` `repository.url`
  must exactly match the GitHub repository for publication from GitHub.

Relevance:

- `cats-runtime` can safely land a dedicated manual publish workflow in the repo
  before the npm trusted publisher is configured.
- The runtime repo should align automation with the documented Node 22
  baseline before treating the publish workflow as ready for real use.
- Release docs should distinguish a repo-owned publish workflow skeleton from
  npm-side trusted-publisher activation.

Action Items:

- Align `.nvmrc` and GitHub workflow automation with the Node 22 runtime
  baseline.
- Reserve a stable GitHub workflow filename for later npm trusted publisher
  binding.
- Document the exact npm-side org/repo/workflow matching requirements and the
  remaining external activation steps.

---

Last reviewed: 2026-04-07
