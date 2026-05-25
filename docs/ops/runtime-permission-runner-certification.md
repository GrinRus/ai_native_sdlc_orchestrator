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

## Qwen Restricted Investigation
Follow-up smoke on 2026-05-25 narrowed the pending Qwen path:

| Case | Result | Interpretation |
| --- | --- | --- |
| `json` + `default` + positional write prompt | `exit=0`, marker missing | Qwen completed but `default` mode exposed `read_file` without `write_file`; no structured `permission_denials[]`. |
| `stream-json` + `default` + positional write prompt | `exit=0`, marker missing | Same permission shape as JSON, with stream events instead of one JSON array. |
| `json` + `default` + stdin AOR request JSON | timeout, marker missing | Current adapter transport shape can hang before usable denial evidence. |
| `stream-json` + `default` + stdin AOR request JSON | timeout, marker missing | Stream output confirms restricted tool set, but the process does not finish cleanly. |
| `json`/`stream-json` + `default` + argv AOR request JSON | timeout, marker missing | Passing the raw AOR envelope as a positional prompt does not avoid the restricted-mode hang. |
| `json` + `auto-edit` + positional write prompt | `pass`, marker written | `auto-edit` restores write capability and is not a restricted/manual approval proof. |
| `json` + `yolo` + stdin or argv AOR request JSON | `pass`, marker written | Full-bypass mapping remains usable. |
| `--bare --auth-type ...` | auth/config failure before permission flow | Bare mode is not a certification workaround in the current host auth setup. |

## Interpretation
- Claude Code and OpenCode confirm the v1 control-plane path: full-bypass stays non-interactive, while restricted mode can return permission evidence that AOR can surface as an interaction.
- Qwen confirms YOLO/full-bypass mapping, but restricted/default mode does not yet expose a reliable non-interactive permission request for AOR JSON-envelope execution. Keep restricted Qwen behavior pending instead of promoting the adapter.
- OpenCode remains extended candidate coverage until a committed full-journey real-runner proof promotes it.
- Qwen remains a candidate adapter until restricted-mode behavior and full live-run evidence are complete.
