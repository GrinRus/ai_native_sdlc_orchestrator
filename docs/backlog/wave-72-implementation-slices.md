# Wave 72 implementation slices — requirements, decisions, and iterative delivery

## Purpose

Move AOR to an iterative Task workflow in which the original request, an
approved compact contract, adopted decisions, and criterion-level verification
drive execution. Discovery, research, specification, and detailed planning are
selected by uncertainty and consequences; their required outputs remain
explicit in the chosen strategy.

The intended operator journey is:

`Request -> Prepared Task -> Start -> bounded work -> verified result -> decision or next iteration -> Review -> Complete`

The motivation includes the [Haulmont translation of Plan Mode Is Dead](https://habr.com/ru/companies/haulmont/articles/1087664/)
and the hypothesis that generated specifications receive insufficient human
review. Treat this as a hypothesis about comprehension and error detection,
not a demonstrated universal fact or permission to remove approval boundaries.

This document registers planned work. It does not claim that W72 behavior,
contracts, human-pilot results, or provider qualification already exist.

The [accepted architecture](../architecture/17-iterative-task-architecture.md)
records all 19 workshop answers and their owners; ADRs 0023-0028 record decisions
and alternatives. The target is a complete replacement before release. The
planning assumption is no production users or running Tasks requiring migration.
No old-model readers, dual engines, opt-in rollout, old-Task conversion, or
engine rollback belong in W72. New-model revision/recovery and partial-delivery
recovery remain required.

The wave now has 21 slices. S18 owns Task domain/publication, S19 controller and
cumulative budgets, S20 bounded units/parallelism, and S21 SWE-bench case/verifier
integration. The [benchmark plan](../research/28-swe-bench-validation-plan.md)
records eight metadata-reviewed candidates, independent checking, and limits;
it does not claim executed environments, attempts, or scores.

[Project positioning](../product/01-project-description.md) owns the new
promise; [iterative Task UX](../product/10-iterative-task-ux.md) owns the proposed
journey, screens, states, and interaction rules. S01 finalizes these sources,
S17 validates the design before S10 public surface contracts, and S11 implements
the accepted
UI. Current fixture observations are design input, not slice-completion proof.

## Entry, scheduling, and release boundary

- W72-S01 depends on completed W71-S14 and starts the development lane.
- Registration leaves W66-S09 active. W72-S01 is ready; the other W72 slices
  are blocked by their hard dependencies. S17 also requires formative human
  observations, and S15 requires the later human-comprehension pilot.
  Selection continues to prefer the existing active slice.
- Keep one active slice. Reconcile backlog scheduling before activating W72;
  W66-S09's active planning record is not evidence of a running worker. This
  planning update does not change its state or require old-Task migration.
- W66-S09 remains the independent release-qualification blocker. W72-S16
  prepares a new freeze and qualification handoff; it does not run paid cells,
  close W66-S09, publish a package, or grant production clearance.
- Preserve historical W66/W71 reports and evidence at their demonstrated
  scope. Qualification of changed runtime behavior requires fresh evidence
  bound to the new source, package, assets, profiles, and target inputs.

## Authority and invariants

- Immutable operator submissions retain the original request and local source
  material. Normalization produces a candidate revision.
- The approved intake-request body owns effective product requirements. Task
  projections display it, and plans/handoffs bind its revision and digest.
- Reuse the existing criteria catalog with stable IDs, source provenance, and
  revision-aware mappings. A plan task, execution unit, attempt, and backlog
  slice keep their distinct identities.
- Proposed decision-record and criterion-verification-report contracts own
  adopted decisions and measured results respectively. They do not create a
  second editable copy of the requirements.
- User answers resolve blockers only after their effect is applied to the
  effective contract or explicitly rejected through the decision boundary.
- Start binds outcome, scope, commands, budgets, delivery mode, routes, and
  approvals. Model confidence cannot grant permission or widen these bounds.
- Deterministic validation precedes semantic evaluation. Runner claims and
  aggregate success cannot substitute for current criterion evidence.
- The headless core owns strategies, iteration, state, next actions, and
  completion. CLI/API/web consume the same services and action catalog.
- Mutable state remains in AOR Home; portable exports remain explicit.
- Task is the stable domain owner; lifecycle, unit execution, and scoped typed
  blockers remain separate. Its authoritative head atomically publishes linked
  immutable artifacts and supports crash recovery without event sourcing.
- A detached leased/fenced controller owns each executing Task. Resume first
  reconciles existing work; all work consumes one cumulative capability-aware
  budget. Parallel units require validated independence and isolated writers.
- Preparation uses validated declarative policy snapshots. Mandatory context
  constraints survive compaction and detail retrieval has explicit bounds.
- Delivery permission is separate from Start and pins exact proof, diff,
  baseline, destination, and mode. Partial delivery cannot close the Task.

## Delivery checkpoints

| Checkpoint | Slices | Independently reviewable result |
| --- | --- | --- |
| Positioning and interaction design | S01, S17 | Product promise, Task journey, visual/state targets, and formative usability evidence before S10/S11. |
| Requirements and closure correctness | S02-S06, S18 | Task owns authority, answers change requirements, and completion requires criterion evidence. |
| First complete iterative journey | S07-S11, S19-S20 | Adaptive preparation, controller/budget/unit execution, and decision/result views through CLI/API/web. |
| Active revision and replacement | S12-S14 | Safe replan, multirepo invalidation, retired-path removal, and one runtime model. |
| Evaluation and installed acceptance | S15-S16, S21 | Independent repository verification, AOR adversarial cases, human observations, installed proof, and qualification freeze. |

The recommended topological order is S01, S02, S18, S03-S08, S19, S09,
S20, S21, S17, then S10-S16. S17 preparation may begin after S01;
backend S02-S09/S18-S21 remain independent of participant scheduling, while
S10/S11 require the accepted design.
Hard dependencies permit independent preparation, but activation and integration
remain sequential. W72-S16 owns combined installed acceptance.

The earlier 8-12-week estimate preceded these accepted ownership/runtime and
replacement decisions and is not a current commitment. Re-estimate after S01/S02
and S17, including S18-S21, prototype work, benchmark environment qualification,
participant scheduling, and the separate paid qualification lane. Estimates
never substitute for acceptance evidence.

## Verification and evidence policy

Each slice updates its owning product/architecture/contract sources before or
together with dependent implementation. Develop bounded slices against fresh
isolated state and produce one complete replacement. Preserve historical
evidence without making old-model execution a supported path.

Use deterministic checks, focused tests, then `pnpm slice:gate`; that gate
already includes `pnpm check`. Contract changes also require
`pnpm test:references` and contract-kernel parity. Runtime assets require
compiled provenance, replay, and representative evaluation. Rendered web
changes require `pnpm test:web:browser`, responsive and keyboard/focus proof.

Done evidence below lists required future closure artifacts. Registration
does not assert that those artifacts or passing results have been produced.
Fixtures, local installed proof, human-pilot observations, and live-provider
qualification must retain separate evidence labels.

## W72-S01 — Product operating model and comprehension baseline

- **State:** ready
- **Epic:** EPIC-0, EPIC-1, EPIC-2, EPIC-6, EPIC-7
- **Hard dependencies:** W71-S14
- **Outcome:** A documented Task/decision operating model and predeclared comprehension baseline bound the transition.
- **Primary modules:** product stories and Task Workspace definition, architecture operating model, backlog sources, baseline scenario and pilot protocol
- **Primary user story surfaces:** PSO-01, PSO-02, PBO-09, OPS-11, OPS-12, FIN-03

**Purpose:** Define the intended user outcome, delegation boundaries, and
measurable comprehension baseline before changing runtime contracts.

**Changes:** Finalize product positioning and the target UX brief, then describe
compact Task authority, consequence-based preparation,
iteration and decision boundaries, closure semantics for change/no-write work,
and a predeclared comparison protocol for the existing and proposed journeys.

### Local tasks

1. **Define the operator contract.**
   - Purpose: Make the user's Start decision and runtime autonomy reviewable.
   - Changes: Finalize product/UX sources and the D01-D19 register/ADRs 0023-0028; align operating-model/module/stack sources with Task authority, policies, budgets, scoped blockers, context, proof, delivery, and breaking replacement; map supported stories without promoting coverage.
   - Validation: Walk through bugfix, analysis, API, architecture, and multirepo scenarios and identify one authority owner for every requirement and decision.
2. **Specify preparation and decision policy.**
   - Purpose: Establish which uncertainty or consequence requires discovery, research, specification, detailed planning, or user intervention.
   - Changes: Record strategy inputs, conservative minimum gates, meaningful behavior changes, skip reasons, and the separation between product decisions and execution permissions.
   - Validation: A decision table covers simple, ambiguous, high-consequence, no-write, and missing-prerequisite cases without depending on model confidence.
3. **Prepare baseline cases and evaluation protocol.**
   - Purpose: Make comprehension and error detection measurable before observing the new flow.
   - Changes: Define representative requests, independently authored expected behavior, seeded contradictions and negative requirements, baseline version/package references, metrics, the S17 formative and S15 comparative protocols/cohorts, and acceptance thresholds; reserve raw participant evidence for private runtime storage.
   - Validation: Every case has ground truth and expected observable checks; thresholds and analysis rules are recorded before pilot observations.
4. **Reconcile delivery and qualification ownership.**
   - Purpose: Keep the new development lane compatible with the single-active-slice rule and release history.
   - Changes: Distinguish W66 backlog scheduling from runtime/process state; record W72 checkpoints, all 19 decision owners, S18-S21 prerequisites, and qualification handoff; keep roadmap, wave, master, epic, graph, and readiness aligned without old-engine compatibility tasks.
   - Validation: Slice helpers load the plan with no state drift or additional active slice, and no development record grants provider qualification or release clearance.

### Acceptance criteria

1. Product positioning, target UX brief, and architecture sources agree on the operator outcome, effective Task owner, delegated Start bounds, required decisions, and closure for all supported work types.
2. Strategy and decision tables cover the representative cases and preserve deterministic safety gates.
3. Baseline cases include an answer contradicting generated acceptance, a lost negative requirement, and successful commands with missing criterion proof.
4. Pilot metrics and thresholds are predeclared; existing story statuses and historical evidence remain accurately scoped.

### Done evidence

- Updated product/operating-model sources and story-to-outcome mapping.
- Baseline case catalog and predeclared human-comprehension protocol.
- Recorded scheduling/qualification disposition and synchronized backlog sources.
- Reference/guidance checks, slice helper output, and `pnpm slice:gate`.

### Out of scope

- Runtime implementation or completed human-pilot claims.
- Paid provider execution, upstream writes, package publication, or release clearance.

## W72-S17 — Iterative Task UX design and prototype validation

- **State:** blocked
- **Epic:** EPIC-0, EPIC-1, EPIC-4, EPIC-6, EPIC-7
- **Hard dependencies:** W72-S01
- **External blocker:** The formative usability cohort and observation window have not been arranged; acceptance requires real observations under the S01 protocol.
- **Outcome:** An accepted Task UI/UX design and tested fixture prototype make behavior, decisions, proof, and recovery understandable before public surface contracts and UI implementation are fixed.
- **Primary modules:** product positioning and iterative Task UX sources, screen/state inventory, existing web tokens/components, fixture prototype and formative usability evidence
- **Primary user story surfaces:** PBO-09, PBO-10, DEV-06, OPS-01, OPS-04, OPS-11, OPS-12, RQA-02, FIN-04

**Purpose:** Validate a coherent result/decision-focused experience before
implementing its projections, action payloads, and Task Workspace composition.

**Changes:** Refine the documented journey using current renderer observations,
produce visual/state targets and a clickable prototype, observe real operator
decisions, and hand the accepted design requirements to S10 and S11.

### Local tasks

1. **Map the journey and complete state inventory.**
   - Purpose: Make the operator's next job and recovery path explicit.
   - Changes: Refine `docs/product/10-iterative-task-ux.md` navigation, Prepared/Overview/decision/review/revision/completion surfaces, content hierarchy, expert drilldown, and loading/partial/error/offline/stale/budget states against the S01 brief.
   - Validation: Bugfix, no-write, architecture, and multirepo walkthroughs identify one clear primary action, owning authority, and recovery for every boundary.
2. **Define visual and interaction targets.**
   - Purpose: Make meaningful behavior and proof readable without losing important constraints.
   - Changes: Create concrete desktop/narrow layouts, decision comparisons, criterion rows, microcopy, keyboard/focus behavior, and accessible state treatments using current Command Desk tokens/components; keep original/negative requirements and material permissions visible.
   - Validation: Inspect 390/768/1280/1440px and 200% zoom targets for overlap, clipping, action visibility, color-independent status, and accessible navigation; success glyphs cannot label unknown acceptance.
3. **Build a clickable fixture prototype.**
   - Purpose: Make the design reviewable through realistic interactions before production code depends on it.
   - Changes: Prototype Prepare/Start, manual-only retry contradiction, decision adoption preview, criterion-proof lookup, unknown/stale proof, exhausted budget, active revision, and follow-up; label fixture data and proposed actions separately from live authority.
   - Validation: The intended paths and recovery controls work with keyboard and pointer; no real runner, upstream write, hidden runtime store, or prototype action can certify implemented behavior.
4. **Observe formative usability and revise.**
   - Purpose: Discover incorrect mental models before contract and UI implementation.
   - Changes: Execute S01's formative protocol, initially targeting 5-6 mixed-experience participants; record unprompted explanations of Start bounds, seeded-error detection, consequence comparison, proof lookup, recovery, assistance, and revisions.
   - Validation: Actual participant/task/prototype identities support findings; resolve critical authorization or success-state misunderstandings and repeat affected scenarios before design acceptance.
5. **Freeze the design and implementation handoff.**
   - Purpose: Keep product, contracts, components, and validation criteria aligned.
   - Changes: Record the selected screen/state targets and sanitized findings in the product UX source; bind S02 requirement/verification authority, map public data/actions to S10, implementation to S11, and final comparative/installed evidence to S15/S16; retain W70/W71 acceptance history.
   - Validation: Every surface maps to an owning runtime action/data requirement and an acceptance scenario; fixture/prototype/formative results cannot promote supported-story or provider evidence tiers.

### Acceptance criteria

1. Product positioning, journey, screen/state inventory, and visual targets form one coherent Task experience with clear operator jobs and recovery.
2. A labelled clickable prototype demonstrates consequential decisions, negative requirements, criterion proof, and incomplete/stale evidence without production authority claims.
3. Actual formative observations inform the selected design and critical decision/success-state misunderstandings are resolved within documented sampling limits.
4. S10/S11 receive reviewable data/action/component requirements and responsive/accessibility scenarios bound to S02 authority; S15/S16 retain distinct final acceptance ownership.

### Done evidence

- Updated product UX source, screen/state targets, and clickable fixture prototype.
- Actual formative observations, sanitized findings, revisions, and design disposition.
- Responsive/keyboard prototype evidence and S10/S11 data/action handoff.
- Reference/source alignment, slice helper output, and `pnpm slice:gate`.

### Out of scope

- Production runtime/UI implementation, paid provider execution, participant recruitment/messages without explicit authorization, or upstream writes.
- Claiming comparative comprehension improvement, installed runtime closure, or release clearance from prototype evidence.

A [preliminary three-screen prototype](../product/prototypes/iterative-task/README.md)
and its [design QA](../product/prototypes/iterative-task/design-qa.md) are available
as bounded preparatory artifacts. They cover Prepared Task, decision adoption,
criterion Review, and selected recovery paths. They do not complete S17's full
state inventory, formative observations, or accepted S10/S11 handoff; the slice
state and dependencies remain unchanged.

## W72-S02 — Versioned requirements, decision, and verification contracts

- **State:** blocked
- **Epic:** EPIC-0, EPIC-2, EPIC-4, EPIC-6
- **Hard dependencies:** W72-S01
- **Outcome:** Canonical Task authority, requirements, decisions, proof, policies, and budgets have current strict contracts and provenance.
- **Primary modules:** contracts/docs/examples, Task/intake families, plans/handoffs, policy/budget identity, loaders/types/reference registry
- **Primary user story surfaces:** PSO-01, EMP-01, DEV-01, RQA-02, SEC-03, FIN-03

**Purpose:** Establish the single new contract model before runtime consumers.

**Changes:** Define stable Task/head identity, lifecycle versus unit execution,
scoped typed blockers, requirement revisions, criteria catalog, decision-record,
criterion-verification-report, policy snapshots, and cumulative budget identity.
Intake-request remains the effective requirement owner. Unsupported old-model
input fails without conversion or compatibility readers.

### Local tasks

1. **Define Task and requirement authority.**
   - Purpose: Avoid competing editable requirements or lifecycle owners.
   - Changes: Specify Task head/revision and requirement refs/digests, lifecycle/unit/blocker relations, immutable source identity, stable criteria/provenance, assumptions, and KPI applicability for bugfix/no-write tasks.
   - Validation: Fixtures preserve criterion IDs across reorder and reject inconsistent terminal states, dangling scope, unsupported provenance, and implicit expansion.
2. **Define decisions and proof.**
   - Purpose: Make adoption and measured closure first-class evidence.
   - Changes: Register decision-record and immutable criterion-verification-report with affected IDs, before/after revisions, actor authority, expected/method/observed facts, pass/fail/unknown, freshness, input identity, and evidence refs.
   - Validation: Positive/negative cases cover duplicate IDs, missing proof, stale input, runner-forged authority, and policy-controlled manual evidence/applicability.
3. **Define policy and budget identity.**
   - Purpose: Carry enforceable bounds across preparation, work, and recovery.
   - Changes: Specify effective policy snapshot, validated known predicates, cumulative consumed/reserved/unknown resources, capability per dimension, and ledger/attempt bindings; align families, validators, types, examples, and references together.
   - Validation: Contradictory/unknown predicates, unsupported requested caps, wrong Task ownership, and invalid resource identities fail strict parsing and parity.
4. **Prove current consumer and replacement boundaries.**
   - Purpose: Keep one new plan/handoff/projection/verification model.
   - Changes: Align current consumer inputs and register retired contracts/assets/actions for S14 removal; reserve accepted S17 public-surface details for S10.
   - Validation: Current examples agree with docs/types/validators; old or mixed authority fails explicitly and cannot synthesize current criterion proof.

### Acceptance criteria

1. Task and intake have distinct single lifecycle/requirement owners with stable identities, source provenance, and revision/digest bindings.
2. Decision/proof contracts distinguish proposals, adoption, measurements, runner claims, and freshness.
3. Policy/budget contracts preserve fixed invariants, cumulative spend, declared enforcement capabilities, and explicit small/no-write applicability.
4. Current docs/types/validators/examples/consumers agree; retired or mixed authority fails without compatibility readers.

### Done evidence

- Registered current contracts, types, canonical examples, and replacement boundary inventory.
- Provenance, invalid-input, criterion/blocker/budget mapping tests.
- `pnpm test:references`, contract-kernel parity, and `pnpm slice:gate`.

### Out of scope

- Applying decisions, executing verification, or replacing active new-model requirements.
- Legacy readers, old-Task migration, or claiming runtime qualification from schemas.

## W72-S03 — Answer reconciliation and effective intake correctness

- **State:** blocked
- **Epic:** EPIC-1, EPIC-2, EPIC-6
- **Hard dependencies:** W72-S02, W72-S18
- **Outcome:** Confirmed intake incorporates adopted answers and cannot retain contradictory acceptance.
- **Primary modules:** intent-service, intent transactions, normalization prompt/candidate handling, intake materialization, intent CLI/API actions and tests
- **Primary user story surfaces:** PSO-01, PSO-02, PBO-09, OPS-11

**Purpose:** Ensure an answer changes the requirements that confirmation
actually adopts, rather than only clearing a question.

**Changes:** Record answers against versioned questions, apply typed option
patches, reconcile free-text candidates, retain unresolved semantic changes,
and compile the adopted revision and decision refs into intake.

### Local tasks

1. **Reproduce the contradiction regression.**
   - Purpose: Capture the demonstrated intake failure with independent expected behavior.
   - Changes: Add a fixture whose candidate requires automatic timeout retry and whose operator answer allows manual retry only; retain immutable raw input and previous revisions.
   - Validation: The effective acceptance after answer/confirm requires manual retry and forbids automatic retry, or confirmation remains blocked pending reconciliation.
2. **Apply answers to candidate requirements.**
   - Purpose: Distinguish receiving an answer from adopting its consequences.
   - Changes: Bind question/answer IDs and revisions, apply deterministic structured-choice changes, and produce an inspectable free-text reconciliation candidate; keep the blocker until required adoption succeeds.
   - Validation: Partial/empty answers, unrelated revisions, ambiguous reconciliation, and a valid-shaped but unapplied answer cannot produce a prepared conflicting contract.
3. **Compile exact adopted intake.**
   - Purpose: Carry the operator's decision into canonical Task execution inputs.
   - Changes: Materialize effective criteria, applicable metrics, assumptions, sources, and decision refs through the canonical Task head; use one adoption/Start path and preserve reviewed no-write/patch-only bounds.
   - Validation: Readback matches the reviewed revision and does not retain superseded acceptance, fabricate KPIs, change provider provenance, or start a provider on confirm.
4. **Prove transaction and recovery behavior.**
   - Purpose: Keep concurrent answering and confirmation exactly once.
   - Changes: Apply revision guards, idempotency, atomic write/readback, stale-source handling, and typed recovery actions to the answer/adoption path.
   - Validation: Two clients, replayed requests, interrupted writes, and stale Markdown sources never create divergent effective intake or duplicate Task identities.

### Acceptance criteria

1. The manual-retry counterexample cannot confirm contradictory acceptance.
2. Receiving an answer and applying a decision have distinct durable states.
3. Confirmation transfers exact current requirements and decisions while preserving immutable history.
4. Failure, concurrency, retry, and canonical action paths pass focused service/API tests.

### Done evidence

- Counterexample fixture, effective intake readback, and immutable revision lineage.
- Intent reconciliation, CAS, idempotency, source-staleness, and recovery test output.
- Updated intent contracts/examples/assets as needed and `pnpm slice:gate`.

### Out of scope

- General decisions during active execution, owned by S04/S12.
- Automatic approval of arbitrary free-text interpretation or broader delivery modes.

## W72-S04 — Runtime-owned decision adoption and Start authority

- **State:** blocked
- **Epic:** EPIC-2, EPIC-3, EPIC-6
- **Hard dependencies:** W72-S02, W72-S03, W72-S18
- **Outcome:** One atomic adoption service binds decisions and Start to exact approved requirements and execution bounds.
- **Primary modules:** operator-request and interaction services, shared decision materialization, intent start, handoff approvals, state transactions and audit
- **Primary user story surfaces:** EMP-05, OPS-04, OPS-11, SEC-03, FIN-03

**Purpose:** Reuse one decision/adoption boundary across intake, requested
interactions, and Ask AOR while keeping execution permissions explicit.

**Changes:** Bind proposals and answers to affected criteria, show consequences,
atomically adopt accepted changes, and bind Start to the exact approved contract
and execution envelope.

### Local tasks

1. **Unify decision lifecycle.**
   - Purpose: Preserve the meaning of answers across existing interaction and request paths.
   - Changes: Reuse existing answer audit and operator-request lineage; materialize proposed, accepted, rejected, applied, and superseded decision states with affected criterion/contract refs and responsible actor.
   - Validation: Intake, requested interaction, and Ask AOR fixtures reach the same adopted contract without duplicating editable answers or requirements.
2. **Implement atomic adoption.**
   - Purpose: Prevent decision/result identity from diverging after replay or a crash.
   - Changes: Use S18 staged immutable artifacts and one CAS/idempotent authoritative-head publication for decision, requirement, plan/invalidation refs; recover derived views and return exact durable readback.
   - Validation: Duplicate, stale, conflicting, and interrupted adoption fails safely or returns the existing decision and resulting revision.
3. **Bind Start and delegation.**
   - Purpose: Make the reviewed execution envelope authoritative.
   - Changes: Bind outcome/criteria revision, scope, commands, budget, delivery mode, execution route, and approved plan; distinguish explicit policy delegation from user approval and retain existing material-plan reapproval rules.
   - Validation: Missing authority, model confidence, a mismatched revision, and a proposed scope/budget/write-mode expansion cannot authorize execution.
4. **Preserve intervention boundaries.**
   - Purpose: Keep bounded Ask AOR proposals and permission answers consistent with Task changes.
   - Changes: Route typed text reconciliation and structured choices through Task adoption; selecting an exact-preview option requires no redundant confirmation; Pause/Resume/Cancel use direct commands; completed Task changes create explicit follow-ups and read surfaces remain sanitized.
   - Validation: A request result or raw chat answer alone cannot mutate completed evidence, change permissions, or publish an artifact.

### Acceptance criteria

1. Every applied decision identifies its source, actor, affected criteria, and exact before/after revisions.
2. Decision adoption is atomic and idempotent across intake/request/interaction paths.
3. Start executes the reviewed contract and approved envelope; delegated iteration cannot widen it silently.
4. Public projections stay sanitized and completed Task evidence retains its lineage.

### Done evidence

- Decision lifecycle and Start authority examples plus audit/readback refs.
- Focused transaction, interaction, request, permission, and Start tests.
- `pnpm slice:gate`.

### Out of scope

- Active-run contract replacement and replan, owned by S12.
- New autonomous approval rights, raw transcript exposure, or upstream writes.

## W72-S05 — Authoritative criterion verification producer

- **State:** blocked
- **Epic:** EPIC-2, EPIC-4
- **Hard dependencies:** W72-S02, W72-S18
- **Outcome:** Each current mandatory criterion has a controller-owned pass/fail/unknown result with resolvable evidence.
- **Primary modules:** project verification, Runtime Harness reconciliation, evidence storage/resolution, verification/QA reports, contract fixtures and tests
- **Primary user story surfaces:** DEV-05, RQA-02, RQA-03, RQA-05, FIN-03

**Purpose:** Produce current, independently resolvable results for every
required criterion instead of trusting a successful runner summary.

**Changes:** Materialize immutable criterion verification records from
controller-owned observations and policy-authorized manual evidence, bound to
criterion digest, checkout, run, attempt, commands, and evidence bytes.

### Local tasks

1. **Map criteria to verification methods.**
   - Purpose: Make observable behavior and required evidence explicit before evaluation.
   - Changes: Bind criterion IDs to command groups, fixtures, API/UI behavior, negative scenarios, and permitted manual checks; carry expected behavior and applicability decisions.
   - Validation: Missing methods, unknown required criteria, duplicate mappings, and unsupported applicability exemptions remain blocked or unknown.
2. **Collect authoritative observations.**
   - Purpose: Distinguish executed checks from runner claims.
   - Changes: Reconcile measured command results, exact workspace/commit identities, paths and artifact digests; materialize immutable pass/fail/unknown records and keep mutable latest summaries as projections.
   - Validation: Fabricated command claims, wrong checkout, unresolved evidence, changed bytes, and mismatched attempt lineage cannot produce a valid pass.
3. **Support explicit manual evidence.**
   - Purpose: Cover behavior that cannot be proven by automated commands alone.
   - Changes: Bind authorized manual observations to criterion and input revisions; preserve observer identity, result, evidence, and policy-required acceptance without allowing blanket self-attestation by the runner.
   - Validation: Missing authority, stale observations, and unapproved exemption decisions fail closed; missing proof stays unknown.
4. **Prove positive and negative behavior.**
   - Purpose: Avoid checking only the implementation's preferred interpretation.
   - Changes: Add independent fixtures for manual-only retry, omission of automatic behavior, partial coverage, successful irrelevant commands, and stale reports.
   - Validation: Both positive and forbidden behavior are checked; an aggregate pass cannot cover an unmeasured criterion.

### Acceptance criteria

1. Every required criterion has an explicit current result or unknown status.
2. Passing records bind measured behavior and resolvable evidence to exact criterion/input identity.
3. Runner claims, mutable summary aliases, stale manual checks, and irrelevant successful commands cannot substitute for proof.
4. Negative behavior and policy-authorized manual/applicability paths have meaningful fixtures.

### Done evidence

- Immutable criterion report examples and verification-method mappings.
- Producer/evidence-resolution/negative-behavior test output.
- Contract/reference/kernel checks and `pnpm slice:gate`.

### Out of scope

- Final lifecycle aggregation, owned by S06.
- Judge-only proof, blanket manual bypass, or paid provider qualification.

## W72-S06 — Criterion-complete progress, review, and delivery closure

- **State:** blocked
- **Epic:** EPIC-2, EPIC-4, EPIC-5
- **Hard dependencies:** W72-S03, W72-S04, W72-S05
- **Outcome:** Progress, review, QA, delivery, and release readiness require complete current criterion coverage.
- **Primary modules:** task-plan/progress services, review and QA, verification-delivery transactions, delivery/release readiness and projections
- **Primary user story surfaces:** DEV-05, RQA-02, DTX-01, DTX-04, FIN-03

**Purpose:** Make every completion and write-back prerequisite depend on the
current effective criteria and verified evidence.

**Changes:** Replace aggregate criterion-status shortcuts with complete
revision-aware coverage, preserve deterministic status precedence, and trace
review back to original request and adopted decisions.

### Local tasks

1. **Aggregate required criterion results.**
   - Purpose: Prevent one successful summary from completing a partially proven task.
   - Changes: Resolve current criterion IDs/digests and required verification records; derive pending, failed, stale, and complete states from coverage, blocking decisions, dependencies, evidence, and approved-plan identity.
   - Validation: Missing, duplicate, stale, conflicting, and wrong-task results cannot produce complete; adapter success advances only to verification-pending.
2. **Anchor review to effective intent.**
   - Purpose: Detect an interpretation error repeated across plan, implementation, and tests.
   - Changes: Review original request, source material, adopted decisions, negative requirements, and observed behavior; preserve the deterministic-before-evaluator boundary.
   - Validation: Independently seeded omitted requirements fail even when generated plan/test summaries agree and the runner reports success.
3. **Align downstream closure.**
   - Purpose: Keep review, QA, delivery, release, and learning handoffs consistent.
   - Changes: Feed the same current coverage into prerequisite/readiness decisions, preserve mandatory integration and write-back approvals, and expose concrete recovery reasons.
   - Validation: Unknown criteria or unresolved decisions block closure/delivery; historical research remains distinct from current execution inputs and cannot become criterion proof.
4. **Authorize exact result delivery separately.**
   - Purpose: Make delivery permission refer to the verified result that actually exists.
   - Changes: Separate verified result, acceptance, and delivery facts; bind delivery approval/plan to requirement revision, current proof, diff digest, base commit, destination, and mode; preserve patch-only closure and require transaction success for branch/PR outcomes.
   - Validation: Changed diff/base/destination or stale proof blocks old approval; partial multirepo delivery remains incomplete with scoped recovery; Start alone cannot authorize result delivery.

### Acceptance criteria

1. Complete requires all current mandatory criteria, verification, evidence, dependencies, approvals, and integration gates to pass.
2. Missing or stale coverage cannot be overridden by runner or evaluator aggregate status.
3. Review can detect an omitted original requirement independently of generated planning artifacts.
4. Progress/review/downstream readiness agree; delivery uses separate exact-result approval and required transaction evidence.

### Done evidence

- Current coverage/readiness examples and downstream readback.
- Task progress, review, QA, delivery/release, and stale/missing-proof test output.
- `pnpm slice:gate`.

### Out of scope

- Removing strategy-required specification gates before S08.
- Publication, release clearance, or reinterpretation of historical provider evidence.

## W72-S07 — Effective-contract context and runtime asset lifecycle

- **State:** blocked
- **Epic:** EPIC-3, EPIC-4
- **Hard dependencies:** W72-S02, W72-S04
- **Outcome:** Every attempt receives bounded current intent, decisions, assigned criteria, and reproducible compiled provenance.
- **Primary modules:** context compiler and manifests, normalization/discovery/planning/implementation/review assets, runner candidates, replay/evaluation fixtures
- **Primary user story surfaces:** EMP-02, DEV-01, AIP-06, ARC-04

**Purpose:** Give each attempt the current requirements, decisions, constraints,
and evidence without making generated documents the only intent anchor.

**Changes:** Compile bounded work packets with original/effective refs,
relevant criteria and decisions, stop conditions, evidence, and exact provenance;
update runtime assets through their existing authoring/certification lifecycle.
Preserve a mandatory compact core plus pinned on-demand detail refs; record
retrieval bounds and compaction decisions. Missing mandatory context reduces the
unit, replans, or blocks rather than dropping constraints.

### Local tasks

1. **Compile current Task inputs.**
   - Purpose: Prevent stale or derived-only context from driving an attempt.
   - Changes: Resolve original request, effective contract, adopted decisions, assigned criteria, scope/permissions/budget, relevant evidence, and execution intent; bind their ordering and digests to compiled provenance.
   - Validation: Changed source or decision refs change the fingerprint; missing mandatory refs and fallback to an unrelated checkout block compilation.
2. **Preserve constraints during compaction.**
   - Purpose: Reduce reading burden without losing negative requirements or delegated boundaries.
   - Changes: Keep mandatory requirements and refs in bounded summaries, load long design/spec content by relevance, and make omitted optional context and compaction decisions explicit.
   - Validation: Budget/compaction fixtures retain negative constraints, unresolved decisions, assigned criteria, and exact evidence identity under context limits.
3. **Update and evaluate runtime assets.**
   - Purpose: Align normalization, planning, work, and review prompts with the new authority model.
   - Changes: Version changed assets/candidates, retain provider-neutral output boundaries, and prepare representative replay/evaluation baselines with independently authored expected behavior.
   - Validation: Asset-loader/compiler/reference checks and focused replay pass; semantic qualification is labeled separately and paid calls remain explicitly authorized.

### Acceptance criteria

1. Compiled attempts reference the current effective contract, source intent, relevant decisions, and assigned criteria.
2. Compaction preserves mandatory constraints and boundaries with inspectable provenance.
3. Runtime asset versions, fingerprints, runner candidate shapes, docs, and replay baselines agree.
4. Model output cannot own authoritative AOR identity, evidence, permissions, or criterion verdicts.

### Done evidence

- Compiled work-packet/provenance examples and compaction boundary fixtures.
- Versioned asset changes, loader/compiler/replay tests, and evaluation baseline.
- `pnpm test:references` and `pnpm slice:gate`.

### Out of scope

- Provider-specific behavior in core or unsolicited contributor/model guidance.
- Paid qualification or automatic promotion of unevaluated assets.

## W72-S08 — Consequence-based preparation and lifecycle readiness

- **State:** blocked
- **Epic:** EPIC-1, EPIC-2, EPIC-3, EPIC-4, EPIC-6
- **Hard dependencies:** W72-S04, W72-S06, W72-S07
- **Outcome:** The executable lifecycle selects preparation depth consistently with consequence/uncertainty policy.
- **Primary modules:** next-action/readiness, intent path and strategy policy, discovery/spec/planning/handoff consumers, review prerequisites and examples
- **Primary user story surfaces:** PBO-09, EMP-02, DEV-01, SEC-04, OPS-12

**Purpose:** Select preparation depth by uncertainty and consequences while
preserving deterministic execution and verification prerequisites.

**Changes:** Interpret schema-validated declarative policy snapshots for simple, uncertain,
and high-consequence work; align readiness/review with required/skipped outputs
as the sole new lifecycle model.

### Local tasks

1. **Define strategy policy and minimum gates.**
   - Purpose: Make short and deep paths predictable and auditable.
   - Changes: Extend typed policy conditions/parameters over verified consequence, uncertainty, reversibility, scope, dependencies, and work type; snapshot effective rules at Start, record reasons, and preserve fixed core permission/proof invariants.
   - Validation: Deterministic cases choose the required depth and never downgrade gates because of a model's self-reported confidence.
2. **Resolve adaptive next actions.**
   - Purpose: Remove unconditional stage sequencing from tasks that meet the shorter strategy's prerequisites.
   - Changes: Persist the strategy and skip reasons, reuse relevant repository facts, generate compact bounded plans/handoffs, and select next actions from actual required outputs.
   - Validation: Simple bugfix/no-write scenarios progress without forced large-spec artifacts; missing facts or prerequisites expose explicit blockers.
3. **Align readiness and closure consumers.**
   - Purpose: Prevent the UI path and executable review/handoff rules from disagreeing.
   - Changes: Make discovery/research/spec/plan completeness conditional on the chosen strategy while keeping product criteria, approvals, verification, and integration requirements mandatory.
   - Validation: A permitted skipped spec does not fail review solely for absence; a required absent spec or design interface still blocks execution/closure.
4. **Prove one adaptive lifecycle.**
   - Purpose: Make fresh Tasks use one deterministic policy implementation.
   - Changes: Replace fixed/legacy strategy selection and update profiles/assets/examples/consumers together; enumerate retired paths for S14 removal.
   - Validation: Fresh Tasks use the same resolver; unsupported old strategy inputs fail explicitly and no selectable old engine remains.

### Acceptance criteria

1. A simple bounded bugfix completes the executable lifecycle under the shorter strategy without a mandatory large specification.
2. Uncertainty and high consequences retain required discovery/design/planning outputs and strict gates.
3. Next action, readiness, handoff, review, and projection use the same strategy and durable skip reasons.
4. One new strategy implementation preserves reviewed authority and rejects old or mixed strategy inputs.

### Done evidence

- Strategy decision table, versioned policy/examples, and lifecycle readback.
- Short/deep/no-write/missing-prerequisite tests spanning next-action through closure.
- Reference checks and `pnpm slice:gate`.

### Out of scope

- Browser-owned strategy choice or bypass of required verification/approvals.
- Automatic migration or active-run requirement replacement.

## W72-S09 — Bounded work, observation, and repair loop

- **State:** blocked
- **Epic:** EPIC-2, EPIC-3, EPIC-4, EPIC-6
- **Hard dependencies:** W72-S07, W72-S08, W72-S19
- **Outcome:** Runtime-owned iteration progresses, repairs, waits, or stops within cumulative approved limits and durable recovery.
- **Primary modules:** Runtime Harness controller, step execution, durable run jobs/control, retry/repair and interaction continuation, live projections
- **Primary user story surfaces:** EMP-05, DEV-05, OPS-01, OPS-04, OPS-11

**Purpose:** Continue useful execution inside the approved envelope and stop
at meaningful decisions or deterministic limits.

**Changes:** Reuse durable jobs and attempts for action/observation/verification
iterations with explicit reasons, stop conditions, cumulative budgets, repair
limits, and restart-safe continuation.

### Local tasks

1. **Define iteration transitions and ownership.**
   - Purpose: Keep execution progress runtime-owned and replayable.
   - Changes: Bind each action, observation, verification result, and continuation reason to the current contract/plan/attempt; select continue, repair, wait-for-decision, complete, or stop through policy.
   - Validation: Transition fixtures preserve identity and cannot advance from missing verification or unresolved required decisions.
2. **Enforce the approved envelope.**
   - Purpose: Allow delegated mechanical work without new authorization for every step.
   - Changes: Reuse approved scope, commands, write mode, and plan; account cumulatively for iteration/time/cost/repair limits and require decisions for material changes.
   - Validation: Repeated repairs cannot reset limits, widen scope, change outcome, or execute an unapproved material plan.
3. **Implement durable continuation and recovery.**
   - Purpose: Preserve exact ownership across pause, cancel, input, and process failure.
   - Changes: Reuse claim/fencing, waiting-input, interaction answers, leases, and durable recovery actions; leave active contract replacement to S12.
   - Validation: Crash/restart, repeated answers, cancellation, expired claims, and budget exhaustion produce one bounded continuation or a recoverable terminal state.
4. **Expose useful result and stop reasons.**
   - Purpose: Make operator intervention about behavior and evidence.
   - Changes: Project the latest verified result, affected criteria, unresolved decision, remaining budget, and allowed next action through headless read models.
   - Validation: Projections explain concrete blockers without reconstructing the loop in the browser or treating provider silence as success.

### Acceptance criteria

1. Iteration remains inside the approved Task/plan envelope and cumulative limits.
2. Verification determines continue/repair/complete; meaningful changes require the decision boundary.
3. Pause/cancel/resume/input/restart preserve exactly-once continuation and attempt history.
4. Limits and blockers expose durable, actionable recovery and preserve partial evidence.

### Done evidence

- Iteration/repair/stop policy and durable transition examples.
- Focused controller/job/recovery/budget tests with public readback.
- `pnpm slice:gate`.

### Out of scope

- Applying changed requirements to already active units, owned by S12.
- Unbounded self-directed work, new permission grants, or automatic publication.

## W72-S10 — Canonical headless decision and criterion actions

- **State:** blocked
- **Epic:** EPIC-2, EPIC-6
- **Hard dependencies:** W72-S04, W72-S06, W72-S08, W72-S09, W72-S17, W72-S20
- **Outcome:** Public CLI/API can operate decisions and criterion-complete iteration through one action catalog and services.
- **Primary modules:** core operator-cli, control-plane services/HTTP/SSE, server Task action catalog and projections, OpenAPI/types/examples, thin CLI/API facades
- **Primary user story surfaces:** OPS-01, OPS-04, OPS-11, FIN-04

**Purpose:** Make the iterative journey operable through public CLI/API actions
without depending on the web UI.

**Changes:** Expose typed decision adoption, current requirements and coverage,
strategy/iteration, cumulative capability-aware budget and scoped-blocker readback,
separate exact-result delivery approval, CAS/recovery errors, and sanitized events
through one runtime-owned action catalog.

### Local tasks

1. **Define public action contracts.**
   - Purpose: Keep clients from inventing mutations or authorization rules.
   - Changes: Bind accepted S17 interaction/data requirements to typed action payloads, affected-version guards, permission categories, consequences, and recovery shapes in the catalog, API/OpenAPI, command docs, types, and examples.
   - Validation: Unknown actions, invalid payloads, stale versions, and mismatched permissions fail before runtime mutation.
2. **Connect CLI and HTTP to shared services.**
   - Purpose: Preserve one implementation of decision and lifecycle behavior.
   - Changes: Route public commands and HTTP mutations to existing core services, preserve idempotency, and return durable readback and current allowed actions.
   - Validation: Equivalent CLI/API requests produce identical contract/decision refs and blockers, including repeated/conflicting requests and recovery.
3. **Project criteria, consequences, and events.**
   - Purpose: Give detached clients enough information to explain results safely.
   - Changes: Expose current criterion coverage/freshness, decision consequences, lifecycle/unit/scoped-blocker facts, budget consumed/reserved/unknown and enforcement capabilities, delivery effects, strategy, results, revisions, and sanitized events; keep raw source text behind controlled reads.
   - Validation: Reconnect/cursor/reload fixtures reconcile to durable state and do not expose secrets or infer success from event presence.
4. **Prove a complete headless journey.**
   - Purpose: Establish public-surface acceptance before web composition.
   - Changes: Exercise prepare, decision adoption, Start, bounded work, verification, review, and completion through public CLI/API surfaces with provider fixtures.
   - Validation: The short-strategy and contradictory-answer journeys complete or block exactly as policy requires without direct state-file edits or private orchestration shortcuts.

### Acceptance criteria

1. Public CLI/API can perform the new journey using the same services and authoritative action catalog.
2. Actions preserve expected revisions, idempotency, permissions, typed errors, and durable readback.
3. Projections/events explain current criteria and meaningful decisions without leaking raw sensitive content.
4. Headless end-to-end evidence labels provider fixtures separately from live qualification.

### Done evidence

- Aligned command/API/OpenAPI/catalog/types/examples and transport readback.
- CLI/API parity, schema, CAS, event recovery, and headless journey tests.
- `pnpm test:references` and `pnpm slice:gate`.

### Out of scope

- Browser composition, owned by S11.
- Active-run replan mutations before S12 or private rehearsal APIs in the public package.

## W72-S11 — Task Workspace decisions, behavior changes, and evidence

- **State:** blocked
- **Epic:** EPIC-1, EPIC-4, EPIC-6
- **Hard dependencies:** W72-S10, W72-S17
- **Outcome:** Operators can inspect and correct expected behavior and review verified results through the installed Task UI.
- **Primary modules:** Task Workspace prepared/work/attention/review views, Ask AOR and interaction controls, client projections, web component/browser tests
- **Primary user story surfaces:** PBO-09, DEV-06, OPS-01, OPS-04, OPS-11, OPS-12, RQA-02

**Purpose:** Let the operator understand expected behavior, detect bad
requirements, and make consequential decisions from the installed UI.

**Changes:** Implement the accepted S17 design from
`docs/product/10-iterative-task-ux.md`; display original/effective intent,
criteria and provenance, assumptions, decision consequences, iteration results, behavioral changes,
verification gaps, and evidence drilldown using server-owned actions.

### Local tasks

1. **Build a comprehensible Prepared Task.**
   - Purpose: Make Start approval about expected behavior and bounds.
   - Changes: Implement the accepted Prepared Task hierarchy with original request, effective outcome/criteria, source provenance, material assumptions/unknowns, scope, budget, permissions, and Start consequences with full detail available when needed; reuse current design primitives.
   - Validation: Displayed criteria/revisions match Start readback; unresolved decisions and stale/dirty state prevent inappropriate approval.
2. **Connect work and decision views.**
   - Purpose: Focus intervention on the verified result and changed behavior.
   - Changes: Implement the default Overview and decision comparison with iteration observations, required choices, consequences, prior/current behavior, and the canonical action; route Ask AOR proposals through the shared adoption service.
   - Validation: Operators can correct the retry counterexample through real control-plane calls; a chat/request result alone cannot adopt a requirement.
3. **Connect review and evidence.**
   - Purpose: Show what was proven and what remains unknown.
   - Changes: Implement behavior-to-proof Review Overview and link code/result changes to criterion pass/fail/unknown records, source intent, and decision history; retain accessible document/log/source drilldown without requiring a large spec review for simple work.
   - Validation: Missing or stale proof is visible and blocks completion; the view cannot infer a pass from a runner summary.
4. **Prove interaction and recovery quality.**
   - Purpose: Keep the new workflow operable across devices and failures.
   - Changes: Preserve keyboard/focus, responsive/zoom states, reload/reconnect/offline recovery, concurrent-tab errors, and server revision refresh.
   - Validation: Component tests and real-control-plane browser scenarios cover Start, decision correction, checks, review, and recovery without API fulfillment mocks for integrated proof.

### Acceptance criteria

1. Prepared/work/review surfaces show the current requirements, consequences, and criterion evidence accurately.
2. The operator can detect and correct seeded behavior errors through runtime-owned actions.
3. Web and headless outcomes agree; raw documents remain available without becoming the mandatory primary journey.
4. Keyboard, responsive/zoom, reload/reconnect, stale-tab, and offline states pass browser verification.

### Done evidence

- Product/UI sources aligned with executable projections and actions.
- Component and real-control-plane browser proof, including contradiction and unknown-criterion cases.
- `pnpm test:web:browser` and `pnpm slice:gate`.

### Out of scope

- Browser-owned lifecycle state or independent mutation allowlists.
- Human-comprehension acceptance claims without the S15 pilot.

## W72-S12 — Active requirement revision and safe replan

- **State:** blocked
- **Epic:** EPIC-2, EPIC-3, EPIC-4, EPIC-6
- **Hard dependencies:** W72-S09, W72-S10, W72-S11
- **Outcome:** Active requirement changes fence stale workers and continue only under current contract/plan approvals.
- **Primary modules:** decision/Task revision services, execution plans and approvals, run jobs/workers/control, reservations, compiler and CLI/API/web revision actions
- **Primary user story surfaces:** EMP-05, DEV-05, OPS-04, SEC-03, FIN-03

**Purpose:** Apply accepted requirement changes during work without allowing
old workers or approvals to close the new Task version.

**Changes:** Reach a safe execution boundary, atomically adopt the new contract,
invalidate affected plans/approvals/evidence, fence stale authority, and continue
with an approved bounded replan while preserving old attempts.

### Local tasks

1. **Define the active revision transaction.**
   - Purpose: Make the transition between old and new authority explicit.
   - Changes: Specify proposal/adoption guards, stop-new-reservations behavior, safe pause/cancel boundaries, affected criteria and inputs, and recovery for partial output.
   - Validation: A decision table covers pending/running/waiting-input/terminal attempts and distinguishes a same-envelope repair from a material Task/plan change.
2. **Fence old execution authority.**
   - Purpose: Prevent a worker launched under old requirements from committing current completion.
   - Changes: Bind job/claim/output commits to contract and execution-plan revisions, raise fencing/ownership barriers at adoption, and retain late outputs as historical evidence excluded from new closure.
   - Validation: Concurrent adoption, delayed child output, expired leases, and restart between pause/adopt/commit cannot produce a current result from stale authority.
3. **Build and approve the bounded replan.**
   - Purpose: Reuse valid work while preserving material-plan approvals.
   - Changes: Compute affected criterion/plan/evidence fingerprints, supersede impacted plans, preserve unaffected outputs only under matching identities, compile new inputs, and require current approvals for changed execution plans.
   - Validation: Scope/budget/outcome changes require the appropriate decision, plan digest drift invalidates approval, and unresolved partial output has explicit recovery.
4. **Expose and prove the public transition.**
   - Purpose: Keep active requirement changes usable through the same operator surfaces.
   - Changes: Extend catalog/CLI/API/UI revision actions with consequences, stale recovery, pause/adoption/replan progress, and immutable history links.
   - Validation: Public end-to-end change-during-run cases preserve exactly-once adoption, all old attempts, and correct new-version verification after restart.

### Acceptance criteria

1. Adoption stops new impacted work and reaches an explicit safe transition boundary.
2. Stale workers may retain historical outputs but cannot mutate or close the current version.
3. New contract/plan digests invalidate affected evidence and approvals; unaffected reuse requires matching fingerprints.
4. CLI/API/web recovery handles partial work and crashes without duplicate patch application or lost lineage.

### Done evidence

- Active revision transaction/approval/fencing contracts and examples.
- Concurrent-worker, crash/restart, partial-output, replan, and public-surface tests.
- `pnpm slice:gate`.

### Out of scope

- General multirepo propagation, owned by S13.
- In-place history rewriting or silent approval of material plan changes.

## W72-S13 — Criterion-aware multirepo invalidation and integration

- **State:** blocked
- **Epic:** EPIC-2, EPIC-3, EPIC-4, EPIC-5
- **Hard dependencies:** W72-S12, W72-S20
- **Outcome:** Changed requirements invalidate dependent multirepo units and require fresh authoritative parent integration.
- **Primary modules:** parent-run scheduler, execution DAG planning, integration service/reports, workspace scope locks, aggregate verification and delivery projections
- **Primary user story surfaces:** EMP-03, RMO-04, RMO-06, DTX-08, DEV-05

**Purpose:** Propagate requirement changes through dependent units and verify
the parent result without losing isolated integration guarantees.

**Changes:** Bind unit inputs to criterion/decision/contract versions, compute
transitive stale boundaries, retain justified unaffected results, and require
fresh parent-owned integration and coverage before coordinated closure.

### Local tasks

1. **Extend unit and dependency fingerprints.**
   - Purpose: Identify which repository outputs depend on a changed requirement.
   - Changes: Include assigned criteria, effective decisions, contract digests, repository inputs, and dependency evidence in scheduling/integration fingerprints.
   - Validation: A semantic requirement change invalidates the affected unit even when filenames are unchanged; unrelated valid outputs retain their fingerprints.
2. **Propagate bounded stale work.**
   - Purpose: Recompute dependent results while preserving unrelated accepted work.
   - Changes: Reuse transitive dependency invalidation, reservation/child control, cumulative parent budgets, and restart-safe locks; expose stale reasons and rerun boundaries.
   - Validation: Two-repository dependency, concurrent output, cancellation, and restart fixtures invalidate exactly the required boundary without overlapping writes.
3. **Close parent integration authoritatively.**
   - Purpose: Ensure child success proves the complete coordinated outcome.
   - Changes: Reconcile exact child output digests/ancestry and changed paths in isolated integration workspaces; bind aggregate verification/QA/review and criterion coverage to current parent inputs.
   - Validation: Partial success, wrong base, stale child proof, forged reports, and source-checkout changes cannot pass parent closure or delivery.

### Acceptance criteria

1. Units bind current criteria, decisions, effective contract, and repository/dependency inputs.
2. Requirement changes propagate through the dependency graph with explicit stale reasons and bounded reruns.
3. Parent completion requires fresh authoritative integration and full current criterion coverage.
4. Locks, isolated workspaces, output identity, primary-checkout safety, and cumulative budgets remain enforced.

### Done evidence

- Version-aware unit/fingerprint/integration examples and stale-boundary readback.
- Scheduler, two-repository change/rerun, isolated integration, and parent closure test output.
- `pnpm slice:gate`.

### Out of scope

- New distributed scheduling infrastructure or provider-specific orchestration.
- Upstream coordinated delivery or bypass of existing integration authority.

## W72-S14 — Breaking replacement consistency and retired-path removal

- **State:** blocked
- **Epic:** EPIC-0, EPIC-2, EPIC-3, EPIC-6
- **Hard dependencies:** W72-S02, W72-S12, W72-S13
- **Outcome:** One coherent new Task model replaces retired lifecycle, reader, asset, and action paths without backward compatibility.
- **Primary modules:** current contracts/assets/consumers, retired Flow lifecycle and aliases, AOR Home readers, CLI/API/web configuration, replacement runbook and fixtures
- **Primary user story surfaces:** PBO-09, OPS-01, SEC-03, FIN-03

**Purpose:** Finish the accepted full replacement without adding an old engine,
legacy conversion, opt-in rollout, or engine rollback.

**Changes:** Remove retired behavior and align current contracts, runtime,
assets, transports, examples, and tests. Preserve historical evidence as history;
use fresh isolated state for acceptance. Recovery inside the new model and
partial-delivery compensation remain supported.

### Local tasks

1. **Inventory and remove retired paths.**
   - Purpose: Ensure old lifecycle ownership cannot bypass Task authority.
   - Changes: Enumerate and remove legacy readers/converters, Flow-owned lifecycle, compatibility aliases, obsolete strategy assets, and default/opt-in engine selection; retain justified current implementation ports.
   - Validation: Static inventory and focused tests show one current owner/dispatch path and actionable rejection of retired input.
2. **Align the single replacement model.**
   - Purpose: Keep every shipped surface and fixture on the same contract.
   - Changes: Update current contract/docs/types/examples, prompts/context/policies, CLI/API/web, package inputs, and tests together; distinguish historical artifacts from executable current inputs.
   - Validation: Cross-surface/parity checks reject mixed authority, stale approvals, old strategy selectors, and fabricated current proof.
3. **Prove fresh-state and new-model recovery.**
   - Purpose: Retain durable operation without old-state migration.
   - Changes: Exercise clean AOR Home onboarding, Task creation, follow-ups, corruption handling, interrupted head publication, controller Resume, explicit export, and partial-delivery recovery.
   - Validation: Fault injection and installed fixtures preserve current identities/evidence and external sentinels without silent cleanup, migration, or target-repository runtime writes.
4. **Document replacement and historical evidence.**
   - Purpose: Explain the supported model and remaining release boundary.
   - Changes: Record one-model setup, unsupported old input, explicit preservation of historical research/qualification, scope of current recovery, and S16 qualification handoff; update source maps and runbooks.
   - Validation: Sources agree that old Task conversion/replay is unsupported; revision and recovery within the new model remain explicit; no release clearance is implied.

### Acceptance criteria

1. No retired reader, API alias, competing lifecycle owner, or selectable old engine remains on current execution paths.
2. Current contracts/assets/commands/examples/tests agree on one model and reject retired/mixed input explicitly.
3. Fresh-state execution and new-model crash/recovery/follow-up/export preserve ownership and partial evidence.
4. Historical evidence is retained without reclassification; no implicit old-state deletion, migration, or release claim occurs.

### Done evidence

- Retired-path inventory, source alignment, and single-model runbook.
- Fresh-state, old/mixed-input rejection, corruption/publication/Resume, and delivery-recovery proof.
- `pnpm slice:gate`.

### Out of scope

- Backward compatibility, conversion/resumption of old Tasks, dual engines, or engine rollback.
- Implicit deletion of existing evidence, release publication, or production-state migration.

## W72-S15 — Adversarial evaluation and human-comprehension pilot

- **State:** blocked
- **Epic:** EPIC-4, EPIC-6, EPIC-7
- **Hard dependencies:** W72-S07, W72-S11, W72-S13, W72-S14, W72-S17, W72-S21
- **External blocker:** The human-pilot cohort and observation window have not been arranged; remove this blocker only when the S01 protocol can be executed with real participants.
- **Outcome:** Actual human observations and adversarial evaluation support a bounded improvement claim against the baseline.
- **Primary modules:** harness datasets/suites/replay, evaluation and scorecards, human-pilot protocol/evidence, observability and learning/backfill proposals
- **Primary user story surfaces:** RQA-03, AIP-06, PBO-09, OPS-11, OPS-12, INC-05, FIN-04

**Purpose:** Measure runtime correctness and operator understanding against the
predeclared baseline before claiming the new process improves delivery.

**Changes:** Run representative/adversarial evaluation, S21 repository comparisons, and a real-user pilot,
record error detection and decision correctness, extend scorecards, and feed
observed gaps into bounded learning proposals.

### Local tasks

1. **Execute representative and adversarial evaluation.**
   - Purpose: Detect failures beyond schema validity and happy-path implementation.
   - Changes: Replay contradictory answers, lost negative requirements, irrelevant successful tests, stale evidence/workers, budget exhaustion, restarts, partial integration, and scope expansion using independent expected behavior.
   - Validation: Required deterministic failures remain failures regardless of judge scores; results distinguish fixtures, real process observations, and live-provider evidence.
2. **Run the human-comprehension comparison.**
   - Purpose: Test whether operators notice and correct bad behavior with less unnecessary review.
   - Changes: Follow S01's predeclared comparative protocol, initially targeting 8-12 mixed-experience participants, comparable old/new tasks, seeded errors, and recorded observation limits; use retained baseline fixtures/frozen evidence rather than a supported old runtime engine; measure correct decisions, detection, explanation, time, intervention, and rework; keep S17 formative observations and any participant reuse separately identified.
   - Validation: Actual participant observations and denominator/task/version identities support each claim; Approve clicks, synthetic interviews, or model judgments cannot stand in for understanding.
3. **Extend scorecards and learning linkage.**
   - Purpose: Preserve actionable feedback about intent and decision failures.
   - Changes: Add comprehension/decision/rework measures alongside existing runtime rates; link sanitized findings to criterion/decision/asset versions and create proposal-only dataset/incident backfill.
   - Validation: Metric definitions, missing data, private evidence refs, and sample limits are explicit; raw user answers are not echoed into public read surfaces or automatic asset promotion.
4. **Record evaluation disposition.**
   - Purpose: Make improvement claims and remaining gaps reviewable.
   - Changes: Compare results against predeclared thresholds, classify regressions, record repair owners or no-go decisions, and retain baseline/new-version evidence labels separately.
   - Validation: Missing human observations or unresolved critical regressions prevent slice acceptance; a small pilot does not become a universal claim about reading behavior.

5. **Compare independently verified repository tasks.**
   - Purpose: Measure orchestration on real bugfixes separately from runner capability and human understanding.
   - Changes: Freeze S21 selection/holdout and direct-runner versus same-runner/model AOR attempts with comparable enforceable bounds; record resolved/unresolved/infrastructure outcomes, false acceptance, stale proof, interventions, and observed resources; label modified variants separately.
   - Validation: Actual denominators and dataset/harness/image/base/patch identity support results; unavailable cost telemetry and public-task contamination limits stay explicit; paid calls require separate authorization.

### Acceptance criteria

1. Representative/adversarial and independently verified repository cases satisfy predeclared thresholds with actual denominator/input identity and separate code/runtime outcomes.
2. Real human observations support the comprehension/error-detection comparison, with explicit sampling and version limits.
3. Decision correctness, error detection, explanation, time, intervention, and rework have defined measurements and honest missing-data handling.
4. Scorecards and bounded learning proposals retain lineage without overriding failed gates or promoting assets automatically.

### Done evidence

- Baseline/new-version replay, adversarial evaluation, and paired repository-task reports with exact inputs and denominators.
- Actual human-pilot observations, sanitized aggregate report, thresholds, limitations, and disposition.
- Metric/scorecard/backfill tests and `pnpm slice:gate`.

### Out of scope

- Paid provider qualification or participant messaging without explicit authorization.
- Synthetic proof of human comprehension, universal claims, or automatic prompt/policy tuning.

## W72-S16 — Installed journey acceptance and qualification freeze

- **State:** blocked
- **Epic:** EPIC-0, EPIC-1, EPIC-4, EPIC-5, EPIC-6, EPIC-7
- **Hard dependencies:** W72-S06, W72-S11, W72-S13, W72-S14, W72-S15
- **Outcome:** Installed public-surface acceptance produces an immutable new-version freeze with a separate qualification handoff.
- **Primary modules:** installed CLI/API/web proof, package/build inputs, internal black-box journal and mission catalog, story/source alignment, replacement and qualification handoff
- **Primary user story surfaces:** PBO-09, DEV-05, DEV-06, OPS-06, OPS-07, OPS-12, RMO-04, DTX-01, DTX-08, FIN-03

**Purpose:** Prove the integrated installed workflow and freeze the exact
version that must receive fresh provider qualification.

**Changes:** Verify packaged public surfaces, new-model recovery and retired-input rejection
scenarios, source/story alignment and replacement gates; produce an immutable
source/package/asset/profile/target freeze and release-only handoff.

### Local tasks

1. **Prove packaged headless and browser journeys.**
   - Purpose: Ensure development fixtures have not hidden installed-surface gaps.
   - Changes: Exercise packaged CLI/API/web Prepare/Start/work/decision/review/complete, no-write and patch-only output, single-repository and two-repository scenarios through public actions and durable readback.
   - Validation: Integrated proof uses real control-plane transport and installed entry points; API fulfillment mocks, direct state edits, or source-service-only calls cannot close this installed outcome.
2. **Execute the boundary and recovery matrix.**
   - Purpose: Verify the high-impact failure cases across the complete product.
   - Changes: Cover contradictory answers, unknown criteria, stale proof/workers, expanded scope, answer/restart exactly-once behavior, budget exhaustion, multirepo partial success, fresh-state replacement, and retired/mixed-input rejection.
   - Validation: Each expected result in the matrix below is observed and linked to exact criterion/decision/attempt evidence with no upstream writes.
3. **Close source alignment and replacement disposition.**
   - Purpose: Make implemented behavior and acceptance claims consistent.
   - Changes: Reconcile README, product/story sources, architecture, contracts, examples, public commands, assets and runbooks; accept only evidenced story tiers and record the single-model replacement disposition separately from release clearance.
   - Validation: Reference/index checks, browser tests, package checks, and the repository gate pass; missing pilot/installed evidence prevents acceptance of the replacement.
4. **Freeze and hand off fresh qualification.**
   - Purpose: Prevent historical provider runs from certifying changed behavior.
   - Changes: Freeze source commit, package digest, asset/compiler versions, profiles, target identities and evidence refs; map new-strategy missions to the existing required provider matrix and preserve historical manifests.
   - Validation: Freshness checks reject changed input identities; the handoff names bounded paid-run prerequisites and retains pending qualification/release status until the authorized fresh runs pass.

### Acceptance criteria

1. Packaged CLI/API/web prove the complete new journey through public runtime-owned actions and durable evidence.
2. All boundary/recovery/replacement cases match the matrix, including no-write and isolated multirepo limits.
3. Product/contracts/assets/commands/docs/story claims agree, and evaluation plus installed proof support the recorded replacement disposition.
4. One immutable current-version freeze and qualification handoff exist; development acceptance does not claim paid-provider completion or production clearance.

### Done evidence

- Installed public-surface journal, browser proof, package identity, and boundary-matrix evidence.
- Current story/source alignment, evaluated replacement disposition, and fresh-state/retired-input rejection results.
- Immutable qualification manifest and fresh-run handoff with separate pending release disposition.
- Relevant package checks, `pnpm test:web:browser`, reference checks, and `pnpm slice:gate`.

### Out of scope

- Executing paid provider cells or changing their historical outcomes.
- npm publication, upstream writes, production deployment, or clearing release audit hold.

### Installed acceptance matrix

| Scenario | Required observable result |
| --- | --- |
| Simple bounded bugfix | Completes the selected short strategy without a mandatory large spec. |
| Answer contradicts normalization | Effective criteria change or confirmation remains blocked. |
| Required criterion has no proof | Completion remains blocked with unknown coverage. |
| Evidence belongs to an old version | It is excluded from current verification. |
| Proposed scope/budget/write-mode expansion | Required decision/approval boundary is enforced. |
| Restart while waiting for an answer | The adopted decision and continuation occur exactly once. |
| Old worker reports success after adoption | History is retained and current completion stays fenced. |
| Budget or repair limit is exhausted | Work stops with partial evidence and explicit recovery. |
| One repository/unit succeeds | Parent closure waits for required integration and full coverage. |
| Analyze/explain/review in no-write mode | Target-write authorization remains absent. |
| Fresh replacement and retired inputs | One new model runs from fresh state; old/mixed inputs fail explicitly without converting historical evidence. |

## W72-S18 — Canonical Task domain and atomic filesystem publication

- **State:** blocked
- **Epic:** EPIC-0, EPIC-2, EPIC-6
- **Hard dependencies:** W72-S02
- **Outcome:** Task owns one recoverable lifecycle/head and publishes linked immutable artifacts atomically through a modular core.
- **Primary modules:** Task domain/application/infrastructure, state transactions/artifact store, AOR Home layout, Task projections, import-boundary checks
- **Primary user story surfaces:** PSO-01, EMP-01, OPS-01, OPS-04, SEC-03

**Purpose:** Implement the stable domain and publication foundation before
answer/adoption, controller, or transport consumers depend on it.

**Changes:** Introduce canonical Task identity/head and pure transitions,
separate unit execution/scoped blockers, stage immutable artifacts, commit one
CAS-protected head, and recover derived publication. Existing core packages
remain; domain imports exclude storage/process/transport/provider code.

### Local tasks

1. **Implement domain ownership and transitions.**
   - Purpose: Keep lifecycle and requirement authority singular.
   - Changes: Implement Task identity/head, lifecycle, typed scoped blockers, unit refs, terminal guards, and exact intake/decision/plan/policy/budget refs; keep original inputs immutable.
   - Validation: Transition tests reject contradictory states and competing Flow authority; clearing one condition leaves unrelated blockers and work intact.
2. **Implement multi-artifact publication.**
   - Purpose: Prevent partially adopted requirements and decisions becoming current.
   - Changes: Stage immutable linked artifacts, lock/CAS the head publication, retain idempotency/request identity, and record pending derived publication for recovery.
   - Validation: Inject interruption before/after each durable boundary; recovery yields one authoritative head without duplicate decisions or mixed revisions.
3. **Enforce module direction.**
   - Purpose: Keep domain reusable without transport/storage coupling.
   - Changes: Separate domain, application handlers, and infrastructure ports inside core; bind existing AOR Home and artifact helpers behind the application boundary; enforce imports.
   - Validation: Domain tests run without filesystem/provider setup and forbidden import edges fail repository checks.
4. **Project consistent state and history.**
   - Purpose: Publish inspectable facts without another editable lifecycle store.
   - Changes: Derive Task readback from one head and exact immutable refs; expose scoped blocker/operation availability internally, retain completed history and explicit follow-up lineage.
   - Validation: Concurrent readers, missing derived files, corrupt data, and stale heads never fabricate current proof or terminal success; tests use isolated fresh AOR Home.

### Acceptance criteria

1. Task has one stable identity/lifecycle owner and links the single intake requirement authority.
2. Multi-artifact publication/recovery is atomic, revisioned, and idempotent.
3. Lifecycle, execution, and scoped blockers have validated combinations and independent resolution.
4. Module/import boundaries and projections preserve headless, runner-neutral AOR Home ownership.

### Done evidence

- Task state/transition/publication contracts, examples, and module map.
- Fault-injection, concurrency, idempotency, scope/blocker, and import-boundary tests.
- `pnpm slice:gate`.

### Out of scope

- New packages/databases, event-sourced lifecycle, provider execution, or legacy migration.
- Public UX/action finalization before S17/S10.

## W72-S19 — Detached Task controller and cumulative resource budget

- **State:** blocked
- **Epic:** EPIC-2, EPIC-3, EPIC-6
- **Hard dependencies:** W72-S04, W72-S07, W72-S08, W72-S18
- **Outcome:** One detached controller supervises Task work under durable ownership and an auditable cumulative capability-aware budget.
- **Primary modules:** Task controller/jobs, worker claims/leases/fencing, budget ledger/reservations, adapter capability negotiation, policies and run controls
- **Primary user story surfaces:** EMP-05, OPS-01, OPS-04, OPS-11, FIN-03

**Purpose:** Make execution survive operator disconnection without resetting
resources or granting unsupported budget guarantees.

**Changes:** Persist ownership/envelope before controller spawn, reuse child
run-job/Harness boundaries, snapshot effective policies, account all Task work,
and reconcile interrupted owners/resources through explicit Resume.

### Local tasks

1. **Accept and claim the detached controller.**
   - Purpose: Ensure one owner controls Task scheduling.
   - Changes: Persist Start identity, exact reviewed envelope and controller job before spawn; claim an exclusive renewable lease/fencing token and record spawn failure.
   - Validation: Duplicate Start, two clients, spawn failure, expired ownership, and late writes do not produce duplicate active controllers or false Running state.
2. **Implement cumulative reservations and accounting.**
   - Purpose: Bound preparation, execution, repair, and checks together.
   - Changes: Account from Task creation under bounded read-only Prepare authority; show prior expenditure/remaining envelope at Start; track consumed/reserved/unknown resources per Task/attempt, reserve before work, settle observations, retain spend across revisions/Resume, and define active-time/termination-grace semantics.
   - Validation: Concurrent starts cannot oversubscribe; failed/interrupted attempts cannot erase spend or release unresolved reservations as free capacity.
3. **Negotiate enforceable limits.**
   - Purpose: Distinguish guarantees from measurements and estimates.
   - Changes: Resolve per-dimension enforced/measured/estimated/unavailable capability from core/adapter facts; reject requested unsupported strict monetary bounds before spawn and show reasons.
   - Validation: Missing/partial usage, delayed telemetry, unsupported caps, and LLM confidence cannot create a cost guarantee or silently widen limits.
4. **Implement control and explicit recovery.**
   - Purpose: Preserve work across pause, cancel, and controller interruption.
   - Changes: Apply durable Pause/Cancel/Answer/Resume; fence old owners and inspect jobs/results/partial output/reservations before respawn; persist waiting and terminal facts.
   - Validation: Stopping CLI/browser leaves Task supervision intact; explicit Resume converges exactly once, and cancel waits for child termination before terminal state.
5. **Prove exhaustion and bounded expansion.**
   - Purpose: Make exhausted work actionable without automatic budget resets.
   - Changes: Stop new launches at exhausted bounds, supervise active limits, retain partial results, and route requested expansion through reviewed decision/adoption with prior spend intact.
   - Validation: Retry, repair, revision, and restart cannot bypass the cumulative ledger; repeated expansion decisions apply once to the reviewed envelope.

### Acceptance criteria

1. Start/controller/child ownership is durable, exclusive, fenced, and independent of operator transports.
2. All Task work consumes one atomic resource ledger with honest unknown consumption.
3. Declared capability determines available guarantees; unsupported required limits block before work.
4. Resume/control/exhaustion preserve spend, partial evidence, and exactly-once authorized continuation.

### Done evidence

- Controller/ledger/capability contracts, policy snapshots, and public-ready internal readback.
- Process/lease/fencing, fault/recovery, reservation/exhaustion, and unavailable-telemetry tests.
- `pnpm slice:gate`.

### Out of scope

- Mandatory global daemon, automatic crash restart without a supervisor, billing integrations, or new infrastructure.
- Paid execution or claiming invoice-grade cost from estimates.

## W72-S20 — Bounded unit planning, parallel scheduling, and integration

- **State:** blocked
- **Epic:** EPIC-2, EPIC-3, EPIC-4, EPIC-5
- **Hard dependencies:** W72-S05, W72-S09, W72-S19
- **Outcome:** Task decomposes into verifiable units and runs only eligible independent work within shared bounds and authoritative integration.
- **Primary modules:** execution plans/DAGs, unit workspace provisioning, Task scheduler/reservations, conflict locks/capacity, integration and criterion coverage
- **Primary user story surfaces:** EMP-03, RMO-04, RMO-06, DEV-05, DTX-08

**Purpose:** Adapt existing scheduler/workspace/integration foundations to the
Task owner while keeping runner-internal reasoning outside core scheduling.

**Changes:** Validate bounded unit outputs, dependencies, many-to-many criterion
mapping, independence reasons, scopes/checks, and single cumulative budget.
Reserve ready work atomically, isolate writers, and require aggregate proof.

### Local tasks

1. **Validate adaptive decomposition.**
   - Purpose: Preserve the user's full outcome when splitting work.
   - Changes: Accept planner candidates with output/dependency/scope/check/stop conditions, stable unit identity, criterion mappings, and integration obligations; allow one unit for simple tasks.
   - Validation: Missing mandatory coverage, cycles, incompatible output assumptions, and invented unit permissions fail; multi-unit criteria require defined integration observations.
2. **Schedule only justified independent work.**
   - Purpose: Avoid races and unapproved resource multiplication.
   - Changes: Reuse dependency readiness, conflict keys/locks, isolated unit workspaces, atomic S19 reservations, capacity and approved concurrency; uncertain independence serializes.
   - Validation: Overlapping writers and missing dependencies serialize/block; independent units run within one global budget and cannot raise concurrency by replanning.
3. **Reconcile unit controls and outputs.**
   - Purpose: Preserve exact ownership under parallel pause/cancel/failure.
   - Changes: Bind child jobs/attempt outputs to current Task/head/plan and exact inputs; scope blockers/controls, release only confirmed reservations, and retain partial results.
   - Validation: Concurrent completion, delayed output, partial launch, lease recovery, and scoped decisions cannot duplicate output or let stale ownership commit.
4. **Integrate and verify the parent result.**
   - Purpose: Prove the coordinated outcome beyond successful children.
   - Changes: Apply immutable exact outputs in dependency order in a separate workspace; bind fresh aggregate criterion checks/review to integrated output and delivery identity.
   - Validation: Wrong base, conflicts, stale child evidence, missing criterion observations, or failed integration prevents closure even when every child reports success.

### Acceptance criteria

1. Units have bounded outputs, valid dependency/criterion mapping, and explicit integration requirements.
2. Parallel work requires independence, isolated writers, scoped locks, and approved shared capacity/budget.
3. Controls, reservations, attempts, and output commits remain fenced and recoverable.
4. Parent closure requires fresh integration and all mandatory current criterion proof.

### Done evidence

- New Task-owned unit/plan/scheduler/integration examples and source map.
- Serial/parallel, conflict/capacity/budget, partial-control/restart, and false-child-success tests.
- `pnpm slice:gate`.

### Out of scope

- Distributed schedulers, runner-specific planning policy, or increased caps without authority.
- Multirepo active-revision propagation owned by S13 or upstream delivery.

## W72-S21 — SWE-bench case catalog and independent patch verifier

- **State:** blocked
- **Epic:** EPIC-4, EPIC-6, EPIC-7
- **Hard dependencies:** W72-S02, W72-S05, W72-S09
- **External blocker:** Dataset/harness/image inputs and a resource-bounded evaluation host have not been qualified; actual base/gold checks are required before acceptance.
- **Outcome:** A frozen curated repository-task catalog and independent verifier produce reproducible observations without leaking evaluator artifacts to coding runners.
- **Primary modules:** private maintainer case/profile registry, bounded upstream-harness integration, instance/environment manifests, patch/result adapter, criterion evidence and datasets
- **Primary user story surfaces:** RQA-03, AIP-06, DEV-05, OPS-12, FIN-04

**Purpose:** Add realistic bugfix validation with independent executable ground
truth alongside AOR-specific authority/recovery and human-comprehension cases.

**Changes:** Implement the [research plan](../research/28-swe-bench-validation-plan.md)
from eight metadata-reviewed Verified candidates; freeze selection before
attempts, qualify base/gold environments, map exact patch observations, and keep
modified orchestration variants and official-instance outcomes separate.

### Local tasks

1. **Freeze catalog and provenance.**
   - Purpose: Prevent cherry-picking and moving benchmark inputs.
   - Changes: Verify IDs/base commits against a pinned dataset revision; record upstream harness/CLI, image/platform/test identity, licensing/provenance, inclusion/exclusion, resource bounds, and separate development/holdout sets.
   - Validation: Unknown/duplicate IDs, altered source/base/image, missing test identity, and post-prediction exclusions fail catalog/freshness checks; metadata alone is not executable qualification.
2. **Qualify independent environments.**
   - Purpose: Separate product failure from verifier infrastructure failure.
   - Changes: Run bounded base/gold checks on the qualified host; record expected failing/regression groups, logs, environment identity, and preflight disposition; keep evaluator files outside provider workspace/context.
   - Validation: Base reproduces intended failure with regressions passing and gold satisfies required groups; actual worker access probes cannot read evaluator files/control sockets or future Git/network solutions; unsuitable environments remain visible/excluded before predictions with reasons.
3. **Verify exact patches and publish observations.**
   - Purpose: Make benchmark evidence controller-owned and current.
   - Changes: Submit exact candidate patches to fresh isolated upstream verifier runs with unique IDs per patch/input; classify resolved/unresolved/infrastructure, lock report/log/patch digests, and route behavior observations through S05.
   - Validation: Old cache hits, changed patches, forged runner reports, unavailable proof, and evaluator-artifact access cannot produce current acceptance.
4. **Define paired and intervention handoff.**
   - Purpose: Compare orchestration fairly without overstating benchmark coverage.
   - Changes: Prepare same-runner/model direct-versus-AOR profiles with comparable enforceable limits, separate modified AOR variants, outcome/resource/false-acceptance metrics, and actual denominator rules for S15.
   - Validation: Dry/mock integration validates mappings only; actual base/gold evidence supports verifier acceptance; paired provider attempts/human results remain separately pending and modified variants never become official benchmark scores.

### Acceptance criteria

1. Pinned catalog/provenance, input identities, resource limits, and predeclared denominators agree.
2. Actual isolated base/gold checks qualify every accepted case and keep evaluator inputs inaccessible to the coding runner.
3. Exact fresh patch evaluation produces independent immutable observations with honest verdict/failure classification.
4. S15 receives reproducible paired/intervention profiles and coverage limits; no fixture or curated subset claims a full benchmark score.

### Done evidence

- Frozen case catalog, source/license/environment manifests, and input-freshness checks.
- Actual base/gold logs/disposition and independent verifier patch/result evidence.
- Mapping/isolation/cache/forgery tests, S15 handoff, and `pnpm slice:gate`.

### Out of scope

- Vendoring full datasets/gold patches into runtime assets or adding production benchmark dependencies.
- Paid/cloud/provider attempts, leaderboard submission, external publication, or replacing human/qualification evidence.

## Wave exit and release qualification

W72 development acceptance requires all twenty-one slice outcomes, actual S17
formative and S15 comparative observations, and S16 installed acceptance.
A planning document, schema change, fixture pass, or successful repository
gate alone cannot close the wave.

Fresh provider qualification remains a separately authorized release action
against the S16 freeze. Apply the existing W66 qualification ownership and
freshness rules without rewriting old runs; reconcile that release record if
the earlier W66 baseline has already completed by the time W72 lands.
Production clearance still requires the unqualified production-readiness gate
and current required-provider evidence. Registration and deterministic W72
work do not supply either.
