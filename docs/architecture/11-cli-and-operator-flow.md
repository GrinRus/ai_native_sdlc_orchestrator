# CLI and operator flow

## Role of the CLI
The CLI is the primary operator surface for AOR. It must remain usable when the web UI is absent.

## Guided installed-user layer
The guided layer targets the first-run vocabulary defined in `docs/product/02-installed-user-onboarding-journey.md`:
- `aor doctor` for environment and repository readiness;
- `aor onboard <repo>` for project bootstrap and asset-mode setup;
- `aor mission create` for product goals, constraints, KPI, Definition of Done, source refs, allowed paths, and delivery mode;
- `aor next` for deterministic next-action guidance;
- `aor app` for optional web attach/discovery.

These are wrappers over runtime-owned command families. They must not remove or rename existing grouped commands, and they must keep ids, packet refs, report refs, blockers, and evidence locations visible.

W21-S02 implements the first-run shell for `doctor`, `onboard`, `app`, and `next`. These shortcuts default to human-readable output for installed users and accept `--json` when scripts need machine-readable fields. `onboard` delegates to `project init`; W21-S03 makes that path clean-repo safe by defaulting to bundled registry roots, writing the generated profile under `.aor/`, and emitting an onboarding report. `app` delegates by instruction to `ui attach` / `ui detach`; `next` is a discovery shortcut until W21-S04 adds the deterministic next-action report.

## Operator lifecycle
1. initialize or inspect the project profile
2. bootstrap and analyze / validate / verify the target project
3. create or ingest feature-specific work
4. inspect packets and approvals
5. start, pause, resume, steer, or cancel execution runs
6. inspect evidence, review verdicts, and quality outputs
7. launch eval or harness workflows
8. prepare delivery or release output
9. open incidents, audit runs, and close learning handoff

## UX rules
- commands should reflect the packet-first model;
- flags should be explicit;
- risky actions should expose approval or dry-run modes;
- the CLI must surface run ids, packet ids, and evidence locations clearly.

`aor project verify --routed-dry-run-step <step_class>` remains the baseline smoke path for routed no-write execution and durable step-result emission. The full-journey live path additionally uses public `review run` and `learning handoff` surfaces after real execution.

Installed-user proof for AOR itself runs through the internal `scripts/live-e2e/*` proof runner and is not part of the public CLI command surface.

Guided installed-user proof is separate from the internal proof runner. The proof runner can rehearse the guided vocabulary, but public guided commands still have to delegate to stable CLI/runtime paths and preserve no-upstream-write defaults.

## Interactive continuation rule
Runner-requested questions are operator interventions, not a separate UI workflow. CLI, API, and web surfaces all read the same `step-result.requested_interaction` evidence and submit answers through the control plane so answer audit refs and run-state transitions stay durable. If the runtime cannot resume from the recorded boundary, subscribers must report the interaction as blocked with the persisted `continuation.next_action=remain_blocked` evidence rather than inventing local resume behavior.
