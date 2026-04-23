---
name: live-e2e-runner
description: Use when you need to run, monitor, abort, or report on a canonical AOR live E2E rehearsal through `aor live-e2e start`, `aor live-e2e status`, and `aor live-e2e report`, including requests such as `regress-short`, `regress-long`, `release-short`, `release-long`, or summarizing completed `.aor` live E2E artifacts.
---

# Live E2E runner

Use this skill for standard live E2E execution and reporting.

Do not use it to design or update profiles. For profile preparation, target selection review, or preflight-only work, use `live-e2e-preflight`.

## Read first

Read only the minimum required context in this order:

1. `README.md`
2. `AGENTS.md`
3. `docs/ops/live-e2e-target-catalog.md`
4. `docs/ops/live-e2e-dependency-matrix.md`
5. `docs/ops/live-e2e-no-write-preflight.md`
6. `docs/ops/live-e2e-standard-runner.md`
7. the matching runbook under `docs/ops/`
8. the matching profile under `examples/live-e2e/`

## Canonical scenario map

Use only these scenario-to-profile mappings:

- `regress-short` -> `./examples/live-e2e/regress-short.yaml`
- `regress-long` -> `./examples/live-e2e/regress-long.yaml`
- `release-short` -> `./examples/live-e2e/release-short.yaml`
- `release-long` -> `./examples/live-e2e/release-long.yaml`

Do not accept free-form target repo, branch, or ref overrides. If the request does not match a canonical profile, stop and report that a new or updated live E2E profile is required.

## Safety invariants

- Do not modify tracked files in the AOR repository.
- Runtime outputs may be materialized only under `.aor/`.
- Keep `write_back_to_remote=false`.
- Never push to an upstream public repository by default.
- Follow the no-write preflight baseline from `docs/ops/live-e2e-no-write-preflight.md`.
- Treat missing prerequisites, blocked policy gates, and failed verification as real outcomes. Never convert them into synthetic success.

## Standard runner flow

Run canonical live E2E rehearsals only through the CLI surfaces below.
Do not replace them with ad hoc manual clone, install, or report flows.

Start:

```bash
aor live-e2e start \
  --project-ref . \
  --profile <PROFILE_PATH>
```

Optional controls:

- add `--run-id <RUN_ID>` only when the user explicitly wants a fixed run id
- add `--hold-open true` only for bounded abort rehearsals

Observe:

```bash
aor live-e2e status \
  --project-ref . \
  --run-id <RUN_ID>
```

Detailed report:

```bash
aor live-e2e report \
  --project-ref . \
  --run-id <RUN_ID>
```

Abort only when the run is non-terminal:

```bash
aor live-e2e status \
  --project-ref . \
  --run-id <RUN_ID> \
  --abort true \
  --reason "<operator reason>"
```

## Evidence rules

- Record exact commands executed.
- If something was not actually run, mark it as `not executed`.
- Use the selected profile and runbook as the source of truth for prerequisites, setup commands, verification commands, abort conditions, budgets, and expected artifacts.
- Treat materialized `.aor` artifacts as the system of record, not handwritten notes.

## Post-run checks

Always confirm the canonical artifact set after the run:

- `live_e2e_run_summary_file`
- `live_e2e_scorecard_files`
- `target_checkout_root`
- `generated_project_profile_file`

When routed execution occurs, also confirm:

- `routed_step_result_file`
- `compiled_context_ref`
- `adapter_raw_evidence_ref`

For `release-short` and `release-long`, also confirm:

- `delivery_manifest_file`
- `release_packet_file`
- `repo_deliveries[0].repo_root == target_checkout_root`
- `repo_deliveries[0].changed_paths` stay target-relative

## Output

Return a concise Markdown operator summary that references canonical artifact paths and includes:

- `Scenario`
- `Resolved Profile`
- `Resolved Target`
- `Outcome`
- `Evidence`
- `Key Findings`
- `Follow-up Recommendations`

Anchor the summary to `.aor` artifact paths and clearly label any `not executed` items.
