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
- Runtime Harness report;
- routed step result;
- adapter raw evidence summary;
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

## W40 proof notes

W40-S04 does not require fresh long-running live provider execution on every
developer machine. If a required CLI, auth source, target setup dependency, or
browser/runtime prerequisite is missing, record a `blocked` cell with
`failure_owner=environment` or `failure_owner=target_repository` as appropriate.
This is acceptable fail-closed evidence. It is not a provider quality pass and
must not be counted as AOR product success.
