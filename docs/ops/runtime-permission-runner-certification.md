# Runbook: runtime permission runner certification

## Purpose
Validate the real external runner behavior behind AOR runtime permission mediation without expanding the runtime permission contracts.

This lane is for post-merge certification after the runtime permission mediation baseline is already green. It checks that adapter profiles still map product modes to real runner flags, that full-bypass remains non-interactive, and that restricted-mode permission blocks surface as control-plane-ready evidence.

## Scope
- Use the existing `examples/adapters/*.yaml` profiles.
- Do not change schemas, CLI/API flags, continuation strategies, or policy rule shapes.
- Keep `session-resume`, `tool-call-scoped`, and operator-configurable policy files out of this lane.
- Store runner output under a temporary runtime root or `.aor/`; do not commit runtime state.

## Smoke Procedure
1. Confirm installed runner versions:
   - `claude --version`
   - `opencode --version`
   - `qwen --version`
2. Run `runLiveAdapterPreflight` from `scripts/live-e2e/lib/preflight.mjs` against a temporary target checkout and `examples/adapters`.
3. For each runner, test:
   - `runtime_agent_permission_mode=full-bypass` with `runtime_agent_interaction_policy=fail-closed`;
   - `runtime_agent_permission_mode=restricted` with `runtime_agent_interaction_policy=orchestrator-mediated` and `runtime_agent_auto_approval_profile=conservative`.
4. Record the preflight status, failure kind, edit-readiness status, permission-readiness status, marker status, and runner version.
5. Promote adapter/provider status only after the evidence includes the appropriate committed full-journey proof, not from this preflight smoke alone.

## Latest Local Smoke
Date: 2026-05-25.

Runner versions:

| Runner | Version |
| --- | --- |
| Claude Code | `2.1.85` |
| OpenCode | `1.14.30` |
| Qwen Code | `0.15.2` |

Results:

| Runner | Mode | Expected mapping | Result | Evidence summary |
| --- | --- | --- | --- | --- |
| Claude Code | `full-bypass` | `--dangerously-skip-permissions` | `pass` | Auth, edit readiness, and permission readiness passed; marker written. |
| Claude Code | `restricted` | `--permission-mode auto` | `interaction_required` | Permission readiness failed with `permission-mode-blocked`; marker missing. |
| OpenCode | `full-bypass` | `opencode run --format json --dangerously-skip-permissions` | `pass` | Auth, edit readiness, and permission readiness passed; marker written. |
| OpenCode | `restricted` | `opencode run --format json` | `interaction_required` | Permission readiness failed with `permission-mode-blocked`; marker missing. |
| Qwen Code | `full-bypass` | `qwen --output-format json --approval-mode yolo` | `pass` | Auth, edit readiness, and permission readiness passed; marker written. |
| Qwen Code | `restricted` | `qwen --output-format json --approval-mode default` | `pending` | Edit-readiness probe timed out with no structured denial output; keep candidate status. |

## Interpretation
- Claude Code and OpenCode confirm the v1 control-plane path: full-bypass stays non-interactive, while restricted mode can return permission evidence that AOR can surface as an interaction.
- Qwen confirms YOLO/full-bypass mapping, but restricted/default mode still needs more runner-specific investigation before it can be treated as certified.
- OpenCode remains extended candidate coverage until a committed full-journey real-runner proof promotes it.
- Qwen remains a candidate adapter until restricted-mode behavior and full live-run evidence are complete.
