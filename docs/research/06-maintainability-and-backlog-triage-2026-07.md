# Maintainability and backlog triage — 2026-07-14

## Purpose and baseline

This note records a current-tree delta review after the broader July audit in
`docs/research/05-codebase-audit-2026-07.md`. The original audit baseline was
commit `db995171`; this review inspected `1c5ef521` and treats the existing
AUD-001 through AUD-055 ledger as the primary remediation source rather than
creating duplicate findings.

The review covered root gates, tracked tests, dependency state, release
automation, module size/complexity, dependency cycles, duplicated contract
families, backlog integrity, tracked artifacts, and ignored local runtime data.
Observed facts below are separated from AOR-specific backlog conclusions.

## Observed facts

### Root test coverage is incomplete

- The repository tracks 57 `*.test.mjs` files.
- `scripts/test.mjs` currently executes 43 and omits 14 files. The omission grew
  from 12 at the original audit baseline because the two provisional W60 tests
  were also not added to the static lists.
- Direct execution of the 14 omitted files on Node `v22.22.3` ran 59 tests:
  59 passed, with no failures, skips, todos, or cancellations.
- `pnpm test` and `pnpm check` pass, but that green result is incomplete by
  construction. Production-readiness also reads source markers from at least one
  omitted test instead of proving that the test executed.

Conclusion: test discovery is a prerequisite for trusting later remediation,
not a late maintainability improvement. W57-S09 owns the correction; W57-S08
re-verifies it after the safety regressions land, and W59-S04 preserves it as a
ratchet.

### Dependency and quality gates need two different time horizons

- The lockfile resolves `vite@8.0.14`.
- The production-only audit is clean, while the full audit reports one high and
  one moderate development advisory. Both are patched in Vite `8.0.16` or later:
  [GHSA-fx2h-pf6j-xcff](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff)
  and [GHSA-v6wh-96g9-6wx3](https://github.com/vitejs/launch-editor/security/advisories/GHSA-v6wh-96g9-6wx3).
- Root `lint` is a repository-integrity scanner, not source linting. The existing
  `tsconfig.base.json` is inactive; no scoped ESLint/checkJs ratchet, coverage
  baseline, license gate, or canonical dependency policy is active.
- Root/slice quality commands duplicate stages, and the private-suite timeout can
  consume the full CI job budget without diagnostic reserve.

Conclusion: the known Vite patch belongs in the early W57-S09 safety baseline.
The ongoing dependency/license policy, source lint/typecheck, diagnostic
coverage, non-duplicating pipeline, timeout policy, and debt ratchets remain one
coherent W59-S04 outcome. Minor available updates are policy input, not separate
backlog slices.

### Confirmed refactor hotspots remain

The diagnostic scan is not yet a CI baseline, but it confirms the audit's shape:

- web: `FlowCockpit` (complexity 215, 588 lines), `App` (146, 1,236),
  `RightRail` (118, 189), and provisional `PlanWorkbench` (48);
- core/CLI/adapter: `executeRoutedStep` (147, 753),
  `handleOperationsCommand` (144, 772), `materializeReviewReport` (126, 555),
  and adapter `execute` (78, 711);
- verification/delivery: `verifyProjectRuntime` (91, 696),
  `runDeliveryDriver` (47, 417), plus delivery-plan and fork-first transaction
  responsibilities;
- operator projections: `certifyAssetPromotion` (87, 446),
  `buildClosureState` (89, 222), `buildArtifactReadiness` (76, 221), and
  `listRuns` (55, 357).

The same scan reported 127 complexity, 81 function-length, and 29 nesting
violations, plus 243 unused-symbol/import candidates. Of those candidates, 237
are imports inherited from the CLI mega-barrel across five handlers, so they are
an architectural signal rather than 237 independent cleanup tasks.

Confirmed bounded dead-code candidates include unused internal loader/constants/
helpers, a stale SPA field, and redundant default React imports. No whole unused
production file was confirmed. Compatibility wrappers and legacy packet/reference
formats remain intentional until their owning migration slices close.

Conclusion: W59-S03 through W59-S06 already own the main audit hotspots and now
explicitly include provisional W60 code in their baseline. The verification-to-
delivery and operator-projection groups are separately acceptable outcomes and
are tracked as W64-S02 and W64-S03 instead of inflating W59-S05 or mixing
behavior-preserving refactors into P0 W57 repairs.

### Dependency boundaries and duplication remain measurable

- The ESM cycle remains:
  `http-transport -> http-mutation-handlers -> lifecycle-command ->
  operator-cli/index -> app-launcher -> http-transport`.
- Public and private contract loaders, reference registries, example-reference
  validators, and family metadata still contain large exact copies.
- Workspace package manifests do not describe most cross-package relative
  imports, so the pnpm graph understates the actual module graph. The current
  monolithic npm package works, but the package model must be made explicit
  before package boundaries can be trusted as architecture enforcement.

Conclusion: W58-S06/S08 own cycle removal; W59-S05 preserves the zero-cycle
boundary while decomposing core/CLI; W59-S06 owns public/private parity; W59-S04
records the workspace dependency baseline. No separate package-removal task is
justified without confirmed unused runtime dependencies.

### Provisional W60 implementation landed before acceptance dependencies

Commit `392f94c` added substantial structured-task contracts, planning/runtime
services, CLI/API/web surfaces, and tests while W60-S01 through W60-S04 still
depend on W59-S07. The code is useful and should not be reimplemented, but its
presence is not acceptance evidence. New files also contain validators and mixed
services above the future W59 ceilings.

Conclusion: W60 remains blocked. Its owning wave now records the landed baseline,
decomposition/residual work, and mandatory post-W57/W59 requalification before
story or slice status can advance.

### Release publication is not recoverable after partial failure

The publish workflow currently pushes the git tag, creates the GitHub Release,
then runs `npm publish`. If registry/OIDC publication fails after the earlier
mutations, a rerun rejects its own tag/version as already used. The runbook
describes recovery from a fully published bad release, but not reconciliation of
tag-only, release-only, or npm-only partial state.

Conclusion: this is a distinct release-transaction outcome, not dependency
hygiene. W64-S01 owns exact remote identity inspection, an idempotent state
machine, failure injection, rerun convergence, retained-branch rules, and a
separate partial-publication runbook. The slice performs no real publication.

### Backlog integrity had structural drift

The slice IDs, states, and dependency tables were broadly aligned at intake
(317 slices: 271 done, one ready, and 45 blocked), but semantic checks were too
shallow:

- the roadmap summary named W46 while its detailed W46 section was absent;
- the published topological order placed W8-S08 after consumers W8-S03/S04 and
  W11-S05 after consumer W10-S05;
- several W63 roadmap story allocations differed from their owning wave;
- `slice:plan` loses multiline and nested Purpose/Changes/Validation content;
- title/epic/allocation/detail-section agreement is not mechanically checked;
- 17 historical master rows repeat generic primary-module entries.

The first three defects and the topological order are corrected with this triage.
W60-S01 now owns lossless task parsing and semantic cross-source integrity guards,
including cleanup of remaining historical metadata duplication.

## Artifact and local-data disposition

- No suspicious tracked runtime/build artifact or confirmed orphan production
  file was found.
- `apps/web/dist/**` is an intentional tracked package artifact and is currently
  fresh. Its content-hash/rebuild proof is refined under W59-S01.
- The ten large W34 PNGs are referenced product evidence, not deletion targets.
- Local ignored `.aor/` was approximately 1 GB during this review, dominated by
  retained proof and adapter-request evidence. It must not be deleted as part of
  repository cleanup without evidence-retention and active-run safeguards.
- `node_modules/` is normal ignored workspace state.

Conclusion: do not turn one maintainer's disk cleanup into shared product backlog.
Create an inspect/archive/prune slice only if growth is reproduced as an
installed-user operational problem with explicit retention and active-run rules.

## Prioritized delivery plan

| Order | Backlog owner | Result |
|---:|---|---|
| 1 | W57-S01 | Encode the audit hold and honest supported topology/readiness. |
| 2 | W57-S09 | Make test execution complete/deterministic and patch the known Vite baseline. |
| 3 | W57-S02 through W57-S08 | Repair and prove the P0 trust/data-integrity boundaries. |
| 4 | W58 | Restore truthful read, context/eval, routing, job/event, API, and loopback behavior. |
| 5 | W59-S01 through W59-S07 | Add executable browser confidence, quality ratchets, bounded decomposition, and independent audit closure. |
| 6 | W64-S01 | Make alpha publication idempotent and recoverable before the next publish. |
| 7 | W60 | Requalify and finish the landed structured-planning baseline after audit closure. |
| 8 | W64-S02 and W64-S03 | Perform the two independent behavior-preserving refactor slices; these may run in parallel with W60-W63 after W59-S07. |

W61-W63 retain their existing product dependencies. W64 deliberately depends on
W59-S07 rather than W63 so maintenance work does not create an artificial serial
block on planning, topology, execution, or operator-console delivery.

## Verification performed during triage

- root lint/test/build/check on the current selected test set;
- direct Node 22 execution of all 14 omitted test files;
- production-only and full dependency audits;
- tracked-test and tracked-artifact inventory;
- package dry-run and web-dist freshness checks;
- AST/static hotspot, unused-symbol, clone, and module-cycle inspection;
- backlog ID/state/dependency/detail/allocation comparison.

Raw analyzer/runtime output remains ignored under `.aor/`; only actionable,
source-backed conclusions and backlog ownership are recorded here.
