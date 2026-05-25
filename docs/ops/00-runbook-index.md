# Runbook index

## Installed-user rehearsal profiles
- `live-e2e-target-catalog.md` — canonical target repositories, setup commands, and scenario briefs.
- `live-e2e-dependency-matrix.md` — canonical dependencies for setup and verification across all live E2E profiles.
- `live-e2e-regress-short.md` — fast smoke rehearsal on a small public repository.
- `live-e2e-regress-long.md` — deeper regression rehearsal with stronger verification.
- `live-e2e-release-short.md` — short release rehearsal that still materializes a release packet.
- `live-e2e-release-long.md` — long monorepo release rehearsal with stronger gates.
- `live-e2e-standard-runner.md` — installed-user black-box step-controller runner, manual workflow, step evaluator, qualification loop, and artifact map for catalog profiles.
- `runtime-permission-runner-certification.md` — post-merge real-runner smoke lane for runtime permission mode mappings and restricted-mode interaction evidence.
- `installed-user-first-run.md` — public guided install, `aor doctor`, `aor onboard`, local `aor app`, Mission form, `aor next`, and guided proof shortcuts.
- `live-e2e-learning-loop.md` — repeatable scorecard/incident capture and backlog-quality handoff flow.
- `live-e2e-w7-governance-closure.md` — integrated W7 governance closure rehearsal and wave-level smoke checks.
- `github-fork-first-delivery.md` — fork-first delivery checkpoints, approval boundaries, and recovery guidance.
- `live-run-event-stream.md` — replay-safe stream behavior, reconnect flow, and backpressure baseline.

## Run control
- `run-control-lifecycle.md` — start/pause/resume/steer/cancel commands, guardrails, and audit checks.
- `incident-audit-operations.md` — incident open/show and audit runs command flow with run-linked evidence checks.
- `operator-strategic-visibility.md` — sponsor/planner wave progress and run-risk snapshots from operator surfaces.
- `operator-policy-troubleshooting.md` — selected-run event and policy history inspection sequence for later-stage operator triage.
- `security-route-governance.md` — allow/deny/escalate checks for delivery/release route governance decisions.
- `control-plane-production-hardening.md` — local-trusted versus production-hardened transport mode, bearer scopes, denied-action audit behavior, and redaction surfaces.
- `production-readiness-gate.md` — self-hosted production-readiness gate usage, evidence checks, and failure interpretation.
- `self-hosted-release.md` — supported self-hosted CLI/API production-candidate mode, release gate, rollback, auth, delivery policy, proof evidence, and non-goals.
- `self-hosted-environment-matrix.md` — local trusted, production-hardened, connected web, and npm alpha operating modes with credentials and verification commands.
- `self-hosted-secrets-and-redaction.md` — secret placement, bearer principal boundaries, and redaction surfaces.
- `self-hosted-backup-restore.md` — workspace-local `.aor/` evidence backup and restore procedure.
- `self-hosted-incident-runbook.md` — containment, evidence preservation, and recovery for bounded self-hosted incidents.
- `npm-cli-alpha-release.md` — npm CLI alpha package release branch, gate, publish automation, prerequisites, and rollback policy.

## UI lifecycle
- `ui-attach-detach.md` — how to launch the local web UI and attach or detach lower-level UI lifecycle state from a running AOR system.

## Profile selection rule of thumb
- Need a fast smoke signal: `regress short`
- Need a stronger regression signal: `regress long`
- Need a quick release-shaped rehearsal: `release short`
- Need a production-like monorepo rehearsal: `release long`
- Need integrated W7 governance closure evidence: `w7 governance integration`
