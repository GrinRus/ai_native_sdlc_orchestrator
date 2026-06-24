# Live E2E Proof-Complete Findings

Status date: 2026-06-24

This note records the proof evidence for the black-box product live E2E hardening pass. Runtime artifacts stay under `.aor/` or `/tmp/aor-*` and are intentionally not committed.

## Scope

- Baseline branch: `codex/black-box-product-live-e2e`.
- Baseline commit for same-commit proof pairing: `5477ba0ddc71`.
- Primary proof wrapper: `node ./scripts/live-e2e/step-evaluator.mjs`.
- Required proof set: guided AOR UI proof, `httpx` medium final acceptance attempt, `fastify` repair medium, and `vitest` large.
- Optional proof: `scripts/live-e2e/profiles/manual-xlarge-release-nextjs-openai.yaml`.
- Product-quality acceptance is not claimed unless run-health, every required step-quality report, final code quality, meaningful changed paths, target verification, and AOR operator UI/accessibility evidence all pass.

## Required Proof Set

| Proof | Profile | Latest run id | Terminal status | Owner | Phase | Class | Acceptance |
|---|---|---|---|---|---|---|---|
| `guided-aor-ui` | `scripts/live-e2e/profiles/installed-user-guided-journey.yaml` | `w46-proof-guided-aor-ui-20260624-5477ba0ddc71` | run-health `warn`, evidence-health `pass` | `aor` | `ui_accessibility` | `keyboard_navigation_proof_gap` | blocked for all-pass pairing |
| `httpx-medium` | `scripts/live-e2e/profiles/full-journey-regress-httpx-medium-openai.yaml` | `w46-proof-httpx-medium-20260623-fresh3-acceptance` | flow pass; final all-pass gate failed after UI pairing | `aor` | `ui_accessibility` | `keyboard_navigation_proof_gap` | not accepted |
| `fastify-repair-medium` | `scripts/live-e2e/profiles/full-journey-repair-fastify-medium-openai.yaml` | `f03-fastify-5477` | run-health blocked after public repair iterations | `provider` | `review` | `implementation_repair_loop_exhausted` | classified blocker, not accepted |
| `vitest-large` | `scripts/live-e2e/profiles/full-journey-regress-vitest-large-openai.yaml` | `f02-vitest-5477` | run-health blocked at execution | `target_repository` | `target_verification` | `target_verification_failed` | classified blocker, not accepted |
| `nextjs-xlarge` | `scripts/live-e2e/profiles/manual-xlarge-release-nextjs-openai.yaml` | not run | optional/manual only | n/a | n/a | n/a | not required |

Required proof coverage is now terminal in the proof-complete sense: each required row either reached a final all-pass gate attempt or recorded a classified blocker. Product acceptance is not claimed because no medium+ product proof currently has all-pass final product-quality acceptance.

## W47 Implementation Hardening Status

W47 implementation work has landed locally to remove the known W46 blocker causes without weakening the all-pass product-quality policy:

- AOR operator UI/accessibility: primary operator controls now have explicit visible focus styling, and guided browser-task proof hydration requires structured `keyboard_focus_sequence` evidence in addition to per-subdimension accessibility checks.
- Hard-target isolation: generated medium+ `product-change` project profiles default target verification to `workspace-clone`, keeping live E2E runtime artifacts out of target lint/test scans unless a profile explicitly overrides the mode.
- Vitest readiness: the Vitest large profile now performs a Node engine preflight and `pnpm build` before product verification; unsupported Node versions are classified as `environment_node_version_unsupported` during target setup instead of becoming a product-quality failure.
- Repair convergence: public `request-repair` decisions now carry repair necessity, unresolved review findings, runtime harness decision, post-run verification status, prior repair decision refs, and stop reason through the implementation loop lineage.
- Backlog closure: W47 is now the latest documented wave, with slices `W47-S01` through `W47-S04` linked from the roadmap, master backlog, epic map, and dependency graph.

This pass is implementation-hardening complete, not proof-accepted. The required fresh proof reruns still need to be executed after this code lands: guided AOR UI, paired `httpx-medium` final all-pass gate, `fastify-repair-medium`, and `vitest-large`.

Local validation for this implementation pass:

- `git diff --check`
- `pnpm live-e2e:test`
- `pnpm test`
- `pnpm build`
- `pnpm check`
- `pnpm slice:gate`

## Guided AOR UI Proof

- Profile: `scripts/live-e2e/profiles/installed-user-guided-journey.yaml`
- Run id: `w46-proof-guided-aor-ui-20260624-5477ba0ddc71`
- Runtime root: `.aor/live-e2e-proof-guided-ui-20260624-5477ba0ddc71`
- Result: controller flow completed through learning; evidence-health passed; run-health remained `warn`.
- Classification: owner `aor`, phase `ui_accessibility`, class `keyboard_navigation_proof_gap`.

Observed evidence:

- AOR was launched through the installed-user guided journey profile.
- The live app surface was available at `http://127.0.0.1:60321/`.
- Browser-task proof was materialized from the public web surface after the runner produced `installed-user-guided-browser-task-proof-request-*`.
- Accessibility checks were present in the browser-task proof.
- `focus_order`, `contrast_and_readability`, `semantic_structure`, `screen_reader_labels`, and `accessible_error_feedback` passed.
- `keyboard_navigation` remained `warn`: repeated Tab probes through the in-app browser did not produce enough focus movement evidence.
- The run also carried a non-blocking `ky` post-run diagnostic warning, so it is not an all-pass AOR operator UI/accessibility proof.

Accepted findings:

- `W46-F08` is no longer blocked by missing browser-task proof; it is now blocked by a concrete accessibility gap.
- The final product gate correctly rejects paired product acceptance while `keyboard_navigation` remains non-pass.

## HTTPX Medium Final Acceptance Attempt

- Product run profile: `scripts/live-e2e/profiles/full-journey-regress-httpx-medium-openai.yaml`
- Product run id: `w46-proof-httpx-medium-20260623-fresh3-acceptance`
- Paired guided UI run id: `w46-proof-guided-aor-ui-20260624-5477ba0ddc71`
- Result: `quality-assessment validate` passed; `quality-assessment gate --policy all-pass` failed.
- Classification: owner `aor`, phase `ui_accessibility`, class `keyboard_navigation_proof_gap`.

Observed evidence:

- The product flow completed all delivery-default steps: `discovery`, `spec`, `planning`, `handoff`, `execution`, `review`, `qa`, and `delivery`.
- The evaluator produced accepted step-quality reports for all observed product steps.
- Run-health, observation status, target verification, and post-run diagnostic verification passed.
- Meaningful changed paths were preserved from the canonical target checkout: `httpx/_client.py`, `httpx/_content.py`, and `tests/test_timeouts.py`.
- The final quality assessment was contract-valid after pairing the guided UI proof.
- The all-pass gate failed only on AOR operator accessibility, specifically `keyboard_navigation`.

Accepted findings:

- `W46-F04` remains closed: meaningful changed paths are canonical target paths and do not silently disappear.
- Product acceptance is correctly not claimed: same-commit UI proof exists, but the accessibility dimension is not all-pass.

## Fastify Repair Medium Proof

- Profile: `scripts/live-e2e/profiles/full-journey-repair-fastify-medium-openai.yaml`
- Main run id: `f03-fastify-5477`
- Runtime root: `/tmp/aor-f03-fastify-5477`
- Result: classified blocker after three public implementation iterations.
- Classification: owner `provider`, phase `review`, class `implementation_repair_loop_exhausted`.

Observed evidence:

- The first long-root run reproduced an environment-specific target verification issue: Fastify tests hit a Unix socket path-length failure. The proof was rerun on a short `/tmp` runtime root.
- On the short-root run, controller observations reached `discovery`, `spec`, `planning`, `handoff`, `execution`, `review`, `execution#2`, `review#2`, `execution#3`, and `review#3`.
- Public repair lineage was observed through `review decide --decision request-repair` and repair run ids `f03-fastify-5477.repair-2` and `f03-fastify-5477.repair-3`.
- Repair artifacts included review-decision reports, adapter live request/work-packet files, compiled context files, live-run event logs, run-control state, and routed step-result reports.
- Execution iterations produced accepted operator decisions and accepted step-quality reports before the next public step.
- Target verification passed on the repaired checkout: `npm run lint` and `npm run test:ci` were green.
- The final `review#3` step blocked because the implementation repair loop exhausted before review quality passed.

Accepted findings:

- `W46-F03` is closed as terminal blocker evidence, not product acceptance.
- The repair loop did not mutate target files privately; repair ran through public AOR review/repair lifecycle artifacts.
- The proof revealed the intended failure mode for insufficient provider/review quality: run-health blocks with `implementation_repair_loop_exhausted`.

## Vitest Large Proof

- Profile: `scripts/live-e2e/profiles/full-journey-regress-vitest-large-openai.yaml`
- Run id: `f02-vitest-5477`
- Runtime root: `/tmp/aor-f02-vitest-5477`
- Result: classified blocker at execution.
- Classification: owner `target_repository`, phase `target_verification`, class `target_verification_failed`.

Observed evidence:

- Discovery, spec, planning, and handoff all had accepted operator decisions and accepted step-quality reports.
- Provider execution completed and changed real target paths:
  `packages/vitest/src/node/config/resolveConfig.ts`,
  `packages/vitest/src/node/pool.ts`, and
  `test/e2e/test/failures.test.ts`.
- The step evaluator wrote a public `block` operator decision for execution after deterministic status `not_pass`.
- Controller health was `pass` after the explicit block decision; run-health blocker classification came from target verification, not missing operator state.
- `pnpm lint` failed because `eslint --cache .` scanned AOR runtime JSON under the target checkout `.aor/` directory.
- `pnpm test` also failed because `packages/vitest/dist/cli.js` was missing and the environment was running Node `v25.9.0`, while the target declares supported engines `^22.12.0 || ^24.0.0 || >=26.0.0`.

Accepted findings:

- `W46-F02` is closed as classified blocker evidence, not product acceptance.
- The proof exposed a runner isolation gap for hard targets: target verification can scan AOR runtime `.aor/` files when the target repo's lint command is broad.
- The proof also exposed a target/environment readiness gap: this Vitest profile's `pnpm test` requires a build artifact or different setup before test execution.

## Implementation Findings Closed In This Pass

- `W46-F08`: moved from missing UI proof to a specific accessibility blocker. Same-commit guided proof exists, but all-pass acceptance remains blocked by keyboard navigation evidence.
- `W46-F03`: public repair lineage is proven across iterations and ends in a classified review-quality blocker.
- `W46-F02`: Vitest large reaches a classified execution/verification blocker with meaningful changed paths.
- `W46-F13`: step evaluator now writes a public `block` operator decision for deterministic non-pass step evidence instead of leaving the run as `controller_incomplete`.
- `W46-F14`: run-health classification now prioritizes factual provider/target verification blockers over resumable controller state when a target/provider failure is already known.
- `W46-F15`: step evaluator waits for the first controller observation instead of fail-closing on an empty step journal when the included step is still pending.

## Follow-Up Tickets

- `W46-F08A` / `W47-S01`: implementation hardening is in place; rerun `installed-user-guided-journey.yaml` with browser-task focus evidence to prove all-pass keyboard navigation.
- `W46-F16` / `W47-S02`: implementation hardening is in place; rerun `vitest-large` to prove target verification no longer scans live E2E `.aor/` runtime state.
- `W46-F17` / `W47-S02`: implementation hardening is in place; rerun `vitest-large` to prove Node/build setup is classified before product execution.
- `W46-F18` / `W47-S03`: implementation hardening is in place; rerun `fastify-repair-medium` to determine whether richer public repair context converges or produces a more specific blocker.
- `W46-F19` / `W47-S04`: pending fresh proof rerun and final acceptance closure; current status remains implementation-hardening complete, not product-accepted.
