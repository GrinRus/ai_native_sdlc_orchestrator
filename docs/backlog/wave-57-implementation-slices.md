# W57 implementation slices

W57 converts the confirmed trust-boundary and data-integrity findings from
`docs/research/05-codebase-audit-2026-07.md` into the first repair lane. The wave
starts by making the audit visible to release decisions, then repairs contracts
before runtime behavior, and closes only with adversarial regression evidence.

The packaged React console remains a local, optional surface. This wave does not
introduce hosted-web security, browser login, OAuth/OIDC, tenant isolation, TLS
termination, or remote-SPA connectivity. It does preserve the security work that
is necessary for any local browser application: a foreign web page must not be
able to drive the loopback control plane, and the shared core must enforce the
same filesystem, delivery, and permission boundaries for CLI, API, and web.

Priorities use the audit remediation scale (`P0` release blocker, `P1` next
repair lane, `P2` planned). Effort estimates use `XS/S/M/L/XL` and include
contracts, implementation, regression tests, and source-of-truth documentation.

## W57-S01 — Audit disposition, release hold, and local-app threat model

- **Outcome:** AOR exposes an honest release/readiness disposition for the open
  audit findings and defines the supported web topology as loopback-only,
  same-origin, and optional.
- **Epic:** EPIC-0, EPIC-6
- **State:** ready
- **Remediation priority:** P0
- **Estimated effort:** M
- **Primary modules:** `docs/architecture/**`, `docs/contracts/**`,
  `docs/ops/**`, `README.md`, `scripts/production-readiness.mjs`, tests
- **Hard dependencies:** W56-S03
- **Primary user story surfaces:** EMP-05, DEV-07, AIP-06, OPS-02, OPS-06,
  OPS-10, SEC-04, SEC-06, PBO-09, DTX-05, FIN-03.
- **Audit findings:** AUD-001 through AUD-022 disposition baseline.

### Local tasks
1. Amend the packaged-local-console ADR and control-plane contract to separate
   the loopback same-origin SPA from the detached production-hardened headless
   API and from any future hosted/remote web product.
2. Record a machine-readable remediation status for every S1 finding and make
   the production-readiness result explain which release-blocking invariants are
   still open.
3. Keep write-capable live execution and credentialed delivery behind an
   explicit unsafe-development opt-in until W57 closure evidence exists.
4. Update the self-hosted environment matrix, release runbook, README readiness
   language, rollback guidance, and user-story coverage matrix to match the audit
   result; downgrade EMP-05, DEV-07, AIP-06, OPS-02, SEC-04, DTX-05, and FIN-03
   to `partial` with gaps W58-S05, W58-S02, W58-S04, W58-S05,
   W57-S05/W58-S04, W57-S03, and W57-S07/W59-S07 respectively.
5. Add source-of-truth tests so a release claim cannot silently ignore the audit
   disposition or reclassify the local SPA as hosted-capable.

### Acceptance criteria
1. Documentation defines `aor app` as a loopback-only same-origin surface and
   keeps the production-hardened detached API usable without the SPA.
2. Hosted web, arbitrary remote control-plane attachment, browser token storage,
   SSO, TLS termination, and tenant security are explicit future ADR triggers.
3. `pnpm production:ready --json` reports a stable blocked disposition while any
   W57 release-blocking invariant remains unresolved, and its tests distinguish
   the expected audit hold from an internal gate failure.
4. Default installed-user commands cannot start credentialed write-capable live
   execution without the explicit unsafe-development override.
5. Mock, dry-run, contract, and repository-integrity development paths remain
   usable while the release hold is active.

### Done evidence
- updated ADR, contracts, environment matrix, release docs, and README
- coverage-matrix gaps for the seven audit-invalidated story outcomes
- production-readiness JSON fixtures for open and closed audit states
- command tests for default block and explicit unsafe-development opt-in
- `pnpm lint`
- `pnpm test`

### Out of scope
- Implementing the individual runtime fixes tracked by W57-S02 through W57-S07.
- Hosted frontend authentication, OAuth/OIDC, RBAC, multi-tenancy, public CORS,
  reverse-proxy trust, TLS, WAF, or internet-facing rate limiting.
- Credentialed provider or real upstream-write proof.

## W57-S02 — Canonical identifier, path, and mission-scope contracts

- **Outcome:** Public contracts reject identifiers and scope descriptions that
  can escape roots, collide after normalization, inject protocol fields, or
  authorize changes outside the mission.
- **Epic:** EPIC-1, EPIC-2, EPIC-3, EPIC-5
- **State:** blocked
- **Remediation priority:** P0
- **Estimated effort:** L
- **Primary modules:** `docs/contracts/**`, `packages/contracts/**`,
  `examples/**`, contract tests
- **Hard dependencies:** W57-S01
- **Primary user story surfaces:** ARC-01, PBO-01, PBO-05, OPS-02, SEC-04,
  DTX-01, DTX-02, DTX-03, DTX-05, FIN-03.
- **Audit findings:** AUD-013, AUD-015, AUD-016.

### Local tasks
1. Define one collision-resistant grammar for project, run, flow, step, attempt,
   event, and artifact identifiers; forbid separators, traversal, control
   characters, drive forms, and lossy normalization.
2. Define explicit canonical-containment rules for project roots, runtime roots,
   working directories, evidence paths, and future write targets.
3. Make every `allowed_paths` element a validated string with documented glob
   semantics; distinguish absent, explicitly empty, malformed, and unrestricted
   scope without fail-open coercion.
4. Define rename/copy/delete scope semantics that retain both Git endpoints and
   treat symlinks/junctions as trust-boundary inputs.
5. Update examples, validation diagnostics, compatibility notes, and migration
   guidance for previously accepted identifiers and scope arrays.
6. Add property-based fixtures for POSIX, Windows, Unicode, CR/LF, wildcard,
   rename, deletion, and collision cases.

### Acceptance criteria
1. Traversal, absolute, separator, CR/LF, drive-letter, dot-segment, and
   collision-equivalent identifiers fail contract validation.
2. Malformed `allowed_paths` fails validation and never becomes unrestricted.
3. `source/*.ts` does not match a nested non-TypeScript path, and all supported
   wildcard behavior is documented with executable examples.
4. Rename validation checks both source and destination, including deletion from
   outside the allowed scope.
5. Every validation error identifies the field, rejected value class, and safe
   migration action.

### Done evidence
- updated identifier, project-profile, delivery, handoff, review, and event
  contract docs
- aligned contract examples and loaders
- property/mutation contract test matrix
- compatibility and migration note
- `pnpm test:references`

### Out of scope
- Runtime filesystem writes or Git staging behavior.
- Automatic migration of ambiguous colliding runtime state.
- Hosted URL, tenant, or remote-browser identifier schemes.

## W57-S03 — True workspace isolation and no-write enforcement

- **Outcome:** No-write execution cannot modify the primary checkout, and every
  advertised execution workspace has independent Git metadata and canonical
  filesystem containment.
- **Epic:** EPIC-1, EPIC-3, EPIC-5
- **State:** blocked
- **Remediation priority:** P0
- **Estimated effort:** XL
- **Primary modules:** `packages/orchestrator-core/src/workspace-isolation.mjs`,
  `packages/orchestrator-core/src/step-execution-engine.mjs`,
  `packages/orchestrator-core/src/delivery-plan.mjs`,
  `packages/adapter-sdk/**`, tests
- **Hard dependencies:** W57-S02
- **Primary user story surfaces:** DEV-01, DEV-09, PBO-01, SEC-04, DTX-05.
- **Audit findings:** AUD-001, AUD-007, AUD-008, AUD-030, AUD-031.

### Local tasks
1. Split execution permission from writeback permission and make
   `delivery_mode=no-write` compile a read-only provider work contract.
2. Replace filesystem copies of `.git` with a detached real Git worktree or an
   independent clone and verify that source and execution gitdirs differ.
3. Use `fileURLToPath`, Git-aware linked-worktree detection, and canonical
   `realpath/lstat` checks for every execution root and existing ancestor.
4. Remove unconditional direct-edit/no-op-forbidden provider instructions from
   no-write requests and propagate the resolved mode into adapter enforcement.
5. Snapshot source SHA, HEAD, index, status, and content before execution and
   fail the run if no-write changes any primary-checkout state.
6. Add cleanup/recovery behavior for failed or interrupted isolated workspaces.

### Acceptance criteria
1. A test adapter that writes in no-write mode cannot change primary source,
   index, HEAD, status, or untracked files and returns a stable blocked result.
2. Worktree and clone modes use independent gitdirs; `git add` and commit in the
   execution root do not affect the source checkout.
3. A symlinked or junction-backed execution path that resolves outside the
   approved root is rejected before provider launch.
4. Linked worktrees, paths with spaces/Unicode, detached HEADs, and ordinary
   repositories preserve correct source metadata.
5. Cleanup is idempotent and never deletes the primary checkout or external
   symlink targets.

### Done evidence
- no-write contract/runtime/adapter tests
- linked-worktree and independent-clone isolation probes
- path-space, symlink, interruption, and cleanup tests
- unchanged-primary-checkout evidence fixture
- `pnpm check`

### Out of scope
- Delivery commit/push semantics, owned by W57-S05.
- Container/VM isolation or a general remote execution platform.
- Real provider credentials or external repositories.

## W57-S04 — Structural runtime permission enforcement

- **Outcome:** Runtime permissions are enforced by normalized capabilities and
  canonical resources rather than bypassable command-text regular expressions.
- **Epic:** EPIC-3
- **State:** blocked
- **Remediation priority:** P0
- **Estimated effort:** L
- **Primary modules:** `docs/contracts/adapter-capability-profile.md`,
  `packages/orchestrator-core/src/runtime-permission-policy.mjs`,
  `packages/orchestrator-core/src/step-execution-engine.mjs`, adapter tests
- **Hard dependencies:** W57-S02, W57-S03
- **Primary user story surfaces:** ARC-01, DEV-09, OPS-03, SEC-01, SEC-04,
  SEC-05.
- **Audit findings:** AUD-002, AUD-008.

### Local tasks
1. Extend the permission contract with normalized operation, resource, network,
   upstream-write, interpreter, and escalation capability fields.
2. Parse supported Git and process forms structurally, including global options,
   aliases, wrappers, and working-directory switches.
3. Deny unparsed interpreters and shell composition by default when they can
   escape declared file/network/process capabilities.
4. Resolve filesystem resources canonically and reject symlink/junction escape
   before auto-approval or resume.
5. Replace coarse full-bypass retries with the smallest auditable grant and bind
   that grant to run, operation, resource, and expiry.
6. Add a command/capability mutation matrix without executing external network
   or upstream writes.

### Acceptance criteria
1. Direct Git push, `git -C`, aliases, shell wrappers, Node/Python network calls,
   and equivalent option permutations receive the same deny decision.
2. Unknown high-capability interpreter requests never auto-approve in
   `trusted-run`.
3. Escaping symlink resources remain denied before and after a resume request.
4. A grant cannot authorize a different command, resource, run, or later step.
5. Permission evidence records normalized intent without leaking secrets or
   relying on raw-command substring claims.

### Done evidence
- updated capability-profile contract and examples
- structural permission classifier and grant tests
- syntax/permutation mutation suite
- symlink and grant-scope probes
- adapter compatibility notes

### Out of scope
- General shell emulation for every command language.
- OS-level sandboxing for untrusted arbitrary binaries.
- Hosted policy administration or tenant-specific permission systems.

## W57-S05 — Exact-diff delivery and resolvable authorization evidence

- **Outcome:** Delivery stages only an exact approved diff and cannot unlock
  commit or push with fabricated, stale, cross-run, or origin-equivalent evidence.
- **Epic:** EPIC-4, EPIC-5
- **State:** blocked
- **Remediation priority:** P0
- **Estimated effort:** XL
- **Primary modules:** `docs/contracts/delivery-plan.md`, delivery/handoff/Harness
  contracts, `packages/orchestrator-core/src/delivery-*.mjs`, CLI handlers, tests
- **Hard dependencies:** W57-S02, W57-S03, W57-S04
- **Primary user story surfaces:** PSO-05, RQA-02, RQA-06, OPS-04, SEC-04,
  DTX-01, DTX-02, DTX-03, DTX-04, DTX-07, FIN-03.
- **Audit findings:** AUD-003, AUD-004, AUD-005, AUD-009, AUD-015.

### Local tasks
1. Version the delivery-plan contract and separate execution, materialization,
   local commit, fork push, and direct-upstream permissions.
2. Resolve handoff, promotion, review, Harness, and coordination refs and verify
   family, schema, project, run, status, freshness, and lock ownership.
3. Snapshot the baseline and calculate the exact allowed add/edit/delete/rename
   set before any Git staging, commit, remote creation, or push.
4. Reject extra tracked/untracked paths and stage only the validated path set;
   never use unbounded `git add -A` for delivery.
5. Canonicalize origin and fork remotes and verify remote inequality plus trusted
   fork-parent metadata before network mutation.
6. Enforce the requested run-level Harness requirement rather than inferring it
   from a soft/step-only report.
7. Add rollback and compatibility behavior for old stored delivery plans.

### Acceptance criteria
1. Missing, wrong-family, wrong-project, wrong-run, stale, held, or non-run-level
   evidence blocks delivery before provider or Git side effects.
2. An unrelated tracked edit, untracked file, deletion, rename endpoint, or
   symlink blocks patch, local-branch, and fork-first delivery.
3. Only approved paths appear in the produced patch and commit tree.
4. Origin-equivalent, mismatched-parent, or local fake fork URLs fail before
   staging and cannot be reported as `direct_upstream_write_allowed=false`.
5. Stored legacy plans are rejected or interpreted through an explicit versioned
   compatibility path rather than permissive defaults.

### Done evidence
- contract/version/migration fixtures
- exact-diff and extra-path Git test matrix
- missing/stale/cross-run evidence tests
- local bare-remote fork-identity probes without external writes
- strict delivery truth-table tests

### Out of scope
- Real GitHub PR creation or credentialed upstream writes.
- Multi-tenant approval administration.
- UI presentation of delivery evidence beyond existing shared read models.

## W57-S06 — Transactional initialization and runtime-root containment

- **Outcome:** Project initialization either publishes one fully valid runtime
  layout inside its canonical root or leaves the previous state unchanged.
- **Epic:** EPIC-1, EPIC-2
- **State:** blocked
- **Remediation priority:** P0
- **Estimated effort:** L
- **Primary modules:** `packages/orchestrator-core/src/project-init.mjs`,
  `packages/orchestrator-core/src/artifact-store.mjs`, asset registry roots, tests
- **Hard dependencies:** W57-S02
- **Primary user story surfaces:** PBO-01, PBO-05, PBO-09, FIN-03.
- **Audit findings:** AUD-013, AUD-014, AUD-029, AUD-030, AUD-031, AUD-052.

### Local tasks
1. Resolve and persist canonical project/runtime roots and reject symlinked or
   escaping roots/ancestors before the first write.
2. Stage the complete initialized layout in a sibling temporary root, validate
   contracts/references, then atomically publish or roll back.
3. Define idempotent recovery for interrupted initialization and pre-existing
   valid runtime state.
4. Use Git-aware branch/source discovery and URL-safe filesystem conversion for
   linked worktrees and install paths with spaces.
5. Reconcile materialized context output with actual registry roots so every
   copied asset has a traced consumer or is not copied.
6. Add failure injection at each write/publish boundary and verify no partial
   state survives.

### Acceptance criteria
1. Traversal IDs and symlinked runtime roots fail before creating any external
   file or directory.
2. Every injected write/validation/publish failure leaves either the previous
   complete runtime or no runtime, never a mixed layout.
3. Repeated initialization is idempotent and preserves valid artifact lineage.
4. Linked worktrees report the real branch/detached state; paths with spaces and
   Unicode initialize successfully.
5. Materialized context is either a validated active registry root or absent.

### Done evidence
- canonical-root and symlink/junction tests
- initialization fault-injection matrix
- idempotency and recovery tests
- linked-worktree/path-space fixtures
- asset-root/reference-integrity proof

### Out of scope
- A database-backed runtime store.
- Automatic repair of already-collided or externally redirected state.
- Remote project initialization.

## W57-S07 — Atomic attempts, run control, and event identity

- **Outcome:** Concurrent execution, operator commands, and event writers preserve
  every transition with unique immutable identities.
- **Epic:** EPIC-2, EPIC-3, EPIC-6
- **State:** blocked
- **Remediation priority:** P1
- **Estimated effort:** L
- **Primary modules:** step result/attempt store, run control,
  `packages/observability/src/live-run-events.mjs`, persistence tests
- **Hard dependencies:** W57-S06
- **Primary user story surfaces:** EMP-03, EMP-05, EMP-06, DEV-01, OPS-01,
  OPS-02, OPS-04, OPS-09, SEC-03, FIN-03, FIN-04.
- **Audit findings:** AUD-011, AUD-016, AUD-017, AUD-023.

### Local tasks
1. Define transactional reservation/idempotency semantics for run, attempt,
   command, transition, event, and artifact identities.
2. Replace scan-then-increment attempt allocation with an exclusive reservation
   and immutable result creation.
3. Serialize or compare-and-swap run-control transitions and return explicit
   conflicts instead of overwriting audit records.
4. Allocate monotonic event sequence/cursor state across processes without
   reparsing and sorting the full log on every append.
5. Make retries idempotent through stable client/request keys and preserve the
   original result or conflict evidence.
6. Add multiprocess barrier tests and crash/restart recovery probes.

### Acceptance criteria
1. Concurrent same-step requests create one idempotent execution or unique
   attempts; no result is overwritten.
2. One hundred simultaneous run-control commands are serialized or explicitly
   rejected, with no silent transition loss.
3. One thousand concurrent event appends have unique monotonic cursors and are
   all replayable after process restart.
4. Duplicate client retries do not spend or execute twice and return stable
   evidence.
5. Append latency and memory do not grow quadratically with journal length.

### Done evidence
- transactional identity contract/tests
- same-step and run-control concurrency stress results
- multiprocess event append/restart results
- idempotency retry fixtures
- bounded performance measurements

### Out of scope
- Distributed multi-host consensus.
- Long-term database migration.
- Live SSE delivery, which is owned by W58-S05.

## W57-S08 — Trust-boundary regression proof and release disposition

- **Outcome:** W57 closes only when the repaired execution, filesystem, delivery,
  and concurrency boundaries are reproducible through public/local test surfaces.
- **Epic:** EPIC-0, EPIC-7
- **State:** blocked
- **Remediation priority:** P0
- **Estimated effort:** L
- **Primary modules:** root gates, safety fixtures, package smoke, release docs,
  audit finding ledger
- **Hard dependencies:** W57-S03, W57-S04, W57-S05, W57-S06, W57-S07
- **Primary user story surfaces:** OPS-06, OPS-07, SEC-04, FIN-03.
- **Audit findings:** W57 closure for AUD-001 through AUD-005, AUD-007,
  AUD-008, AUD-011, AUD-013 through AUD-017, AUD-022, AUD-023, AUD-029
  through AUD-031, and the filesystem/context-foundation portion of AUD-052.
  AUD-009 receives delivery-boundary proof here but closes only with W58-S04
  quality-lineage evidence.

### Local tasks
1. Add automatic discovery for all tracked tests and fail when a new test file is
   omitted without an explicit reason/expiry.
2. Convert W57 safe probes into deterministic regression suites for no-write,
   paths, permissions, delivery evidence, initialization, and concurrency.
3. Remove load-sensitive wall-clock assumptions from the root gate and preserve
   bounded timeout coverage with deterministic fake clocks/process fixtures.
4. Re-run package install/smoke in a clean temporary project and verify only the
   permitted runtime root changes.
5. Reconcile the audit ledger, story evidence claims, release hold, runbooks, and
   production-readiness output with actual W57 closure evidence.
6. Record remaining S1/S2 work as W58/W59 dependencies rather than silently
   marking the whole audit closed.

### Acceptance criteria
1. Test discovery reports every tracked test file and the root gate is stable
   across repeated Node 22 runs.
2. All W57 adversarial regression suites pass without external network writes or
   credentials.
3. Package smoke proves no-write primary-checkout invariance and exact runtime
   root ownership.
4. Production-readiness can clear only the W57 hold with machine-readable evidence
   while still reporting unresolved W58/W59 limitations.
5. Audit IDs and acceptance evidence map one-to-one in the closure report.

### Done evidence
- complete test-discovery manifest and repeated Node 22 gate results
- W57 safety/concurrency regression suite
- package install/no-write smoke transcript
- updated audit disposition and readiness JSON
- `pnpm slice:gate`

### Out of scope
- Credentialed provider, GitHub, or paid external proof.
- Claiming full audit or production closure before W58 and W59.
- Hosted frontend security or deployment evidence.
