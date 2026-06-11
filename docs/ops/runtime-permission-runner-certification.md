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
| Qwen Code | `full-bypass` | `qwen --bare --auth-type anthropic --output-format stream-json --include-partial-messages --approval-mode yolo --exclude-tools skill --max-wall-time <resolved-timeout-minus-reserve>s` with `ANTHROPIC_API_KEY` supplied directly or through `env_from: ANTHROPIC_AUTH_TOKEN` | `pass` | Auth, edit readiness, permission readiness, and stream progress readiness passed in local smoke; full-journey candidate proof still must close target changes without runner-owned `.qwen` state leaks. |
| Qwen Code | `restricted` | `qwen --bare --auth-type anthropic --output-format stream-json --include-partial-messages --approval-mode default --exclude-tools skill --max-wall-time <resolved-timeout-minus-reserve>s` with the same auth env bridge | `pending` | Edit-readiness probe can time out or complete without write evidence; keep candidate status. |

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
| missing `--auth-type` or missing Qwen API-key alias | auth/config failure before permission flow | Preflight must fail before full live execution when the host has only `ANTHROPIC_AUTH_TOKEN` and no `ANTHROPIC_API_KEY`. |

## OpenCode Full-Journey Attempt
Follow-up acceptance proof on 2026-05-25 exercised the real OpenCode runner beyond permission preflight:

| Field | Value |
| --- | --- |
| Profile | `scripts/live-e2e/profiles/full-journey-regress-ky-medium-open-code.yaml` |
| Run ID | `opencode-full-journey-ky-medium-20260525` |
| Provider variant | `open-code-primary` |
| Runner version | `opencode 1.14.30` |
| Runtime permission mode | `full-bypass` |
| Interaction policy | `fail-closed` |
| Controller result | `blocked` |
| Canonical coverage | `attempted_failed` |
| Acceptance status | `fail` |

Evidence summary:

- The manual controller completed `discovery`, `spec`, `planning`, `handoff`, and reached `execution`.
- `execution` used route `route.implement.default.open-code-primary`, adapter/provider `open-code`, and the external command `opencode run --format json --dangerously-skip-permissions ... --file <adapter request>`.
- Request transport was `file-attachment`, matching the OpenCode adapter contract.
- Runtime Harness blocked the run with `failure_class=provider-timeout`, `repair_status=exhausted`, and `runtime_harness_decision=block`.
- The final OpenCode attempt used the previous `timeout_ms=600000` adapter bound, ended with `timed_out=true`, `signal=SIGKILL`, and `exit_code=null`, and established that the former 10 minute hard cap was too short for this proof lane.
- Two repair retries were attempted; both hit `provider-timeout` at about 601 seconds, exhausting the policy budget.
- After this attempt, real external provider adapter profiles were aligned to `timeout_ms=3600000` while keeping `preflight_timeout_ms=120000`, so future full-journey attempts can use the intended 60 minute full-runner bound.
- `runtime_permission_summary.total=0`; the full-bypass proof did not produce runtime permission interactions.
- The profile safety policy remained `no-upstream-write`; the target-cleanliness check before execution passed.
- Strict code-changing inspection reported `strict_code_changing_noop_detection_applied=true` and `strict_code_changing_noop=true` with no meaningful changed paths, so the operator decision blocked continuation to `review`.

This is committed blocked/pending evidence, not promotion evidence. Keep `open-code-primary` as extended candidate coverage until a passing full-journey proof completes with meaningful target changes and closed acceptance status.

## Interpretation
- Claude Code and OpenCode confirm the v1 control-plane path: full-bypass stays non-interactive, while restricted mode can return permission evidence that AOR can surface as an interaction.
- Qwen confirms YOLO/full-bypass mapping, but restricted/default mode does not yet expose a reliable non-interactive permission request for AOR JSON-envelope execution. Keep restricted Qwen behavior pending instead of promoting the adapter.
- OpenCode remains extended candidate coverage until a passing committed full-journey real-runner proof promotes it.
- Qwen remains a candidate adapter until restricted-mode behavior and full live-run evidence are complete.
