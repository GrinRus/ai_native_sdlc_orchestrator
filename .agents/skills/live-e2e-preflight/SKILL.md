---
name: live-e2e-preflight
description: Use when you need to prepare, review, or update a live E2E rehearsal profile for AOR.
---

1. Start with `docs/ops/live-e2e-target-catalog.md` and the machine-readable catalog under `scripts/live-e2e/catalog/targets/*.yaml`.
2. Treat live E2E proof as skill-agent-only installed-user proof. Bounded deterministic rehearsal profiles are no longer supported live proof inputs.
3. Choose a supported full-journey/catalog-backed profile or `installed-user-guided-journey`.
4. Require both `target_catalog_id` and `feature_mission_id`; do not allow raw `repo_url` plus free-form objective text.
5. Confirm the profile declares:
   - `live_e2e.flow_range_policy` as `delivery_default` or `full_lifecycle`;
   - `live_e2e.installation_policy=source-install-required` unless a reviewed installed binary path is passed through `--aor-bin`;
   - `live_e2e.interaction_capability=public-control-plane`;
   - `live_e2e.frontend_capability=none`, `guided-web-smoke`, or `browser-task-proof`;
   - `live_e2e.safety_policy=no-upstream-write`;
   - `live_e2e.operator_mode=skill-agent`;
   - `live_e2e.agent_decision_policy=required`;
   - `live_e2e.interaction_answer_policy=agent-required`;
   - `live_e2e.target_write_policy=aor-runtime-only-before-execution`.
6. Confirm `implementation_loop.enabled=true`, `implementation_loop.max_iterations >= 1`, repair actions include `request-repair`, and blocking review/runtime failures do not silently continue.
7. Confirm the target repo shape, setup commands, verification commands, safety defaults, expected result evidence, and change budget. Do not require `allowed_paths` or `forbidden_paths`; they are not live E2E acceptance gates.
8. Ensure the runner will use isolated AOR source install by default. `--runtime-root` or `--aor-install-mode repo-local` is a dev/debug override, not acceptance proof.
9. Ensure the runner will prepare the feature request input during the run instead of skipping directly to execution.
10. Keep upstream write-back disabled unless a fork is explicitly configured and the profile really needs release-shaped delivery evidence.
