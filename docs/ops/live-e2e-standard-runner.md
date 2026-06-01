# Runbook: live E2E standard runner

## Purpose
Provide one installed-user black-box proof runner for catalog-backed full-journey profiles and guided installed-user journeys.

Live E2E simulates a user who has installed AOR, initializes or attaches a target repository, walks the public SDLC flow through CLI/API surfaces, and then emits a per-step black-box observation summary. It must not call private runtime internals to repair the run. It proves whether AOR works as a product from the public surface and whether produced artifacts explain each `pass`, `warn`, `not_pass`, block, and missing-evidence gap.

Every run starts by proving the AOR launcher before target execution. Source-channel acceptance and production-proof profiles create `${TMPDIR:-/tmp}/aor-live-e2e/<run-id>/`, copy the current AOR source into `aor-source`, run the source-only install proof (`corepack enable`, `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm aor --help`), and then use a run-scoped session launcher from that isolated source install. Runtime state is stored under `<workspace>/runtime`; target checkouts live under `<workspace>/runtime/projects/<id>/target-checkouts`. `--runtime-root` and `--aor-install-mode repo-local` are explicit dev/debug overrides, not acceptance defaults. Profiles that use `--aor-bin` must still prove the provided binary with `aor --help`.

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
acceptance proof:
- `readme-smoke`: installed-user no-write bootstrap path;
- `bounded-live`: fast fail-closed provider proof;
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
- `full-journey-regress-ky-medium-anthropic.yaml`
- `full-journey-regress-ky-medium-open-code.yaml`
- `full-journey-release-ky-medium-openai.yaml`
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
- `full-journey-governance-ky-large-openai.yaml`
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
- Qwen candidate full-bypass: `qwen --output-format json --approval-mode yolo`.
- Qwen candidate restricted: `qwen --output-format json --approval-mode default`.

Use `runtime-permission-runner-certification.md` for the post-merge real-runner smoke lane that checks these mappings without changing contracts or provider status.

Live adapter preflight uses `execution.external_runtime.preflight_timeout_ms` when present, and otherwise derives a bounded probe timeout from `execution.external_runtime.timeout_ms`. Preflight and full external runner execution are hard local subprocess bounds: a runner that exceeds them has its local process group killed and is reported as timeout evidence instead of leaving the public lifecycle waiting indefinitely. Real external provider profiles use a 60 minute full-runner bound (`timeout_ms=3600000`) while keeping preflight probes short (`preflight_timeout_ms=120000`), so medium and larger full-journey proofs are constrained by route/policy budgets before the adapter's hard cap. Per-step policy budgets may shorten an external runner request, but they must not extend it beyond the adapter profile timeout. If the permission-readiness marker is written with the expected nonce before the runner times out, access readiness passes with a `post-marker-timeout` warning; structured permission denials still fail even when the marker exists.

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
- it starts from candidate profile metadata, then promotes the run summary to `proof_scope=full_code_changing_runtime` and `real_code_change_proof_complete=true` only when executable evidence proves a real code-changing pass, required target verdicts pass, Runtime Harness/review/delivery evidence exists, and the no-upstream-write assertion passes.

Expected output includes:
- `run_id`
- `live_e2e_run_summary_file`
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

One invocation runs only the next pending controller step, writes `live_e2e_controller_state_file` plus a `live-e2e-step-observation-*` artifact, and prints the current decision. Re-run the same command with the same `--run-id` after completing any required public action. After the execution step has been observed, including while it is waiting for a skill-agent decision, manual resume reuses the preserved pre-execution baseline and target-cleanliness evidence instead of re-checking the already-mutated target checkout as if execution had not run; if that preserved readiness evidence is missing, resume fails closed. The same rule applies to repair-loop iterations such as `execution#2`: installing the operator decision must update the persisted observation, not rerun or reclassify the already observed public execution. When repeated command labels exist in the command journal, the controller resolves cached evidence by matching label plus step instance and iteration; legacy state may fall back only when the transcript matches the persisted step journal entry or the label is not repeated.

Delivery-time harness certification uses the delivery-owned diagnostic label `delivery-harness-certify`. Review-time `harness-certify` evidence must not be replayed as delivery certification evidence, because delivery certification is a fresh public `aor harness certify` precondition before `aor deliver prepare`.

When the step stops for a required skill-agent decision, write the decision JSON from the request's expected response shape and install it before resuming:

```bash
node ./scripts/live-e2e/manual-live-e2e.mjs \
  --project-ref . \
  --profile ./scripts/live-e2e/profiles/full-journey-regress-ky.yaml \
  --run-id <stable-run-id> \
  --operator-decision-file <decision.json>
```

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

The helper accepts only medium, large, or xl profiles. It runs one fresh live E2E, writes `live-e2e-qualification-analysis-*`, and exits as:
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

Record mode applies the same medium-or-larger and pass/fix/block classification gates as a fresh run, reads the observation report from the summary unless `--record-observation-report-file` is supplied, and upserts the qualification-set attempt by `run_id` so a manually resumed run replaces its earlier blocked accounting entry. The recorded summary must match the selected profile's `profile_id`, `target_catalog_id`, `feature_mission_id`, `scenario_family`, `provider_variant_id`, and `feature_size`. Run summaries include `commit_sha` and `branch_name`; record mode requires `commit_sha` to be on the current branch lineage and rejects cross-profile, cross-provider, corrupt, or stale qualification evidence before writing the qualification set.

The launching agent performs the fix and commit. Final qualification requires at least five full positive medium-or-larger runs across provider variants: at least two `openai-primary`, at least two `anthropic-primary`, and at least one `open-code-primary`.

## Layer behavior
Bounded rehearsal layer:
- clones the target checkout;
- materializes run-scoped bootstrap assets and generated project profile on the AOR side under `.aor/`;
- proves one bounded black-box execution path quickly.

Full-journey layer:
- resolves `target_catalog_id`, `feature_mission_id`, `scenario_family`, and `provider_variant_id` from the curated internal catalog;
- uses public `aor project init` with a host-side generated project profile plus repo command overrides derived from the curated catalog;
- preflights the selected provider adapter before execution so missing live runtime metadata, missing commands, auth failures, edit-readiness failures, and permission-mode blocks fail before `run start`;
- records auth probe attempts and retries one transient auth/runtime probe failure before failing the proof;
- splits verification into `readiness`, `baseline_diagnostic`, and `post_run_quality` phases;
- treats full-journey baseline target verification as diagnostic by default: failed target `verification.commands` are preserved as context, but setup failures, missing prerequisites, failed validation, missing or failed routed dry-run, provider readiness failure, and unsafe write-back policy still block before execution;
- resolves mission post-run quality into a mission-blocking primary gate plus optional full diagnostic commands; a failed diagnostic command records findings without hiding a passing primary gate unless the mission declares `diagnostic_failure_mode=fail`;
- has the runner prepare one structured feature request input under AOR run state;
- requires medium, large, and xl catalog missions to provide goals, KPIs, Definition of Done, expected quality evidence, and primary post-run commands before the run can close acceptance;
- materializes provider-pinned route overrides in host-side AOR run state before execution starts;
- writes an execution-readiness decision before `run start` so promotion evidence is based on readiness and routed dry-run proof, not on a failed baseline target check;
- includes the materialized spec step-result as a concrete `packet://spec@evidence://...` promotion ref for adapter context, while `run start` binds the approved handoff ref into the compiled context.
- runs the public observation lifecycle through `intake create`, `project analyze`, `project validate`, baseline `project verify --verification-label baseline-diagnostic --routed-dry-run-step implement`, `discovery run`, `spec build`, `wave create`, `handoff approve`, `project validate --require-approved-handoff`, `run start`, `run status`, primary post-run `project verify --verification-label post-run-primary`, `review run`, `eval run`, optional diagnostic `project verify --verification-label post-run-diagnostic`, and `deliver prepare --quality-gate-mode observe`.
- repeats public `run start` / `review run` iterations with iteration-specific run ids when review or primary verification requests repair, and records each repeated step as `execution#N` and `review#N` in the step journal.
- bounds each target `project verify` command with a per-command timeout from the generated project profile and uses a hard local timeout signal for target commands. Timeout failures are preserved as failed step-result evidence; for full-journey baseline diagnostics they are interpreted through the same diagnostic/blocking gate rules as other target verification failures.
- runs target verification commands with inherited Node compile-cache state disabled so the orchestrator's runtime session cache cannot corrupt target package-manager or test-runner module loading.
- gates continuation after every observed public step by the online live E2E controller decision.
- keeps `release` and `learning` outside `step_journal[]` for `delivery_default` profiles; full-lifecycle profiles, including bounded full-lifecycle profiles, must execute them as ordinary observed steps.

Production-proof profiles add a fail-closed layer on top of full-journey behavior:
- runner auth probe is required;
- edit and permission readiness are required before `run start`;
- target setup and verification commands must be declared;
- baseline target verification must use blocking mode;
- write-back must remain disabled and delivery mode must be `patch-only` or `local-branch`;
- proof-runner bootstrap asset overrides are not supported.

Guided full-journey profiles set `guided_journey.enabled=true`. They still use the full-journey catalog and public CLI subprocesses, but prepend installed-user shortcuts (`doctor`, `onboard`, `app`, `next`), use `mission create` for the product intake packet, require an approved `review decide` before delivery/release, run `release prepare`, close `learning handoff`, and capture an operator-console web smoke artifact. The runner writes `installed-user-guided-journey-proof-<run>.json` and fails the run if the proof is only narrative: required CLI transcripts, packet/report files, web smoke output, and no-upstream-write assertions must be materialized.

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
- inspect `quality_judgement` for target acceptance dimensions that are not already obvious from one step.

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
- `real_code_change_status`
- `runtime_harness_report_file`
- `runtime_harness_decision`
- `run_start_runtime_harness_decision`
- `latest_runtime_harness_decision`
- `quality_gate_decision`
- `review_report_file`
- `live_e2e_observation_report_file`
- `live_e2e_controller_state_file`
- `live_e2e_step_observation_files`
- `live_e2e_observation_overall_status`
- `operator_context`
- `runner_quality_summary`
- `final_skill_agent_verdict_request_file`
- `final_skill_agent_verdict_file`
- `quality_judgement`
- `canonical_status`
- `command_status`
- `target_verification_status`
- `artifact_quality_status`
- `delivery_status`
- `coverage_status`
- `acceptance_status`
- `run_tier`
- `release_status`
- `proof_eligible_tier`
- `required_matrix_acceptance_closed`

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
- `artifacts.guided_journey_proof_file`
- `artifacts.guided_web_smoke_summary_file`
- `artifacts.guided_web_smoke_html_file`
- `artifacts.guided_web_dom_snapshot_file`
- `artifacts.guided_web_accessibility_summary_file`
- `artifacts.guided_web_screenshot_files` (empty until real browser-task screenshots are captured)
- `artifacts.guided_web_visual_guardrail_file` for deterministic app-smoke visual guardrail evidence
- `artifacts.review_decision_file`
- `artifacts.release_packet_file`
- `artifacts.target_head_before` and `artifacts.target_head_after`
- `artifacts.target_git_status_without_runtime`

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

Guided or release profiles use `live_e2e.flow_range_policy=full_lifecycle`:

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

The live E2E skill is the operator. It reads the decision request, inspects public artifacts/UI/API/logs, writes the operator decision artifact with `semantic_analysis.judge_source=skill-agent` and non-empty `inspected_evidence_refs[]`, and answers any requested interaction through public control-plane surfaces such as `aor run answer` or the HTTP answer route. `--agent-judge-file` is removed; live E2E semantic analysis comes only from accepted skill-agent decisions and the final skill-agent verdict artifact.

Every `agent_decision_request_ref` carries a decision rubric with required inspection refs. The skill-agent decision must cite those refs in `inspected_evidence_refs[]`; missing or non-materialized local refs are rejected fail-closed. For UI-capable profiles, the decision must cite the frontend evidence refs for HTML, DOM snapshot, accessibility summary, and real screenshot evidence before continuation can be accepted. Deterministic `aor app --smoke` visual summaries are guardrails only and do not satisfy `browser-task-proof` screenshot requirements.

Judge criteria:
- traceability to feature request, mission, and previous step;
- completeness for the step;
- actionability for the next step;
- consistency with neighboring artifacts;
- absence of synthetic or no-op explanations that hide failure.

If a profile does not provide an accepted skill-agent operator decision, the runner stops fail-closed and writes the decision request for manual/evaluator continuation.

For guided installed-user runs, deterministic web smoke is only a render guardrail. Final acceptance requires `frontend_interactions[]` with HTML, DOM, accessibility, screenshot/visual evidence, and an accepted skill-agent UI/UX verdict linked from `agent_verdict_ref`.

## Quality Judgement
Full-journey summaries may include `quality_judgement` with target acceptance dimensions:
- `scenario_family`
- `provider_variant_id`
- `feature_size`
- `target_selection`
- `feature_request_quality`
- `target_baseline_status`
- `discovery_quality`
- `provider_execution_status`
- `real_code_change_status`
- `post_run_verification_status`
- `post_run_diagnostic_status`
- `runtime_success`
- `runner_quality_summary`
- `runtime_harness_decision`
- `run_start_runtime_harness_decision`
- `latest_runtime_harness_decision`
- `artifact_quality`
- `code_quality`
- `feature_size_fit_status`
- `scenario_coverage_status`
- `delivery_release_quality`
- `learning_loop_closure`
- `quality_gate_decision`
- `overall_status`

## Canonical Status
The run summary's canonical status block is the status source for operators.

Canonical fields:
- `command_status`: public subprocesses completed and emitted parseable payloads.
- `target_verification_status`: post-run primary verify summary result.
- `artifact_quality_status`: intake strictness, review artifact quality, and lineage consistency.
- `delivery_status`: `materialized`, `degraded`, `blocked`, or `not_materialized`.
- `coverage_status`: `covered_pass`, `covered_with_findings`, `attempted_failed`, or `not_attempted`.
- `acceptance_status`: `pass`, `warn`, or `fail`.
- `release_status`: `pass`, `fail`, `skipped`, or `not_attempted`.
- `proof_eligible_tier`: true only for `acceptance` and `production-proof`.
- `required_matrix_acceptance_closed`: true only when the run actually closes required matrix acceptance.

The target scorecard mirrors these canonical fields in addition to linking back
to the summary.

`command_status` is about technical command evidence, not final quality. If the
runner intentionally accepts a non-zero command because it emitted a readable
payload, the command diagnostic keeps the non-zero exit code while canonical
quality is reported through the relevant delivery, release, verification, or
artifact status.

Required matrix coverage closes only when `coverage_status=covered_pass` on
`run_tier=acceptance` or `run_tier=production-proof`. A delivery-reaching run
with warnings is `covered_with_findings`; it is useful evidence but does not
close required acceptance.

## Operator checks
- Summary and scorecard files exist under `.aor/projects/<project_id>/reports/`.
- `target_checkout_root` exists and is a cloned checkout, not the control-plane repository root.
- Full-journey runs resolve repo and mission from the curated catalog; they must not rely on raw `repo_url` plus free-form objective text.
- Full-journey runs resolve one explicit matrix cell and preserve `matrix_cell` plus `coverage_follow_up` in summary, review, audit, and learning artifacts.
- Full-journey runs use public `project init` with a host-side generated project profile and host-side bootstrap assets under the AOR `.aor/` run state. Target checkouts must not receive proof-runner `examples/`, `context/`, root `project.aor.yaml`, generated route files, or `.aor-live-e2e` scaffolding before agent execution.
- `routed_step_result_file` exists and references a routed step with `mode=execute`.
- `review_report_file` exists and is contract-valid.
- `review-report.provider_traceability` matches the requested provider variant and adapter path.
- `review-report.feature_size_fit` stays inside the declared size budget for the mission.
- `review-report.artifact_quality.verify_summary_ref` points at the post-run `project verify` summary.
- `post_run_verify_status`, `provider_execution_status`, `real_code_change_status`, and `runner_quality_summary` are observed post-delivery dimensions. Runtime Harness can block final quality for missing execution evidence, adapter crashes, unresolved interaction, or blocked runtime state, but it does not fail implementation quality by path whitelist/blacklist rules.
- `delivery_manifest_file` exists and is anchored to the target checkout.
- Proof runner execution stays CLI-only and remains valid with web UI detached.
- Guided proof execution starts from `aor doctor`, `aor onboard`, `aor app`, and `aor next`; the target repository HEAD must remain unchanged and no remote write commands may be recorded unless an explicit future profile opts into network write-back.

## W21-S07 guided proof bundle (2026-05-06)
Canonical profile:
- `scripts/live-e2e/profiles/installed-user-guided-journey.yaml`

Canonical fixtures:
- `examples/live-e2e/fixtures/w21-s07/installed-user-guided-proof.sample.json`
- `examples/live-e2e/fixtures/w21-s07/installed-user-guided-web-smoke.sample.json`
- `examples/live-e2e/fixtures/w21-s07/installed-user-guided-blocked-readiness.sample.json`

Run command:
```bash
node ./scripts/live-e2e/run-profile.mjs \
  --project-ref . \
  --profile ./scripts/live-e2e/profiles/installed-user-guided-journey.yaml
```

Pass evidence requires all of the following:
- CLI transcript files for doctor, onboard, app, next, mission create, run execution, review decision, delivery, release, and learning closure.
- Durable onboarding, intake, next-action, run, review, review-decision, delivery, release, learning, and web smoke artifacts.
- Public-repo safety assertions: `write_back_to_remote=false`, `patch-only` delivery mode, unchanged target `HEAD` until controlled execution, runtime state under `.aor/`, and no `.aor-live-e2e` state.
- Blocked and partial-readiness branches must keep the same no-write defaults visible and must not be marked pass without durable artifacts.

## Removed W14-S07 matrix fixture bundle (2026-04-24)
The old W14-S07 matrix fixture bundle was removed after live E2E moved to skill-agent-only proof. It was historical `coverage_with_findings` evidence backed by deterministic external-runner mock behavior, so it is no longer valid acceptance closure. Current matrix claims need a fresh acceptance or production-proof run with accepted skill-agent decisions.

## W25-S03 production proof fixture (2026-05-08)
Canonical fixture:
- `examples/live-e2e/fixtures/w25-s03/w25-s03-production-proof.json`

Evidence note:
- the fixture is derived from a real `full-journey-production-proof-ky-openai.yaml` run, not from a bootstrap asset override or a deterministic mock runner.
- it covers the required `ky.regress.small.openai` cell with `quality_judgement.overall_status=pass`, `real_code_change_proof_complete=true`, and `external_runner_mode=real-external-process`.
- it records meaningful implementation changed paths under `source/utils/merge.ts` and `test/headers.ts`, plus pass summaries for post-run verification, Runtime Harness, review, delivery, and learning-loop closure.
- it records `delivery_mode=patch-only`, `write_back_to_remote=false`, unchanged target `HEAD`, empty `commit_refs`, and `writeback_results=[patch-materialized]`.
- it is sanitized for commit: no runtime output tree, target checkout, local absolute path, raw transcript, or secret material is included.
