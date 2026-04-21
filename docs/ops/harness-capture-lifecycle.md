# Harness capture lifecycle

## Purpose
Define how harness capture and replay artifacts are produced, stored, replayed, and pruned.

## Artifact locations
All harness artifacts are written under:

`<runtime_root>/projects/<project_id>/reports/`

Files:
- `harness-capture-*.json` — captured step evidence plus scoring snapshot baseline.
- `harness-replay-*.json` — replay verdict, compatibility check result, and comparable/non-comparable outcome.
- `evaluation-report-*.json` — replay scoring output referenced by capture/replay artifacts.
- `step-result-*.json` — routed dry-run evidence referenced by captures.

## Capture flow
Use `captureHarnessReplayArtifact(...)` to produce one reusable capture artifact from:
1. routed dry-run step execution (`step-result`);
2. offline eval scoring (`evaluation-report`);
3. compatibility snapshot (`step_class`, route, wrapper, prompt, policy, adapter IDs).

The capture is reusable only when compatibility metadata still matches current runtime asset selection.

## Replay flow
Use `replayHarnessCapture(...)` to:
1. load a previously captured artifact;
2. compare compatibility metadata against current runtime route/wrapper/prompt/policy/adapter resolution;
3. reject replay explicitly with `status: incompatible` when drift is detected;
4. rerun eval scoring only when compatibility passes.

## Minimum evidence bar for promotion decisions
A promotion decision can move an asset from `candidate` to `stable` only when all required evidence exists:
- one evaluation report for the certification suite (`evaluation-report-*.json`);
- one harness capture (`harness-capture-*.json`);
- one harness replay verdict (`harness-replay-*.json`).

Decision semantics:
- `pass`: evaluation is `pass` and harness replay is `pass`;
- `hold`: evaluation is `pass` but harness replay is missing/incompatible;
- `fail`: evaluation is `fail` or harness replay is `fail`.

## Pruning and retention rules
- Keep at least one latest successful capture/replay pair per critical suite (`release`, `regress`, `cert`).
- Remove stale captures after asset/version migration once replacements are recorded.
- Never delete capture and replay files referenced by incident reports, certification decisions, or release packets.
- Pruning is currently an explicit operator action (manual file cleanup in reports root).
