# AGENTS.md

`scripts/live-e2e` owns the internal installed-user black-box proof runner.

## Rules
- Keep this proof runner black-box with respect to target execution: run public `aor` commands as subprocesses.
- Do not import or call analyze/validate/verify/step-execution runtime functions directly here.
- Keep scenario profiles private to this folder; they are not part of the public contract surface.
- Write deterministic transcripts and summaries under the maintainer run's ignored `.aor/` output directory, outside the target checkout, so failures stay debuggable.
- Full-journey mode must resolve curated `target_catalog_id` and `feature_mission_id` from `scripts/live-e2e/catalog/targets/*.yaml`.
- Full-journey mode must use public `project init` with host-side generated profiles/assets; do not inject `examples`, `context`, root `project.aor.yaml`, route overrides, or `.aor-live-e2e` scaffolding into the target checkout.
- Runner-prepared inputs, decisions, generated profiles, and route overlays stay in maintainer run-scoped state outside the target checkout.
- Launch public `aor` commands with the isolated session `AOR_HOME`; central project runtime state must not be materialized in the target repository. Public commands do not accept `--runtime-root`.
- Before execution, keep the target checkout unchanged. Portable project configuration and evidence exports require their own explicit public actions; they are not implicit runtime initialization.
- Audit, incident, review, and learning closure on the full-journey path must use public CLI commands, not proof-runner-private post-processing.
