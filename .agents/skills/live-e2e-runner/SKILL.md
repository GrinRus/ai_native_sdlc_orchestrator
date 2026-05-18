---
name: live-e2e-runner
description: Use when you need to run or assess AOR live E2E profiles through the black-box step journal.
---

1. Start with `docs/ops/live-e2e-standard-runner.md` and `docs/ops/live-e2e-target-catalog.md`.
2. Decide whether the run is bounded rehearsal, full-journey acceptance, guided installed-user proof, or production proof.
3. Confirm the profile declares `live_e2e.flow_range_policy`, `live_e2e.interaction_capability`, `live_e2e.frontend_capability`, and `live_e2e.safety_policy`.
4. Use the installed-user proof runner entrypoint for automatic runs:
   - `node ./scripts/live-e2e/run-profile.mjs --project-ref . --profile <profile>`
5. Use the manual loop when a human or agent must gate each step:
   - `node ./scripts/live-e2e/manual-live-e2e.mjs --project-ref . --profile <profile> --run-id <id>`
   - rerun the same command with the same `run-id` after completing any required public action.
6. Use the harness evaluator when proof must fail closed on missing controller evidence:
   - `node ./scripts/live-e2e/harness-evaluator.mjs --project-ref . --profile <profile>`
7. Treat every path as the same online black-box step controller:
   - plan the next step from `step_journal[].plan`;
   - execute only the installed project flow through public CLI/API/web surfaces;
   - inspect `live_e2e_step_observation_files[]`, command transcripts, artifact refs, UI/API/log output, and `live_e2e_controller_state_file`;
   - classify deterministic and semantic evidence before deciding;
   - let the step decision gate continuation;
   - do not import private runtime internals to repair or explain target execution.
8. For each step, decide one action:
   - `continue` when deterministic and semantic analysis pass;
   - `answer` when `requested_interaction` is present;
   - `frontend_interact` when the profile exposes a guided web surface and the step needs browser evidence;
   - `retry_public_step` only through public CLI/API/web surfaces;
   - `diagnose` when evidence is incomplete or quality failed;
   - `block` when safety, policy, or non-resumable continuation prevents progress.
9. For interaction questions, submit answers only through public control-plane surfaces (`aor run answer` or the HTTP answer route). Verify the answer audit ref, `state_history[]`, and final `interaction_status` before continuing.
10. For guided profiles, inspect `frontend_interactions[]` and the linked web smoke evidence. Browser/UI evidence must be tied to the relevant step observation.
11. For full-journey acceptance, ensure the public lifecycle is exercised end-to-end: project bootstrap, intake or mission create, analyze, validate, discovery, spec, wave, handoff, run start/status, review, eval, delivery, and profile-enabled release/learning.
12. Report `quality_judgement`, `canonical_status`, remaining matrix coverage, controller state, and any step journal findings. Do not report legacy `verdict_matrix`, `step_matrix`, or artifact-quality matrix fields.
