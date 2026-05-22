# W29 - npm CLI alpha distribution

Open the first package distribution channel while preserving the normal
`main` development flow and keeping internal workspace packages private.

## Wave objective

Make AOR publishable as one npm CLI alpha package with a guarded release branch
flow, reproducible package evidence, and fail-closed automation.

## Wave exit criteria

- The root package publishes as `@grinrus/aor` with bin command `aor`.
- Internal apps and packages remain private implementation modules.
- Release PRs from `release/v<semver-alpha>` run a full release candidate gate.
- Merged release PRs publish only with `release:publish`, matching version, and
  npm Trusted Publishing.
- README, support, security, changelog, and ops docs describe the npm alpha
  channel honestly.

---

## W29-S01 — npm CLI alpha release channel
- **Epic:** EPIC-5 Delivery and release
- **State:** done
- **Outcome:** AOR has a guarded npm CLI alpha release flow for `@grinrus/aor` while regular PRs to `main` remain non-publishing.
- **Primary modules:** `package.json`, `.github/workflows/**`, `scripts/**`, `README.md`, `docs/ops/**`, `docs/backlog/**`
- **Hard dependencies:** W28-S03

### Local tasks
1. Add npm CLI alpha source-of-truth docs and release branch policy.
2. Make the root package publishable while keeping internal workspace packages private.
3. Add release verify, pack, smoke, and event-guard checks.
4. Add release candidate and release publish workflows with fail-closed guards.
5. Update repository gates and tests for the new distribution channel.

### Acceptance criteria
1. `pnpm release:gate` validates metadata, package contents, installed package behavior, and branch/version rules.
2. Release candidate PRs from `release/v<semver-alpha>` run the release gate without publishing.
3. Publish automation runs only for same-repo merged release PRs with `release:publish` and matching package version.
4. npm publishing uses Trusted Publishing/OIDC and no token fallback.
5. Root checks still pass with the npm alpha channel documented.

### Done evidence
- npm release runbook
- package metadata and package-content guards
- release flow unit tests
- release candidate and publish workflows
- updated README, changelog, security, support, backlog, and CI docs

### Out of scope
- Docker or GHCR distribution.
- Hosted SaaS distribution.
- Public semver API guarantees for internal workspace packages.
