# AGENTS.md

`scripts/live-e2e` owns the internal installed-user black-box proof runner.

## Rules
- Keep this proof runner black-box with respect to target execution: run public `aor` commands as subprocesses.
- Do not import or call analyze/validate/verify/step-execution runtime functions directly here.
- Keep scenario profiles private to this folder; they are not part of the public contract surface.
- Keep internal transcripts and summaries in the runner's isolated workspace or an explicitly selected ignored `.aor/` output root. The session launcher sets an isolated `AOR_HOME` for product state; do not replace that with target-repository `.aor/` state.
- Full-journey mode must resolve curated `target_catalog_id` and `feature_mission_id` from `scripts/live-e2e/catalog/targets/*.yaml`.
- Full-journey mode must use public `project init` with host-side generated profiles/assets; do not inject `examples`, `context`, root `project.aor.yaml`, route overrides, or `.aor-live-e2e` scaffolding into the target checkout.
- Runner-prepared feature requests, decisions, generated profiles, and route overlays belong in host-side run-scoped state. Before agent execution, the target checkout may receive only the runner's permitted `.aor/` preparation files; this exception does not redefine installed-user runtime storage.
- Audit, incident, review, and learning closure on the full-journey path must use public CLI commands, not proof-runner-private post-processing.
- Assess existing evidence without starting or resuming a live run when the request is read-only. Repairs, commits, credential changes, paid retries, and publication require their own applicable authorization; a run failure does not expand scope.
- Product-change steps require both accepted operator decisions and accepted step-quality reports before continuation. Medium/large qualification and manual-only xlarge observation must remain distinct.
- Keep the contributor skills and matching runbook sections aligned when changing the operator workflow. Use `CONTRIBUTING.md` for the applicable local and CI verification commands.
