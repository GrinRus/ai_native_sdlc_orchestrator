# Changelog

All notable source-level and package changes should be summarized here for
versioned AOR snapshots.

## Unreleased

- Prevented Task Workspace live-event subscriptions from reconnecting after
  cleanup or churning on every task refresh, with focused lifecycle coverage.
- Made the installed-user product journey and internal rehearsal vocabulary
  consistently Task-first and added deterministic guards for product-doc drift
  and missing GitHub issue templates.
- Clarified npm alpha support, conduct-reporting boundaries, and release
  verification while upgrading the supported ESLint development toolchain.
- Completed the packaged Task Workspace cutover: clean projects now open the
  Task surface directly, retired Flow/Quiet Cockpit renderers are excluded from
  the Vite bundle, and installed browser acceptance covers the default route.
- Replaced the alpha app-smoke UI fields with `task_workspace_loaded`,
  `new_task_action_loaded`, `prepare_task_action_loaded`, and
  `legacy_surface_absent`; this is an intentional pre-release JSON migration.
- Aligned current architecture and installed-user runbooks with Task Workspace
  while preserving older console material as historical research evidence.
- Added `NOTICE` to the npm package guardrails, patched vulnerable transitive
  development dependencies, and added a scheduled high-severity dependency
  audit workflow.
- Improved contributor guidance, confidential reporting instructions, npm
  metadata, and structured GitHub issue forms.

## [0.1.0-alpha.20] - 2026-08-27

- Added the W70 Task Workspace experience with resumable Tasks Home,
  server-owned task navigation, pinned Markdown sources, Prepared Task review,
  durable task actions, review evidence, and completion evidence.
- Aligned the installed web console with the W70 responsive design system,
  including truthful task lifecycle states, attention and blocker surfaces,
  review flows, completion states, and mobile layouts.
- Hardened task Markdown rendering and source-count semantics while preserving
  packaged browser acceptance and no-upstream-write behavior.

## [0.1.0-alpha.19] - 2026-08-10

- Added intent-first Project Home, resumable Intent navigation, review-first
  Prepared Task editing, and the Flow Cockpit adaptive lifecycle experience.
- Added CAS-safe confirmation with stale-revision recovery while keeping
  confirmation separate from the first Discovery action.
- Propagated work type, runtime-owned lifecycle steps, Flow summaries, and
  independent attention/blocker counts through the control-plane contracts and
  projections.
- Updated OpenAPI examples, backlog traceability, browser acceptance, and
  packaged web assets for the W69 release.

## [0.1.0-alpha.18] - 2026-08-04

- Moved mutable AOR state into the central `~/.aor` home with collision-safe
  workspace project identities, logical evidence references, managed Git
  checkouts, and explicit portable project configuration and evidence exports.
- Replaced topology-first initialization with intent-first onboarding for local
  Git folders or HTTPS/SSH Git URLs plus task text and bounded text-file
  attachments.
- Added read-only, provider-agnostic intent normalization with immutable
  revisions, deterministic structured validation, clarification and retry
  actions, and idempotent flow creation after explicit confirmation.
- Simplified the web console around source connection, task preparation,
  compact review, automatic safe execution modes, and recoverable start jobs,
  while moving topology and provider details into advanced project settings.
- Added headless CLI and control-plane surfaces for project connection, folder
  selection, intent submission, write-back, export, disconnect, and explicit
  AOR data deletion, with updated contracts, OpenAPI coverage, and installed
  package proofs.

## [0.1.0-alpha.17] - 2026-08-03

- Reworked the Quiet Cockpit around one global project and flow context, one
  lifecycle control per viewport, and one visually dominant recommended action.
- Clarified first-run onboarding from repository selection and local runtime
  initialization through Mission setup, execution-route selection, provider
  readiness, and the first safe action.
- Improved semantic typography and design-token adoption, reduced competing
  cards and borders, and moved technical context and readiness evidence behind
  progressive disclosures.
- Added a fail-closed configuration-error surface, clearer degraded-state
  behavior, responsive mobile lifecycle navigation, and accessible control
  labels while preserving packaged browser acceptance coverage.

## [0.1.0-alpha.16] - 2026-08-02

- Added structured medium/large planning, topology-aware workspace sets,
  parent/child execution scheduling, coordinated multi-repository delivery, and
  resilient lifecycle recovery across the CLI, API, and web console.
- Reworked the operator console around guided mission intake, a semantic design
  system, an adaptive shell, truthful action and evidence surfaces, and
  installed-console accessibility and browser acceptance.
- Hardened runtime ownership, atomic event persistence, replay/resume behavior,
  verification and delivery boundaries, provider process cleanup, and
  runner-agnostic adapter contract parity.
- Added bounded external-provider sessions and versioned provider work packets
  with explicit command roles, focused repair verification, environment-limited
  outcomes, and precise timeout, cancellation, context, and budget evidence.
- Expanded installed-user qualification tooling with immutable browser proof,
  run-health and final-assessment gates, diagnostic isolation, and a passing
  guided plus OpenAI medium checkpoint while retaining the W66 audit hold.
- Refreshed open-source onboarding documentation and routine npm and GitHub
  Actions dependencies.
- Allowed npm alpha snapshot publication under a valid audit hold while
  preserving false production clearance and rejecting invalid readiness
  evidence.
- Installed the Playwright Chromium runtime in both alpha candidate and publish
  jobs before executable browser acceptance.
- Hardened external-runner timeout cleanup by tracking late-spawned detached
  descendant process groups before bounded termination.
- Fixed alpha publication inspection so an absent remote tag is not
  misclassified as a conflicting empty tag.

## [0.1.0-alpha.15] - 2026-07-09

- Hardened the installed-user web console first-run, project switcher, active
  cockpit, workbench, and mobile/focus states around flow-centric operation.
- Added live run-health read-model surfaces so decision gates, assessment gates,
  target/setup blockers, provider telemetry, and materialized decisions stay
  factual across CLI, API, and web projections.
- Improved operator recovery paths for pending/rejected decisions, failed
  required verification, exhausted repair loops, public repair decisions,
  completed repair runs, and completed-flow follow-up creation.
- Documented the W56 rendered UX audit findings and updated control-plane and
  runtime recovery contracts/runbooks for the new recovery-state evidence.

## [0.1.0-alpha.14] - 2026-07-07

- Added generic verification command groups and verification authoring flows for
  stack discovery, generated project profiles, public plan surfaces, and
  archetype smoke coverage.
- Split discovery, research, and spec prompt/readiness semantics while keeping
  artifact execution compatibility and documenting live readiness proof.
- Added bounded review/QA quality repair contracts, runtime state, CLI/API/web
  surfaces, proof fixtures, and live acceptance evidence.
- Hardened hard-target repair evidence with command-level verification failure
  details, `ky` xlarge primary alignment, Claude xlarge guardrails, and W55
  control rerun reporting.

## [0.1.0-alpha.13] - 2026-06-30

- Hardened W52 installed-user hard-target rehearsals with target setup readiness owner
  propagation, bounded diagnostic timeout handling, and post-run target
  verification isolation.
- Hardened Codex provider execution by using clean config/rules flags while
  preserving host auth and surfacing malformed OpenAI tool-call schema failures
  as provider-owned evidence.
- Added manual xlarge step-quality continuation support and follow-up backlog
  slices for manual evidence depth, diagnostic classification precision, and
  final acceptance/xlarge observation reporting.
- Recorded HTTPie large product acceptance, paired guided UI proof, and HTTPie
  xlarge manual observation evidence without counting xlarge observation as
  product acceptance.

## [0.1.0-alpha.12] - 2026-06-22

- Added outcome-oriented internal rehearsal quality assessment with factual-only
  observation reports, separate run-health reports, post-run quality
  assessment reports, and an all-pass advisory gate.
- Added diagnostic run-health evidence so diagnostic warnings and
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
