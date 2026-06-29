# Changelog

All notable source-level and package changes should be summarized here for
versioned AOR snapshots.

## Unreleased

- No unreleased changes yet.

## [0.1.0-alpha.12] - 2026-06-22

- Added outcome-oriented internal rehearsal quality assessment with factual-only
  observation reports, separate run-health reports, post-run quality
  assessment reports, and an all-pass advisory gate.
- Added `diagnostic_health` run-health evidence so diagnostic warnings and
  failures stay separate from code, artifact, and outcome quality.
- Refined AOR operator UI/UX assessment with structured guided-browser
  accessibility proof for keyboard, focus, contrast, semantics, screen-reader,
  and error-feedback checks.
- Hardened live adapter request-artifact and provider work-packet handling so
  long prompts are measured, compacted, bounded, and failed fast before
  provider calls when needed.
- Added execution no-op and provider work-packet non-execution classification
  with target-change proof surfaced through run-health and Runtime Harness
  evidence.

## [0.1.0-alpha.11] - 2026-06-11

- Added internal rehearsal quality gates for mission-scoped verification, delivery path
  integrity, run-health evidence, post-run quality assessment, and artifact
  completeness.
- Hardened Runtime Harness, review, delivery, and handoff artifacts so
  mission-relevant changed paths, goals, Definition of Done, KPIs, and
  post-run verification commands stay traceable through the run.
- Fixed public run-control interruption classification for external providers
  when a canceled runner closes before the heartbeat observes the cancel state.
- Generalized the HTTPie target-catalog warning-output guidance so release
  artifacts avoid run-specific fixture wording while preserving output-quality
  expectations.

## [0.1.0-alpha.10] - 2026-06-04

- Added operator-owned provider interruption classification so public run
  status, execution evidence, reports, and qualification summaries distinguish
  operator stops from provider failures.
- Added optional public `provider_step_status` interruption owner, status, and
  reason fields while preserving fail-closed `interrupted` provider execution
  semantics.
- Updated the web execution evidence panel and internal rehearsal examples so operator
  stops render with owner/phase context and provider, target repository,
  environment, and AOR failures remain separately classified.

## [0.1.0-alpha.9] - 2026-06-04

- Fixed the installed-user local app evidence rendering so valid runtime state,
  onboarding report, and mission body sidecar refs render as readable ready
  summaries instead of false `Evidence missing` entries.
- Closed the W41 alpha.8 findings review with owner/phase classifications and
  queued W42 follow-up slices for release prep and operator interruption
  reporting cleanup.
- Refreshed provider qualification docs and matrix evidence with Codex and Qwen
  short-smoke parity results while keeping Qwen, OpenCode, and Claude optional
  and non-release-blocking.
- Kept the release scope to npm CLI alpha only; no stable, Docker/GHCR,
  hosted/SaaS, SDK, or mandatory optional-provider qualification is claimed.

## [0.1.0-alpha.8] - 2026-06-04

- Hardened W40 installed-user onboarding and release docs so registry package
  smoke, clean `aor app` launch, first-run guidance, no-surprise writes, and
  advanced headless paths remain aligned.
- Added active provider heartbeat surfacing through public run event
  history, SSE/read surfaces, and local console auto-refresh while preserving
  provider-neutral lifecycle semantics.
- Added the optional internal provider qualification matrix for Codex, Claude,
  OpenCode, and Qwen with owner/phase evidence and explicit release-blocking
  separation.
- Kept Qwen, OpenCode, and Claude optional unless a future release policy
  explicitly promotes their coverage requirements.

## [0.1.0-alpha.7] - 2026-06-03

- Added W37 target setup and verification closure evidence so internal rehearsal reports
  separate provider-independent target setup blockers from provider quality.
- Closed W35 internal UX proof coverage with Codex proof evidence and Qwen
  fail-closed/operator evidence while preserving no-upstream-write semantics.
- Added W38 Qwen `stream-json` progress handling so long candidate runs expose
  non-silent provider status without depending on private Qwen logs.
- Added W39 provider parity lifecycle defaults so Codex, Claude, OpenCode, and
  Qwen use shared retry/repair semantics and do not start hidden internal
  repair after a terminal provider result.
- Fixed Codex preflight classification for benign `avoid interactive prompts`
  wording.

## [0.1.0-alpha.6] - 2026-06-02

- Fixed the local app topbar/project switcher layout so `Add local project`
  remains clickable beside the flow selector in the packaged no-settings UI.
- Preserved the W36 onboarding and local multi-project behavior while adding
  regression coverage for the project switcher/topbar click path.
- Added W37 target setup closure planning so W35-S05 proof retries can
  bound target setup, expose setup elapsed/budget/status evidence, and separate
  provider-independent setup blockers from Codex/Qwen provider quality.
- Documented that W35-S05 remains blocked until clean Codex/Qwen proof or
  bounded target blocker evidence closes.

## [0.1.0-alpha.5] - 2026-06-02

- Added W36 no-settings onboarding for `aor app`, including the first-run
  wizard, explicit runtime initialization, first mission intake, and flow
  cockpit handoff.
- Added the local multi-project workspace and project switcher so one loopback
  UI can manage multiple independent local projects without mixing runtime or
  evidence state.
- Hardened project readiness reads to use a non-mutating runtime preview before
  explicit initialization.
- Updated clean UI onboarding smoke and browser proof coverage for the W36
  wizard and multi-project flow.

## [0.1.0-alpha.4] - 2026-06-02

- Added the W34 flow-centric operator console baseline, including active and
  completed flow selection, scoped evidence workbench views, and follow-up flow
  creation from learning handoff evidence.
- Added W35 internal operator UX hardening for provider heartbeat/status
  visibility, readable artifact summaries, decision-helper UX, execution
  evidence panels, and interruption/retry control surfaces.
- Updated packaged SPA release smoke coverage for the flow-centric console so
  installed npm users keep the flow selector and `New Flow` launch path.
- Documented that the Codex/Qwen internal UX proof slice remains blocked until
  clean proof closes or a replanning slice explicitly updates the target.

## [0.1.0-alpha.3] - 2026-05-24

- Added W30 alpha-hardening source-of-truth docs, including the W30 backlog
  wave, ADR index, and architecture decisions for the self-hosted alpha
  boundary.
- Added the OpenAPI 3.1 detached control-plane API contract and readiness
  drift checks that compare the contract to the implemented router surface.
- Added self-hosted operations guidance for environment modes,
  secrets/redaction, `.aor` backup/restore, and incident evidence preservation.
- Refreshed npm alpha release and installed-user smoke evidence for the
  hardened self-hosted CLI/API alpha path.

## [0.1.0-alpha.2] - 2026-05-23

- Verified the automated npm Trusted Publishing release path after bootstrap.
- Pinned release automation to the npm CLI version that supports explicit
  trusted-publishing permissions.
- Marked automated alpha GitHub Releases as prereleases.

## [0.1.0-alpha.1] - 2026-05-22

- Added the first npm CLI alpha package channel as `@grinrus/aor`.
- Added release branch gates for `release/v<semver-alpha>` PRs.
- Added npm package verification, dry-run packing, installed-package smoke, and
  GitHub release publish automation guarded by `release:publish`.
- Added public OSS readiness guidance for source-only alpha distribution.
- Added security, support, community, dependency automation, and CI hardening files.

## Release Policy

`main` remains the public source channel. npm CLI alpha releases are cut from
short-lived `release/v<semver-alpha>` branches, published as `@grinrus/aor`,
and tagged with matching GitHub Releases after the release gate passes.
