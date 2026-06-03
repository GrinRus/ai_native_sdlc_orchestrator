# npm CLI alpha release runbook

## Supported release channel

AOR publishes one npm alpha artifact: `@grinrus/aor`. The package exposes the
`aor` CLI and bundles the runtime source, contracts, example assets, and
packaged `apps/web/dist` SPA required for the documented no-write onboarding
and local UI path.

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
pnpm production:ready --json
```

Then run the npm release gate:

```bash
pnpm release:gate
```

`pnpm release:gate` runs repository integrity, production readiness, release
metadata verification, `npm pack --dry-run --json`, and an installed-package
smoke test. The smoke test installs the generated tarball into a temporary npm
project, runs `aor --help`, and runs `doctor` plus `onboard` against a temporary
git repository while asserting that only `.aor/` runtime state changes. W30
extends that smoke path to run `aor app --help` so optional API/web guidance is
covered. W31 extends it further with
`aor app --smoke --open false --json`, which starts the local packaged SPA,
checks `/`, `/app-config.json`, `GET /api/projects`, and
`GET /api/projects/:projectId/state`, then exits without starting a hosted
service or making the web console required.
W32 extends the source checkout and package smoke expectations with
`aor request create --json`, `aor request run --json`, and sanitized
operator-request API coverage so the packaged CLI proves bounded interactive
runtime work without changing target files outside `.aor/`.
W34 extends the app smoke expectation so `aor app --smoke --open false --json`
must also prove the packaged flow-centric bundle still contains the flow
selector and `New Flow` markers. This remains a deterministic release guardrail;
installed-user live E2E acceptance still comes from
`installed-user-guided-journey.yaml` with `browser-task-proof`, flow-loop
fields, accepted skill-agent decisions, a final skill-agent verdict, and
no-upstream-write assertions.
W36 extends the same deterministic smoke so it must also prove the first-run
wizard marker, project switcher marker, `/api/projects` project index, and
matching `default_project_id` fields while preserving the single-project
`aor app` launch contract.

After a publish, registry smoke must run from a neutral temporary runner
directory rather than from the AOR source checkout:

```bash
TMP="$(mktemp -d)"
mkdir -p "$TMP/target" "$TMP/runner"
git -C "$TMP/target" init
cd "$TMP/runner"
npm exec --yes --package @grinrus/aor@0.1.0-alpha.7 -- aor --help
npm exec --yes --package @grinrus/aor@0.1.0-alpha.7 -- \
  aor app --project-ref "$TMP/target" --runtime-root "$TMP/target/.aor" --smoke --open false --json
```

This proves the registry artifact and avoids npm resolving the local source
checkout package context. For a clean target, the app smoke should pass without
creating `$TMP/target/.aor`; explicit runtime initialization or `aor onboard`
is the write boundary for first-run runtime state.

W30 alpha hardening also requires the production-readiness gate to verify the
ADR index, OpenAPI 3.1 control-plane route contract, self-hosted operations
runbooks, story-status honesty for blocked OpenCode outcomes, and alpha
non-goals before release review.

W31 local app launch readiness also requires `npm pack --dry-run --json` to
include `apps/web/dist`, the shared app launcher, and the shared HTTP transport
files while excluding tests and target runtime state.

W32 request readiness also requires the package to include the shared
operator-request runtime files, CLI request handler, `operator-request`
contract/example, and operator-intervention context bundle/rule. Release smoke
must verify no-write request runs produce proposal evidence, patch-only requests
require explicit allowed paths, and sanitized list/status outputs omit raw
request text.

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
Prerelease, and publishes prerelease builds to the npm `alpha` dist-tag with:

```bash
npm publish --access public --tag alpha --provenance
```

Do not publish alpha versions without `--tag alpha`: npm publish defaults to the
`latest` dist-tag when no explicit tag is supplied, and `latest` is reserved for
future stable releases.

The bootstrap `0.1.0-alpha.1` release also has `latest` for historical first
publish reasons. Do not advance `latest` from automation until a stable channel
exists; release automation must update only the `alpha` dist-tag.

The workflow uses npm Trusted Publishing through GitHub OIDC. Do not add npm
tokens or token fallback behavior. The release workflows pin Node.js `22.14.0`
and install `npm@11.15.0`, matching the npm Trusted Publishing registry
contract that requires explicit publish permissions instead of relying on the
hosted runner image defaults.

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

No Docker, GHCR, hosted SaaS, enterprise identity, default upstream write-back,
or public SDK package release is part of this alpha channel.
