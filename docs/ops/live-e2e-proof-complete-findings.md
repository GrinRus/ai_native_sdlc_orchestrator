# Live E2E Proof-Complete Findings

Status date: 2026-06-24

This note records the W47 control proof evidence for black-box product live E2E. Runtime artifacts stay under `.aor/` or `/tmp/aor-*` and are intentionally not committed.

## Scope

- Branch: `codex/black-box-product-live-e2e`.
- Control commit: `47eee2ffa2a7`.
- Primary proof wrapper: `node ./scripts/live-e2e/step-evaluator.mjs`.
- Required control proof set: guided AOR UI proof, paired `httpx` medium final acceptance, `fastify` repair medium, and `vitest` large.
- Product-quality acceptance is claimed only for runs where final `quality-assessment gate --policy all-pass` passed.

## Required Proof Set

| Proof | Profile | Latest run id | Terminal status | Owner | Phase | Class | Acceptance |
|---|---|---|---|---|---|---|---|
| `guided-aor-ui` | `scripts/live-e2e/profiles/installed-user-guided-journey.yaml` | `w47-control-guided-aor-ui-20260624-47eee2ffa2a7` | run `pass`; UI evidence `pass` | none | none | none | accepted as paired AOR UI proof |
| `httpx-medium` | `scripts/live-e2e/profiles/full-journey-regress-httpx-medium-openai.yaml` | `w47-control-httpx-medium-20260624-47eee2ffa2a7` | run `pass`; final all-pass gate `pass` | none | none | none | product-accepted |
| `fastify-repair-medium` | `scripts/live-e2e/profiles/full-journey-repair-fastify-medium-openai.yaml` | `w47-control-fastify-repair-medium-20260624-47eee2ffa2a7` | blocked after `review#3` | `provider` | `review` | `implementation_repair_loop_exhausted` | classified blocker, not product-accepted |
| `vitest-large` | `scripts/live-e2e/profiles/full-journey-regress-vitest-large-openai.yaml` | `w47-control-vitest-large-20260624-47eee2ffa2a7` | blocked before product execution | `environment` | `target_setup` | `environment_node_version_unsupported` | classified blocker, not product-accepted |
| `nextjs-xlarge` | `scripts/live-e2e/profiles/manual-xlarge-release-nextjs-openai.yaml` | not run | optional/manual only | n/a | n/a | n/a | not required |

The required proof set is terminal for W47 control closure. Only `httpx-medium` is product-accepted; blocked runs remain useful proof evidence but are not product-quality acceptance.

## Guided AOR UI Proof

- Run id: `w47-control-guided-aor-ui-20260624-47eee2ffa2a7`.
- Runtime root: `.aor/live-e2e-w47-control-guided-ui-20260624-47eee2ffa2a7`.
- Result: run summary `status=pass`; browser-task proof `status=pass`.
- Keyboard evidence: `keyboard_focus_sequence` has 28 focused controls.
- Accessibility checks: `keyboard_navigation`, `focus_order`, `contrast_and_readability`, `semantic_structure`, `screen_reader_labels`, and `accessible_error_feedback` all passed.
- Evidence refs include the browser-task proof JSON, screenshot, DOM summary, accessibility summary, rendered HTML, and web smoke accessibility/visual guardrail reports.

Accepted findings:

- W47 UI/accessibility hardening is proven on the installed-user/operator console.
- The guided UI proof is valid pairing evidence for medium+ product final quality assessments.
- The run-health report still carries a non-blocking target diagnostic warning for the small canary target; that warning did not affect the AOR UI/accessibility proof acceptance.

## HTTPX Medium Product Acceptance

- Run id: `w47-control-httpx-medium-20260624-47eee2ffa2a7`.
- Runtime root: `.aor/live-e2e-w47-control-httpx-20260624-47eee2ffa2a7`.
- Paired AOR UI proof: `w47-control-guided-aor-ui-20260624-47eee2ffa2a7`.
- Result: run `pass`, post-run primary verification `pass`, post-run diagnostic `pass`.
- Final quality report: `.aor/live-e2e-w47-control-httpx-20260624-47eee2ffa2a7/projects/aor-core/reports/live-e2e-quality-assessment-report-w47-control-httpx-medium-20260624-47eee2ffa2a7.yaml`.
- Final gate: `node ./scripts/live-e2e/quality-assessment.mjs gate --policy all-pass --assessment-report-file <report>` returned `status=ok`, `gate_issue_count=0`.
- Meaningful changed paths: `httpx/_client.py`, `httpx/_content.py`, `httpx/_transports/asgi.py`, and `tests/test_timeouts.py`.

Accepted findings:

- `httpx-medium` is the first W47 product-accepted medium mission.
- Final acceptance used same-commit guided AOR UI evidence and did not rely on run-health alone.
- Changed paths were preserved from the canonical target checkout and remained mission-relevant.

## Fastify Repair Medium Proof

- Run id: `w47-control-fastify-repair-medium-20260624-47eee2ffa2a7`.
- Runtime root: `/tmp/aor-w47-control-fastify-20260624-47eee2ffa2a7`.
- Result: blocked after `review#3`.
- Run summary classification: owner `provider`, phase `review`, class `implementation_repair_loop_exhausted`.
- Post-run primary verification: `pass`.
- Meaningful changed paths: `fastify.js`, `lib/schema-controller.js`, `test/internals/request-validate.test.js`, `test/schema-serialization.test.js`, `test/types/instance.tst.ts`, and `types/schema.d.ts`.

Observed evidence:

- Public repair lineage was preserved through `review decide --decision request-repair` and public `aor run start` repair run ids `...repair-2` and `...repair-3`.
- `repair-2` added an additional product regression test file, `test/schema-serialization.test.js`.
- `repair-3` ran through the public provider path and target verification without private target mutation.
- The old long-path Unix socket failure did not recur; short temp roots under `/tmp/aorlt/...` were exercised.
- The final review blocker is more precise than the W46 blocker: review repeatedly requested repair for `artifact-quality.01`, because primary verification did not explicitly map `npm run test:ci` to changed test files, even though target verification passed.
- The review decision files still expose a payload gap: repair decision JSON kept `decision=request-repair` but did not carry structured `repair_context`, `unresolved_findings`, `previous_repair_attempts`, or `stop_reason` fields.

Accepted findings:

- W47 public repair lineage hardening is proven across three implementation/review iterations.
- Product acceptance is not claimed: AOR review still does not converge when it should either recognize acceptable residual risk or request a more actionable verification mapping.
- Follow-up belongs to AOR review/repair quality, not live E2E target isolation.

## Vitest Large Proof

- Run id: `w47-control-vitest-large-20260624-47eee2ffa2a7`.
- Runtime root: `/tmp/aor-w47-control-vitest-20260624-47eee2ffa2a7`.
- Result: blocked at execution before product implementation.
- Classification: owner `environment`, phase `target_setup`, class `environment_node_version_unsupported`.
- Meaningful changed paths: none, because product execution did not start.

Observed evidence:

- Live adapter preflight completed and baseline diagnostic started before product execution.
- Target verification ran in `workspace-clone` isolation.
- The old `.aor` lint scan blocker did not recur: `pnpm lint` ran as `eslint --cache .` inside the isolated workspace clone.
- The old missing `packages/vitest/dist/cli.js` blocker did not recur as an unclassified product-quality failure: the profile ran setup/build before target tests.
- The remaining blocker is the local Node runtime. The target declares unsupported Node `v25.9.0` for this proof, and baseline tests failed before product execution; the run was correctly classified as `environment_node_version_unsupported`.

Accepted findings:

- W47 hard-target isolation/readiness changes worked as intended for the old W46 failure modes.
- `vitest-large` remains non-accepted until the proof runs under a compatible Node version or the profile provisions one explicitly.

## Closed And Open Follow-Ups

- `W47-S01`: closed for control proof. Guided AOR UI/accessibility is all-pass and can pair with medium+ product runs.
- `W47-S02`: partially closed. Isolation and build setup prevented old W46 Vitest blockers; compatible Node provisioning remains open.
- `W47-S03`: partially closed. Public repair lineage is proven; AOR review/repair convergence remains open.
- `W47-S04`: closed for control batch execution. Required proof runs reached terminal evidence; only `httpx-medium` reached product acceptance.
- `W47-F20`: AOR review should distinguish broad verification relevance from a repair-worthy artifact-quality finding, and should stop repeating ineffective `request-repair` when verification already passed.
- `W47-F21`: AOR repair decision artifacts should persist structured `repair_context`, `unresolved_findings`, `previous_repair_attempts`, and `stop_reason` fields instead of leaving them null.
- `W47-F22`: Vitest large proof requires a compatible Node toolchain, or the live E2E profile must provision one before baseline/product execution.

## Local Validation

Control proof local validation passed:

- `git diff --check`
- `pnpm live-e2e:test`
- `pnpm test`
- `pnpm build`
- `pnpm check`
- `pnpm slice:gate`
- Guided AOR UI proof run.
- Paired `httpx-medium` final quality `validate` and `gate --policy all-pass`.
- Fresh `fastify-repair-medium` proof run.
- Fresh `vitest-large` proof run.
