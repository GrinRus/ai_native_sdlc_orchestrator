# W4 implementation slices

## Wave objective
Add safe write-back modes, manifests, and release artifacts so AOR can move from rehearsal to controlled delivery.

## Wave exit criteria
- isolated execution supports patch, local branch, and fork-first delivery modes
- write-back policy is explicit and machine-checkable before a delivery run starts
- delivery outputs can be materialized as patches, branches, and PR-ready changesets
- delivery manifests and release packets capture the exact evidence chain for every run
- delivery rehearsal on public targets remains recovery-safe and upstream-safe by default

## Parallel start and sequencing notes
- `W4-S03` and `W4-S04` can proceed in parallel once isolation and delivery policy are stable.
- `W4-S05` is the artifact join point for release evidence.
- `W4-S06` must cover safe recovery and rollback-adjacent behavior before public write-back is trusted.

---

## W4-S01 — Isolated worktree and workspace execution foundation
- **Epic:** EPIC-5 Delivery and release
- **State:** done
- **Outcome:** Prepare safe local isolation primitives so delivery can happen without mutating the operator's main checkout accidentally.
- **Primary modules:** `packages/orchestrator-core`, `packages/observability`, `docs/ops/**`
- **Hard dependencies:** W2-S05, W1-S05
- **Primary user-story surfaces:** delivery engineer, operator / SRE, security / compliance

### Local tasks
1. Support isolated execution roots such as worktrees or workspace clones for delivery runs.
2. Record the isolation mode and target checkout metadata in run evidence.
3. Make cleanup and failure-safe teardown part of the standard flow.
4. Document when each isolation mode should be used.

### Acceptance criteria
1. Delivery-capable runs can execute in isolated roots instead of mutating the primary checkout directly.
2. Isolation metadata is captured in run evidence and manifests.
3. Cleanup behavior is explicit for success, abort, and failure paths.
4. Runbooks describe which isolation mode is appropriate for each delivery scenario.

### Done evidence
- isolation-mode tests or fixtures
- updated delivery runbooks
- recorded isolation metadata examples

### Out of scope
- git push or PR creation
- release artifact publication

---

## W4-S02 — Delivery planning and write-back mode policy
- **Epic:** EPIC-5 Delivery and release
- **State:** ready
- **Outcome:** Make delivery intent explicit before any write-back happens by choosing a mode, approval boundary, and safety policy.
- **Primary modules:** `packages/orchestrator-core`, `docs/contracts/**`, `docs/architecture/**`
- **Hard dependencies:** W4-S01, W1-S07, W3-S05
- **Primary user-story surfaces:** delivery engineer, engineering manager / planner, security / compliance

### Local tasks
1. Model delivery write-back modes such as no-write, patch-only, local-branch, and fork-first PR.
2. Require explicit approved handoff and promotion evidence before non-read-only modes are allowed.
3. Persist the selected delivery plan as durable metadata before file changes are written.
4. Document the policy boundary between rehearsal and delivery.

### Acceptance criteria
1. Delivery mode is explicit and machine-checkable before a delivery run starts.
2. Non-read-only modes require approved handoff and promotion evidence.
3. The selected delivery plan is persisted and linked to the run before write-back begins.
4. Docs explain how rehearsal and delivery policies differ.

### Done evidence
- delivery-plan fixtures
- policy validation tests
- updated delivery architecture docs

### Out of scope
- actual file mutation
- manifest or release-packet emission

---

## W4-S03 — Patch and local branch delivery driver
- **Epic:** EPIC-5 Delivery and release
- **State:** blocked
- **Outcome:** Support the safest write-back modes first: patch emission and local branch application.
- **Primary modules:** `packages/orchestrator-core`, `apps/cli`, `packages/observability`
- **Hard dependencies:** W4-S02
- **Primary user-story surfaces:** delivery engineer, operator / SRE, AI platform owner

### Local tasks
1. Implement patch output generation from approved delivery runs.
2. Implement local branch write-back with bounded git operations and evidence capture.
3. Record changed files, diff stats, and owning run metadata.
4. Document safe recovery when local delivery fails mid-run.

### Acceptance criteria
1. A delivery run can emit a patch artifact without mutating upstream repositories.
2. A delivery run can write to a local branch using bounded git operations.
3. Changed-file summaries and diff metadata are captured durably.
4. Failure and recovery behavior for patch and local-branch modes is documented.

### Done evidence
- patch artifacts
- local-branch delivery transcript
- delivery-driver tests

### Out of scope
- fork creation
- pull request creation

---

## W4-S04 — Fork-first GitHub PR delivery driver
- **Epic:** EPIC-5 Delivery and release
- **State:** blocked
- **Outcome:** Add the first networked delivery mode with explicit fork-first safety defaults for public repositories.
- **Primary modules:** `packages/orchestrator-core`, `packages/adapter-sdk`, `apps/cli`, `docs/ops/**`
- **Hard dependencies:** W4-S02, W2-S04
- **Primary user-story surfaces:** delivery engineer, operator / SRE, security / compliance

### Local tasks
1. Implement fork-first delivery planning for GitHub-hosted repositories.
2. Prepare PR-ready metadata and branch naming rules without requiring immediate auto-merge behavior.
3. Capture API-side evidence such as fork target, branch ref, and PR draft metadata.
4. Document credential and permission expectations for this mode.

### Acceptance criteria
1. Public-repo delivery defaults to fork-first rather than direct upstream branch writes.
2. PR-ready delivery metadata is explicit before networked write-back occurs.
3. Fork target, branch ref, and PR draft metadata are captured durably.
4. Runbooks document credential, permission, and approval requirements for this mode.

### Done evidence
- fork-first delivery plan fixtures
- networked delivery smoke path or stubbed test
- updated GitHub delivery runbook

### Out of scope
- auto-merge
- release publication to package registries

---

## W4-S05 — Delivery manifest and release packet materialization
- **Epic:** EPIC-5 Delivery and release
- **State:** blocked
- **Outcome:** Turn delivery output into durable release evidence that can be reviewed, replayed, and audited later.
- **Primary modules:** `packages/orchestrator-core`, `packages/contracts`, `examples/packets/**`, `apps/cli`
- **Hard dependencies:** W4-S03, W4-S04, W3-S05
- **Primary user-story surfaces:** delivery engineer, finance / audit, engineering manager / planner

### Local tasks
1. Materialize a delivery manifest that captures what changed, how it changed, and what evidence justified it.
2. Materialize a release packet that links delivery output to handoff, promotion, and step-result artifacts.
3. Ensure manifests and packets reload cleanly after process restart.
4. Document how manifests and release packets are consumed later.

### Acceptance criteria
1. Every delivery-capable run can emit a delivery manifest and release packet.
2. The manifest links changed files, delivery mode, evidence roots, and approval context.
3. Release packets link delivery output back to handoff, promotion, and execution evidence.
4. Manifest and release-packet artifacts can be reloaded and inspected after process restart.

### Done evidence
- delivery-manifest fixtures
- release-packet fixtures
- reload tests and updated docs

### Out of scope
- operator UI approvals
- incident or learning-loop capture

---

## W4-S06 — Delivery rehearsal and recovery-safe operations
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** blocked
- **Outcome:** Prove that delivery modes remain safe, inspectable, and recoverable on selected public targets before widening access.
- **Primary modules:** `docs/ops/**`, `examples/live-e2e/**`, `apps/cli`, `packages/observability`
- **Hard dependencies:** W4-S05, W0-S05
- **Primary user-story surfaces:** operator / SRE, AI platform owner, security / compliance

### Local tasks
1. Run delivery rehearsals on selected public targets using patch-only and fork-first safety defaults.
2. Capture manifests, release packets, and recovery evidence for both success and failure paths.
3. Document the human checkpoints required before any real write-back mode is used in production.
4. Refine the standard delivery runbook from rehearsal findings.

### Acceptance criteria
1. Delivery rehearsal works on selected public targets using bounded safety defaults.
2. Manifests, release packets, and recovery evidence remain durable after success and failure paths.
3. Human checkpoints before production write-back are documented explicitly.
4. The standard delivery runbook is updated from rehearsal findings.

### Done evidence
- public-target delivery rehearsal transcript
- delivery evidence set
- updated delivery runbooks

### Out of scope
- web UI operator intervention
- incident scorecards or learning-loop automation

---
