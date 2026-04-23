# W12 implementation slices

## Wave objective
Remove public live-E2E product surfaces, move rehearsal to repo-maintainer-only black-box tooling, and refresh proof through installed-user style execution.

## Wave exit criteria
- public CLI, help, and contract docs no longer expose `aor live-e2e *`
- public project-profile examples no longer expose `live_e2e_defaults`
- target-catalog rehearsal runs execute through an internal black-box harness that launches external `aor` subprocesses
- refreshed proof bundles and runbooks show installed-user style execution without removed public live-E2E commands

## Parallel start and sequencing notes
- `W12-S01` starts first because source-of-truth docs and backlog must describe the breaking cleanup before runtime work proceeds.
- `W12-S02` follows `W12-S01` so the replacement internal harness exists before public surface removal lands.
- `W12-S03` depends on `W12-S02` because the public CLI and contract removal must not leave the repository without a rehearsal path.
- `W12-S04` closes the wave only after fresh proof fixtures and runbooks exist for the internal harness.

---

## W12-S01 — Public surface realignment
- **Epic:** EPIC-0 Repository development system
- **State:** done
- **Outcome:** Rewrite source-of-truth docs so `live-e2e` is no longer presented as a public user-facing AOR command surface and is instead described as internal maintainer rehearsal tooling.
- **Primary modules:** `README.md`, `docs/product/**`, `docs/architecture/**`, `docs/ops/**`, `docs/backlog/**`
- **Hard dependencies:** none
- **Primary user-story surfaces:** operator / SRE, project bootstrap / onboarding, delivery engineer

### Local tasks
1. Remove public-facing descriptions of `aor live-e2e *` from README, product stories, and command-surface docs.
2. Explicitly split public product flow from internal acceptance and rehearsal tooling.
3. Add W12 to the shared backlog model and keep the new breaking-cleanup sequence explicit.
4. Recheck source-of-truth docs for wording that still implies public live-E2E product support.

### Acceptance criteria
1. No source-of-truth doc still describes `aor live-e2e *` as a public user-facing CLI path.
2. Public docs direct installed-user flows through `project analyze`, `project validate`, `project verify`, `deliver prepare`, and `release prepare`.
3. The roadmap, master backlog, epic map, dependency graph, and wave doc agree on the W12 cleanup sequence.
4. Backlog integrity checks pass after the planning-model update.

### Done evidence
- updated entry and planning docs showing internal-only rehearsal semantics
- synchronized roadmap, wave, backlog, and dependency-graph references for W12
- passing slice-cycle integrity checks after the planning update

### Out of scope
- implementing the harness in this slice
- deleting contracts or CLI code in this slice

---

## W12-S02 — Internal black-box installed-user harness
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Add internal maintainer tooling under `scripts/live-e2e/` that launches installed-user style `aor` subprocesses against real target repositories without importing runtime functions directly.
- **Primary modules:** `scripts/live-e2e/**`, `docs/ops/**`, `examples/live-e2e/**`, `packages/observability`
- **Hard dependencies:** W12-S01
- **Primary user-story surfaces:** operator / SRE, delivery engineer, finance / audit / hygiene

### Local tasks
1. Add a black-box harness entrypoint that prepares temp home and runtime roots, target checkouts, and external `aor` invocation.
2. Move scenario-profile configuration from the public example and contract zone into internal harness-owned config.
3. Collect `.aor`, stdout, stderr, scorecard, and learning-loop evidence from the black-box run.
4. Add tests or smoke coverage for valid, invalid-ref, missing-runner, and policy-blocked harness branches.

### Acceptance criteria
1. The short regression scenario can run through external `aor` subprocesses without direct runtime imports.
2. Harness-owned config lives under `scripts/live-e2e/` rather than the public example and contract surface.
3. The harness records target checkout, runtime artifact, and normalized evidence locations for follow-up proof generation.
4. Tests or smoke paths cover success and key blocked or failed branches.

### Done evidence
- internal harness script and config under `scripts/live-e2e/**`
- black-box smoke coverage for target execution and blocked branches
- internal harness transcript or fixture showing external `aor` subprocess usage

### Out of scope
- adding a second live adapter
- preserving public `live-e2e` compatibility

---

## W12-S03 — Breaking CLI and contract removal
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Remove public `live-e2e` CLI, contract, and config surfaces with no compatibility layer once the internal harness exists.
- **Primary modules:** `apps/cli`, `docs/contracts/**`, `packages/contracts`, `examples/**`
- **Hard dependencies:** W12-S02
- **Primary user-story surfaces:** project bootstrap / onboarding, operator / SRE, AI platform owner

### Local tasks
1. Remove `aor live-e2e start`, `status`, and `report` from CLI code, help output, fixtures, and tests.
2. Remove `live-e2e-profile` from public contract docs, loader coverage, and contract-family references.
3. Remove `live_e2e_defaults` from the public meaning of `project-profile` and from public example project profiles.
4. Update contract and CLI tests so no public surface still references removed live-E2E commands or profile families.

### Acceptance criteria
1. Public CLI help and command catalog contain no `live-e2e` entries.
2. Public contract docs and loader expectations contain no `live-e2e-profile` family.
3. Public example project profiles contain no `live_e2e_defaults`.
4. CLI, contract, and example integrity tests pass after the breaking removal.

### Done evidence
- updated CLI help/catalog fixtures with no `live-e2e` commands
- updated contract docs and loader tests with no `live-e2e-profile`
- updated example project profiles and integrity checks with no `live_e2e_defaults`

### Out of scope
- backward-compatible shims or aliases
- public replacement command for the removed rehearsal flow

---

## W12-S04 — Proof refresh after surface cleanup
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Refresh proof fixtures and operator runbooks so catalog-backed evidence references the internal black-box harness and removed public commands do not appear in proof docs.
- **Primary modules:** `docs/ops/**`, `examples/live-e2e/fixtures/**`, `packages/observability`, `scripts/live-e2e/**`
- **Hard dependencies:** W12-S03
- **Primary user-story surfaces:** operator / SRE, delivery engineer, finance / audit / hygiene

### Local tasks
1. Regenerate short-profile proof artifacts through the internal black-box harness.
2. Update runbooks and dependency matrix to use the internal harness commands and new failure signatures.
3. Refresh evidence bundles so they point at installed-user style execution outputs.
4. Link the refreshed W12 proof back into roadmap and backlog closure text.

### Acceptance criteria
1. Refreshed proof bundles no longer rely on removed `aor live-e2e *` commands.
2. Runbooks and dependency docs describe the internal harness path and observed blocked or failed branches accurately.
3. Refreshed evidence still anchors delivery and release lineage to target checkouts and `.aor` artifacts.
4. The resulting evidence is sufficient to close the W12 wave without narrative-only assumptions.

### Done evidence
- refreshed short-profile proof fixtures produced by the internal harness
- updated runbooks and dependency matrix pointing at internal harness execution
- backlog references linking W12 closure evidence to the breaking cleanup

### Out of scope
- long-profile proof refresh
- broad target-catalog expansion
