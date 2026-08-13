# Wave 68 implementation slices — runtime model selection

## Purpose

Reconcile, complete, and certify provider-neutral runtime selection for model
and reasoning effort. A route may omit either value and let the selected runtime
choose its native default; an explicit value is validated by the adapter and
mapped to adapter-owned process arguments. Live E2E profiles may opt into an
isolated model/effort selection without changing the active W66 qualification
baseline.

## Existing baseline and decision boundary

W68 is a reconciliation, completion, and certification wave rather than a
greenfield implementation. Current route and adapter contracts, provider
routing, adapter negotiation, step-result evidence, execution-profile
projections, and examples already carry parts of requested/effective
model/reasoning-effort behavior. W68 must inventory that behavior, make one
contract authoritative, close missing compatibility and projection paths, and
qualify the cutover without rewriting historical W66 evidence.

## Current deterministic checkpoint

W68-S01 through W68-S03 are complete on the current source baseline. W68-S04
is the next ready slice for an isolated Codex `gpt-5.6-luna`/`high` rehearsal;
Claude and Qwen live or paid runs remain intentionally deferred. Deterministic
Claude/Qwen format, malformed-output, capability, and no-spawn fixtures remain
part of the completed contract and adapter gates. W66-S09 stays blocked and
production readiness remains `audit-hold` until the fresh four-cell W66 matrix
is rerun after the Anthropic quota blocker is removed.

Model and reasoning-effort values remain adapter-owned opaque stable strings;
AOR does not invent a cross-provider quality scale. Provider-neutral presets
select approved route candidates instead of translating one provider's effort
name into another provider's value. When a value is omitted, requested and
effective fields remain `null` unless the runner reports a trustworthy
effective value, and the source records `runner-default`. An explicit
unsupported value blocks before spawn.

## W68-S01 — Contract and migration baseline for runtime selection

- **State:** done
- **Epic:** EPIC-0, EPIC-3, EPIC-4
- **Hard dependencies:** W67-S05
- **Primary modules:** route/adapter/execution contracts, examples, focused tests

**Purpose:** Make model and reasoning-effort selection explicit in route,
adapter, execution-profile, and evidence contracts while preserving old route
files and their compatibility semantics.

**Changes:**

- add optional `reasoning_effort` to route candidates;
- add adapter-supported effort values and adapter-owned effort argument mapping;
- document runner-native fallback and migration of legacy hidden live defaults;
- add a private live profile for Codex `gpt-5.6-luna` with `high` effort.

**Validation:** contract loader tests reject malformed nested values; all
existing examples still load; the new profile resolves through the catalog
without changing the required W66 matrix cells.

### Local tasks

1. **Inventory and freeze the partial baseline.**
   - Purpose: Distinguish already implemented behavior from missing W68 work.
   - Changes: Record current route, adapter, routing, invocation, evidence, and
     projection fields plus legacy hidden live defaults in one compatibility
     matrix.
   - Validation: Source/reference checks prove every documented field has one
     owner and every existing behavior has an explicit keep/change disposition.
2. **Define the authoritative selection contract.**
   - Purpose: Keep explicit selection provider-neutral without inventing a
     cross-provider effort scale.
   - Changes: Define optional requested/effective model and effort, source
     vocabulary, adapter-owned opaque values, omitted-value semantics, and
     qualification-key linkage to ADR 0022 schema capability.
   - Validation: Contract fixtures cover explicit, omitted, alias-resolved,
     unsupported, and runner-reported effective values.
3. **Define legacy-default migration.**
   - Purpose: Prevent duplicate model/effort arguments while historical live
     profiles remain readable.
   - Changes: Classify adapter `default_args`, route-explicit values, private
     live-profile overrides, historical evidence, and rollback behavior.
   - Validation: Compatibility fixtures prove old profiles load without
     qualifying or silently changing new strict execution.
4. **Align docs, loaders, and examples.**
   - Purpose: Make the contract reviewable before runtime changes depend on it.
   - Changes: Update route, adapter, execution-profile, step-result, examples,
     and validation notes together.
   - Validation: Focused contract, example-loader, and reference checks pass.

### Acceptance criteria

1. Existing route and adapter examples remain loadable with documented legacy
   semantics.
2. Omitted model/effort produces no provider-specific process argument and
   records `runner-default` rather than fabricating an effective value.
3. Explicit values remain adapter-owned strings and require declared adapter
   support plus argument mapping.
4. The current partial implementation has an evidence-backed keep/change
   disposition with no second competing contract.
5. Qualification identity joins adapter digest, runtime selection, output mode,
   and exact output schema without altering historical W66 cells.

### Done evidence

- Current-baseline compatibility matrix.
- Contract test output and example-load/reference report.
- Legacy-default migration and rollback table.

### Out of scope

- Provider-specific policy cutover and qualification baseline changes.

## W68-S02 — Runtime resolution and adapter argument mapping

- **State:** done
- **Epic:** EPIC-3, EPIC-4
- **Hard dependencies:** W68-S01
- **Primary modules:** provider-routing, adapter SDK, step-result evidence, tests

**Purpose:** Resolve explicit model/effort values before spawn and preserve
requested/effective/source fields in route and adapter projections.

**Changes:**

- external-process adapters return runner-native model defaults when a route
  omits `model`;
- explicit reasoning effort is validated against adapter capabilities;
- adapter-owned argument templates render model effort values at the process
  boundary;
- terminal request evidence carries model and reasoning-effort resolution.

**Validation:** adapter/provider-routing focused tests cover explicit,
unsupported, and omitted values plus argv mapping; root checks remain green.

### Local tasks

1. **Reconcile deterministic resolution.**
   - Purpose: Make one route-to-adapter path authoritative across existing
     partial implementations.
   - Changes: Normalize requested/effective/source resolution for primary and
     fallback candidates, aliases, omitted values, and runner-reported values.
   - Validation: Provider-routing and adapter fixtures produce identical
     resolution evidence for equivalent candidates.
2. **Enforce capability before spawn.**
   - Purpose: Avoid paid or write-capable execution with unsupported explicit
     selections.
   - Changes: Join model, effort, output-mode, and ADR 0022 schema capability
     during adapter negotiation; retain exact blocker reasons for skipped
     fallback candidates.
   - Validation: Unsupported and unqualified explicit values never spawn;
     policy-eligible compatible fallback remains bounded and ordered.
3. **Render adapter-owned arguments.**
   - Purpose: Keep provider-specific CLI syntax outside orchestrator core.
   - Changes: Render model and effort through adapter profile mappings, suppress
     duplicate legacy defaults, and retain sanitized invocation identity.
   - Validation: Codex, Claude, mock, and negative custom-adapter argv fixtures
     contain exactly one applicable mapping and no secret values.
4. **Persist truthful execution evidence.**
   - Purpose: Let qualification and operators distinguish requested, effective,
     and native-default behavior.
   - Changes: Align route resolution, adapter response, step-result, Harness
     capture, and attempt evidence.
   - Validation: Reload/replay fixtures preserve the same selection lineage and
     do not infer an unknown runner-native effective value.

### Acceptance criteria

1. No external process starts with an unsupported or schema-unqualified
   explicit selection.
2. Omitted values add no model/effort flags and preserve runner-native behavior.
3. Provider-specific argument syntax exists only in adapter-owned mappings.
4. Primary and fallback candidates record independent requested/effective/source
   evidence and remain policy-bounded.
5. Existing compatible routes retain their documented behavior and no hidden
   default is applied twice.

### Done evidence

- Adapter/provider-routing semantic matrix.
- No-spawn capability and bounded-fallback regressions.
- Sanitized invocation and step-result evidence fixtures.

### Out of scope

- Operator UI controls and live qualification certification.

## W68-S03 — Runtime selection projection and presets

- **State:** done
- **Epic:** EPIC-1, EPIC-3, EPIC-6
- **Hard dependencies:** W68-S02
- **Primary modules:** execution profile/readiness projections, CLI/API/web fixtures

**Purpose:** Expose selection in operator-facing execution projections without
  leaking provider-specific flags into the orchestrator core.

**Changes:** add resolved selection fields to execution-profile/readiness and
  route-attempt projections; define reusable provider-neutral presets for
  coding, planning, judge, and live E2E diagnostics.

**Validation:** projection fixtures preserve route IDs, source metadata, and
backward-compatible nulls when no explicit selection is present.

### Local tasks

1. **Project runtime selection.**
   - Purpose: Expose requested/effective/source evidence without leaking CLI
     syntax or inventing native defaults.
   - Changes: Align execution-profile, readiness, route-attempt, Flow/Task, and
     control-plane projections.
   - Validation: Projection fixtures cover explicit, omitted, unavailable,
     unqualified, fallback, and legacy-null states.
2. **Define provider-neutral presets.**
   - Purpose: Give operators reusable choices without translating provider
     effort vocabularies in core.
   - Changes: Define coding, planning, judge, and live-diagnostic presets as
     approved route selections with capability/readiness summaries.
   - Validation: Presets resolve only registered routes and never inject raw
     model/effort values outside route contracts.
3. **Align CLI, API, OpenAPI, and web reads.**
   - Purpose: Keep headless and installed surfaces on the same source of truth.
   - Changes: Add additive fields, stable unavailable reasons, recovery actions,
     and backward-compatible null behavior.
   - Validation: Contract drift, serialization, reload, and control-plane client
     fixtures pass.
4. **Prove query safety.**
   - Purpose: Keep runner arguments, credentials, and private paths out of
     operator projections.
   - Changes: Add provider flag, secret, auth-home, and local-path canaries.
   - Validation: CLI/API/web snapshots expose only approved route and sanitized
     selection metadata.

### Acceptance criteria

1. Projection rows preserve route identity and backward-compatible nulls.
2. Requested, effective, and source fields are consistent across CLI, API,
   OpenAPI, web, step-result, and Harness evidence.
3. Presets select approved routes and never normalize one provider's effort
   vocabulary into another provider's value.
4. Unavailable or unqualified selections remain visible with a stable reason
   and cannot be started.
5. Query surfaces contain no provider flags, secrets, raw auth paths, or
   private live-profile details.

### Done evidence

- Execution-profile/readiness/attempt projection matrix.
- CLI/API/OpenAPI/web parity output.
- Query-safety canary results.

### Out of scope

- New runtime stores or provider-specific flags in core.

## W68-S04 — Live E2E selection and Codex Luna/high rehearsal

- **State:** ready
- **Epic:** EPIC-0, EPIC-4, EPIC-7
- **Hard dependencies:** W68-S02
- **Primary modules:** private live profiles/materialization, runbook, proof tests

**Purpose:** Let a live profile select a concrete model and effort while keeping
  generated assets isolated and no-write by default.

**Changes:** materialize profile/provider runtime selection into pinned routes;
  suppress legacy adapter `default_args` only for an explicitly selected live
  run; retain source profiles and W66 evidence unchanged.

**Validation:** private proof-runner tests assert generated Codex routes contain
`gpt-5.6-luna` and `high`, generated permission modes have no duplicate legacy
model defaults, and other provider variants remain unchanged.

### Local tasks

1. **Define the isolated live profile.**
   - Purpose: Prove one explicit selection without changing shared or historical
     qualification inputs.
   - Changes: Add a private Codex Luna/high profile with pinned target, scenario,
     output schema, no-write boundary, and unique evidence identity.
   - Validation: Catalog/profile checks reject missing selection, schema,
     isolation, or no-write fields.
2. **Materialize selected routes safely.**
   - Purpose: Avoid duplicate legacy defaults and source-profile mutation.
   - Changes: Generate run-scoped routes and adapter assets, suppress applicable
     copied `default_args`, and preserve source digests.
   - Validation: Snapshot tests show exactly one Luna/high mapping and unchanged
     non-selected providers.
3. **Prove deterministic preflight and browser readiness.**
   - Purpose: Fail before paid execution when selection, capability, or installed
     UI projection is inconsistent.
   - Changes: Extend private proof-runner and guided-profile fixtures for
     selection/readiness/readback.
   - Validation: Unsupported, unavailable, duplicate-argument, stale, and
     secret/path canary scenarios fail closed.
4. **Run one bounded isolated rehearsal.**
   - Purpose: Establish real evidence for the selected runtime path before
     cutover certification.
   - Changes: Execute the approved no-upstream-write profile from an isolated
     install and retain path-neutral evidence.
   - Validation: Actual requested/effective/source selection, schema acceptance,
     terminal health, and unchanged primary/upstream state are proven.

### Acceptance criteria

1. Generated assets carry the selected Luna/high values exactly once and never
   mutate source profiles.
2. The selected route is schema-qualified under ADR 0022 before spawn.
3. Other provider variants and historical W66 evidence remain byte-for-byte
   unchanged.
4. The installed journey exposes truthful selected/default/readiness state and
   durable readback.
5. The bounded rehearsal writes neither primary source nor upstream and retains
   no credential or private runtime path in committed evidence.

### Done evidence

- Isolated live-E2E materialization and route snapshots.
- Deterministic preflight/browser matrix.
- Path-neutral bounded rehearsal evidence index.

### Out of scope

- Promoting the profile to the required W66 qualification matrix.

## W68-S05 — Cutover, certification, and docs closure

- **State:** blocked
- **Epic:** EPIC-0, EPIC-4, EPIC-7
- **Hard dependencies:** W68-S03, W68-S04
- **Primary modules:** qualification ledger, runbooks, root gates

**Purpose:** Certify the new selection path and decide whether the default
  Codex live profile can move from the legacy pinned model to the runtime-native
  policy.

**Changes:** run isolated medium/large Codex rehearsals, record qualification
  evidence, remove migrated hidden defaults only after evidence closure, and
  update runbooks/README/backlog status.

**Validation:** deterministic gates, focused live-E2E proof, and a ledger-linked
cutover decision. No upstream writes or mutation of historical evidence.

### Local tasks

1. **Freeze the certification manifest.**
   - Purpose: Make every final cell attributable to one accepted behavior
     commit and target revision.
   - Changes: Pin AOR/target commits, profile and adapter digests, selected
     schema, model/effort, output mode, scenarios, and no-write policy.
   - Validation: Manifest validation rejects drift or mixed-commit evidence.
2. **Run the bounded Codex certification cells.**
   - Purpose: Compare medium and large behavior before default cutover.
   - Changes: Execute isolated installed profiles sequentially with fresh IDs
     and full selection/output/health evidence.
   - Validation: Both cells meet the frozen manifest and ADR 0022 acceptance;
     any product fix restarts the affected certification set.
3. **Record the reversible cutover decision.**
   - Purpose: Remove hidden defaults only when evidence supports the new path.
   - Changes: Update the qualification ledger with promote/hold decision,
     rationale, compatibility limits, rollback profile, and evidence refs.
   - Validation: The decision is mechanically derivable from accepted cells and
     rollback restores the prior route/default without rewriting history.
4. **Close docs and deterministic gates.**
   - Purpose: Keep README, runbooks, examples, backlog, and release claims
     aligned with the selected policy.
   - Changes: Update owning docs and run focused, root, reference, package, and
     slice gates.
   - Validation: All gates pass and committed evidence is path-neutral,
     credential-free, and contains no runtime state.

### Acceptance criteria

1. Certification uses one frozen AOR/target/profile/schema manifest.
2. Medium and large Codex evidence carries truthful requested/effective/source
   selection and accepted output contracts.
3. Hidden defaults are removed only after a ledger-linked promote decision.
4. Hold leaves the prior default intact and records an explicit next action.
5. Cutover is reversible without changing historical W66 evidence or writing
   upstream.
6. Focused, root, package, reference, and slice gates pass.

### Done evidence

- Frozen certification manifest and two accepted cell indexes.
- Qualification ledger promote/hold and rollback decision.
- Root, package, reference, and slice-gate output.

### Out of scope

- Any upstream repository write or irreversible default change without evidence.
