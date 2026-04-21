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
1. resolve route profile for the step class;
2. choose wrapper profile (`step override` first, then `project default` by route class);
3. choose prompt bundle (`step override` first, then wrapper `prompt_bundle_ref`);
4. emit one asset bundle with route, wrapper, prompt bundle, and provenance refs.

If any source is missing or conflicts with the step class, resolution fails before execution.

## Policy loading order and guardrails (W2-S03)
Policy resolution is deterministic and runs before any adapter invocation:
1. resolve route for the step (`project default` or `step override`);
2. resolve step policy id (`step override` first, then `project default` by route class);
3. merge bounds in one path:
   - budget and timeout: `route constraints` then `project budget defaults`;
   - command constraints: `policy command constraints`, otherwise `route constraints`, otherwise `project repo command allowlist`;
   - write-back mode: `policy override`, then `route constraints`, then `project writeback defaults`;
4. persist guardrails (`approval_required`, allowlist enforcement, redaction, blocking rules) into step planning metadata.

Any missing or conflicting required policy source must fail deterministically before runner execution starts.
