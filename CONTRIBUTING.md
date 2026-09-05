# Contributing to AOR

Thanks for contributing to AOR.

AOR is a docs-first repository with implemented CLI/API/web/runtime baselines today. The highest-value contributions are the ones that keep the roadmap, contracts, examples, command surfaces, and implementation baselines aligned while the runtime is hardened toward production readiness.

The public distribution channels are GitHub source and the npm CLI alpha package `@grinrus/aor`. Internal workspace packages remain private and unpublished unless maintainers explicitly open a separate package API channel.

## Ways to contribute

You can help by:

- reporting gaps or contradictions in the product, architecture, or contract docs;
- improving examples, runbooks, and operator workflows;
- refining the roadmap, epic map, or dependency graph;
- implementing one bounded backlog slice at a time;
- strengthening repository-integrity checks, CI, or contributor guidance.

## Before you start

Read these first:

1. `README.md`
2. `AGENTS.md`
3. the nearest `AGENTS.md` to the files you plan to change

If implementation introduces a new product outcome, also read
`docs/backlog/backlog-operating-model.md`, `docs/backlog/mvp-roadmap.md`, and
find the owning slice before writing broad code. A tightly scoped bug,
documentation, or maintenance fix may stay outside a feature slice when its
boundary is explicit and it does not create a new independently acceptable
outcome.

For internal maintainer rehearsal dependencies and procedures, start with
`scripts/AGENTS.md` and follow its owning runbooks. Installed-user operations
remain under `docs/ops/`.

## Development workflow

1. Fork the repository and create a topic branch.
2. Classify the work as one feature slice or one bounded maintenance fix.
3. For feature work, open the owning wave document and use its built-in
   local-task outline as your starting plan.
4. Keep the PR bounded to that slice or maintenance outcome.
5. Update docs, contracts, examples, and code together when they share the
   outcome.
6. Select focused checks from the validation matrix below, then run the default
   commit-ready gate once. Install dependencies when needed:
   ```bash
   pnpm install --frozen-lockfile
   pnpm check
   ```
7. Run the additional readiness or release gate only when that evidence is in
   scope, as defined in the matrix and release workflow below.
8. Open a focused pull request with the evidence needed to review the change.

## Validation by change type

Use Node.js 22 and the pnpm version pinned in `package.json` when reproducing CI.
The installed CLI's minimum Node requirement is not certification of every
newer Node version for contributor tests.

Use the rows that match the changed surfaces. Start with deterministic checks,
then focused tests, and finish with one `pnpm check` run for a commit-ready
change. `pnpm slice:gate` and the scoped `pnpm release:gate` already run
`pnpm check`; use the selected enclosing gate without a separate duplicate
run. Repeat checks only when subsequent changes or failures require it.
Record any pending check and its exact reason in the handoff or PR.

| Changed surface | Focused verification and additional evidence |
| --- | --- |
| Contributor guidance, `AGENTS.md`, `.agents/skills/**`, or navigation docs | `pnpm guidance:check`; check referenced commands, paths, ownership, and authorization boundaries. |
| Contracts, schemas, API payloads, or canonical examples | `pnpm test:references`; owning contract/parser tests and affected API tests; review compatibility and example parity. |
| Runtime behavior, CLI/API command handling, or tooling | Owning runtime, command, or script tests, including failure and recovery paths affected by the change. |
| Runtime prompts, context assets, skills, wrappers, or compiler | Reference checks and affected asset-loader/context-compiler tests; inspect version/ref compatibility and compiled provenance; use representative evaluation and baseline evidence for behavioral changes. See [asset lifecycle](docs/architecture/15-platform-assets-and-prompt-lifecycle.md). |
| Rendered web UI or browser interaction | Relevant web tests and `pnpm test:web:browser`; inspect the changed flow, responsive behavior, and keyboard/focus states. Install Chromium with `pnpm exec playwright install chromium` if needed. A build alone does not prove browser behavior. |
| Production clearance | `pnpm production:ready --json` must pass without an audit-hold exception; report gate execution and release disposition separately. |
| npm CLI alpha release | `pnpm release:gate` includes the repository, browser, package, and smoke checks. It may accept a valid audit hold for alpha distribution; it does not grant production clearance. See [release runbook](docs/ops/npm-cli-alpha-release.md). |

Checks involving paid providers, credentials, or external writes must stay
within the user's explicit authorization. Reuse authorization already granted
for the same bounded action; a validation row does not expand that scope.

For changes to skill selection, task boundaries, or complex contributor
workflows, use the [representative guidance cases](.agents/evals/contributor-guidance.md).
The static guidance checker proves metadata/reference integrity; independent
case replay evaluates the decisions an agent makes from those instructions.

## Release workflow

Normal feature and fix work still merges to `main` through regular PRs and does
not publish artifacts. npm CLI alpha releases use a short-lived
`release/v<semver-alpha>` branch, for example `release/v0.1.0-alpha.1`.

Release PRs must:

- target `main` from the same repository, not a fork;
- carry the `release:publish` label before merge;
- keep `package.json` version equal to the release branch version;
- include a matching `CHANGELOG.md` entry;
- install Playwright Chromium in candidate and publish jobs before the browser
  acceptance portion of the release gate;
- run `pnpm release:gate` before merge.

The npm alpha release gate may accept a valid production-readiness
`audit-hold` through `--allow-audit-hold`. This is limited to pre-release
snapshot distribution: it leaves `release_clearance=false` and still fails on
invalid evidence or failed execution. Stable and production readiness continue
to require the unqualified `pnpm production:ready` gate to pass.

After a labeled release PR is merged, `.github/workflows/release-publish.yml`
re-runs the release gate on the merge commit, creates the matching tag and
GitHub Release, and publishes `@grinrus/aor` with npm Trusted Publishing and
provenance. The workflow must fail closed if the npm Trusted Publisher, npm
scope, branch name, label, version, or artifact checks are missing.

## Continuous slice loop

Use the slice helper commands to keep one-slice-at-a-time delivery explicit:

```bash
pnpm slice:status
pnpm slice:next -- --json
pnpm slice:plan -- W0-S04
pnpm slice:sync-ready -- --apply
pnpm slice:gate
pnpm slice:complete -- W0-S04 --apply
```

Notes:

- `slice:sync-ready` recalculates `ready` and `blocked` from hard dependencies.
- `slice:complete` updates both the master backlog and the owning wave doc state.
- `slice:gate` delegates once to the mandatory `pnpm check` pipeline; it does
  not repeat lint, test, or build as separate second passes.

## CI acceptance gates

The repository uses a repository-integrity workflow plus focused security workflows:

- `.github/workflows/ci.yml`
- `.github/workflows/dependency-review.yml`
- `.github/workflows/dependency-audit.yml`
- `.github/workflows/codeql.yml`
- `.github/workflows/scorecard.yml`
- `.github/workflows/release-candidate.yml`
- `.github/workflows/release-publish.yml`

The repository-integrity workflow runs on:
- pull requests;
- pushes to `main`;
- manual `workflow_dispatch`.

What the workflows prove today:
- `pnpm check` runs lint, type checking, tests, build, quality ratchets,
  dependency policy, contract parity, and release metadata verification;
- CI separately runs executable browser acceptance after installing Chromium;
- CI runs `pnpm production:ready --json --allow-audit-hold` as a disposition
  check: valid `audit-hold` evidence can pass this CI step while the report
  remains `status: blocked` and `release_clearance: false`. Production
  clearance requires the unqualified `pnpm production:ready` gate to pass;
- release candidate PRs from `release/v<semver-alpha>` run `pnpm release:gate`,
  which may accept only a valid npm-alpha audit hold while production clearance
  remains false;
- dependency review, scheduled dependency audit, CodeQL, and OpenSSF Scorecard
  run as separate security workflows. `pnpm audit --audit-level high` remains a
  network-backed advisory check and therefore does not run inside the
  deterministic local `pnpm check` pipeline.

If the repository-integrity workflow fails, the failing step maps directly to one of the root checks so the remediation path stays explicit. If a security workflow fails, treat it as a supply-chain or code-scanning finding unless the workflow output clearly identifies a setup problem.

## Repo-specific rules

- English is the default project language.
- Packet-first and contract-first rules are non-negotiable.
- Keep orchestrator core runner-agnostic.
- Product runtime state resolves through `~/.aor` or the isolated `AOR_HOME`.
  Target-repository `.aor/` is only for explicit portable config and selected
  exports; internal rehearsals may keep ignored run-scoped output in the AOR
  source checkout's `.aor/` according to their runbook.
- Do not commit private AOR Home state, source-checkout `.aor/` rehearsal output,
  generated target checkouts, `.env` files, secrets, personal access tokens,
  credentials, or machine-local scratch notes.
- Do not paste secrets, exploit details, private repository data, or credential-bearing runner transcripts into public issues, PRs, logs, or comments.
- Public-repo rehearsals must stay no-write by default unless the selected slice explicitly expands the write-back boundary.
- If a flow changes, update the matching public runbook or operator-facing guidance in the same PR.

## Picking work

Use this sequence:

1. `docs/backlog/mvp-roadmap.md`
2. `docs/backlog/mvp-implementation-backlog.md`
3. `docs/backlog/slice-dependency-graph.md`
4. the owning wave document
5. `docs/backlog/orchestrator-epics.md` when you need the cross-wave context

The shared backlog tracks **waves, epics, and slices**. Local tasks are derived from the owning wave document and do not become new shared backlog items unless they introduce a new independently acceptable outcome.

## Pull request checklist

Before opening a PR, confirm that:

- the change still fits one slice or one tightly related bug fix;
- the owning wave doc still describes the work accurately;
- examples still match the contracts they illustrate;
- docs, contracts, examples, and command surfaces are still aligned;
- the relevant docs were updated;
- root checks and the production-readiness gate were run when applicable;
- acceptance criteria have reviewable evidence.

## Bug reports

A strong bug report should include:

- what you expected to happen;
- what actually happened;
- exact steps to reproduce;
- the relevant command, profile, route, wrapper, or target repo;
- logs, transcripts, or artifact paths when relevant;
- whether the issue affects a specific wave, slice, or operator scenario.

Never paste secrets, tokens, or private repository credentials into an issue.

## Feature requests

A strong feature request should include:

- the user problem being solved;
- the primary user-story surfaces affected;
- the expected outcome;
- where the change likely belongs in the roadmap;
- whether it should be a new slice, a split of an existing slice, or a later-wave addition.

## Review expectations

Reviewers will look for:

- bounded scope;
- contract and example alignment;
- durable evidence for acceptance criteria;
- safe public-repo behavior;
- clear docs for anything user-visible or operator-visible.

## Issue and PR templates

Use the repository templates under `.github/` when they fit. They are intentionally aligned with the slice-first planning model.

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0 that applies to this repository.
