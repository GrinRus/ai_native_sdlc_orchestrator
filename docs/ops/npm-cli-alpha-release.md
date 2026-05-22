# npm CLI alpha release runbook

## Supported release channel

AOR publishes one npm alpha artifact: `@grinrus/aor`. The package exposes the
`aor` CLI and bundles the runtime source, contracts, and example assets required
for the documented no-write onboarding path.

Internal workspace packages under `apps/*` and `packages/*` stay private. They
are implementation modules inside the CLI package, not public semver APIs.

## Branch model

Normal development merges to `main` through regular pull requests. Those merges
do not publish artifacts.

npm alpha releases use a short-lived `release/v<semver-alpha>` branch. Example:

```bash
git switch main
git pull --ff-only
git switch -c release/v0.1.0-alpha.1
```

Only release prep, release docs, package metadata, and targeted packaging fixes
belong in a release branch. The release PR targets `main`, must come from the
same repository, and must carry the `release:publish` label before merge.

## Release gate

Run the normal source gates first:

```bash
pnpm check
pnpm production:ready
```

Then run the npm release gate:

```bash
pnpm release:gate
```

`pnpm release:gate` runs repository integrity, production readiness, release
metadata verification, `npm pack --dry-run --json`, and an installed-package
smoke test. The smoke test installs the generated tarball into a temporary npm
project, runs `aor --help`, and runs `doctor` plus `onboard` against a temporary
git repository while asserting that only `.aor/` runtime state changes.

For strict release-branch validation, set the release branch explicitly:

```bash
AOR_RELEASE_BRANCH=release/v0.1.0-alpha.1 AOR_RELEASE_STRICT_BRANCH=true pnpm release:gate
```

## Publish automation

`.github/workflows/release-candidate.yml` runs the full release gate for PRs
from `release/v<semver-alpha>` into `main`. It does not publish.

`.github/workflows/release-publish.yml` runs after a release PR is merged. It
publishes only when all of these conditions are true:

- the PR was merged into `main`;
- the head branch matches `release/v<semver-alpha>`;
- the head repository is the same as `GrinRus/ai_native_sdlc_orchestrator`;
- the PR has the `release:publish` label;
- `package.json` version matches the release branch version;
- the npm package version and git tag do not already exist;
- `pnpm release:gate` passes on the merge commit.

The publish workflow creates tag `v<semver-alpha>`, creates the matching GitHub
Release, and publishes prerelease builds to the npm `alpha` dist-tag with:

```bash
npm publish --access public --tag alpha --provenance
```

Do not publish alpha versions without `--tag alpha`: npm publish defaults to the
`latest` dist-tag when no explicit tag is supplied, and `latest` is reserved for
future stable releases.

The workflow uses npm Trusted Publishing through GitHub OIDC. Do not add npm
tokens or token fallback behavior. The release workflows pin Node.js `22.14.0`
and install `npm@11.5.1`, matching the npm Trusted Publishing minimums instead
of relying on the hosted runner image defaults.

## External prerequisites

Before the first publish, maintainers must configure:

- npm scope ownership for `@grinrus`;
- npm Trusted Publishing for package `@grinrus/aor`, repository
  `GrinRus/ai_native_sdlc_orchestrator`, and workflow
  `release-publish.yml`;
- GitHub branch protection for `main` with required `CI` and release candidate
  checks before release PR merge.

If those prerequisites are missing, the publish workflow must fail closed.

## Rollback and recovery

npm package versions are immutable. Do not overwrite an existing package
version. If a release is bad:

1. Stop further release PR merges.
2. Publish a fixed `release/v<next-alpha>` version after the full gate passes.
3. Deprecate the bad npm version with a clear replacement version.
4. Leave the original git tag and GitHub Release intact unless they expose
   secrets. If secrets are exposed, treat it as a security incident.

No Docker, GHCR, hosted SaaS, enterprise identity, or public SDK package release
is part of this alpha channel.
