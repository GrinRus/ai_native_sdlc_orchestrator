---
name: live-e2e-runner
description: Use when you need to run or assess AOR live E2E profiles through the black-box step journal.
---

1. Start with `docs/ops/live-e2e-standard-runner.md` and `docs/ops/live-e2e-target-catalog.md`.
2. Decide whether the run is full-journey acceptance, guided installed-user proof, or production proof.
3. Confirm the profile declares `live_e2e.flow_range_policy`, `live_e2e.installation_policy`, `live_e2e.interaction_capability`, `live_e2e.frontend_capability`, `live_e2e.safety_policy`, operator policy fields, and `implementation_loop`.
4. Use the manual loop for acceptance and production-proof runs; the skill-agent running this skill is the live E2E operator:
   - `node ./scripts/live-e2e/manual-live-e2e.mjs --project-ref . --profile <profile> --run-id <id>`
   - inspect `agent_decision_request_ref`;
   - write the matching decision JSON and resume with `--operator-decision-file <decision.json>` when the step can continue;
   - answer `requested_interaction` through `aor run answer` or the HTTP answer route;
   - rerun the same command with the same `run-id` after completing any required public action.
5. Use `run-profile.mjs` only as the strict proof orchestrator for skill-agent-only profiles. It must fail closed when operator decisions are missing or rejected:
   - `node ./scripts/live-e2e/run-profile.mjs --project-ref . --profile <profile>`
6. Use the step evaluator when proof must fail closed on missing controller evidence:
   - `node ./scripts/live-e2e/step-evaluator.mjs --project-ref . --profile <profile>`
7. Use the qualification loop for the outer medium+ fix-and-rerun workflow:
   - `node ./scripts/live-e2e/qualification-loop.mjs --project-ref . --profile <medium-or-larger-profile>`
   - `passed` means the run can count toward provider qualification;
   - `needs_fix` means inspect the analysis artifact, patch AOR, commit, and rerun from a fresh isolated workspace;
   - `blocked` means fix credentials, provider setup, safety, or environment before judging product quality.
8. Treat every path as the same online black-box step controller:
   - plan the next step from `step_journal[].plan`;
   - execute only the installed project flow through public CLI/API/web surfaces;
   - inspect `agent_decision_request_ref`, `live_e2e_step_observation_files[]`, command transcripts, artifact refs, UI/API/log output, and `live_e2e_controller_state_file`;
   - inspect `aor_installation_proof_file` and `setup_journal[]` before trusting SDLC step evidence;
   - classify deterministic and semantic evidence before deciding;
   - let the accepted skill-agent operator decision gate continuation;
   - do not import private runtime internals to repair or explain target execution.
9. For each step, decide one action:
   - `continue` when deterministic and semantic analysis pass;
   - `answer` when `requested_interaction` is present;
   - `frontend_interact` when the profile exposes a guided web surface and the step needs browser evidence;
   - `retry_public_step` only through public CLI/API/web surfaces;
   - `diagnose` when evidence is incomplete or quality failed;
   - `block` when safety, policy, or non-resumable continuation prevents progress.
10. For interaction questions, decide and submit the answer yourself as the skill-agent operator, only through public control-plane surfaces (`aor run answer` or the HTTP answer route). Verify the answer audit ref, `state_history[]`, and final `interaction_status` before continuing.
11. For guided profiles, inspect `frontend_interactions[]` and the linked web smoke evidence. Browser/UI evidence must be tied to the relevant step observation.
12. For full-journey acceptance, ensure the public lifecycle is exercised end-to-end: isolated AOR source install, project bootstrap, intake or mission create, analyze, validate, discovery, spec, wave, handoff, `execution#N -> review#N` repair loop when needed, eval, delivery, and profile-enabled release/learning.
13. Report `runner_quality_summary`, `quality_judgement`, `canonical_status`, `final_skill_agent_verdict_file`, `implementation_loop.iterations[]`, remaining matrix coverage, controller state, UI/UX evidence when present, and any step journal findings. Do not report legacy `agent_operator_assessment`, `verdict_matrix`, `step_matrix`, artifact-quality matrix fields, or path-scope verdicts.
