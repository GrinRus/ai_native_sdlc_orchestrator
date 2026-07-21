# W66 - Live E2E qualification remediation

W66 is a learning-loop remediation wave created from the blocked installed-user
run `live-e2e-ky-medium-codex-20260717T170624Z`. It restores the catalog-backed
live E2E path without weakening the canonical public identifier contract or the
no-upstream-write boundary.

## Wave objective

Catalog repository locators remain portable source metadata while generated AOR
project profiles use canonical repository identities, bootstrap failures retain
their real AOR owner and phase, and the medium/large Codex and Claude
qualification cells can reach provider execution and terminal quality closure.

## Entry conditions

- W65-S07 is done and the repository gate is green.
- The blocked run evidence shows `aor project init` rejecting
  `repos[0].repo_id=sindresorhus/ky` before provider execution.
- Codex and Claude host authentication are available; upstream writes remain
  disabled.

## Wave exit criteria

- Catalog `repo.repo_id` values may remain stable GitHub-style locators, but
  generated public project profiles derive a valid lowercase canonical ID and
  preserve the original locator separately.
- A failed bootstrap public command is classified as AOR-owned bootstrap
  failure before controller-incomplete fallback classification.
- Contract and proof-runner regression tests cover the exact blocked `ky`
  profile path and reject silent identity collisions.
- Fresh medium and large Codex/Claude qualification runs either pass strict
  closure or retain accurate provider/target/AOR blocker evidence without
  upstream writes.

## W66-S01 — Catalog identity, bootstrap health, and qualification recovery

- **Epic:** EPIC-0, EPIC-1, EPIC-7
- **State:** active
- **Outcome:** Catalog-backed installed-user profiles initialize successfully
  with canonical repository identities, bootstrap failures are attributed
  honestly, and the requested four-cell provider qualification matrix is rerun
  from fresh isolated workspaces.
- **Delivery priority:** P0
- **Estimated effort:** M
- **Primary modules:** `scripts/live-e2e/**`, live E2E contracts/tests,
  `docs/backlog/**`, runbook evidence
- **Hard dependencies:** W65-S07
- **Primary user story surfaces:** DEV-01, OPS-06, SEC-04.

### Local tasks

1. **Catalog identity boundary**
   - Purpose: Separate a catalog repository locator from the canonical ID
     required by `project-profile`.
   - Changes: Derive the generated repo ID deterministically from catalog
     identity, keep the remote URL/locator as source metadata, and validate the
     generated profile before public init without lossy ID repair at ingress.
   - Validation: Load and initialize the current `ky` catalog profile plus
     representative organization/repository and already-canonical fixtures.
2. **Run-health failure precedence**
   - Purpose: Preserve the actual failed public bootstrap command instead of
     reporting an operator continuation gap.
   - Changes: Classify failed command/bootstrap evidence before the generic
     in-progress controller fallback and expose stable owner/phase/class values.
   - Validation: Regression fixtures cover bootstrap failure, genuine pending
     operator decision, provider failure, and target readiness failure.
3. **Installed-user regression gate**
   - Purpose: Prevent catalog/profile contract drift from reaching an
     expensive provider run.
   - Changes: Extend live E2E catalog/materialization tests through generated
     profile validation and public `project init`; document the identity rule.
   - Validation: Focused live E2E suites and `pnpm slice:gate -- W66-S01` pass.
4. **Structured planning lifecycle alignment**
   - Purpose: Keep the private full-journey runner aligned with the W60 public planning contract.
   - Changes: Materialize the structured task plan through `aor plan create` before handoff approval, preserve the explicit generated project profile through approval, Runtime Harness, review, and run-status reads, and retain legacy journal-label compatibility for older evidence. Strategic projections read event journals only for canonical runtime run identities; external qualification summaries remain visible without becoming journal owners. Review resolves its Git evidence root from immutable routed step-result lineage rather than the clean target checkout.
   - Validation: A fresh medium run reaches planning, handoff, provider execution, run-status inspection, and review without missing-plan, cross-profile exact-plan mismatch, invalid external-summary event-history, or false no-change failures; its human qualification ID derives a separate canonical lowercase runtime run ID before public ingress.
5. **Fresh provider qualification**
   - Purpose: Confirm the remediation through the requested real black-box
     paths.
   - Changes: Run medium regression and large governance profiles for Codex
     and Claude through the manual skill-agent loop, record qualification and
     quality assessment evidence, and keep all writeback disabled.
   - Validation: Each cell reaches provider execution; any non-pass result
     names the correct owner/phase/class and preserves complete evidence.
6. **Disposable execution permission separation**
   - Purpose: Let a write-capable mission produce a bounded diff without
     granting primary-checkout or upstream writeback.
   - Changes: Keep `patch-only` target edits scoped to the disposable workspace
     while exact-diff delivery authorization and all writeback remain separate.
     Materialize the provider-visible work packet and required local inputs as
     read-only snapshots inside that workspace, preserve canonical evidence
     refs separately, and prohibit evidence paths from selecting an execution
     checkout.
   - Validation: Provider work packets require meaningful edits for implement
     steps, every provider-visible local path is inside the disposable root,
     no-write packets remain read-only, and live execution cannot mutate the
     primary checkout or upstream.
7. **Bounded delivery transaction identity**
   - Purpose: Keep delivery manifest generation valid for long, otherwise
     canonical qualification run IDs.
   - Changes: Derive the coordination transaction through the shared bounded
     content-addressed ID helper while preserving the original run identity in
     `run_refs`.
   - Validation: A long W66-style run ID completes patch-only manifest
     generation without relaxing public ID validation or changing private
     live-E2E contracts.
8. **Content-addressed intake discovery**
   - Purpose: Keep long-ID Mission and follow-up packets visible to canonical
     Flow and next-action reads.
   - Changes: Discover validated intake artifacts by `packet_type` instead of
     treating the legacy readable filename as lifecycle authority.
   - Validation: A `packet-<digest>.json` intake produces the same Flow,
     next-action, analysis, and handoff inputs as a readable packet filename.
9. **Explicit learning project identity**
   - Purpose: Keep public learning closure in the same explicitly selected
     project as the source run.
   - Changes: Expose the handler-supported optional `--project-profile` flag in
     the canonical command catalog and installed CLI parser.
   - Validation: Learning handoff help and lifecycle regression exercise the
     explicit profile without private runner shortcuts.

### Acceptance criteria

1. `project init` accepts the generated `ky` project profile without relaxing canonical ID validation.
2. The external repository locator remains visible without becoming a public repository identity.
3. Bootstrap command failure wins over controller-incomplete fallback in run-health classification.
4. Root and focused gates pass with a clean source checkout.
5. The planning stage uses `aor plan create` and materializes a structured plan before handoff approval.
6. Handoff approval resolves the exact generated project profile used to create the plan.
7. Qualification IDs with UTC timestamp markers never cross the public lowercase run-ID boundary unchanged.
8. Post-provider run-status projections resolve the same explicit project profile as run start.
9. Runtime Harness and review preserve that profile and inspect the disposable execution workspace identified by the routed step result.
10. Patch-only execution permits direct edits only in the disposable workspace while writeback remains disabled until exact-diff delivery authorization.
11. Four fresh provider cells are recorded with no upstream writes.
12. Long canonical run IDs cannot make a producer-owned delivery transaction
    identifier violate the 128-character public-ID contract.
13. Content-addressed intake packet filenames remain discoverable through the
    public Flow and next-action lifecycle.
14. Public learning handoff preserves an explicitly selected project profile.

### Done evidence

- Focused regression tests and current tracked-test execution manifest.
- W66-S01 slice gate output.
- Fresh run summaries, observation reports, run-health reports, qualification
  analyses, and quality assessments for the four requested cells.

### Out of scope

- Public ID grammar changes.
- New providers, target missions, or runtime dependencies.
- Credential storage, upstream delivery, publication, or hosted execution.
