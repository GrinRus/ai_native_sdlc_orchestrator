# Live E2E provider qualification matrix

## Purpose

The provider qualification matrix records what AOR knows about each live E2E
provider path without turning optional providers into release blockers. It is a
readable operator report surface, not raw runner logs and not a stable-release
certificate.

The W40 matrix covers:
- `openai-primary` through the `codex-cli` adapter;
- `anthropic-primary` through the `claude-code` adapter;
- `open-code-primary` through the `open-code` adapter;
- `qwen-primary` through the `qwen-code` adapter.

Provider-specific differences remain only at the adapter boundary: command
shape, auth/env mapping, permission flags, output parser, and coverage tier.
The live E2E lifecycle, target setup/verification classification, Runtime
Harness retry/repair semantics, operator decisions, and evidence requirements
must stay provider-neutral.

## Matrix fields

Each `provider_cells[]` entry must include:
- `provider_variant_id`, `provider`, `adapter`, and `coverage_tier`;
- `qualification_status`: `qualified`, `candidate`, `blocked`, or `not-run`;
- `release_blocking`: whether this cell blocks the current release policy;
- `required_pass_count` and `passing_run_count`;
- `latest_run_id` and `latest_attempt_status`, when evidence exists;
- `failure_owner`: `aor`, `target_repository`, `provider`, `environment`, or
  `operator`;
- `failure_phase`: `aor_install`, `target_checkout`, `target_setup`,
  `target_verification`, `provider_execution`, `controller_decision`, or
  `ui_validation`;
- `failure_class`, `blocker_reason`, and user-facing `evidence_refs[]`.

The provider name cannot decide status by itself. A Qwen or OpenCode run may be
`qualified` when it has clean evidence, and an OpenAI/Codex run may be `blocked`
with `failure_owner=aor` when the orchestrator product failed. Likewise, target
repository setup/build/test failures and local environment/auth blockers are
valid fail-closed evidence, but they do not count as AOR product pass or
provider quality pass.

Provider qualification uses `live-e2e-run-health-report` only for run failure
classification. It must not use post-run code quality, artifact content quality,
UI/UX quality, accessibility quality, `live-e2e-step-quality-assessment-report`,
or `live-e2e-quality-assessment-report` to decide whether a provider path is
qualified. Medium+ product acceptance consumes those quality reports separately.

Strict quality-driven fix-and-rerun work may additionally run
`quality-assessment.mjs gate --policy all-pass` after a completed flow. That
gate is a local outcome-quality closure check. It can create follow-up work and
force a local rerun loop, but it does not change provider qualification status,
release-blocking policy, or run-health owner/phase/class classification.

## Status rules

- `qualified`: at least one accepted live E2E attempt satisfies the matrix cell's
  pass requirement and does not carry unresolved owner/phase blockers.
- `candidate`: some reviewed evidence exists, but it is not enough to call the
  provider path qualified.
- `blocked`: the latest reviewed attempt is fail-closed with owner/phase
  evidence.
- `not-run`: no reviewed attempt exists for the provider cell.

`coverage_tier` remains catalog metadata. It does not automatically make a
provider release-blocking in the W40 optional matrix. Release-blocking policy
must be explicit in `release_blocking_provider_ids[]` and in release planning
docs for that release.

## Evidence sources

Use public live E2E evidence only:
- run summary;
- live E2E observation report;
- live E2E run-health report;
- Runtime Harness report;
- routed step result;
- adapter raw evidence summary;
- request artifact, provider work packet, and context-budget summary when an
  external provider step was reached;
- provider heartbeat/progress status;
- target setup/verification status;
- accepted skill-agent operator decisions.

Do not require private runner homes such as `~/.qwen/**`, `~/.codex/**`,
`~/.claude/**`, or `~/.opencode/**` for product qualification. Those files can
help manual diagnosis, but they are not product evidence.

The sample matrix lives at
`examples/live-e2e/fixtures/w40-s04/provider-qualification-matrix.sample.json`.

## Running or recording attempts

For medium-or-larger qualification loops:

```bash
node ./scripts/live-e2e/qualification-loop.mjs \
  --project-ref . \
  --profile ./scripts/live-e2e/profiles/full-journey-regress-ky-medium-codex.yaml \
  --qualification-set-file /tmp/aor-live-e2e-qualification-set.json
```

For a manually resumed run, record the same run summary instead of starting a
new target workspace:

```bash
node ./scripts/live-e2e/qualification-loop.mjs \
  --project-ref . \
  --profile ./scripts/live-e2e/profiles/full-journey-regress-ky-medium-codex.yaml \
  --qualification-set-file /tmp/aor-live-e2e-qualification-set.json \
  --record-run-summary-file <live-e2e-run-summary-file>
```

The generated qualification set includes `provider_qualification_matrix`.
Short/small diagnostic runs may be cited as blocker or candidate evidence, but
they do not replace medium-or-larger qualification-loop evidence.

The generated qualification analysis includes `run_health_report_ref`,
`run_health_status`, and `run_health_gaps`. Treat these as the source for
provider/environment/operator/AOR-owner follow-up. Use the separate quality
assessment report for outcome backlog items only after provider qualification is
recorded.

Context-budget blockers such as `compiled_context_budget_exceeded` and
provider-side overflow blockers such as `provider_context_window_exceeded` are
run-health issues in `phase=provider_execution`. They do not evaluate produced
code or artifacts.

## W40 proof notes

W40-S04 does not require fresh long-running live provider execution on every
developer machine. If a required CLI, auth source, target setup dependency, or
browser/runtime prerequisite is missing, record a `blocked` cell with
`failure_owner=environment` or `failure_owner=target_repository` as appropriate.
This is acceptable fail-closed evidence. It is not a provider quality pass and
must not be counted as AOR product success.

## W41-S03 alpha.8 smoke refresh

W41-S03 refreshed the provider qualification surface after
`@grinrus/aor@0.1.0-alpha.8`. The refresh used short normal live E2E profile
runs, not provider-specific diagnostic modes. The goal was parity evidence:
target setup classification, provider heartbeat/progress, routed step result,
adapter raw evidence, Runtime Harness report, and decision-helper behavior.

| Provider cell | Run or check | Owner / phase | Result |
| --- | --- | --- | --- |
| `openai-primary` | `w41-s03-codex-small-20260604` with `full-journey-regress-ky-small-codex.yaml` | `operator` / `provider_execution` | Target setup passed (`npm install --prefer-offline --no-audit --no-fund`, 32.075s). The run reached the provider execution step and was stopped through public `aor run cancel` after the short-smoke timebox. W42-S02 classifies this as `interruption_owner=operator` and `failure_class=operator_stopped`; Runtime Harness still writes `overall_decision=block`, `terminal_status=blocked`, and `repair_status=not_required`, so no pass is claimed and no hidden internal repair route starts. |
| `qwen-primary` | `w41-s03-qwen-small-20260604` with `full-journey-regress-ky-small-qwen.yaml` | `operator` / `provider_execution` | Target setup passed (`npm install --prefer-offline --no-audit --no-fund`, 21.004s). Qwen used the same live E2E lifecycle as Codex and differed only at the adapter boundary: `qwen-code` ran with `--output-format stream-json --include-partial-messages`. Public run-control showed `status=interrupted`, `interruption_owner=operator`, `output_mode=stream-json`, `progress_event_count=7481`, and `last_progress_kind=message_stop` after public cancel. Adapter raw evidence retained 100 sanitized progress summaries. Runtime Harness still writes `overall_decision=block`, `terminal_status=blocked`, and `repair_status=not_required`; no hidden internal repair route starts. |
| `anthropic-primary` | local readiness check | `environment` / `aor_install` | `claude` CLI was not available locally, and no `ANTHROPIC_API_KEY` or `CLAUDE_CONFIG_DIR` readiness evidence was present. This optional provider cell was not run and remains non-release-blocking. |
| `open-code-primary` | local readiness check | `environment` / `provider_execution` | `opencode --version` returned `1.14.30`, but no `OPENCODE_API_KEY` readiness evidence was present. This optional provider cell was not run and remains non-release-blocking. |

Both Codex and Qwen smoke runs used accepted public operator decisions for
deterministic controller steps and installed `diagnose` decisions for the
interrupted execution step through the decision helper. The helper populated all
required inspected refs (`36` refs for the execution decisions) and no manual
JSON editing was required.

W42-S02 closes the W41 findings-closure item for public operator timebox stops:
operator-initiated `aor run cancel` is reported as `failure_owner=operator`,
`failure_phase=provider_execution`, and `failure_class=operator_stopped` while
preserving fail-closed provider execution evidence. Provider crashes, provider
timeouts, target repository blockers, environment blockers, and AOR product
failures remain separate owner/phase outcomes.

## W43-S03 alpha.10 live E2E smoke refresh

W43-S03 refreshed interruption/provider smoke evidence after
`@grinrus/aor@0.1.0-alpha.10` and W43-S02 installed-user validation. The smoke
used the normal `manual-live-e2e.mjs` lifecycle and public run-control surfaces;
it did not add a provider-specific mode.

| Provider cell | Run or check | Owner / phase | Result |
| --- | --- | --- | --- |
| `openai-primary` | `w43-s03-codex-alpha10-20260604113716` with `full-journey-regress-ky-small-codex.yaml` | `operator` / `provider_execution` | `pnpm live-e2e:test` passed before the smoke. Discovery, spec, planning, and handoff were resumed through the decision helper. Execution reached the Codex provider step with public `provider_step_status.status=running`, then was stopped through `aor run cancel --approval-ref approval://operator/w43-s03-codex-alpha10-20260604113716/stop`. The run summary reports `status=blocked`, `failure_owner=operator`, `failure_phase=provider_execution`, and `failure_class=operator_stopped`; `provider_step_status.status=interrupted`, `interruption_owner=operator`, and `interruption_status=operator-stopped`. The routed result exists with `failure_class=external-runner-interrupted`, adapter raw evidence exists, Runtime Harness reports `overall_decision=block`, and `repair_status=not_required`; no hidden repair attempt file was produced. |
| `qwen-primary` | local readiness check | `environment` / `provider_execution` | Qwen was not run in this W43-S03 environment because the `qwen` CLI was missing and `ANTHROPIC_API_KEY`, `QWEN_API_KEY`, and `DASHSCOPE_API_KEY` readiness checks were empty. This is a non-release-blocking optional-provider environment blocker, not a Qwen quality result. |
| `anthropic-primary` | local readiness check | `environment` / `provider_execution` | Claude was not run in this W43-S03 scope. No Anthropic/Claude local readiness evidence was present, and optional provider runs remain non-release-blocking without an explicit release-policy slice. |
| `open-code-primary` | not run by W43-S03 scope | `environment` / `provider_execution` | OpenCode was not run in W43-S03 because the slice only required Codex and optional Qwen when ready. This does not change the optional provider qualification policy. |

An earlier W43-S03 Codex attempt,
`w43-s03-codex-alpha10-20260604113605`, failed before target/provider execution
because the neutral shell did not include `/opt/homebrew/bin`; the isolated
installed-source setup could not find `corepack` or `pnpm`. That attempt is
classified as environment/aor-install setup evidence and was rerun with the
same public profile after restoring the expected PATH. It is not a target
repository failure, provider failure, or AOR runtime pass.
