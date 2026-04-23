# AGENTS.md

`scripts/live-e2e` owns the internal installed-user rehearsal harness.

## Rules
- Keep this harness black-box with respect to target execution: run public `aor` commands as subprocesses.
- Do not import or call analyze/validate/verify/step-execution runtime functions directly here.
- Keep scenario profiles private to this folder; they are not part of the public contract surface.
- Write deterministic transcripts and summaries under `.aor/` so failures stay debuggable.
