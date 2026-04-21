# Platform assets and prompt lifecycle

## Asset types
AOR manages these platform assets:
- prompt bundles
- wrappers
- route profiles
- step policies
- adapter capability profiles
- datasets and suites

## Why prompt bundles are first-class
Prompt guidance should not be buried inside wrappers or scattered across docs. A prompt bundle is the durable instruction asset for a step class.

## Separation of concerns
- **Prompt bundle** — task guidance and output expectations
- **Wrapper** — execution envelope, allowed tools, included files, verification section, redaction
- **Route** — adapter/provider/model selection plus constraints
- **Step policy** — validators, retries, repair, escalation, blocking rules
- **Adapter profile** — what a runner can actually do

## Lifecycle
1. draft
2. candidate
3. certification
4. stable promotion
5. freeze or demotion if incidents or regressions appear

## Rules
- do not merge prompt guidance and execution envelope into one opaque file;
- certify prompt-bundle changes independently when possible;
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
