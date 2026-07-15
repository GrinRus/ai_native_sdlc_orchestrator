# Platform assets and runtime context lifecycle

## Asset types
AOR manages these platform assets:
- prompt bundles
- context docs
- context rules
- context skills
- context bundles
- wrappers
- skills
- route profiles
- step policies
- adapter capability profiles
- compiler revisions
- datasets and suites

## Why prompt bundles and context assets are first-class
Prompt guidance should not be buried inside wrappers, and runtime context should not be scattered across repository-local notes. Prompt bundles and context assets are the durable building blocks for one routed step.

Ownership is singular:
- routes select provider, adapter, model, and route constraints;
- wrappers define execution envelopes only;
- project profiles own default wrapper, prompt, and context selection;
- context bundles expand into docs, rules, and skills later at compile time.

## Separation of concerns
- **Prompt bundle** — task guidance and output expectations
- **Context doc** — pull-on-demand reference material for a library, repo area, or workflow domain
- **Context rule** — always-on team, security, or operating constraints
- **Context skill** — relevance-triggered workflow instructions for a step class
- **Context bundle** — reusable selection of context docs, rules, and skills for one runtime use case
- **Wrapper** — execution envelope, allowed tools, included files, verification section, redaction
- **Skill profile** — reusable step-class workflow with explicit activation and output intent
- **Route** — adapter/provider/model selection plus constraints
- **Step policy** — validators, retries, repair, escalation, blocking rules
- **Adapter profile** — what a runner can actually do
- **Compiled context artifact** — the resolved prompt/context payload, packet refs, and provenance for one step

## Lifecycle
1. draft
2. candidate
3. certification
4. stable promotion
5. freeze or demotion if incidents or regressions appear

## Rules
- do not merge prompt guidance, runtime context, and execution envelope into one opaque file;
- `AGENTS.md` and `.agents/**` are repository-development guidance, not runtime assets;
- committed registry roots contain source assets and static samples only; runtime-emitted compiled artifacts still belong under `.aor/`;
- certify prompt-bundle, context, and compiler changes independently when possible;
- keep baseline references explicit;
- preserve incident and promotion history for every platform asset.

## Runtime loading order (W2-S02)
Asset resolution for a step is deterministic and follows this order:
1. resolve route profile for the workflow step;
2. choose wrapper profile (`step override` first, then `project default` by route class);
3. choose prompt bundle (`step override` first, then `project default` by workflow step);
4. choose context bundles (`step override` first, then `project default` by workflow step) and expand docs/rules/skills;
5. reject missing, wrong-family, or conflicting canonical asset identities before execution;
6. normalize selected UTF-8 content, compute content digests, and emit one ordered
   effective asset set with route, wrapper, prompt, policy, bundle, document,
   rule, and skill provenance;
7. derive the compiled fingerprint from asset content, order, provenance, and
   compiler revision, then deliver the same bounded content in the provider work
   packet.

Byte-identical identities may be deduplicated only across explicitly ordered
registry roots. Their full source provenance remains in the compiled artifact;
same-ID content conflicts fail closed instead of using filesystem order.

If any source is missing or conflicts with the step class, resolution fails before execution.

## Artifact workflow prompt granularity

Discovery, research, and spec are workflow steps that share the `artifact`
execution class. This lets AOR give each step task-specific prompt guidance
while preserving the same artifact wrapper, policy, route class, context
foundation, and public-repo safety rules.

The compatibility invariants are:
- route profiles may differ by workflow step, but their `route_class` remains
  `artifact`;
- prompt bundles for discovery, research, and spec must keep
  `step_class: artifact`;
- `artifact-default@v1` remains a valid fallback for profiles that have not
  opted into step-specific prompt bundles;
- context, skill, and policy overlays are added only when evidence from the
  prompt split or readiness model proves a material workflow difference;
- compiled-context artifacts must expose the selected prompt bundle ref,
  context bundle refs, required packet refs, stale or blocked diagnostics, and
  provenance so operators can inspect the choice without raw adapter output.

W44 keeps `artifact-default@v1` as the legacy fallback while materializing
step-specific artifact prompt bundles for profiles that opt into the split:
`discovery-default@v1`, `research-default@v1`, and `spec-default@v1`.

## W44 artifact overlay disposition

W44-S04 does not add discovery-, research-, or spec-specific context bundles,
skill profiles, or step policies. The W44-S02 prompt split already carries the
material workflow guidance, and W44-S03 readiness diagnostics carry the
research ADR-ready and spec handoff-ready gates without introducing a new
execution policy.

The selected disposition is:

| Workflow step | Prompt bundle | Context bundle | Skill profile | Step policy | Decision |
|---|---|---|---|---|---|
| `discovery` | `prompt-bundle://discovery-default@v1` | `context-bundle://context.bundle.artifact.foundation@v1` | `skill.artifact.default@v1` | `policy.step.artifact.default` | prompt-only split |
| `research` | `prompt-bundle://research-default@v1` | `context-bundle://context.bundle.artifact.foundation@v1` | `skill.artifact.default@v1` | `policy.step.artifact.default` | prompt + readiness diagnostics |
| `spec` | `prompt-bundle://spec-default@v1` | `context-bundle://context.bundle.artifact.foundation@v1` | `skill.artifact.default@v1` | `policy.step.artifact.default` | prompt + handoff readiness diagnostics |

Compiled-context artifacts must persist the selected prompt bundle,
`context_*_refs`, and `skill_refs` so operators can prove the shared artifact
foundation was selected deliberately. A future overlay split is allowed only as
a separate slice with evidence that the shared foundation cannot express a
workflow rule, and any policy split must define explicit gate, retry, repair,
and blocked-reason behavior.

## W44 maintainer validation evidence

Maintainer validation for the artifact workflow uses public artifacts
rather than private rehearsal vocabulary. A full-journey rehearsal records
`aor next` snapshots after mission, discovery, spec, and planning; the run
summary then exposes `artifact_readiness_proof` with:

- the next-action report refs and stage readiness statuses;
- discovery, research, spec, and planning prompt-bundle lineage from the
  generated project profile and project-analysis report;
- spec compiled-context provenance, including required input refs, context
  bundle refs, skill refs, and compiler revision refs;
- discovery research status and planning handoff refs.

This proof is a compact acceptance index. Operators should still treat the
linked next-action report, discovery research report, spec step-result, and
handoff packet as the durable source artifacts.

## Policy loading order and guardrails (W2-S03)
Policy resolution is deterministic and runs before any adapter invocation:
1. resolve route for the step (`project default` or `step override`);
2. resolve step policy id (`step override` first, then `project default` by route class);
3. merge bounds in one path:
   - budget and timeout: `route constraints` then `project budget defaults`;
   - command constraints: `policy command constraints`, otherwise `route constraints`, otherwise `project repo command allowlist`;
   - write-back mode: `policy override`, then `route constraints`, then `project writeback defaults`;
4. normalize write-back mode into delivery-plan modes (`no-write`, `patch-only`, `local-branch`, `fork-first-pr`);
5. persist guardrails (`approval_required`, allowlist enforcement, redaction, blocking rules) into step planning metadata.
6. persist a delivery-plan artifact before write-back, and block non-`no-write` modes without approved handoff and promotion evidence.

Any missing or conflicting required policy source must fail deterministically before runner execution starts.

## Context as runtime asset
Prompt bundles, context docs, context rules, context skills, wrappers, routes, policies, adapters, and compiler revisions are runtime assets. They must be versioned, compiled into a `compiled-context` artifact during the Runtime Harness prepare phase, traced through adapter execution, and evaluated through validation, eval, and certification evidence like other software artifacts.

Runtime Harness reports may identify impacted asset refs and recommend recertification. Promotion or freeze remains owned by Asset Certification Capability and `promotion-decision`, not by learning handoff or run diagnosis.

Compiler revisions are tracked through `compiler-revision-status`: one report records revision identity, lifecycle state, compatibility, decision history, compiled-context refs, evaluation refs, incident refs, and certification evidence. The CLI/API read path is `aor compiler revision` and `GET /api/projects/:projectId/compiler-revisions`.

## Operator intervention context

Operator requests do not introduce a separate prompt system. `aor request run`
and the web Ask AOR drawer use the normal route, wrapper, prompt bundle,
policy, adapter, and context compiler path for the selected target step. The
only additive context asset is `context-bundle://context.bundle.operator-intervention@v1`,
which expands the always-on `context-rule://context.rule.operator-intervention@v1`.

That rule tells the runtime to treat `packet://operator-request@...` as
durable bounded operator intent, validate target refs and delivery mode, and
produce proposal/patch evidence without silent source mutation for v1
document-edit flows.

Quality repair requests follow the same compiler path. A repair implementation
step cites `packet://quality-repair-request@...` in compiled context packet
refs, and the repair prompt receives source finding refs, required evidence
refs, and attempt budget as AOR-owned context. The compiler must keep this
provider-agnostic; adapter-specific repair behavior belongs to adapter
capabilities and evidence, not to the public request contract.
