# W44 - discovery/research/spec prompt granularity and readiness transitions

W44 turns the current shared `artifact-default` baseline for discovery,
research, and spec into a more precise runtime-asset model without breaking the
existing `artifact` execution class. The work is intentionally split so prompt
bundle granularity lands before any broader context, skill, or policy overlays.

## Wave objective

Maintainers should make discovery, research, and spec steps compile into
step-specific runtime guidance while preserving runner-agnostic core behavior,
compiled-context traceability, and backward compatibility for existing artifact
assets.

## Wave exit criteria

- Source-of-truth docs distinguish workflow steps (`discovery`, `research`,
  `spec`) from execution classes (`artifact`, `planner`, `runner`, `repair`,
  `eval`, `harness`).
- Discovery, research, and spec can resolve distinct prompt bundle refs while
  keeping `prompt_bundle.step_class=artifact` and shared artifact wrapper
  compatibility.
- Runtime readiness semantics define explicit transitions from mission intake
  through discovery, research, spec, and planning readiness, including stale and
  blocked states.
- Compiled-context evidence makes the selected prompt bundle, context bundles,
  skill refs, required input refs, and transition diagnostics inspectable.
- Any context, skill, or policy split is evidence-driven and does not hide new
  behavior inside the old shared artifact baseline.
- Post-implementation documentation and live E2E evidence prove the updated
  discovery/research/spec flow remains operator-safe before W44 is considered
  closed.

---

## W44-S01 — Artifact workflow taxonomy and transition invariants
- **Epic:** EPIC-0 Repository development system; EPIC-3 Routed execution
- **State:** done
- **Outcome:** Define the source-of-truth taxonomy and state-transition
  invariants for splitting discovery, research, and spec runtime assets.
- **Primary modules:** `docs/architecture/**`, `docs/contracts/**`,
  `docs/backlog/**`, `examples/**`
- **Hard dependencies:** W43-S04
- **Primary user story surfaces:** DIS-03, DIS-07, DIS-08, ARC-08, OPS-10.

### Local tasks
1. Document workflow-step selection (`discovery`, `research`, `spec`) versus execution-class compatibility (`artifact`).
2. Define discovery -> research -> spec -> planning readiness states: pending, complete/adr_ready/ready, incomplete, blocked, stale.
3. Record split invariants: keep `step_class=artifact`, shared artifact wrapper behavior, `artifact-default@v1` fallback, and public-repo safety context.
4. Identify which contracts and examples must change in later slices before runtime code depends on the new split.
5. Add acceptance notes for stale downstream artifacts when mission, discovery, or research refs change.

### Transition invariants
| Stage | Ready-state evidence | Blocked-state evidence | Stale-state trigger |
|---|---|---|---|
| Mission intake | Complete intake packet and body refs with goals, constraints, KPI, Definition of Done, and source refs. | Missing or malformed intake fields that prevent discovery from naming evidence gaps. | Mission packet/body refs materially change after discovery, research, spec, or planning evidence exists. |
| Discovery | Current project analysis and discovery evidence linked to the current mission refs. | Missing project profile, missing source refs, failed validation, or discovery command failure. | Mission intake refs or repository/source refs change after discovery evidence was created. |
| Research | `discovery-research-report.status=adr-ready` for strict readiness, or `incomplete` only when a soft profile records explicit missing evidence. | Strict profile lacks current discovery evidence, local research input refs, or ADR-ready recommendations. | Mission or discovery refs change after the research report was created. |
| Spec | Current spec evidence linked to current mission, discovery, and research refs; strict mode requires current ADR-ready research. | Strict profile sees missing, incomplete, blocked, or stale research; soft profile lacks an explicit incomplete-research decision. | Mission, discovery, or research refs change after spec evidence was created. |
| Planning | Current spec can be consumed by planner and handoff creation without stale or blocked upstream evidence. | Spec is missing, blocked, stale, or incomplete under a strict profile. | Spec refs change after wave ticket or handoff planning evidence was created. |

### Downstream implementation targets
| Slice | Contract/example/test target |
|---|---|
| W44-S02 | Add `discovery-default@v1`, `research-default@v1`, and `spec-default@v1` prompt bundle examples with `step_class: artifact`; update project-profile examples and context-compiler tests for distinct prompt refs. |
| W44-S03 | Add readiness diagnostics to contract examples and runtime/read-surface tests for pending, ready, incomplete, blocked, and stale discovery/research/spec/planning paths. |
| W44-S04 | Add context, skill, or policy overlays only if W44-S02/S03 evidence proves a material workflow difference; otherwise record an explicit no-split decision. |
| W44-S05 | Refresh source-of-truth docs and run live E2E proof that the discovery -> research -> spec -> planning path exposes prompt refs and readiness diagnostics. |

### Acceptance criteria
1. Architecture and contract docs define workflow-step versus execution-class ownership without changing existing loader enums.
2. The transition model explains when `spec.ready` is allowed, blocked, or stale.
3. Later implementation slices have explicit contract/example/test targets.
4. The plan preserves compatibility for existing `artifact-default@v1` profiles and compiled-context references.

### Done evidence
- updated architecture/contract guidance for artifact workflow granularity
- updated backlog source-of-truth entries for W44
- transition invariant table for discovery, research, spec, and planning
- `pnpm slice:status`
- `pnpm slice:plan -- W44-S02`

### Out of scope
- Creating new prompt bundles.
- Changing runtime resolution behavior.
- Removing or renaming existing artifact assets.

---

## W44-S02 — Discovery/research/spec prompt bundle split
- **Epic:** EPIC-3 Routed execution
- **State:** done
- **Outcome:** Replace the shared artifact prompt default for discovery,
  research, and spec with distinct step-specific prompt bundle refs while
  keeping the artifact execution class intact.
- **Primary modules:** `examples/prompts/**`, `examples/project*.aor.yaml`,
  `packages/contracts/**`, `packages/orchestrator-core/**`, tests
- **Hard dependencies:** W44-S01
- **Primary user story surfaces:** DIS-03, DIS-07, DIS-08, ARC-08.

### Local tasks
1. Add `discovery-default@v1`, `research-default@v1`, and `spec-default@v1` prompt bundles with `step_class: artifact`.
2. Update project-profile defaults and fixtures so discovery, research, and spec resolve distinct prompt bundle refs.
3. Keep `artifact-default@v1` valid as a legacy fallback without changing artifact wrapper, route class, or baseline context bundle behavior.
4. Add context-compiler tests proving distinct prompt refs and stable compiled-context fingerprints for all three steps.
5. Update reference-integrity examples and docs so required input differences are visible before adapter invocation.

### Acceptance criteria
1. `compileStepContext` for discovery, research, and spec emits distinct `prompt_bundle_ref` values.
2. New prompt bundles validate under the existing `prompt-bundle` contract with `step_class=artifact`.
3. Required inputs, output hints, stop conditions, and redaction expectations reflect each workflow step's role.
4. Existing profiles that still point at `artifact-default@v1` remain valid.

### Done evidence
- prompt bundle examples and project-profile default updates
- context-compiler and reference-integrity test output
- compiled-context fixture or test assertions showing distinct prompt refs
- `pnpm test -- context-compiler`
- `pnpm check`

### Out of scope
- Splitting wrapper or adapter behavior.
- Adding policy-specific gates.
- Changing live provider behavior.

---

## W44-S03 — Artifact readiness state machine and stale transitions
- **Epic:** EPIC-1 Bootstrap and onboarding; EPIC-6 Operator surface
- **State:** done
- **Outcome:** Make discovery, research, and spec readiness explicit in runtime
  evidence and next-action behavior so planning cannot consume stale or blocked
  upstream artifacts silently.
- **Primary modules:** `docs/contracts/**`, `packages/orchestrator-core/**`,
  `apps/cli/**`, `apps/api/**`, `apps/web/**`, `examples/reports/**`, tests
- **Hard dependencies:** W44-S02
- **Primary user story surfaces:** DIS-07, DIS-08, ARC-08, PBO-07, OPS-10.

### Local tasks
1. Choose the owning evidence surfaces for artifact readiness diagnostics without inventing a second orchestration owner.
2. Add deterministic status derivation for mission, discovery, research, spec, stale, blocked, and planning-ready states.
3. Mark downstream discovery, research, and spec evidence stale when upstream mission/input/evidence refs materially change.
4. Surface readiness and blocked reasons through CLI/API/web next-action reads.
5. Add tests for strict and soft readiness profiles, including incomplete research and stale spec transitions.

### Acceptance criteria
1. `spec.ready` is impossible in strict mode without current discovery and research evidence refs.
2. Incomplete research either blocks spec or is explicitly recorded as a soft profile decision with evidence.
3. Upstream mission/discovery/research changes mark downstream artifacts stale instead of silently allowing planning.
4. Operator surfaces show readable blocked/stale reasons without raw JSON inspection.

### Done evidence
- contract/example updates for readiness diagnostics
- runtime and read-surface tests for pass, blocked, incomplete, and stale paths
- next-action output examples
- `pnpm test`
- `pnpm check`

### Out of scope
- Autonomous external research collection.
- Full policy split for every artifact step.
- Delivery or release behavior changes.

---

## W44-S04 — Context, skill, and policy overlays from evidence
- **Epic:** EPIC-4 Quality platform; EPIC-3 Routed execution
- **State:** done
- **Outcome:** Add only the context bundles, artifact skills, and policy
  overlays justified by W44 prompt/readiness evidence, then prove they remain
  traceable through compiled-context artifacts.
- **Primary modules:** `examples/context/**`, `examples/skills/**`,
  `examples/policies/**`, `packages/orchestrator-core/**`,
  `packages/contracts/**`, `docs/architecture/**`, tests
- **Hard dependencies:** W44-S02, W44-S03
- **Primary user story surfaces:** DIS-08, ARC-08, RQA-06, AIP-11, OPS-10.

### Local tasks
1. Review W44-S02 and W44-S03 evidence before adding any overlay assets.
2. Add step-specific artifact skill profiles only when workflow differences remain material after prompt split; keep `step_class: artifact`.
3. Add context bundle overlays only where discovery, research, or spec need different always-on rules or pull-on-demand docs.
4. Decide whether research ADR-readiness or spec handoff-readiness requires a policy split; keep shared artifact policy when no new gate exists.
5. Add asset-graph, compiled-context, and certification/provenance evidence for any new overlays.

### Acceptance criteria
1. Overlay assets are justified by evidence and not created speculatively.
2. Any new skill profile remains compatible with route class `artifact`.
3. Any policy split exposes explicit gate, retry, repair, and blocked-reason behavior.
4. Compiled-context artifacts show overlay context refs and skill refs with stable provenance.

### Done evidence
- overlay asset examples or explicit decision not to split
- compiled-context test fixtures with overlay provenance
- asset graph/reference validation output
- promotion or certification evidence when platform assets change materially
- `pnpm check`

### W44-S04 disposition evidence
- Decision: no discovery/research/spec context, skill, or policy overlay split
  in this slice.
- Rationale: W44-S02 provides workflow-specific prompt bundles while W44-S03
  readiness diagnostics carry ADR-ready and handoff-ready gates without a new
  execution policy.
- Required proof: compiled-context contract/runtime evidence persists selected
  prompt refs, shared artifact context refs, and shared artifact `skill_refs`.

### Out of scope
- Provider-specific prompt syntax.
- Wrapper or adapter split.
- Removing the shared artifact foundation bundle.

---

## W44-S05 — Post-implementation docs and live E2E validation
- **Epic:** EPIC-0 Repository development system; EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Update user-facing and maintainer documentation after W44
  implementation, then run a live E2E proof that discovery, research, spec, and
  planning readiness still work end to end.
- **Primary modules:** `README.md`, `docs/architecture/**`,
  `docs/contracts/**`, `docs/ops/**`, `examples/live-e2e/**`,
  `scripts/live-e2e/**`, tests
- **Hard dependencies:** W44-S04
- **Primary user story surfaces:** DIS-08, ARC-08, DEV-04, OPS-06, OPS-10,
  OPS-11.

### Local tasks
1. Update README, architecture, contract, and ops docs to match the implemented discovery/research/spec prompt and readiness behavior.
2. Refresh examples and runbooks so operators can inspect prompt refs, required input refs, readiness diagnostics, blocked reasons, and stale transitions.
3. Run the appropriate live E2E profile against the implemented W44 flow and capture public evidence refs, reports, logs, and verdicts.
4. Verify the live E2E proof covers discovery -> research -> spec -> planning readiness, including no hidden fallback to the shared artifact baseline.
5. Classify every live E2E or documentation finding as fixed, blocked with owner/phase, or split into a follow-up backlog slice.

### Acceptance criteria
1. Documentation describes the actual implemented behavior and does not describe planned-only prompt, context, skill, policy, or readiness semantics as shipped.
2. Live E2E evidence proves the W44 implementation completes the intended path or records an explicit non-pass verdict with owner, phase, and follow-up slice.
3. Reports expose selected prompt bundle refs, readiness diagnostics, stale/blocked reasons, and compiled-context provenance without requiring raw JSON inspection.
4. W44 cannot be closed if docs are stale or if live E2E evidence is missing, ambiguous, or only mock-based.

### Done evidence
- updated README, architecture, contract, ops, and example docs
- live E2E command, profile, report refs, and verdict
- finding classification notes with owner and phase
- follow-up backlog entries for any unresolved non-pass finding
- `pnpm slice:status`
- `pnpm slice:gate`

W44-S05 closure evidence:
- Docs refreshed in `README.md`,
  `docs/architecture/08-end-to-end-flow.md`,
  `docs/architecture/15-platform-assets-and-prompt-lifecycle.md`,
  `docs/contracts/next-action-report.md`,
  `docs/ops/installed-user-first-run.md`, and
  `scripts/live-e2e/docs/runbooks/live-e2e-standard-runner.md`.
- Focused regression coverage:
  `node --test scripts/live-e2e/test/live-e2e-proof-runner.test.mjs`.
- Live command:
  `node ./scripts/live-e2e/run-profile.mjs --project-ref . --profile ./scripts/live-e2e/profiles/full-journey-regress-ky-medium-codex.yaml --run-id w44-s05-ky-medium-codex-20260704-161801 --runner-auth-mode host`,
  followed by `manual-live-e2e.mjs` operator decisions and step-quality
  reports for discovery, spec, and planning.
- Live report refs:
  `/var/folders/0y/qkpd1n592qjgm3w3rcl_gs6m0000gn/T/aor-live-e2e/w44-s05-ky-medium-codex-20260704-161801/runtime/projects/aor-core/reports/live-e2e-run-summary-w44-s05-ky-medium-codex-20260704-161801.json`,
  `/var/folders/0y/qkpd1n592qjgm3w3rcl_gs6m0000gn/T/aor-live-e2e/w44-s05-ky-medium-codex-20260704-161801/runtime/projects/aor-core/reports/live-e2e-run-health-report-w44-s05-ky-medium-codex-20260704-161801.json`.
- Scoped verdict: W44 path accepted through planning readiness. The summary
  reports `bootstrap`, `discovery`, `spec`, `planning`, and `handoff` as `pass`;
  `artifact_readiness_proof.proof_status=available`; readiness snapshots show
  `mission=complete`, `discovery=complete`, `research=adr-ready`,
  `spec=ready`, and `planning=ready` at the planning checkpoint; prompt lineage
  exposes `discovery-default@v1`, `research-default@v1`, and `spec-default@v1`
  over the shared artifact wrapper.
- Finding classification: live-run implementation findings were fixed in this
  slice (`README` public-boundary wording, undefined readiness command args,
  snapshot timing before controller gates, duplicate resume snapshots, frozen
  next-action snapshot summarization, and intake reuse after manual resume).
  The remaining run-health block is outside W44 scope:
  `owner=operator`, `phase=controller_decision`, `class=controller_incomplete`
  at the handoff gate before execution; the matching evidence warning is tied
  to that next-stage operator decision. No W44 follow-up slice is required.

### Out of scope
- Reopening W44 prompt/readiness implementation scope without a new slice.
- Treating mock-only proof as live E2E closure.
- Publishing a release solely because W44 documentation and live E2E pass.
