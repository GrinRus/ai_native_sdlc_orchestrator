# Eval and harness architecture

## Quality layers

### Validation
Objective checks such as schema validity, repo-scope enforcement, required evidence, build, lint, and tests.

### Eval
Task-specific scoring based on datasets, suites, and graders.

### Harness
Replay, certification, compare-to-baseline, and failure-mode workflows.

### Promotion
Decision layer that moves an asset or route from candidate to stable or frozen.

## Datasets and suites
A dataset stores cases for a specific subject type. A suite defines how those cases are graded and how pass/fail is decided.

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
