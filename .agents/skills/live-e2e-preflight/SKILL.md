---
name: live-e2e-preflight
description: Use when you need to prepare, review, or update a live E2E rehearsal profile for AOR.
---

1. Start with `docs/ops/live-e2e-target-catalog.md` and the machine-readable catalog under `scripts/live-e2e/catalog/targets/*.yaml`.
2. Decide whether the request is bounded rehearsal or full-journey acceptance.
3. For bounded rehearsal, choose the smallest matching profile: regress short, regress long, release short, release long, or governance integration.
4. For full-journey acceptance, require both `target_catalog_id` and `feature_mission_id`; do not allow raw `repo_url` plus free-form objective text.
5. Confirm the profile declares:
   - `live_e2e.flow_range_policy` as `delivery_default` or `full_lifecycle`;
   - `live_e2e.interaction_capability=public-control-plane`;
   - `live_e2e.frontend_capability=none` or `guided-web-smoke`;
   - `live_e2e.safety_policy=no-upstream-write`.
6. Confirm the target repo shape, setup commands, verification commands, safety defaults, and mission scope (`allowed_paths`, `forbidden_paths`, expected evidence, change budget).
7. Ensure the runner will prepare the feature request input during the run instead of skipping directly to execution.
8. Keep upstream write-back disabled unless a fork is explicitly configured and the profile really needs release-shaped delivery evidence.
