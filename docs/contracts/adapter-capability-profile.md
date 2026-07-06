# Adapter capability profile

## Purpose
Capability matrix for a runner adapter such as repo write support, shell access, live logs, structured output, approvals, and sandbox mode.

## Required fields
- `adapter_id`
- `version`
- `capabilities`
- `constraints`

## Notes
Routing should depend on declared capabilities rather than assumptions.
Capability negotiation must happen before adapter invocation; missing required capabilities are deterministic pre-execution failures.
`mock-runner` is the deterministic dry-run baseline profile for rehearsals and tests.
External-process adapter baselines can add optional execution metadata without changing required fields. `execution` remains optional for dry-run, candidate, and interactive-only adapters. When a required provider route points at an external-process adapter, that adapter must be runnable and declare:
- `execution.live_baseline: true`
- `execution.runtime_mode: external-process`
- `execution.handler`
- `execution.evidence_namespace`
- `execution.external_runtime.command`
- `execution.external_runtime.permission_policy.default_mode`
- `execution.external_runtime.permission_policy.modes.<mode>.args`
- `execution.external_runtime.request_transport: request-artifact`
- `execution.external_runtime.timeout_ms`

`execution.external_runtime.env` is optional and should only carry safe, non-secret runner overrides. Installed-user rehearsals should inherit host CLI authentication by default instead of encoding auth paths or secrets in adapter profiles.

`execution.external_runtime.env_from` is optional and maps target environment variable names to source host environment variable names. AOR applies each mapping only when the target variable is unset and the source variable exists, records only the variable names in evidence, and never records the secret value. Use this for runner-specific host auth aliases, for example `ANTHROPIC_API_KEY: ANTHROPIC_AUTH_TOKEN` when a local Qwen Code host setup stores the reusable credential under the Codex/Anthropic token name but Qwen requires the API-key variable name.

`execution.external_runtime.execution_root_mode` is optional and defaults to direct execution from the canonical target checkout. Adapters whose native CLI derives local state paths from `cwd` may set `execution_root_mode: short-symlink`; AOR then invokes the external process from a run-scoped short symlink while preserving the canonical checkout in evidence as `canonical_execution_root`. This is intended for runner path-length limits only and must not change target checkout ownership, delivery guardrails, or no-upstream-write semantics.

`execution.external_runtime.request_transport` declares how AOR passes work to the external runner. Supported values are:
- `request-artifact`: persist the full internal adapter request envelope as AOR evidence, build a bounded provider work packet, and pass only a short pointer prompt plus a runner-specific file argument to the CLI. This is the canonical transport for live external-process adapters.
- `stdin-json`: write the JSON request envelope to stdin. This is allowed only for deterministic small/test shims or explicitly scoped small-only diagnostics.
- `file-attachment`: legacy spelling for request-file based adapters. New live adapters should use `request-artifact`.
- `argv-json`: append the serialized JSON request envelope as one argv argument. This is for small local shims only.
- `none`: invoke the runner without passing the request envelope.

`request_via_stdin` is retained for existing profiles as a compatibility shorthand. New external-process adapters should use `request_transport`. Baseline adapters must not rely on unrestricted `stdin-json`; if a profile uses `stdin-json`, it must declare `stdin_json_scope: test-only` or `stdin_json_scope: small-only` so the limitation is visible to routing and runtime preflight.

For `request-artifact`, `execution.external_runtime.request_file` declares only the mechanical CLI binding:
- `argument`: optional runner-specific flag that accepts a local file path, such as `--file`.
- `message`: optional short launcher prompt. It must instruct the runtime agent to execute the approved implementation, read the provider work packet, open required `resolved_local_refs[].local_path` files, make direct edits in the ephemeral target checkout when required, avoid upstream writes, run requested verification when feasible, and only then return the final report; it must not embed the full AOR request envelope.
- `mode`: optional binding label such as `native-file-argument` or `pointer-prompt`.

`request-artifact` has provider-agnostic semantics. AOR always persists:
- the full `request_artifact_ref`, which is AOR/operator evidence and may be large;
- the bounded `provider_work_packet_ref`, which is the only file the runtime agent is instructed to open initially;
- a context budget report and compaction report before provider invocation.

The bounded provider work packet must include `resolved_local_refs[]` for provider-visible local files. Required entries include the full request artifact, provider work packet, compiled context, required input packets such as handoff/spec when present, and repair evidence such as review-decision/review-report files when execution is a public repair iteration. Each entry carries `role`, `evidence_ref`, `local_path`, `required`, and `kind`. The packet must also include an `execution_contract` that states whether a meaningful target change is required, which target paths may prove it, which AOR runtime paths are ignored, that direct edits in the ephemeral target checkout are allowed during execution, that upstream writes remain forbidden, which verification commands are expected, and which final report sections prove execution. `execution_contract.output_quality_policy` records the provider-visible rule that stdout/stderr warning tokens from required, primary, or diagnostic verification must be resolved before final reporting; exit-0 warning output is not all-pass evidence unless the same command reproduces the same warning on an unchanged baseline. `execution_contract.expected_meaningful_change.allowed_target_paths[]` is derived from mission traceability, including `feature_traceability.required_path_prefixes[]` and any explicit allowed paths; prefix hints such as `source/` are rendered as provider-visible globs such as `source/**`. Live code-changing execution must forbid no-op packet summaries.

For repair executions, `execution_contract.repair_closure_policy` is required. It points to the source review decision/report, carries the source phase and cycle iteration, and includes the structured `unresolved_finding_details[]` copied from `review-decision.repair_context`. When a repair finding came from failed public verification, those details may include `verification_failure_details[]` with the failed command, role/enforcement, timeout class, exit/signal/error metadata, bounded stdout/stderr excerpts, failure summary, and evidence refs. The provider-visible work packet must also include a first-class `repair_context` section, not only a generic evidence ref. Runtime agents must open the source review decision/report, address every unresolved finding, and include explicit closure evidence in the final report. A repair execution cannot claim success by summarizing the packet or by changing unrelated files; it must either close each finding or return a blocked report with evidence refs.

Adapters may differ in the CLI flag used to pass the provider work packet, output format, timeout argument, or permission-mode args. They must not define provider-specific policies for how much AOR context is placed into the provider work packet.

`execution.external_runtime.preflight_timeout_ms` is optional and controls external adapter preflight probes separately from full step execution. When omitted, AOR derives a conservative probe timeout from `timeout_ms`. Preflight reports must record both the full `timeout_ms` and selected `preflight_timeout_ms` so slow readiness probes can be distinguished from full runtime execution limits.

Edit-readiness and permission-readiness probes may retry transient external-runner timeouts or generic runner failures once. Contract consumers must read `edit_readiness.attempts[]` and `permission_readiness.attempts[]` as the complete factual attempt history; final readiness still requires a successful marker write or a post-marker-timeout warning with matching marker contents.

For `request-artifact` adapters, live adapter preflight is itself the external
runtime invocation. The preflight work packet must declare an explicit
`request.preflight_contract`, and the launcher prompt must keep the runtime on
that contract: auth-only probes return a concise final preflight report without
running shell commands, while edit or permission probes may only read/write the
named nonce and marker files. Preflight prompts must forbid recursive provider
CLI calls such as invoking `codex`, `claude`, `opencode`, or `qwen` from inside
the already-running provider process; otherwise readiness can time out while
testing the provider by launching another provider.

`execution.external_runtime.native_timeout_arg` is optional and lets AOR pass the resolved per-request timeout to CLIs that can self-terminate before AOR has to kill the process group. The object supports:
- `flag`: the CLI flag to append, such as `--max-wall-time`.
- `format`: `seconds` for a plain integer or `duration-seconds` for values such as `295s`.
- `reserve_ms`: optional positive millisecond reserve subtracted from the AOR timeout before formatting.

The native timeout must always be shorter than or equal to AOR's hard local timeout. It is diagnostic and cooperative only; AOR still enforces `timeout_ms`, route budget timeouts, and preflight timeout bounds as hard subprocess limits.

External runners that expose official streaming output should prefer that output
mode over buffered final JSON when live operator progress matters. Qwen
candidate profiles use `--output-format stream-json --include-partial-messages`
because Qwen Code buffers `--output-format json` until process completion.
AOR may summarize stream JSONL events into `provider_step_status` progress
fields and `provider_progress_events[]` raw evidence, but those summaries must
remain sanitized and must not read private runner homes such as `~/.qwen/**` as
normal product input.

External-process adapters must enforce `execution.external_runtime.timeout_ms` and preflight probe timeouts as hard local subprocess bounds. A policy `resolved_bounds.budget.timeout_sec` may shorten a single request timeout, but it must not extend execution beyond the adapter profile's hard bound. A runner that exceeds the bound, including one that ignores graceful termination or launches a long-lived child process, must have its local process group terminated and return fail-closed timeout evidence with `failure_kind=external-runner-timeout` and `timed_out=true`; it must not leave the public lifecycle waiting indefinitely.

`execution.external_runtime.permission_policy` is required for external-process adapters. It declares named non-interactive permission modes:
- `default_mode` selects the adapter default when `AOR_RUNTIME_AGENT_PERMISSION_MODE` is not set.
- `modes.<mode>.args` is the selected runtime invocation argument list.

Installed-user acceptance runs may default to `full-bypass` so they do not hang on runtime-agent approval prompts inside isolated target checkouts. `restricted` should preserve the safer adapter-native prompting mode for local diagnostics. Codex uses `--ask-for-approval never` for the full-bypass mode and omits that approval bypass in restricted mode; both Codex modes invoke `codex exec --ignore-user-config --ignore-rules` so host authentication via `CODEX_HOME` is preserved while host config, project rules, plugins, and MCP/tool-surface drift are excluded from maintainer proof runs. Claude Code uses `--dangerously-skip-permissions` for full-bypass and `--permission-mode auto` for restricted mode. OpenCode candidate profiles may declare `opencode run --format json --dangerously-skip-permissions` for full-bypass and `opencode run --format json` for restricted mode, with `request_transport=request-artifact` and `request_file.argument=--file` so the provider work packet is passed through OpenCode's documented message/file CLI surface. Qwen candidate profiles use `--bare`, `--output-format stream-json`, `--include-partial-messages`, and `--exclude-tools skill` to avoid buffered final-output silence and runner-local `.qwen/` skill state in target checkouts; Runtime Harness still blocks such state if the runner creates it. W22-S03 keeps OpenCode out of required baseline status until future real-runner certification. If `AOR_RUNTIME_AGENT_PERMISSION_MODE` requests a mode that the profile does not declare, or if an external-process adapter profile omits `permission_policy`, adapter execution must return blocked semantics with `failure_kind=permission-policy-invalid`. Legacy `execution.external_runtime.args` is intentionally unsupported for permission selection.

`approval_features` may additionally declare how runtime permission requests are mediated after the adapter normalizes provider output:
- `continuation_strategy` is `reinvoke`, `session-resume`, or `none`. Current external-process baseline adapters use `reinvoke`.
- `approval_grant_scope` is `step-coarse` when approval can only rerun the whole step with a broader runtime mode, or `tool-call-scoped` when the provider can resume a specific tool call.
- `approval_resume_mode` names the permission policy mode to use for a coarse reinvocation after an approved permission request, usually `full-bypass`.
- `permission_request_detection[]` records whether the adapter can detect permission requests from `structured-output`, `stdout-stderr-patterns`, or `jsonl-events`.

Runtime permission mediation is controlled separately from provider permission args:
- `runtime_agent_permission_mode` selects the adapter permission mode, defaulting to `full-bypass`.
- `runtime_agent_interaction_policy` selects AOR behavior for permission blocks: `fail-closed`, `ask-all`, or `orchestrator-mediated`.
- `runtime_agent_auto_approval_profile` selects policy-owned auto-approval rules: `none`, `conservative`, `auto-edit`, or `trusted-run`.

In `orchestrator-mediated` mode the adapter still only reports the runtime request. The orchestrator evaluates the normalized request and records an audited decision: `auto_approve`, `ask_user`, or `auto_deny`. Hard deny rules for secrets, paths outside the execution root, destructive shell, upstream/network writes, runner auth homes, and global/system config cannot be bypassed by `trusted-run`.
In-process adapters without `execution.external_runtime`, such as `mock-runner`, may declare profile-level `permission_policy: not_applicable` as informational evidence that runtime-agent approval prompts do not apply.

When live runtime prerequisites are missing (for example command not found on PATH), adapter execution should return explicit blocked semantics instead of synthetic success.
Internal maintainer preflight must reject required provider variants whose primary adapter lacks the external-live metadata above. Extended provider variants may reference candidate adapters that are not yet live baselines.

## Example
See `examples/adapters/*.yaml`.
