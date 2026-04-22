# W6 implementation slices

## Wave objective
Deliver command-first post-MVP expansion for intake, run control, UI lifecycle, delivery/release preparation, and incident/audit operations.

## Wave exit criteria
- backlog tooling and consistency checks can schedule and validate `W6+` slices without manual wave-list edits
- planned intake/discovery/spec/wave commands are implemented with contract-backed artifacts
- run control commands are implemented with explicit policy and audit semantics
- UI attach/detach commands preserve headless-first operation while enabling controlled web lifecycle
- delivery/release prepare commands and incident/audit commands produce durable evidence linked to runs

## Parallel start and sequencing notes
- `W6-S01` must land first because all subsequent slices depend on post-W5 backlog tooling support.
- `W6-S04`, `W6-S05`, and `W6-S06` can progress in parallel after `W6-S03` is complete.
- Keep each command pack traceable to its target user-story cluster and contract family.

---

## W6-S01 — Backlog and slice-cycle extensibility for W6+
- **Epic:** EPIC-0 Repository development system
- **State:** done
- **Outcome:** Extend backlog planning and validation tooling so wave files beyond W5 participate in the normal slice loop.
- **Primary modules:** `docs/backlog/**`, `scripts/**`
- **Hard dependencies:** W5-S06
- **Primary user-story surfaces:** engineering manager / planner, repository owner

### Local tasks
1. Update `slice-cycle` loader logic to discover wave files beyond W5.
2. Update repo integrity scripts so backlog consistency checks include newly discovered wave files.
3. Add W6-W8 planning docs and keep roadmap/backlog/graph/epic alignment deterministic.
4. Prove that `pnpm slice:status` and `pnpm slice:next -- --json` can select W6 slices.

### Acceptance criteria
1. Backlog tooling discovers wave files dynamically and can parse W6-W8 slices.
2. `pnpm slice:status` reports W6 slices and keeps state counts coherent.
3. `pnpm slice:next -- --json` selects `W6-S01` as the next slice.
4. Root gate remains green after the planning-tooling change.

### Done evidence
- `pnpm slice:status` output with W6 slices
- `pnpm slice:next -- --json` output selecting `W6-S01`
- `pnpm slice:gate` passing output

### Out of scope
- implementation of planned command handlers
- runtime API behavior changes beyond tooling compatibility

---

## W6-S02 — Intake/discovery/spec/wave command pack
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Implement `aor intake create`, `aor discovery run`, `aor spec build`, and `aor wave create` as durable command-surface flows.
- **Primary modules:** `apps/cli`, `packages/orchestrator-core`, `docs/contracts/**`, `docs/architecture/**`
- **Hard dependencies:** W6-S01
- **Primary user-story surfaces:** product sponsor / owner, discovery / research, project bootstrap / onboarding

### Local tasks
1. Implement the four planned command handlers with contract-backed output artifacts.
2. Align command catalog docs and help semantics with runtime behavior.
3. Add smoke tests and transcript fixtures for each new command.
4. Verify story traceability for sponsor/discovery/bootstrap story IDs.

### Acceptance criteria
1. All four commands move from planned to implemented in the command catalog.
2. Each command writes durable artifacts under `.aor/` with documented contract families.
3. CLI help and docs match actual inputs/outputs and status semantics.
4. Smoke tests cover success and required-flag failure paths.

### Done evidence
- updated `command-catalog.mjs` and architecture catalog docs
- CLI tests and command transcript fixtures
- contract/packet artifact samples for intake/discovery/spec/wave flows

### Out of scope
- run-control commands
- delivery/release and incident/audit commands

---

## W6-S03 — Run-control command pack with policy and audit guardrails
- **Epic:** EPIC-6 Operator surface
- **State:** ready
- **Outcome:** Implement `aor run start`, `pause`, `resume`, `steer`, and `cancel` with explicit policy gating and audit traces.
- **Primary modules:** `apps/cli`, `apps/api`, `packages/orchestrator-core`, `packages/observability`, `docs/contracts/**`
- **Hard dependencies:** W6-S01, W5-S03
- **Primary user-story surfaces:** engineering manager / planner, delivery engineer, operator / SRE, security / compliance

### Local tasks
1. Implement run-control command handlers and shared API/control-plane integration.
2. Enforce policy and approval checks before high-risk control actions.
3. Emit auditable control events linked to run IDs and evidence roots.
4. Add API/CLI smoke tests and fixtures for control transitions.

### Acceptance criteria
1. Run-control commands are implemented and callable through CLI with deterministic semantics.
2. Policy/approval guardrails block unauthorized or out-of-scope control operations.
3. Every control action emits durable audit evidence linked to the affected run.
4. Tests cover command success, blocked operations, and invalid transition handling.

### Done evidence
- API and CLI tests for run-control lifecycle
- control-event fixtures tied to run IDs
- updated ops docs for start/pause/resume/steer/cancel semantics

### Out of scope
- UI attach/detach command lifecycle
- delivery/release and incident command packs

---

## W6-S04 — UI attach/detach lifecycle command pack
- **Epic:** EPIC-6 Operator surface
- **State:** blocked
- **Outcome:** Implement `aor ui attach` and `aor ui detach` so web console lifecycle is explicit, bounded, and operationally traceable.
- **Primary modules:** `apps/cli`, `apps/web`, `apps/api`, `docs/ops/**`
- **Hard dependencies:** W6-S03, W5-S04
- **Primary user-story surfaces:** delivery engineer, architect / tech lead, operator / SRE

### Local tasks
1. Implement attach/detach command handlers and lifecycle state reporting.
2. Keep headless CLI and API operation unaffected when UI is detached.
3. Add detachable web smoke tests and CLI transcript fixtures.
4. Document attach/detach operational guidance and failure handling.

### Acceptance criteria
1. `aor ui attach` and `aor ui detach` are implemented and deterministic.
2. Headless-first operation still works when UI is not attached.
3. Attach/detach state is visible through operator surfaces.
4. Tests cover attach, detach, idempotent retry, and disconnected UI paths.

### Done evidence
- CLI tests and transcript fixtures for attach/detach commands
- web/API smoke tests covering attached and detached modes
- updated operator runbook for UI lifecycle

### Out of scope
- new multi-tenant auth hardening
- run-control feature expansion beyond W6-S03 scope

---

## W6-S05 — Delivery/release prepare command pack
- **Epic:** EPIC-5 Delivery and release
- **State:** blocked
- **Outcome:** Implement `aor deliver prepare` and `aor release prepare` as policy-bounded command entrypoints linked to manifests and release packets.
- **Primary modules:** `apps/cli`, `packages/orchestrator-core`, `docs/contracts/**`, `docs/ops/**`
- **Hard dependencies:** W6-S03, W4-S05
- **Primary user-story surfaces:** delivery transaction / Git / PR flow, repository / multirepo owner

### Local tasks
1. Implement `deliver prepare` and `release prepare` handlers on top of existing delivery artifact foundations.
2. Enforce write-back and release policy checks before manifest/release materialization.
3. Emit command outputs that link directly to delivery manifests and release packets.
4. Add tests and runbook coverage for bounded preparation paths.

### Acceptance criteria
1. Both commands are implemented and no longer listed as planned.
2. Command outputs reference durable delivery-manifest and release-packet artifacts.
3. Policy checks prevent bypass of existing write-back guardrails.
4. Tests cover no-write, branch/fork policy modes, and release precondition failures.

### Done evidence
- updated command catalog and CLI tests for delivery/release prepare
- manifest and release-packet fixtures from command execution
- updated release and delivery runbook sections

### Out of scope
- direct upstream write automation defaults
- incident/audit query surface changes

---

## W6-S06 — Incident and audit command pack
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** blocked
- **Outcome:** Implement `aor incident open`, `aor incident show`, and `aor audit runs` as first-class operational commands.
- **Primary modules:** `apps/cli`, `apps/api`, `packages/observability`, `docs/contracts/**`, `docs/ops/**`
- **Hard dependencies:** W6-S03, W5-S06
- **Primary user-story surfaces:** incident / improvement owner, finance / audit / hygiene

### Local tasks
1. Implement incident create/read command handlers with contract-backed incident artifacts.
2. Implement audit query command surface for run-centric operational evidence.
3. Link incident/audit outputs to run, scorecard, and promotion evidence roots.
4. Add smoke tests and docs for bounded incident/audit workflows.

### Acceptance criteria
1. Incident open/show and audit runs commands are implemented and documented.
2. Incident and audit outputs are durable and contract-compliant.
3. Command output links make run-to-incident and run-to-audit traceability explicit.
4. Tests cover open/show/audit success and invalid lookup paths.

### Done evidence
- CLI/API tests for incident and audit command flows
- incident-report and audit fixture artifacts
- learning-loop/backlog handoff notes linked from command output

### Out of scope
- automated backlog reprioritization
- production billing and tenant-level analytics
