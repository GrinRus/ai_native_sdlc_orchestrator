# Contract loader coverage

This table maps documented contracts to loader coverage for `W0-S02`.

| Contract family | Source contract | Loader family key | Example glob | Status | Notes |
|---|---|---|---|---|---|
| Core packets and profiles | `project-profile.md` | `project-profile` | `examples/project*.aor.yaml` | implemented | Required fields + top-level type checks. |
| Core packets and profiles | `onboarding-report.md` | `onboarding-report` | `examples/reports/onboarding-report*.yaml` | implemented | Required fields + closed asset-mode/status values for bundled versus explicit materialized onboarding evidence. |
| Core packets and profiles | `next-action-report.md` | `next-action-report` | `examples/reports/next-action-report*.yaml` | implemented | Required fields + closed ready/blocked status for deterministic guided next-action resolution, including durable closure state for review, delivery, release, and learning evidence. |
| Core packets and profiles | `project-analysis-report.md` | `project-analysis-report` | `examples/project-analysis-report.sample.yaml` | implemented | Required fields + top-level type checks, including route, asset, policy, evaluation-registry payloads, and later-maturity completeness/traceability fields. |
| Core packets and profiles | `discovery-research-report.md` | `discovery-research-report` | `examples/reports/discovery-research-report*.yaml` | implemented | Required fields + closed status values for ADR-ready versus incomplete local research evidence. |
| Core packets and profiles | `artifact-packet.md` | `artifact-packet` | `examples/packets/artifact-packet*.yaml` | implemented | Required fields plus nested validation for optional evidence refs and invocation context. |
| Core packets and profiles | `intake-request-body.md` | `intake-request-body` | `examples/packets/intake-request-body*.yaml` | implemented | Required fields + nested validation for goals, constraints, KPIs, Definition of Done, local source refs, and completeness status. |
| Core packets and profiles | `wave-ticket.md` | `wave-ticket` | `examples/packets/wave-ticket-*.yaml` | implemented | Required fields + top-level type checks. |
| Core packets and profiles | `handoff-packet.md` | `handoff-packet` | `examples/packets/handoff-*.yaml` | implemented | Required fields + top-level type checks, including approval-state and writeback boundary fields. |
| Execution and quality | `execution-plan.md` | `execution-plan` | `examples/packets/execution-plan-*.yaml` | implemented | Immutable approved plan-to-unit mapping with closed status values, unit identity, task refs, dependencies, scope, evidence, grouping rationale, and parallel-candidate validation. |
| Execution and quality | `task-progress-report.md` | `task-progress-report` | `examples/reports/task-progress-report-*.yaml` | implemented | Evidence-derived task state with closed overall/task statuses, task digests, unit/attempt/evidence refs, verification, blockers, and next actions. |
| Core packets and profiles | `release-packet.md` | `release-packet` | `examples/packets/release-*.yaml` | implemented | Required fields + top-level type checks, including `delivery_manifest_ref`, `evidence_lineage`, and `created_at`. |
| Core packets and profiles | `delivery-plan.md` | `delivery-plan` | `examples/packets/delivery-plan-*.yaml` | implemented | V2 separates write permissions, locks evidence digests, and binds delivery to an exact baseline add/edit/delete/rename set; write-capable v1 plans require migration. |
| Core packets and profiles | `delivery-manifest.md` | `delivery-manifest` | `examples/delivery-manifest*.yaml` | implemented | Required fields + top-level type checks, including `step_ref`, `approval_context` with Runtime Harness gate context when present, `evidence_root`, `source_refs`, and `created_at`. |
| Core packets and profiles | `incident-report.md` | `incident-report` | `examples/reports/incident-report*.yaml` | implemented | Required fields plus nested validation for linkage arrays and recertification/platform rollback metadata. |
| Execution and quality | `incident-backfill-proposal.md` | `incident-backfill-proposal` | `examples/reports/incident-backfill-proposal*.yaml` | implemented | Required fields + closed proposal-state vocabulary; runtime validation prevents proposal creation without incident, asset, suite, and dataset refs. |
| Execution and quality | `step-result.md` | `step-result` | `examples/reports/step-result*.yaml` | implemented | Includes closed-set enum check for `step_class` plus nested validation for Runtime Harness decisions, interaction audit refs/state history, repair attempts, external runner evidence, and meaningful changed-path arrays. |
| Execution and quality | `validation-report.md` | `validation-report` | `examples/reports/validation-report*.yaml` | implemented | Required fields plus closed validation statuses and nested validator object/evidence-ref checks. |
| Execution and quality | `evaluation-report.md` | `evaluation-report` | `examples/eval/report-*.sample.yaml` | implemented | Required fields + top-level type checks, including scorer metadata and summary metrics. |
| Execution and quality | `review-report.md` | `review-report` | `examples/reports/review-report*.yaml` | implemented | Required fields plus nested validation for review sections, findings, matrix cells, coverage follow-up, and evidence/path arrays. |
| Execution and quality | `review-decision.md` | `review-decision` | `examples/reports/review-decision*.yaml` | implemented | Required fields + closed decision vocabulary for approve, hold, and request-repair; runtime validation prevents approval unless review and Runtime Harness evidence pass. |
| Execution and quality | `quality-repair-request.md` | `quality-repair-request` | `examples/reports/quality-repair-request*.yaml` | implemented | Required fields + closed review/QA source and bounded repair status vocabulary, including attempt budget, scope, blocker, history, and evidence-ref validation. |
| Execution and quality | `runtime-harness-report.md` | `runtime-harness-report` | `examples/reports/runtime-harness-report*.yaml` | implemented | Required fields, permission decision summary fields, closed-set runtime/mission decisions, and nested run-level controller evidence when present. |
| Execution and quality | `multirepo-coordination-status.md` | `multirepo-coordination-status` | `examples/reports/multirepo-coordination-status*.yaml` | implemented | Required fields + closed status values for bounded scoped locks, conflict/stale blockers, and cross-repo validation evidence. |
| Execution and quality | `dataset.md` | `dataset` | `examples/eval/dataset-*.yaml` | implemented | Required fields + top-level type checks. |
| Execution and quality | `evaluation-suite.md` | `evaluation-suite` | `examples/eval/suite-*.yaml` | implemented | Required fields + top-level type checks. |
| Execution and quality | `promotion-decision.md` | `promotion-decision` | `examples/packets/promotion-decision-*.yaml` | implemented | Includes closed-set enum checks for promotion channels and certification status (`pass|hold|fail`). |
| Execution and quality | `compiled-context-artifact.md` | `compiled-context-artifact` | `examples/context/compiled/*.yaml` | implemented | Required fields + top-level type checks for compiled prompt, context, skill refs, packet, hash, and provenance lineage. |
| Execution and quality | `operator-request.md` | `operator-request` | `examples/reports/operator-request*.yaml` | implemented | Required fields + closed target-stage, intent, delivery-mode, and status values for runtime-owned operator interventions. |
| Platform assets | `provider-route-profile.md` | `provider-route-profile` | `examples/routes/*.yaml` | implemented | Required fields + top-level type checks. |
| Platform assets | `wrapper-profile.md` | `wrapper-profile` | `examples/wrappers/*.yaml` | implemented | Includes closed-set enum check for `step_class`. |
| Platform assets | `prompt-bundle.md` | `prompt-bundle` | `examples/prompts/*.yaml` | implemented | Includes closed-set enum check for `step_class`. |
| Platform assets | `context-doc.md` | `context-doc` | `examples/context/docs/*.yaml` | implemented | Required fields + top-level type checks for metadata, source, and applicability. |
| Platform assets | `context-rule.md` | `context-rule` | `examples/context/rules/*.yaml` | implemented | Required fields + top-level type checks for instruction, source refs, and applicability. |
| Platform assets | `context-skill.md` | `context-skill` | `examples/context/skills/*.yaml` | implemented | Required fields + top-level type checks for workflow, source refs, and applicability. |
| Platform assets | `context-bundle.md` | `context-bundle` | `examples/context/bundles/*.yaml` | implemented | Required fields + top-level type checks for context refs, source refs, and selection policy. |
| Platform assets | `step-policy-profile.md` | `step-policy-profile` | `examples/policies/*.yaml` | implemented | Includes closed-set enum check for `step_class`. |
| Platform assets | `adapter-capability-profile.md` | `adapter-capability-profile` | `examples/adapters/*.yaml` | implemented | Required fields + top-level type checks, including deterministic `mock-runner` baseline profile. |
| Platform assets | `skill-profile.md` | `skill-profile` | `examples/skills/*.yaml` | implemented | Includes closed-set enum check for `step_class` and required workflow shape. |
| Operations | `live-run-event.md` | `live-run-event` | `examples/reports/live-run-event*.yaml` | implemented | Closed-set `event_type` validation plus nested `payload.sequence`, interaction status, continuation metadata, answer-audit refs, and raw-answer rejection. |
| Operations | `planner-metrics-snapshot.md` | `planner-metrics-snapshot` | `examples/reports/planner-metrics-snapshot*.yaml` | implemented | Required fields + closed `status` values for no-data, partial, and ready planner metric histories. |
| Operations | `finance-monitoring-snapshot.md` | `finance-monitoring-snapshot` | `examples/reports/finance-monitoring-snapshot*.yaml` | implemented | Required fields + closed `status` values for no-data, partial, and ready finance/production monitoring snapshots. |
| Operations | `compiler-revision-status.md` | `compiler-revision-status` | `examples/reports/compiler-revision-status*.yaml` | implemented | Required fields + closed lifecycle/status values for compiler revision status and decision-history snapshots. |
| Operations | `learning-loop-scorecard.md` | `learning-loop-scorecard` | `examples/reports/learning-loop-scorecard*.yaml` | implemented | Required fields plus nested validation for matrix cells, coverage follow-up, and linked evidence refs. |
| Operations | `learning-loop-handoff.md` | `learning-loop-handoff` | `examples/reports/learning-loop-handoff*.yaml` | implemented | Required fields plus nullable `incident_ref`, matrix-cell/coverage follow-up validation, and string-only action/evidence refs. |
| Operations | `control-plane-api.md` | `control-plane-api` | `examples/control-plane-api/*.yaml` | implemented | Loader validates the hybrid module + detached HTTP/SSE baseline for read/follow plus bounded run-control/ui-lifecycle mutation families; the example also carries W18 interactive-continuation target metadata, W20 production-hardening metadata, W23 explicit production permission semantics, and W34 flow-projection baseline examples. |

## Reference integrity and compatibility checks (W3-S01)

The reference-integrity validator checks only local example graph refs and intentionally ignores external namespaces (for example `evidence://`, `schema://`, `approval://`, `incident://`, `review://`, `redact://`, `validate.*`, `retry.*`, `repair.*`).

| Source family | Field path | Expected target |
|---|---|---|
| `project-profile` | `default_route_profiles.*` | existing `route_id` (`provider-route-profile`) |
| `project-profile` | `default_wrapper_profiles.*` | existing `wrapper_id@vN` (`wrapper-profile`) |
| `project-profile` | `default_prompt_bundles.*` | existing `prompt-bundle://prompt_bundle_id@vN` (`prompt-bundle`) |
| `project-profile` | `default_context_bundles.*[]` | existing `context-bundle://context_bundle_id@vN` (`context-bundle`) |
| `project-profile` | `default_step_policies.*` | existing `policy_id` (`step-policy-profile`) |
| `project-profile` | `eval_policy.default_release_suite_ref` | existing `suite_id@vN` (`evaluation-suite`) |
| `provider-route-profile` | `primary.adapter` | existing `adapter_id` (`adapter-capability-profile`) |
| `provider-route-profile` | `fallback[].adapter` | existing `adapter_id` (`adapter-capability-profile`) |
| `evaluation-suite` | `dataset_ref` | existing `dataset://dataset_id@version` (`dataset`) |
| `step-policy-profile` | `quality_gate.suite_ref` (if present) | existing `suite_id@vN` (`evaluation-suite`) |
| `prompt-bundle` | `certification_hints.default_suite_refs[]` (if present) | existing `suite_id@vN` (`evaluation-suite`) |
### Compatibility checks

The validator also enforces deterministic asset-graph compatibility after reference resolution:

- route slot key (`project.default_route_profiles.<step>`) must match referenced route `step`;
- wrapper slot key (`project.default_wrapper_profiles.<step_class>`) must match wrapper `step_class`;
- policy slot key (`project.default_step_policies.<step_class>`) must match policy `step_class`;
- route `route_class` must match referenced wrapper `step_class`;
- wrapper `step_class` must match referenced prompt-bundle `step_class`;
- suite `subject_type` must match referenced dataset `subject_type`;
- route adapters must satisfy `required_adapter_capabilities[]`;
- project `allowed_adapters[]` must include adapters used by referenced default routes.

### Reference failure shapes

- `reference_format_invalid` — the reference value shape is invalid for the expected field format.
- `reference_target_missing` — the reference format is valid, but no matching target exists in local examples.
- `reference_target_type_mismatch` — the reference resolves to an existing object of a different contract family.
- `reference_target_incompatible` — both assets exist, but their deterministic compatibility constraints do not match.
