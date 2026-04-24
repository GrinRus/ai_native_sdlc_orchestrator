# AGENTS.md

`scripts/live-e2e` owns the internal installed-user rehearsal harness.

## Rules
- Keep this harness black-box with respect to target execution: run public `aor` commands as subprocesses.
- Do not import or call analyze/validate/verify/step-execution runtime functions directly here.
- Keep scenario profiles private to this folder; they are not part of the public contract surface.
- Write deterministic transcripts and summaries under `.aor/` so failures stay debuggable.
- Full-journey mode must resolve curated `target_catalog_id` and `feature_mission_id` from `scripts/live-e2e/catalog/targets/*.yaml`.
- Full-journey mode must use public `project init` bootstrap materialization; do not inject `examples`, `context`, or generated project profiles directly.
- Runner-prepared feature request inputs should live under target `.aor/requests/` or another non-code path so review scope checks stay code-focused.
- Audit, incident, review, and learning closure on the full-journey path must use public CLI commands, not harness-private post-processing.
