# Eval and harness architecture

## Quality layers

### Validation
Objective checks such as schema validity, repo-scope enforcement, required evidence, build, lint, and tests.

Deterministic validation is a hard gate before eval or harness:
- validate reference existence and family type across project, route, wrapper, prompt, policy, adapter, dataset, suite, and live-E2E assets;
- validate compatibility edges (for example route class vs wrapper step class, suite subject type vs dataset subject type, adapter capability requirements);
- fail fast with machine-readable `validation-report` output that CI and runtime flows can consume directly.

### Eval
Task-specific scoring based on datasets, suites, and graders.

Eval begins only after deterministic validation is `pass`. Eval answers "how good is the candidate" rather than "is the graph structurally valid".

### Harness
Replay, certification, compare-to-baseline, and failure-mode workflows.

Harness consumes validated assets and eval outputs to produce replay/certification evidence. Harness logic must not replace structural validation rules.

### Promotion
Decision layer that moves an asset or route from candidate to stable or frozen.

## Datasets and suites
A dataset stores cases for a specific subject type. A suite defines how those cases are graded and how pass/fail is decided.

Datasets and suites are loaded through one deterministic registry path (`examples/eval/**` via shared loader), not ad hoc file reads. Registry resolution must provide:
- suite refs (`suite_id@vN`);
- dataset refs (`dataset://dataset_id@version`);
- subject-type compatibility verdicts before eval/harness execution.

AOR needs suites for:
- run regression,
- release readiness,
- wrapper certification,
- adapter certification,
- incident backfill,
- live E2E rehearshal.

## Harness workflows
- packet replay
- execution replay
- transcript replay
- candidate-vs-baseline comparison
- recovery injection
- route/wrapper/adapter certification

## Key rule
Harness is not an external add-on. It is part of the same orchestration model and should reuse the same routes, wrappers, policies, and evidence model.

Deterministic validation, judge-based eval, and harness replay are separate layers with explicit hand-off:
1. validation checks shape, refs, and compatibility;
2. eval scores behavior on datasets/suites;
3. harness replays and compares evidence for certification and promotion decisions.
