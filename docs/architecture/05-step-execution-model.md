# Step execution model

## Purpose
AOR needs one execution model for both execution and non-execution steps.

## Supported step classes
- `artifact` — discovery, research, ADR, spec, review summaries
- `planner` — wave and handoff planning
- `runner` — bounded execution through a coding runner
- `repair` — narrower fix-up loops after failures
- `eval` — suite execution and scoring
- `harness` — replay, certification, compare-to-baseline, failure-mode runs

## Step resolution stack
For each step AOR resolves:
1. project profile
2. route profile
3. wrapper profile
4. prompt bundle
5. skill profiles
6. step policy
7. adapter/provider/model execution

## Standard step phases
1. load context and required packets
2. resolve route, wrappers, prompt bundle, and policy
3. compile working context from prompt instructions, wrapper bootstrap, resolved required inputs, guardrails, and skill workflows
4. pre-validate prerequisites
5. execute the step
6. normalize output into a step result
7. run post-validation
8. optionally run eval or harness
9. retry, repair, escalate, or close

## Adapter SDK baseline (W2-S04 + W9-S08)
Adapter invocation uses one stable envelope pair:
- request envelope: `request_id`, `run_id`, `step_id`, `step_class`, resolved route/asset/policy bundles, input packet refs, compiled context, and dry-run flag;
- response envelope: `request_id`, `adapter_id`, `status`, summary, normalized output payload, evidence refs, and tool traces.

Shared lifecycle hooks are explicit and adapter-agnostic:
`before_step`, `invoke_adapter`, `after_step`, `on_retry`, `on_repair`, `on_escalation`.

Execution baselines:
- deterministic dry-run adapter path (`mock-runner`) for rehearsal-safe execution;
- first live provider baseline (`codex-cli`) for routed live execution foundation in `W9-S08`.

## Routed execution engine baseline (W2-S05 + W9-S08)
The routed execution baseline follows one deterministic sequence:
1. resolve route;
2. resolve wrapper + prompt bundle + context bundles;
3. resolve policy bounds and governance;
4. materialize delivery guardrails (`delivery-plan`) for writeback policy truth;
5. compile context and persist one `compiled-context` artifact;
6. negotiate adapter capabilities;
7. execute:
  - dry-run path: deterministic mock adapter;
  - live path: supported live adapter only when delivery guardrails are ready, otherwise explicit blocked adapter response.

The engine always writes a normalized `step-result` artifact, including failure and blocked outcomes, with:
- selected route/asset/policy/adapter metadata;
- compiled-context diagnostics and refs;
- adapter request/response lineage;
- deterministic blocked-next-step guidance.

Routed `step-result` and `compiled-context` outputs use run/step/attempt-scoped identities so repeated same-step executions preserve prior evidence.

## Why one model matters
A single step model keeps:
- quality logic reusable;
- replay possible;
- routing consistent;
- audits easier to read;
- platform-asset changes comparable across flows.
