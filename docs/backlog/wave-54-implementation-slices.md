# W54 implementation slices

W54 turns W53's generic verification execution model into an authoring,
discovery, and operator-facing workflow for arbitrary project stacks. After the
W44 disposition, this is the selected implementation lane; W44/W45 remain valid
deferred backlog tracks and are not prerequisites for W54.

## W54-S01 — Verification group authoring contract

- **Outcome:** Extend the generic command-group contract so it can describe real
  multi-root and multi-stack projects without private proof-harness semantics.
- **Epic:** EPIC-4, EPIC-7
- **State:** ready
- **Primary modules:** `docs/contracts/**`, `packages/contracts/**`, examples
- **Hard dependencies:** W53-S05

### Local tasks
1. Document optional command-group authoring fields such as `repo_id`,
   `working_dir`, `depends_on`, `detected_from`, `package_manager`,
   `tool_requirements`, and `skip_policy`.
2. Define command ordering and dependency rules for readiness, baseline,
   post-change, and diagnostic phases.
3. Represent `no-tests`, `missing-tool`, `not-applicable`, and
   `broken-baseline` outcomes as generic AOR evidence.
4. Update project-profile, handoff-packet, wave-ticket, and step-result contract
   docs before implementation depends on the new fields.

### Acceptance criteria
1. Existing W53 command groups remain valid without modification.
2. New authoring fields validate through shared contract loading.
3. AOR contracts do not accept private proof-harness fields.

### Done evidence
- contract-loader tests for optional authoring fields
- updated contract docs and examples

### Out of scope
- Stack detection or profile generation behavior.

## W54-S02 — Stack discovery engine

- **Outcome:** Discover verification command-group candidates from repository
  manifests instead of relying on target-specific matrices.
- **Epic:** EPIC-1, EPIC-4
- **State:** blocked
- **Primary modules:** `packages/orchestrator-core/**`, discovery fixtures,
  tests
- **Hard dependencies:** W54-S01

### Local tasks
1. Detect Node package managers, workspace manifests, and package scripts.
2. Detect Python project metadata from `pyproject.toml`, `setup.cfg`, `tox.ini`,
   `noxfile.py`, pytest, and unittest signals.
3. Detect Go and Rust compiled-project manifests from `go.mod`, `Cargo.toml`,
   and workspace metadata.
4. Detect frontend browser test signals from Playwright, Cypress, Vitest, and
   related config files.
5. Discover monorepo package boundaries and package-level commands.
6. Emit explicit no-tests evidence instead of inventing a passing test command.

### Acceptance criteria
1. Discovery emits command-group candidates with confidence and source refs.
2. Unknown stacks produce `custom` or no-tests suggestions, not runtime failure.
3. Stack detectors do not import or reference private proof-harness modules.

### Done evidence
- discovery-engine fixture tests for supported archetypes

### Out of scope
- Running discovered commands.

## W54-S03 — Project init profile materialization

- **Outcome:** `project init` can materialize safe default
  `verification.command_groups[]` for detected project shapes.
- **Epic:** EPIC-1
- **State:** blocked
- **Primary modules:** `packages/orchestrator-core/src/project-init.mjs`,
  examples, init tests
- **Hard dependencies:** W54-S02

### Local tasks
1. Materialize generated command groups from discovery results during project
   initialization.
2. Preserve legacy `repos[].build_commands`, `repos[].lint_commands`, and
   `repos[].test_commands` as a compatibility read model.
3. Generate only detected setup, build, lint, typecheck, test, e2e, and
   full-suite groups.
4. Keep init side-effect free for target commands: profile generation must not
   install dependencies or run verification commands.

### Acceptance criteria
1. Clean Node, Python, Go, Rust, frontend, monorepo, and no-tests fixtures get
   valid generated profiles.
2. Generated profiles validate through the shared project-profile contract.
3. No private proof-harness vocabulary appears in generated profiles.

### Done evidence
- project-init profile-generation tests
- updated example generated profiles

### Out of scope
- Operator UI for editing the generated plan.

## W54-S04 — Verifier execution semantics hardening

- **Outcome:** `project verify` executes real multi-root command groups with
  dependency, skip, missing-tool, timeout, and baseline semantics.
- **Epic:** EPIC-4
- **State:** blocked
- **Primary modules:** `packages/orchestrator-core/src/project-verify.mjs`,
  verifier tests
- **Hard dependencies:** W54-S03

### Local tasks
1. Execute command groups from their configured `working_dir`.
2. Honor `depends_on` and record skipped evidence for dependent groups after
   required prerequisite failures.
3. Distinguish missing tools from command failures.
4. Keep timeout-class limits separate from hang-detection cleanup.
5. Keep baseline failures distinct from post-change failures in summaries.

### Acceptance criteria
1. Required dependency failure blocks dependent required groups with clear
   skipped evidence.
2. Warn and observe groups never become acceptance evidence.
3. Timeout and hang transcripts preserve stdout, stderr, exit classification, and
   cleanup metadata.

### Done evidence
- verifier dependency, missing-tool, timeout, and skip regression tests

### Out of scope
- Provider adapter execution changes.

## W54-S05 — CLI/API/UI verification plan surfaces

- **Outcome:** Operators can inspect discovered and generated verification plans
  before running expensive checks.
- **Epic:** EPIC-6
- **State:** blocked
- **Primary modules:** `apps/cli/**`, `apps/api/**`, `apps/web/**`,
  `packages/orchestrator-core/**`
- **Hard dependencies:** W54-S04

### Local tasks
1. Add CLI JSON output for discovered command groups, confidence, and source
   refs.
2. Add a dry verification-plan command surface such as `project verify --plan`.
3. Expose verification plan and per-group status through the API read surface.
4. Render compact role, phase, enforcement, timeout, and last-result status in
   the web console.
5. Keep public surfaces free of private proof-harness vocabulary.

### Acceptance criteria
1. CLI JSON includes command groups without private fields.
2. API and web distinguish failed, warn, observe, skipped, and not-applicable
   groups.
3. README and public docs avoid private proof-harness names.

### Done evidence
- CLI/API/web tests for verification-plan inspection

### Out of scope
- Editing command groups from the web UI.

## W54-S06 — Migration and examples

- **Outcome:** Public examples and docs teach command groups while preserving
  legacy command compatibility.
- **Epic:** EPIC-4
- **State:** blocked
- **Primary modules:** `docs/contracts/**`, `docs/ops/**`, `examples/**`,
  CLI tests
- **Hard dependencies:** W54-S05

### Local tasks
1. Update examples for Node, Python, monorepo, browser e2e, no-tests, and broken
   baseline projects.
2. Add a migration guide from legacy `repo_*_commands` and repo command lists to
   `verification.command_groups[]`.
3. Document timeout classes, enforcement modes, dependency skips, and no-tests
   behavior.
4. Keep all public examples free of private target-catalog terms.

### Acceptance criteria
1. Contract loader validates every updated example.
2. CLI tests prove legacy flags still normalize into command groups.
3. Docs state clearly that warn and observe evidence is not acceptance.

### Done evidence
- updated examples and migration docs
- contract-loader and CLI compatibility tests

### Out of scope
- Removing legacy command fields.

## W54-S07 — Real archetype smoke matrix

- **Outcome:** Prove discovery, generated profiles, dry plans, and targeted
  verification against representative project archetypes outside private target
  matrices.
- **Epic:** EPIC-4, EPIC-7
- **State:** blocked
- **Primary modules:** verifier fixtures, smoke tests, docs
- **Hard dependencies:** W54-S06

### Local tasks
1. Add temp-fixture smoke repos for Node, Python, Go/Rust-style compiled,
   frontend/browser, monorepo, no-tests, and broken-baseline archetypes.
2. Run discovery, profile generation, verification-plan dry run, and targeted
   verify for each archetype.
3. Assert generated AOR artifacts contain no private proof-harness fields.
4. Preserve runtime outputs outside committed source.

### Acceptance criteria
1. Each archetype reaches the expected generic status.
2. Broken baseline is represented as a baseline required failure.
3. No archetype requires private target matrix membership.

### Done evidence
- archetype smoke matrix tests

### Out of scope
- Live hard-target product acceptance reruns.

## W54-S08 — Boundary regression expansion

- **Outcome:** Extend W53 leak guards so public docs, examples, source, and AOR
  artifacts stay reusable outside the private proof harness.
- **Epic:** EPIC-0, EPIC-7
- **State:** blocked
- **Primary modules:** boundary tests, public docs/examples, artifact fixtures
- **Hard dependencies:** W54-S07

### Local tasks
1. Extend source guards to public examples and public docs where private terms are
   not allowed.
2. Keep private harness docs and fixtures allowlisted only under their private
   directory.
3. Add artifact-shape tests proving AOR verify summaries cannot contain private
   fields.
4. Add an artificial leak fixture that must fail the guard.

### Acceptance criteria
1. `packages/**`, `apps/**`, public docs, and public examples stay private-term
   clean.
2. Private harness artifacts may reference public AOR artifacts, but AOR
   artifacts never reference private harness artifacts.
3. `pnpm slice:gate` passes and no `.aor/` runtime output is tracked.

### Done evidence
- expanded boundary guard tests
- final W54 evidence matrix

### Out of scope
- Changing private proof-harness acceptance policy.
