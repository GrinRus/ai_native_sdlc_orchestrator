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
   - `needs_fix` means inspect run-health gaps in the analysis artifact, patch AOR or the run setup, commit, and rerun from a fresh isolated workspace;
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
11. For guided profiles, inspect `frontend_interactions[]` and the linked web smoke evidence. AOR operator browser/UI evidence must be tied to the relevant step observation. When the profile requires `browser-task-proof`, use the `app_url` from `guided_browser_task_proof_request_file` as the live browser target and treat `smoke_app_url` only as short-lived render-guardrail metadata. The request should carry expected proof, HTML, DOM, accessibility, and visual guardrail refs; after writing proof, ensure `manual-live-e2e.mjs --prepare-decision` hydrates the proof JSON/screenshots into inspected frontend refs and final observation/run-health use the hydrated proof refs. Missing proof or a non-passing guided task outcome is a factual run-health `ui_validation` blocker; do not treat deterministic `aor app --smoke` refs as sufficient UX proof.
12. For full-journey acceptance, ensure the public lifecycle is exercised end-to-end: isolated AOR source install, project bootstrap, intake or mission create, analyze, validate, discovery, spec, wave, handoff, `execution#N -> review#N` repair loop when needed, eval, delivery, and profile-enabled release/learning.
13. After the runner completes, inspect `live_e2e_run_health_report_file` before discussing outcome quality. Separate run-health failures (`owner`, `phase`, `class`, command/controller/provider/target/environment/operator/evidence gaps) from code, artifact, delivery, UI/UX, accessibility, and traceability quality.
14. Treat `running`, `silent-running`, and `timeout-risk` provider states as transient. Do not diagnose or block only from stale observation evidence if durable run-control state has a newer terminal provider status. For `compiled_context_budget_exceeded`, inspect `request_artifact_ref`, `provider_work_packet_ref`, `context_budget_status`, `top_context_size_sources[]`, and raw adapter evidence before planning a fix.
15. Treat `implementation_repair_loop_exhausted` and `review_quality_not_approved` as factual run-health blockers from final review evidence. Do not continue into QA or prepare an outcome quality assessment for that run.
16. Prepare a post-run quality assessment request when the run produced a full-flow result:
   - `node ./scripts/live-e2e/quality-assessment.mjs prepare --run-summary-file <live_e2e_run_summary_file>`
   - when AOR operator UI/UX or accessibility must be strict for a headless run, first run the matching guided installed-user proof for the same AOR commit and pass `--paired-aor-operator-ui-run-summary-file <guided_summary>` to `prepare`;
   - inspect the request, observation report, run-health report, review/eval/harness/delivery/release/learning refs, AOR operator UI refs, and acceptance/KPI/DoD refs;
   - write `live-e2e-quality-assessment-report` as the SWE evaluator in free-form expert mode using the structured dimensions and findings taxonomy;
   - validate it with `node ./scripts/live-e2e/quality-assessment.mjs validate --assessment-report-file <report>`.
17. For strict quality closure, run `node ./scripts/live-e2e/quality-assessment.mjs gate --policy all-pass --assessment-report-file <report>` after validation. Treat failures as local fix-and-rerun findings only; do not mutate run-health or provider qualification from the quality gate.
18. Report `live_e2e_run_health_overall_status`, `live_e2e_run_health_report_file`, `implementation_loop.iterations[]`, controller state, AOR operator UI/UX evidence when present, quality assessment status/gap report/gate status when available, and any step journal findings. Do not report legacy `runner_quality_summary`, `quality_judgement`, `canonical_status`, `final_skill_agent_verdict_file`, `agent_operator_assessment`, `verdict_matrix`, `step_matrix`, artifact-quality matrix fields, or path-scope verdicts.
