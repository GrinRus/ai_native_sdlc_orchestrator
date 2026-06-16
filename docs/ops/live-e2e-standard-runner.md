# Runbook: live E2E standard runner

## Purpose
Provide one installed-user black-box proof runner for catalog-backed full-journey profiles and guided installed-user journeys.

Live E2E simulates a user who has installed AOR, initializes or attaches a target repository, walks the public SDLC flow through CLI/API surfaces, and then emits a per-step black-box observation summary. It must not call private runtime internals to repair the run. It proves whether AOR works as a product from the public surface and whether produced artifacts explain each `pass`, `warn`, `not_pass`, block, and missing-evidence gap.

Every run starts by proving the AOR launcher before target execution. Source-channel acceptance and production-proof profiles create `${TMPDIR:-/tmp}/aor-live-e2e/<run-id>/`, copy the current AOR source into `aor-source`, run the source-only install proof (`corepack enable`, `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm aor --help`, `pnpm aor project init --help`), and then use a run-scoped session launcher from that isolated source install. Manual resume may reuse the install proof only after the cached launcher also passes `aor project init --help`, so a stale or partially materialized dependency tree fails before lifecycle commands run. Runtime state is stored under `<workspace>/runtime`; target checkouts live under `<workspace>/runtime/projects/<id>/target-checkouts`. `--runtime-root` and `--aor-install-mode repo-local` are explicit dev/debug overrides, not acceptance defaults. Profiles that use `--aor-bin` must still prove the provided binary with `aor --help`.

Provider CLIs that derive local project state paths from the checkout path may set `live_e2e.target_checkout_root_mode: short-physical`. In that mode the runner still stores AOR reports and state under the normal isolated workspace, but clones the target repository into a short physical temp checkout. Use this only for provider path-length limits; no-upstream-write, delivery guardrails, and target `.aor/` runtime ownership remain unchanged.

Small or medium provider smoke profiles may set `live_e2e.provider_step_timeouts_sec` as a map from step name to timeout seconds. Provider-pinned route materialization applies these values to generated route constraints before public execution starts, so bounded profiles can fail closed on provider latency instead of inheriting long full-lifecycle route caps.

Profiles may also set `live_e2e.target_command_timeout_sec` for target setup and
verification commands that run before provider execution. The runner must expose
`target_setup_status`, `target_verification_status`, `failure_owner`, and
`failure_phase` in target pre-execution evidence. A target repository setup,
test, build, browser dependency, or timeout blocker is not a Codex/Qwen quality
signal. Conversely, AOR runner/controller/API/UI failures must be classified as
`failure_owner=aor`, not hidden behind target repository blocker wording.

Live E2E provider parity is required across Codex, Claude, OpenCode, and Qwen.
Provider-specific behavior belongs only at the adapter boundary: command shape,
auth/env mapping, permission flags, output parsing, and coverage tier. The
public lifecycle, target setup/verification classification, evidence model,
Runtime Harness retry/repair semantics, operator decisions, and pass/blocker
classification must stay provider-neutral. Coverage tier affects whether a run
counts toward qualification; it must not change runner behavior.

Live E2E provider execution defaults to one terminal provider attempt per
provider-backed step. Provider-pinned policy materialization writes run-scoped
step policy overrides and passes them through public `--policy-overrides`; when
`live_e2e.provider_step_retry_max_attempts` and
`live_e2e.provider_step_repair_max_attempts` are absent, generated policies set
`retry.max_attempts=0` and `repair.max_attempts=0` for the provider-pinned
steps. Profiles may still set these maps explicitly, but they must do so as a
profile-class policy that applies consistently across providers rather than as a
provider workaround. A terminal provider failure must preserve the routed step
result, raw adapter evidence, provider status/progress, and Runtime Harness
report, then fail closed without launching an internal repair provider step.
Public repair remains the outer `execution#N -> review#N` lifecycle loop
controlled by `implementation_loop`.

All external-process adapters use the same request-artifact pipeline. AOR
persists the full adapter request as run evidence, builds a bounded provider
work packet, records context-budget and compaction evidence, and passes only a
short launcher prompt plus the work-packet path through the adapter's mechanical
CLI binding. Provider-specific behavior is limited to command flags, auth/env
mapping, output parsing, timeout args, and optional native file argument names.
Live baseline adapters must not pass unrestricted full request JSON through
stdin. If the provider work packet still exceeds the configured context budget
after deterministic ref-summary compaction, execution blocks before provider
spawn with `failure_class=compiled_context_budget_exceeded`.

The runner invokes the installed project flow step by step. Each step follows `plan -> execute -> inspect -> classify -> decide -> persist`; the next public command is allowed only after the current step decision is `continue` or after a requested interaction/frontend/manual action is completed through a public surface.

Operator-initiated interventions are public-surface actions, not private runner
repairs. When a profile asks for interactive operator-request coverage, the
runner must create the request through `aor request create` or
`POST /api/projects/:projectId/operator-requests`, run it through
`aor request run` or the request action route, and inspect only durable
request, proposal, patch, step-result, and next-action evidence. The runner
must not call `run steer` with free-form text or mutate target files directly.

Full-journey implementation is iterative. Acceptance profiles declare `implementation_loop.enabled=true`, `max_iterations`, `review_repair_actions`, and `stop_on_blocking_review`. The public lifecycle may repeat `execution#N -> review#N` until review and verification pass or the iteration budget is exhausted. Runtime Harness internal repair remains execution-health evidence only; it does not replace the public `run start` / `review run` / `review decide --decision request-repair` loop.

W14 extends the full-journey layer into a curated matrix across:
- `scenario_family`
- `provider_variant_id`
- `feature_size`

Current summaries also preserve `run_tier` so coverage is not confused with
acceptance proof. `bounded-live` can appear only as legacy classification on
historical summaries; it is not a current profile family or live acceptance
input:
- `readme-smoke`: installed-user no-write bootstrap path;
- `bounded-live`: historical fast fail-closed provider proof tier;
- `full-journey-observation`: delivery-reaching observation with findings allowed;
- `acceptance`: required matrix closure, fail-closed for artifact and verification gates;
- `production-proof`: real external process, no mock, no upstream write, strict evidence.

## Canonical profiles
Use only `scripts/live-e2e/profiles/**`.

Catalog-backed full-journey profiles:
- `installed-user-guided-journey.yaml`
- `full-journey-production-proof-ky-openai.yaml`
- `full-journey-regress-ky.yaml`
- `full-journey-regress-ky-anthropic.yaml`
- `full-journey-regress-ky-open-code.yaml`
- `full-journey-regress-ky-small-codex.yaml`
- `full-journey-regress-ky-medium-codex.yaml`
- `full-journey-regress-ky-medium-anthropic.yaml`
- `full-journey-regress-ky-medium-open-code.yaml`
- `full-journey-regress-ky-small-qwen.yaml`
- `full-journey-regress-ky-medium-qwen.yaml`
- `full-journey-release-ky-medium-openai.yaml`
- `installed-user-guided-journey-qwen.yaml`
- `full-journey-regress-httpie.yaml`
- `full-journey-regress-httpie-anthropic.yaml`
- `full-journey-repair-httpie-medium-anthropic.yaml`
- `full-journey-governance-httpie-medium-openai.yaml`
- `full-journey-governance-httpie-large-openai.yaml`
- `full-journey-regress-commander-js.yaml`
- `full-journey-repair-commander-js-medium-anthropic.yaml`
- `full-journey-governance-commander-js-medium-openai.yaml`
- `full-journey-regress-pluggy.yaml`
- `full-journey-repair-pluggy-medium-anthropic.yaml`
- `full-journey-governance-pluggy-medium-openai.yaml`
- `full-journey-governance-pluggy-medium-open-code.yaml`
- `full-journey-governance-ky-large-codex.yaml`
- `full-journey-governance-ky-large-openai.yaml`
- `full-journey-governance-ky-large-anthropic.yaml`
- `full-journey-release-nextjs.yaml`
- `full-journey-release-nextjs-anthropic.yaml`
- `full-journey-repair-nextjs-medium-anthropic.yaml`
- `full-journey-governance-nextjs-large-openai.yaml`
- `full-journey-regress-nextjs-small-openai.yaml`
- `full-journey-regress-zod-medium-openai.yaml`
- `full-journey-regress-httpx-medium-openai.yaml`
- `full-journey-regress-eslint-medium-openai.yaml`
- `full-journey-repair-fastify-medium-openai.yaml`
- `full-journey-regress-prettier-medium-openai.yaml`
- `full-journey-regress-ruff-large-openai.yaml`

Manual-only xlarge profiles:
- `manual-xlarge-release-nextjs-openai.yaml`
- `manual-xlarge-release-nextjs-anthropic.yaml`
- `manual-xlarge-governance-ky-openai.yaml`
- `manual-xlarge-governance-ky-anthropic.yaml`
- `manual-xlarge-governance-httpie-openai.yaml`
- `manual-xlarge-governance-httpie-anthropic.yaml`

Xlarge profiles must be launched through `manual-live-e2e.mjs`; `run-profile`
auto/evaluator mode and `qualification-loop.mjs` reject them before target
execution.

The human catalog stays in `docs/ops/live-e2e-target-catalog.md`; machine-readable matrix definitions live under:
- `scripts/live-e2e/catalog/targets/*.yaml`
- `scripts/live-e2e/catalog/scenarios/*.yaml`
- `scripts/live-e2e/catalog/providers/*.yaml`

## Target and mission rotation
For routine qualification, regression, and success-rate analysis, prefer a fresh
product and feature mission for each new live E2E run. Do not repeatedly prove
success on the same `target_catalog_id` plus `feature_mission_id` pair unless the
run is explicitly a reproduction, repair confirmation, production-proof rerun,
or provider A/B comparison for that exact matrix cell.

When selecting the next profile:
- rotate across target products first, then across feature missions inside the
  same product;
- include different scenario families and feature sizes when the current
  question is overall live E2E success, not a single adapter or target debug;
- record the chosen `target_catalog_id`, `feature_mission_id`,
  `scenario_family`, `provider_variant_id`, `feature_size`, and `run_tier` in
  the run summary or qualification notes;
- keep repeated same-cell runs linked to a concrete reason such as
  `reproduce-failure`, `verify-repair`, `provider-comparison`, or
  `production-proof`.

This rotation rule makes the observed success rate reflect product breadth
instead of overfitting to one familiar repository or one easy feature seam.

## Start
```bash
node ./scripts/live-e2e/run-profile.mjs \
  --project-ref . \
  --profile ./scripts/live-e2e/profiles/full-journey-regress-ky.yaml
```

By default, live E2E uses `--runner-auth-mode host`: AOR runtime state remains isolated under the run workspace/runtime root, while external runners reuse the operator's local CLI authentication. This means `codex` uses the normal `~/.codex` or caller-provided `CODEX_HOME`, and `claude` uses the normal local Claude Code auth/config sources. Use `--runner-auth-mode isolated` only for CI, proof, or fixture runs that deliberately need a session-scoped runner home.

By default, live E2E also uses `--runtime-agent-permission-mode full-bypass` so non-interactive acceptance runs do not pause on runner-native tool approval prompts inside isolated checkouts. Use `--runtime-agent-permission-mode restricted` when diagnosing adapter-native permission behavior. The selected mode is passed to public `aor` subprocesses through `AOR_RUNTIME_AGENT_PERMISSION_MODE` and is recorded in live adapter preflight, raw adapter evidence, routed step results, and the run summary.

Runtime permission mediation is configured separately from provider permission args:
- `--runtime-agent-interaction-policy fail-closed|ask-all|orchestrator-mediated` controls whether runtime permission blocks stay diagnostic failures, always ask the operator, or first go through AOR policy auto-approval.
- `--runtime-agent-auto-approval-profile none|conservative|auto-edit|trusted-run` controls the auto-approval rule set when mediation is enabled. If `orchestrator-mediated` is selected without an explicit profile, the runner uses `conservative`.

Acceptance and production-proof profiles should keep the default `fail-closed` unless the profile exists specifically to test interactive permission handling. In mediated profiles, permission readiness can report `interaction_required` instead of a hard preflight failure.
Run summaries copy the latest Runtime Harness `runtime_permission_summary` and `runtime_permission_decisions[]` when present, so mediated runs expose decision counts, audit refs, selected modes, and continuation strategy without reading raw adapter logs.

This is required for Claude Code because `--permission-mode auto` can ask the operator to approve tool reads or writes when the compiled context links handoff/spec artifacts under `.aor/`. AOR invokes Claude through `--print` in non-interactive live E2E, so there is no interactive approval channel to answer those prompts during the run.

Provider permission-mode analogues:
- Codex full-bypass: `--ask-for-approval never` with the configured workspace sandbox.
- Codex restricted: configured non-interactive `codex exec` args without the approval bypass.
- Claude Code full-bypass: `--dangerously-skip-permissions`.
- Claude Code restricted: `--permission-mode auto`.
- OpenCode full-bypass: `opencode run --format json --dangerously-skip-permissions` with the AOR request attached through OpenCode's message/`--file` CLI surface.
- OpenCode restricted: `opencode run --format json` with the same file-attached request transport.
- Qwen candidate full-bypass: `qwen --bare --auth-type anthropic --output-format stream-json --include-partial-messages --approval-mode yolo --exclude-tools skill --max-wall-time <resolved-timeout-minus-reserve>s` with `external_runtime.env_from` mapping `ANTHROPIC_AUTH_TOKEN` to `ANTHROPIC_API_KEY` when needed by the host setup.
- Qwen candidate restricted: `qwen --bare --auth-type anthropic --output-format stream-json --include-partial-messages --approval-mode default --exclude-tools skill --max-wall-time <resolved-timeout-minus-reserve>s` with the same auth env bridge.

Qwen candidate runs also rely on Runtime Harness runner-state leakage detection: target-checkout changes under `.codex/`, `.claude/`, `.qwen/`, or `.opencode/` are classified as `runner-owned-state-leak` and block the run before delivery proof can treat runner-local state as patch content.

Use `runtime-permission-runner-certification.md` for the post-merge real-runner smoke lane that checks these mappings without changing contracts or provider status.

Live adapter preflight uses `execution.external_runtime.preflight_timeout_ms` when present, and otherwise derives a bounded probe timeout from `execution.external_runtime.timeout_ms`. Preflight and full external runner execution are hard local subprocess bounds: a runner that exceeds them has its local process group killed and is reported as timeout evidence instead of leaving the public lifecycle waiting indefinitely. Real external provider profiles use a 60 minute full-runner bound (`timeout_ms=3600000`) while keeping preflight probes short (`preflight_timeout_ms=120000`), so medium and larger full-journey proofs are constrained by route/policy budgets before the adapter's hard cap. Per-step policy budgets may shorten an external runner request, but they must not extend it beyond the adapter profile timeout. Edit-readiness and permission-readiness retry transient runner timeouts or generic runner failures once, and the preflight report records every attempt. If the edit-readiness or permission-readiness marker is written with the expected nonce before the runner times out, readiness passes with a `post-marker-timeout` warning; structured permission denials still fail even when the marker exists.

While an external provider step is running, `run-control-state-<run>.json`
preserves `provider_step_status` and public reads expose the same heartbeat
through `aor run status`, `GET /api/projects/:projectId/state`, and
`GET /api/projects/:projectId/runs`. Active heartbeat events may also appear in
`GET /api/projects/:projectId/runs/:runId/events/history` and the matching SSE
stream as `provider.heartbeat` events with the same `provider_step_status`
snapshot. The status must show provider, adapter, route, step, elapsed time,
timeout budget, remaining budget, last output or artifact update, a compact
command label, and a recommended action. Silent providers are reported as
`silent-running` after the no-output window rather than as a hung terminal
process. The SPA should auto-refresh public read surfaces while a provider
status is active so elapsed/budget/progress remain visible without manual
refresh. Operator reports and the SPA must not print raw process commands, args,
env, tokens, or provider secrets; raw evidence remains behind explicit evidence
refs.

`running`, `silent-running`, and `timeout-risk` are transient provider states.
Before final observation, run summary, or run-health evidence is written, the
runner refreshes provider status from durable run-control state so terminal
`completed`, `failed`, or `interrupted` evidence cannot be hidden by a stale
observation snapshot.

For Qwen candidate profiles, `provider_step_status` also exposes sanitized
stream progress from official `stream-json` stdout: `last_progress_at`,
`last_progress_kind`, `last_progress_label`, `progress_event_count`, and
`output_mode=stream-json`. AOR must not depend on private `~/.qwen/chats` or
`~/.qwen/debug` files for normal progress detection. Those files are useful only
for manual diagnosis when public stream evidence is absent.

Live adapter request and raw-output evidence files must use bounded filenames. Full-journey run ids, repair suffixes, step ids, and request ids can be long, so the persisted file name keeps the adapter prefix for operator readability and uses a short token plus hash for uniqueness. The evidence ref remains the durable contract; consumers must not depend on the full run id being embedded in the basename.

Skill-agent operator decisions cannot override deterministic validation. A `continue` decision is accepted only when the step's deterministic analysis is `pass`, `warn`, or `resumed` and the decision declares `semantic_analysis.judge_source=skill-agent`; deterministic `not_pass`, `blocked`, or `interaction_required` evidence must be diagnosed, answered, retried through public surfaces, or blocked instead of continued.

`run start` passes concrete packet refs into the adapter request when the public lifecycle has materialized them. Full-journey execution binds the approved handoff and spec result as refs such as `packet://handoff@evidence://...` and `packet://spec@evidence://...`, while preserving abstract fallback refs when no concrete artifact exists. Runners should use those refs before broad repository searches so runtime harness evidence is tied to the intended packet artifacts.

Optional override for local catalog experiments:
```bash
node ./scripts/live-e2e/run-profile.mjs \
  --project-ref . \
  --profile ./scripts/live-e2e/profiles/full-journey-regress-ky.yaml \
  --catalog-root ./scripts/live-e2e/catalog
```

Bootstrap assets are always loaded from packaged repository assets. The old `--examples-root` override has been removed so live E2E cannot inject fixture-only bootstrap assets.

Production-proof candidate profile:

```bash
node ./scripts/live-e2e/run-profile.mjs \
  --project-ref . \
  --profile ./scripts/live-e2e/profiles/full-journey-production-proof-ky-openai.yaml \
  --runner-auth-mode host \
  --runtime-agent-permission-mode full-bypass
```

`full-journey-production-proof-ky-openai.yaml` is stricter than the W14 coverage profiles:
- it resolves `ky` and `ky-header-regression` from the curated target catalog;
- it uses the packaged `codex-cli` adapter profile and `external_runner_mode=real-external-process`;
- it has no bootstrap asset override path because production proof cannot use deterministic mock adapter injection;
- it sets `verification.baseline_gate.mode=blocking`, so target verification failures block before provider execution;
- it keeps `output_policy.write_back_to_remote=false` and `preferred_delivery_mode=patch-only`;
- it starts from candidate profile metadata, then promotes the run summary to `proof_scope=full_code_changing_runtime` and `real_code_change_proof_complete=true` only when executable evidence proves a real code-changing pass, Runtime Harness/review/delivery evidence exists, and the no-upstream-write assertion passes.

Expected output includes:
- `run_id`
- `live_e2e_run_summary_file`
- `live_e2e_run_health_status`
- `live_e2e_run_health_report_file`
- `aor_installation_proof_file`
- `live_e2e_controller_state_file`
- `live_e2e_scorecard_files`

## Manual step workflow
Use the manual entrypoint when a maintainer wants to inspect or answer one controller decision at a time:

```bash
node ./scripts/live-e2e/manual-live-e2e.mjs \
  --project-ref . \
  --profile ./scripts/live-e2e/profiles/full-journey-regress-ky.yaml \
  --run-id <stable-run-id>
```

One invocation runs only the next pending controller step, writes `live_e2e_controller_state_file` plus a `live-e2e-step-observation-*` artifact, and prints the current decision. Re-run the same command with the same `--run-id` after completing any required public action. Manual resume reuses a previously passing live adapter preflight report from the controller artifact snapshot instead of probing the provider again, so transient provider readiness after discovery/spec/planning/handoff cannot overwrite earlier pass evidence. After the execution step has been observed, including while it is waiting for a skill-agent decision, manual resume reuses the preserved pre-execution baseline and target-cleanliness evidence instead of re-checking the already-mutated target checkout as if execution had not run; if that preserved readiness evidence is missing, resume fails closed. The same rule applies to repair-loop iterations such as `execution#2`: installing the operator decision must update the persisted observation, not rerun or reclassify the already observed public execution. When repeated command labels exist in the command journal, the controller resolves cached evidence by matching label plus step instance and iteration; legacy state may fall back only when the transcript matches the persisted step journal entry or the label is not repeated.

Manual output includes a compact `provider_step_status` summary when the latest
observed command ran an external provider. Use that summary to distinguish
`running`, `silent-running`, `timeout-risk`, `completed`, and `failed` provider
states without opening terminal process details.

Artifact refs in live E2E UI/operator reads should render through
`artifact_display_summaries[]`: show label, type, stage, status, severity, and
short purpose first; keep the raw evidence/path/packet ref only in explicit
debug or `Copy raw ref` actions. Missing or unreadable refs must stay visible as
`status=missing` summaries rather than disappearing from the operator view.
When a live E2E step observation artifact exists but still needs a skill-agent
operator decision, render it as `status=awaiting-decision` with warning severity
instead of treating the observation itself as missing evidence.

The execution evidence panel reads `RunSummary.execution_evidence` and is the
operator view for provider execution, Runtime Harness decision, real-code-change
status, post-run verification, review, delivery readiness, and no-upstream-write
status. Changed paths are grouped as `mission-relevant`, `runtime-owned`,
`runner-owned-leak`, and `scratch-unrelated`. Scratch-only output cannot count
as a passing implementation. Runner-local state under `.qwen/`, `.codex/`,
`.claude/`, or `.opencode/` in the target checkout is a blocking
`runner-owned-leak` and must not be delivered as target work.

Interruption controls must use public surfaces only:
- stop a running provider with `aor run cancel`, which records durable
  `provider_step_status.status=interrupted`,
  `provider_step_status.interruption_owner=operator`,
  `provider_step_status.interruption_status=operator-stopped`, and matching
  audit evidence. The controller must classify this as
  `failure_owner=operator` and `failure_phase=provider_execution`, not as a
  provider-quality failure, while still interrupting the supervised external
  provider process instead of only changing report state;
- preserve partial evidence with `aor run status --json`;
- diagnose or retry with `manual-live-e2e.mjs --prepare-decision --action
  diagnose` or `--action retry_public_step`.

An interrupted provider run is not a pass and must remain visible as partial
evidence for diagnosis or public retry. UI controls should disable diagnose or
retry buttons when no public `agent_decision_request_ref` is visible, instead
of inventing a private continuation path.

Delivery-time harness certification uses the delivery-owned diagnostic label `delivery-harness-certify`. Review-time `harness-certify` evidence must not be replayed as delivery certification evidence, because delivery certification is a fresh public `aor harness certify` precondition before `aor deliver prepare`.

When the step stops for a required skill-agent decision, prepare the decision
from the request rubric instead of hand-copying raw JSON refs:

```bash
node ./scripts/live-e2e/manual-live-e2e.mjs \
  --prepare-decision \
  --request <agent_decision_request_ref> \
  --action continue \
  --finding "Required public evidence refs were inspected."
```

If `--request` is omitted, pass the same `--project-ref`, `--runtime-root` when
used, and `--run-id`; the helper finds the latest pending
`agent_decision_request_ref`. The helper writes to the request's
`operator_decision_expected_ref` by default, or to `--output <decision.json>` for
a draft file. It automatically fills `inspected_evidence_refs[]` from
`decision_rubric.required_evidence_refs[]`, preserves frontend evidence refs, and
prints a validation preview with readable rejection risks. Supported actions are
`continue`, `diagnose`, `block`, `retry_public_step`, `answer`, and
`frontend_interact`.

Install the prepared decision before resuming:

```bash
node ./scripts/live-e2e/manual-live-e2e.mjs \
  --project-ref . \
  --profile ./scripts/live-e2e/profiles/full-journey-regress-ky.yaml \
  --run-id <stable-run-id> \
  --operator-decision-file <decision.json>
```

If the controller reports `operator_decision_status=rejected`, read the
`operator_decision_rejection_reason` from the latest step observation and run the
same `--prepare-decision` command again with the corrected action, semantic
status, finding, or operator note. The correction path must not require manual
editing of raw JSON just to restore required evidence refs.

Interaction answers must still go through `aor run answer` or the HTTP answer route; a local operator decision file cannot substitute for answer audit evidence.

Operator-initiated requests use `aor request create/run/status` and stay
separate from runtime-initiated `requested_interaction` answers. A no-write
analysis request may target current evidence refs from the step observation.
A document-change rehearsal must use `delivery-mode=patch-only` with explicit
`--allowed-path` and must assert that proposal/patch evidence exists while no
upstream write occurs.

## Step evaluator
Use the step evaluator when the run must fail closed if any controller phase evidence is missing:

```bash
node ./scripts/live-e2e/step-evaluator.mjs \
  --project-ref . \
  --profile ./scripts/live-e2e/profiles/full-journey-regress-ky.yaml
```

The evaluator uses the same controller as `run-profile.mjs`, runs in automatic mode until terminal success or an unresolved action, and rejects reports where any observed step lacks `plan`, execution, inspection, classification, or decision evidence. `aor harness certify` remains the public replay/certification command inside the SDLC flow; the step evaluator is the live E2E decision-loop wrapper.

## Qualification loop
Use the qualification loop helper for the outer fix-and-rerun workflow:

```bash
node ./scripts/live-e2e/qualification-loop.mjs \
  --project-ref . \
  --profile ./scripts/live-e2e/profiles/full-journey-regress-ky-medium-open-code.yaml
```

The helper accepts only medium or large profiles. Xlarge profiles are
manual-only and must not enter qualification sets. The helper runs one fresh live
E2E, writes `live-e2e-qualification-analysis-*`, and exits as:
- `0` / `passed`: full flow and quality passed;
- `2` / `needs_fix`: AOR code or live E2E flow likely needs a patch before rerun;
- `3` / `blocked`: environment, provider, auth, permission, or safety setup prevented a valid evaluation.

When the helper exits `blocked` because an acceptance profile is waiting for required skill-agent decisions, complete the same run with `manual-live-e2e.mjs`. After the terminal manual resume writes a passing run summary and final observation report, reconcile that same evidence into the qualification set without starting a new target workspace:

```bash
node ./scripts/live-e2e/qualification-loop.mjs \
  --project-ref . \
  --profile ./scripts/live-e2e/profiles/full-journey-release-ky-medium-openai.yaml \
  --qualification-set-file /tmp/aor-live-e2e-qualification-set.json \
  --record-run-summary-file <live-e2e-run-summary-file>
```

Record mode applies the same medium/large and pass/fix/block classification gates as a fresh run, reads the observation report from the summary unless `--record-observation-report-file` is supplied, and upserts the qualification-set attempt by `run_id` so a manually resumed run replaces its earlier blocked accounting entry. The recorded summary must match the selected profile's `profile_id`, `target_catalog_id`, `feature_mission_id`, `scenario_family`, `provider_variant_id`, and `feature_size`. Run summaries include `commit_sha` and `branch_name`; record mode requires `commit_sha` to be on the current branch lineage and rejects cross-profile, cross-provider, corrupt, stale, or xlarge-only qualification evidence before writing the qualification set.

The launching agent performs the fix and commit. Final qualification requires at least five full positive medium/large runs across provider variants: at least two `openai-primary`, at least two `anthropic-primary`, and at least one `open-code-primary`. `qwen-primary` is extended candidate evidence and does not count toward the required qualification set until a future promotion changes its coverage tier.

W40 adds an optional provider qualification matrix for installed-user alpha
operations. That matrix is separate from historical final-qualification counts:
it records Codex, Claude, OpenCode, and Qwen as readable provider cells with
`qualification_status`, `failure_owner`, `failure_phase`, and
`release_blocking` fields. The W40 optional matrix must not infer success or
failure from provider name alone. It must also keep target repository blockers,
environment/auth blockers, provider blockers, and AOR product failures separate.
For the current alpha scope, optional provider cells do not block release unless
a release plan explicitly lists them in `release_blocking_provider_ids[]`.
Details and the sample report are in
`docs/ops/live-e2e-provider-qualification.md`.

## Layer behavior
Legacy bounded rehearsal summaries:
- may still appear in archived evidence and backlog history;
- are not supported live E2E acceptance inputs;
- must not be cited instead of catalog-backed full journeys,
  `installed-user-guided-journey`, or the W25 production-proof fixture.

Full-journey layer:
- resolves `target_catalog_id`, `feature_mission_id`, `scenario_family`, and `provider_variant_id` from the curated internal catalog;
- uses public `aor project init` with a host-side generated project profile plus repo command overrides derived from the curated catalog;
- preflights the selected provider adapter before execution so missing live runtime metadata, missing commands, auth failures, edit-readiness failures, and permission-mode blocks fail before `run start`;
- keeps adapter preflight self-contained: the provider invocation used for
  readiness must not recursively launch provider CLIs such as `codex`,
  `claude`, `opencode`, or `qwen`; auth-only request-artifact probes should
  return a concise preflight report without shell commands, and edit/permission
  probes may only touch the named nonce and marker files;
- records auth probe attempts and retries one transient auth/runtime probe failure before failing the proof;
- splits verification into `readiness`, `baseline_diagnostic`, and `post_run_quality` phases;
- treats full-journey baseline target verification as diagnostic by default: failed target `verification.commands` are preserved as context, but setup failures, missing prerequisites, failed validation, missing or failed routed dry-run, provider readiness failure, and unsafe write-back policy still block before execution;
- resolves mission post-run quality into a mission-blocking primary gate plus optional full diagnostic commands; a failed diagnostic command records findings without hiding a passing primary gate unless the mission declares `diagnostic_failure_mode=fail`;
- has the runner prepare one structured feature request input under AOR run state;
- requires medium, large, and xlarge catalog missions to provide goals, KPIs, Definition of Done, expected quality evidence, and primary post-run commands; xlarge remains manual observation evidence and cannot close required acceptance;
- materializes provider-pinned route and policy overrides in host-side AOR run
  state before execution starts so all provider variants share the same
  retry/repair lifecycle semantics for the selected profile class;
- writes an execution-readiness decision before `run start` so promotion evidence is based on readiness and routed dry-run proof, not on a failed baseline target check;
- includes the materialized spec step-result as a concrete `packet://spec@evidence://...` promotion ref for adapter context, while `run start` binds the approved handoff ref into the compiled context.
- runs the public observation lifecycle through `intake create`, `project analyze`, `project validate`, baseline `project verify --verification-label baseline-diagnostic --routed-dry-run-step implement`, `discovery run`, `spec build`, `wave create`, `handoff approve`, `project validate --require-approved-handoff`, `run start`, `run status`, primary post-run `project verify --verification-label post-run-primary`, `review run`, `eval run`, optional diagnostic `project verify --verification-label post-run-diagnostic`, and `deliver prepare --quality-gate-mode observe`.
- repeats public `run start` / `review run` iterations with iteration-specific run ids when review or primary verification requests repair, and records each repeated step as `execution#N` and `review#N` in the step journal.
- bounds each target `project verify` command with a per-command timeout from the generated project profile and uses a hard local timeout signal for target commands. Generated live E2E project profiles default this bound to 1800 seconds per command unless the profile sets `live_e2e.target_command_timeout_sec`; Ky bounded full-journey profiles use explicit shorter budgets and mission-scoped verification commands so Playwright/browser setup and the full browser matrix cannot block before operator-visible decisions. Ky diagnostic full-suite policy installs Playwright browsers immediately before `npm test`, preserving full-suite evidence without reintroducing browser setup into the primary gate. Timeout failures are preserved as failed step-result evidence with target setup/verification owner and phase fields.
- runs target verification commands with inherited Node compile-cache state disabled so the orchestrator's runtime session cache cannot corrupt target package-manager or test-runner module loading.
- gates continuation after every observed public step by the online live E2E controller decision.
- keeps `release` and `learning` outside `step_journal[]` for `delivery_default` profiles; full-lifecycle profiles, including bounded full-lifecycle profiles, execute profile-declared terminal stages as ordinary observed steps. Governance profiles that declare `learning` must reach learning closure even when release is not required.

Production-proof profiles add a fail-closed layer on top of full-journey behavior:
- runner auth probe is required;
- edit and permission readiness are required before `run start`;
- target setup and verification commands must be declared;
- baseline target verification must use blocking mode;
- write-back must remain disabled and delivery mode must be `patch-only` or `local-branch`;
- proof-runner bootstrap asset overrides are not supported.

Guided full-journey profiles set `guided_journey.enabled=true`. They still use the full-journey catalog and public CLI subprocesses, but prepend installed-user shortcuts (`doctor`, `onboard`, `app`, `next`), use `mission create` for the first product intake packet, require an approved `review decide` before delivery/release, run `release prepare`, close `learning handoff`, create a follow-up mission with `--follow-up-source-handoff-ref`, refresh `next` for the second flow, and create a flow-targeted `request create --target-flow-id`. The runner writes `installed-user-guided-journey-proof-<run>.json` and fails the run if the proof is only narrative: required CLI transcripts, packet/report files, flow-loop fields, browser-task/frontend evidence refs, and no-upstream-write assertions must be materialized.

Guided installed-user proof profiles keep provider execution timeouts long enough
for real runtime work, but target verification commands stay bounded. The guided
proof exists to produce AOR operator UI/UX and accessibility evidence; target
full-suite diagnostic commands are supporting facts and must not leave the
manual runner waiting on an unbounded repository test process. Ky guided proof
profiles therefore override catalog setup with only
`npm install --prefer-offline --no-audit --no-fund`; Playwright browser
installation remains diagnostic evidence from the mission policy instead of a
pre-execution readiness blocker.

No proof-runner-side `examples/context/project profile` injection is allowed inside the target checkout on the full-journey path.

## Inspect
The proof runner is a black-box step controller. Inspect `live_e2e_run_summary_file` directly:
- read `status`, `stage_results`, and `command_results`;
- inspect `aor_installation_proof_file` and `setup_journal[]` before trusting SDLC step evidence;
- inspect `live_e2e_observation_report_file` first; it is the durable ordered step journal;
- inspect `live_e2e_controller_state_file` to see the current step, completed steps, phase history, pending decision, retry counters, and evidence refs;
- inspect `live_e2e_step_observation_files[]` for per-step plan, public transcript, artifact refs, analysis, interaction decisions, and resume results;
- inspect `implementation_loop.iterations[]` when a run repaired through repeated `execution` / `review` steps;
- inspect `agent_decision_request_ref` and the matching `operator_decision_ref` for each step; acceptance profiles require accepted skill-agent decisions before continuation;
- inspect `artifacts.routed_step_result_file`, `artifacts.review_report_file`, delivery artifacts, and public closure artifacts when present;
- inspect `live_e2e_run_health_report_file` for run-health status and owner/phase/class classification;
- prepare and validate a separate post-run quality assessment when outcome quality is needed.

Full-journey summaries must carry:
- `target_catalog_id`
- `feature_mission_id`
- `feature_request_file`
- `intake_artifact_packet_file`
- `baseline_verify_summary_file`
- `baseline_verify_status`
- `baseline_verify_gate_decision`
- `post_run_verify_summary_file`
- `post_run_verify_status`
- `post_run_diagnostic_verify_summary_file` when configured
- `post_run_diagnostic_status`

On manual resume, the runner should reuse an already materialized `post_run_diagnostic_verify_summary_file` instead of
rerunning diagnostic commands for every delivery/release/learning tail step. A new diagnostic run is required only when
the preserved summary is missing.
- `real_code_change_status`
- `runtime_harness_report_file`
- `runtime_harness_decision`
- `run_start_runtime_harness_decision`
- `latest_runtime_harness_decision`
- `review_report_file`
- `live_e2e_observation_report_file`
- `live_e2e_run_health_report_file`
- `live_e2e_run_health_overall_status`
- `live_e2e_controller_state_file`
- `live_e2e_step_observation_files`
- `live_e2e_observation_overall_status`
- `operator_context`
- `run_tier`
- `full_flow_facts` when emitted by full-journey flow execution

Production-proof candidate summaries additionally carry:
- `production_proof`
- `proof_scope`
- `external_runner_mode`
- `real_code_change_proof_complete`
- `production_proof_evidence_status`
- `production_proof_evidence_refs`
- `no_upstream_write_assertion`
- `delivery_manifest_file`
- `review_report_file`
- `latest_runtime_harness_report_file`

The W25-S03 committed production proof fixture is
`examples/live-e2e/fixtures/w25-s03/w25-s03-production-proof.json`. It is a sanitized derivative of the real
W25-S02 `full-journey-production-proof-ky-openai.yaml` run and records `proof_scope=full_code_changing_runtime`,
`real_code_change_proof_complete=true`, `external_runner_mode=real-external-process`, `overall_status=pass`,
meaningful implementation changed paths, Runtime Harness/review/delivery evidence summaries, and a passing no-upstream-write
assertion. It intentionally excludes runtime output paths, target checkout contents, raw transcripts, and secrets.

Guided full-journey summaries also carry:
- `guided_journey`
- top-level `guided_web_smoke_summary_file`
- top-level `guided_web_smoke_html_file`
- top-level `guided_web_dom_snapshot_file`
- top-level `guided_web_accessibility_summary_file`
- top-level `guided_web_visual_guardrail_file`
- top-level `guided_browser_task_proof_request_file`
- top-level `guided_browser_task_proof_file`
- `artifacts.guided_journey_proof_file`
- `artifacts.guided_web_smoke_summary_file`
- `artifacts.guided_web_smoke_html_file`
- `artifacts.guided_web_dom_snapshot_file`
- `artifacts.guided_web_accessibility_summary_file`
- `artifacts.guided_web_screenshot_files` when browser-task proof provides screenshots
- `artifacts.guided_web_visual_guardrail_file` for deterministic app-smoke visual guardrail evidence
- `artifacts.guided_browser_task_proof_request_file`
- `artifacts.guided_browser_task_proof_file`
- `artifacts.first_flow_id`
- `artifacts.first_flow_status=completed`
- `artifacts.completed_flow_read_only=true`
- `artifacts.second_flow_id`
- `artifacts.follow_up_source_handoff_ref`
- `artifacts.new_flow_mission_artifact_packet_file`
- `artifacts.new_flow_next_action_report_file`
- `artifacts.flow_targeted_operator_request_file`
- `artifacts.review_decision_file`
- `artifacts.release_packet_file`
- `artifacts.target_head_before` and `artifacts.target_head_after`
- `artifacts.target_git_status_without_runtime`

If the guided profile requires `browser-task-proof`, a missing `guided_browser_task_proof_file` or non-passing
`frontend_interactions[].task_outcome.status` must make run-health non-passing with
`failure_summary.phase: ui_validation`. The deterministic web smoke remains factual render evidence only.
The browser proof must be captured against the live app surface recorded in
`artifacts.guided_browser_task_proof_request_file` as `app_url`/`control_plane`.
The request also preserves `smoke_app_url` as guardrail history, but that smoke
server is short-lived and must not be used as the browser-task inspection target.
The same request must also name the expected proof file and deterministic
HTML/DOM/accessibility/visual guardrail refs so the operator can cite stable
local evidence without re-deriving paths.

Each command and stage result should carry status, duration, transcript or artifact refs when available, failure class, missing evidence, and a recommendation. A command exit code of `0` is not enough for product observation success when required step evidence is missing.

Archived fixture summaries may carry legacy bounded fields, but they are not live E2E acceptance proof:
- `target_checkout_root`
- `generated_project_profile_file`
- `routed_step_result_file`
- `compiled_context_ref`
- `adapter_raw_evidence_ref`

## Observation Report
The runner writes `live-e2e-observation-report` for every profile. The report is an ordered `step_journal`, not a post-run matrix.

Default profiles use `live_e2e.flow_range_policy=delivery_default`:

`discovery -> spec -> planning -> handoff -> execution -> review -> qa -> delivery`

Guided, release, or governance-audit profiles use `live_e2e.flow_range_policy=full_lifecycle`.
The terminal segment is profile-declared: release profiles include `release -> learning`, while governance profiles can include `learning` without requiring `release`.

`discovery -> spec -> planning -> handoff -> execution -> review -> qa -> delivery -> release -> learning`

Installation proof, target checkout, `project init`, `intake create`, `project analyze`, and readiness validation are setup/prelude evidence captured in `setup_journal[]`. The SDLC `step_journal[]` starts at `discovery`.

`overall_status` uses:
- `pass`: every observed public step and final analysis passed.
- `warn`: the flow completed with non-terminal findings.
- `not_pass`: the black-box flow failed.
- `blocked`: execution reached a non-resumable control-plane boundary.
- `interaction_required`: a step produced an unresolved `requested_interaction`.
- `resumed`: an interaction answer resumed a recorded checkpoint.

Delivery evidence no longer downgrades `not_pass` to `warn`.

`deliver prepare` must be invoked with `--quality-gate-mode observe` by the live E2E runner. In observe mode Runtime Harness failures, no meaningful patch, and quality findings are copied into delivery output instead of preventing delivery evidence materialization.

## Step Analysis
The runner performs deterministic analysis for every step from public command transcripts and artifact refs, then writes `agent_decision_request_ref` before the next public step can run. Acceptance and production-proof profiles require `operator_context.operator_kind=skill-agent`, `decision_policy=required`, and an accepted `operator_decision_ref` for every observed step.

The live E2E skill is the operator. It reads the decision request, inspects public artifacts/UI/API/logs, writes the operator decision artifact with `semantic_analysis.judge_source=skill-agent` and non-empty `inspected_evidence_refs[]`, and answers any requested interaction through public control-plane surfaces such as `aor run answer` or the HTTP answer route. `--agent-judge-file` is removed; live E2E semantic analysis during the run comes only from accepted skill-agent step decisions. Outcome quality is assessed after the run in `live-e2e-quality-assessment-report`.

Every `agent_decision_request_ref` carries a decision rubric with required inspection refs. The skill-agent decision must cite those refs in `inspected_evidence_refs[]`; missing or non-materialized local refs are rejected fail-closed. Use `manual-live-e2e.mjs --prepare-decision` as the default draft path so required refs and frontend refs are copied from the request rather than typed by hand. For UI-capable profiles, the decision must cite the frontend evidence refs for HTML, DOM snapshot, accessibility summary, and screenshot or visual evidence before continuation can be accepted. Deterministic `aor app --smoke` visual summaries are guardrails only and do not replace `browser-task-proof` evidence.
If browser-task proof is written after the decision request was created, the helper should hydrate the draft from the guided smoke/proof request files so the proof JSON and screenshots are also cited as inspected frontend evidence.

Judge criteria:
- traceability to feature request, mission, and previous step;
- completeness for the step;
- actionability for the next step;
- consistency with neighboring artifacts;
- absence of synthetic or no-op explanations that hide failure.

If a profile does not provide an accepted skill-agent operator decision, the runner stops fail-closed and writes the decision request for manual/evaluator continuation.

For guided installed-user runs, deterministic web smoke is only a render guardrail. `frontend_interactions[]` must carry HTML, DOM, accessibility, screenshot or visual-guardrail evidence as factual AOR operator UI proof. AOR operator UI/UX quality is assessed later in `live-e2e-quality-assessment-report`; checked-repository frontend behavior belongs to implementation and verification evidence when the mission requires it. The guided proof must also include `flow_loop.first_flow_id`, `flow_loop.first_flow_status=completed`, `flow_loop.completed_flow_read_only=true`, a distinct `flow_loop.second_flow_id`, `flow_loop.follow_up_source_handoff_ref`, fresh second-flow intake/next-action files, and `flow_loop.operator_request.target_flow_id` pointing at the second flow.
When `browser-task-proof` is required, open the `app_url` from
`guided_browser_task_proof_request_file`; the runner starts that additional live
surface specifically for skill-agent/browser inspection. Do not rely on the
`smoke_app_url`, because `aor app --smoke` closes its server after writing the
guardrail summary. If browser proof is written after the smoke summary, final
report assembly must rehydrate `guided_web_smoke.task_outcome` and
`frontend_interactions[]` from the proof file before run-health is finalized.
After the lifecycle is complete, the temporary proof app surface should be
terminated and recorded in the run summary cleanup field.

## Run Health
The run summary links `live_e2e_run_health_report_file`. This report is the only status source for quality of the run itself. It covers:
- lifecycle completion;
- public command failures;
- controller gaps and missing operator decisions;
- provider execution status;
- target setup and target verification environment status;
- missing factual evidence refs;
- resume or interaction issues;
- primary failure `owner`, `phase`, and `class`.

Run-health must not evaluate produced code, artifact content, test adequacy, security, performance, AOR operator UI/UX, accessibility, or release readiness. A run can have `overall_status=pass` while the post-run quality assessment still reports weak or failing outcome quality.

## Post-Run Quality Assessment
After the full flow, the launching SWE agent prepares an assessment request:

```bash
node ./scripts/live-e2e/quality-assessment.mjs prepare \
  --run-summary-file <live_e2e_run_summary_file>
```

The SWE agent then freely inspects linked evidence and writes `live-e2e-quality-assessment-report`. Validate it without changing run or qualification status:

```bash
node ./scripts/live-e2e/quality-assessment.mjs validate \
  --assessment-report-file <live_e2e_quality_assessment_report_file>
```

For strict fix-and-rerun quality closure, run the separate all-pass gate after
validation:

```bash
node ./scripts/live-e2e/quality-assessment.mjs gate \
  --policy all-pass \
  --assessment-report-file <live_e2e_quality_assessment_report_file>
```

The gate fails on any `warn`, `fail`, `not_evaluated`, `weak`, `missing`,
blocking/high/critical/major finding, missing local evidence ref, or missing
meaningful target changed path. The gate does not change run-health,
qualification, or acceptance accounting; it only decides whether the local
quality-driven rerun loop may stop.

The assessment report is advisory outcome quality evidence. It must cover artifact content, implementation correctness/completeness, maintainability, tests, security, performance risk, verification quality, delivery safety, AOR operator UI/UX, AOR operator accessibility, evidence strength, and acceptance criteria traceability. Every dimension records `status`, `evidence_strength`, inspected refs, findings, and follow-ups. The AOR operator UI/UX dimensions also record required subdimensions for task success, flow navigation, next actions, blockers, recovery, state feedback, visual responsiveness, raw JSON independence, keyboard navigation, focus, contrast/readability, semantic structure, screen-reader labels, and accessible error feedback. Missing or weak signals must stay visible in `gap_report`.

Headless full-journey profiles normally do not produce AOR operator UI/UX or
accessibility evidence. When strict quality closure needs those dimensions, run
the matching guided installed-user proof for the same AOR commit and pass that
guided run summary to `quality-assessment prepare` with
`--paired-aor-operator-ui-run-summary-file`. This paired evidence may be used
only for AOR operator UI/UX and accessibility; target repository UI remains part
of implementation and verification evidence when the mission requires it.

## Operator checks
- Summary and scorecard files exist under `.aor/projects/<project_id>/reports/`.
- `target_checkout_root` exists and is a cloned checkout, not the control-plane repository root.
- Full-journey runs resolve repo and mission from the curated catalog; they must not rely on raw `repo_url` plus free-form objective text.
- Full-journey runs resolve one explicit matrix cell and preserve `matrix_cell` plus `coverage_follow_up` in summary, review, audit, and learning artifacts.
- Full-journey runs use public `project init` with a host-side generated project profile and host-side bootstrap assets under the AOR `.aor/` run state. Target checkouts must not receive proof-runner `examples/`, `context/`, root `project.aor.yaml`, generated route files, or `.aor-live-e2e` scaffolding before agent execution.
- `routed_step_result_file` exists and references a routed step with `mode=execute`.
- `request_artifact_ref`, `provider_work_packet_ref`, `context_budget_status`, and `top_context_size_sources[]` are present when an external provider was invoked or blocked by context-budget guardrails.
- `review_report_file` exists and is contract-valid.
- `review-report.provider_traceability` matches the requested provider variant and adapter path.
- `review-report.feature_size_fit` stays inside the declared size budget for the mission.
- `review-report.artifact_quality.verify_summary_ref` points at the post-run `project verify` summary.
- If the final `execution#N -> review#N` iteration still has non-passing review evidence after the repair budget is exhausted, the runner must stop at factual run-health with `failure_summary.phase=review` and `failure_summary.class=implementation_repair_loop_exhausted`; it must not continue into QA or create a post-run quality assessment.
- `post_run_verify_status`, `provider_execution_status`, `real_code_change_status`, and Runtime Harness decisions are factual post-delivery signals. Runtime Harness can block run health for missing execution evidence, adapter crashes, unresolved interaction, blocked runtime state, runner-owned state leaks, or missing mission-relevant source-change evidence. It does not provide the final implementation-quality verdict; `change_evidence.required_path_prefixes` only defines the minimum changed-path evidence that can prove the selected catalog mission was touched.
- `delivery_manifest_file` exists and is anchored to the target checkout.
- `live_e2e_run_health_report_file` exists and separates run-health failures from outcome-quality assessment.
- `compiled_context_budget_exceeded` is a run-health/provider-execution blocker, not an implementation-quality verdict. Do not prepare post-run quality assessment unless the declared full flow produced outcome artifacts.
- Outcome quality follow-up comes from `live-e2e-quality-assessment-report`, not from the runner summary.
- Proof runner execution stays CLI-only and remains valid with web UI detached.
- Guided proof execution starts from `aor doctor`, `aor onboard`, `aor app`, and `aor next`; the target repository HEAD must remain unchanged and no remote write commands may be recorded unless an explicit future profile opts into network write-back.

## W21-S07 guided proof bundle (2026-05-06)
Canonical profile:
- `scripts/live-e2e/profiles/installed-user-guided-journey.yaml`

Canonical fixtures:
- `examples/live-e2e/fixtures/w21-s07/installed-user-guided-proof.sample.json`
- `examples/live-e2e/fixtures/w21-s07/installed-user-guided-app-smoke.sample.json`
- `examples/live-e2e/fixtures/w21-s07/installed-user-guided-blocked-readiness.sample.json`

Run command:
```bash
node ./scripts/live-e2e/run-profile.mjs \
  --project-ref . \
  --profile ./scripts/live-e2e/profiles/installed-user-guided-journey.yaml
```

Pass evidence requires all of the following:
- CLI transcript files for doctor, onboard, app, next, mission create, run execution, review decision, delivery, release, and learning closure.
- Durable onboarding, intake, next-action, run, review, review-decision, delivery, release, learning, and web smoke artifacts, including first-run wizard, project switcher, flow selector, and `New Flow` smoke markers.
- Public-repo safety assertions: `write_back_to_remote=false`, `patch-only` delivery mode, unchanged target `HEAD` until controlled execution, runtime state under `.aor/`, and no `.aor-live-e2e` state.
- Blocked and partial-readiness branches must keep the same no-write defaults visible and must not be marked pass without durable artifacts.

## Removed W14-S07 matrix fixture bundle (2026-04-24)
The old W14-S07 matrix fixture bundle was removed after live E2E moved to skill-agent-only proof. It was historical `coverage_with_findings` evidence backed by deterministic external-runner mock behavior, so it is no longer valid acceptance closure. Current matrix claims need a fresh acceptance or production-proof run with accepted skill-agent decisions.

## W25-S03 production proof fixture (2026-05-08)
Canonical fixture:
- `examples/live-e2e/fixtures/w25-s03/w25-s03-production-proof.json`

Evidence note:
- the fixture is derived from a real `full-journey-production-proof-ky-openai.yaml` run, not from a bootstrap asset override or a deterministic mock runner.
- it covers the required `ky.regress.small.openai` cell with `real_code_change_proof_complete=true` and `external_runner_mode=real-external-process`; outcome quality is assessed separately from production proof.
- it records meaningful implementation changed paths under `source/utils/merge.ts` and `test/headers.ts`, plus pass summaries for post-run verification, Runtime Harness, review, delivery, and learning-loop closure.
- it records `delivery_mode=patch-only`, `write_back_to_remote=false`, unchanged target `HEAD`, empty `commit_refs`, and `writeback_results=[patch-materialized]`.
- it is sanitized for commit: no runtime output tree, target checkout, local absolute path, raw transcript, or secret material is included.

## W35-S05 operator UX proof closure (2026-06-02)
W35-S05 adds operator-UX proof evidence for the hardened live E2E surfaces:

- `examples/live-e2e/fixtures/w35-s05/silent-provider-ux-proof.sample.json`
  records a synthetic silent-provider proof for the current skill-agent-only
  model. It proves that `provider_step_status`, `artifact_display_summaries[]`,
  `RunSummary.execution_evidence`, public stop/save/diagnose actions, decision
  helper auto-filled refs, runner-owned leak blocking, and no-upstream-write
  evidence remain visible without terminal/process inspection.
- Final live proof evidence must preserve both provider and target-repository
  classification: Codex proof may close cleanly, while Qwen may close as
  fail-closed `provider_blocked` evidence only after target setup and
  verification are shown separately as pass or as their own target/environment
  blocker.
- Targeted regression coverage lives in
  `scripts/test/live-e2e-proof-runner.test.mjs` and asserts the W35 fixture
  preserves fail-closed operator evidence, readable artifact summaries, and
  decision-helper required refs.
- `examples/live-e2e/fixtures/w35-s05/live-attempts-summary.sample.json`
  records the 2026-06-02 local attempts. Codex small reached public
  `baseline-diagnostic` target verification and was blocked by a long-running
  target `npm test`/AVA/WebKit process before a controller decision could be
  produced. Current bounded Ky profiles keep `npm test` as post-run diagnostic
  evidence and run `npx playwright install` before that diagnostic full-suite,
  so browser-cache misses are recorded as target diagnostic findings instead of
  pre-execution blockers. Qwen CLI availability was confirmed (`qwen --version` returned
  `0.17.0`), but the Qwen full proof was not advanced because the same target
  verification blocker appeared before provider-specific quality could be
  judged. These attempts are fail-closed blocker evidence, not proof credit.
- Real Codex/Qwen proof attempts for W35 must use
  `full-journey-regress-ky-small-codex.yaml` or
  `full-journey-regress-ky-medium-codex.yaml`, plus
  `full-journey-regress-ky-small-qwen.yaml` for Qwen candidate evidence. If Qwen
  remains silent, leaks runner-owned `.qwen/` state, times out, or fails target
  verification, record it as provider-quality/environment blocker evidence
  instead of a product pass.
- Proof closure still requires accepted skill-agent decisions, non-empty
  `inspected_evidence_refs[]`, frontend refs when the profile requires browser
  proof, run-health evidence, post-run quality assessment evidence when outcome
  quality is being claimed, and no-upstream-write assertions.
  Deleted bounded or mock-backed proof profiles must not be restored.
