# Wave ticket

## Purpose
Bounded work unit derived from an approved spec. It identifies scope, dependencies, objectives, and expected verification.

## Required fields
- `ticket_id`
- `project_id`
- `objective`
- `scope`
- `dependencies`
- `risk_tier`
- `status`
- `approved_input_ref`

## Notes
A wave ticket is the planning bridge between specification and handoff.
`approved_input_ref` must point to the approved upstream artifact or fixture that authorized ticket creation.
Tickets without `task_model_version` are legacy compact tickets and remain
loadable without migration. Newly generated task plans use
`task_model_version: 1` and add the following plan-level fields:

- `plan_id`, stable for one flow across revisions;
- `plan_version`, incremented only for a material plan change;
- `plan_status`, one of `proposed`, `revision-required`,
  `revision-requested`, `approved`, or `superseded`;
- `plan_size`, one of `small`, `medium`, `large`, or `xlarge`;
- `previous_plan_ref` and `revision_summary` for revision lineage;
- `criteria_catalog[]`, which assigns stable IDs to goals, KPIs, Definition of
  Done entries, and acceptance criteria;
- `source_refs`, which identifies the approved intake, specification, project
  analysis, and prior plan evidence used by the planner.

For structured implementation work, `local_tasks[]` contains:

- `task_id`, `title`, `type`, `objective`, and `rationale`;
- `scope.repo_ids[]`, optional `scope.component_ids[]`,
  `scope.allowed_paths[]`, and `scope.forbidden_paths[]`;
- `depends_on[]`, `work_items[]`, and `criteria_refs[]`;
- `verification.command_group_refs[]`, `verification.validators[]`,
  `verification.manual_checks[]`, and
  `verification.success_conditions[]`;
- `expected_evidence[]`, `risks[]`, and `stop_conditions[]`;
- `execution_hints.group_key`, `execution_hints.group_reason`, and advisory
  `execution_hints.parallel_candidate`.

Supported task types are `analysis`, `design`, `implementation`,
`verification`, `documentation`, `integration`, `review`, `delivery`, and
`custom`.

Structured-plan validation is deterministic and precedes optional semantic
evaluation. It checks task-count policy, unique task and criterion IDs, DAG
integrity, scope containment, criterion coverage, verification coverage,
expected-evidence ownership, and execution-group consistency. `small` plans
contain one to three tasks; `medium` and `large` plans contain three to seven.
`xlarge` plans that cannot fit seven independently reviewable tasks fail with
`mission-split-required`.

### Compatibility and migration

`task_model_version: 1` is additive. Loaders must first determine whether the
field is present: legacy compact tickets use their original validation path,
while versioned tickets run deterministic structured validation. Implementers
must not infer version 1 from the presence of individual optional fields or
rewrite legacy artifacts during read.

The validation order is fixed: shape and enum checks, canonical scope
containment, dependency DAG, criterion coverage, verification completeness,
expected-evidence ownership, and execution-group compatibility. Optional
semantic evaluation runs only after those deterministic checks pass and cannot
convert a structurally invalid plan into an approvable plan.

Task and plan path scopes inherit `canonical-identifiers-and-paths.md`. `*`
does not cross a segment boundary, `**` is a whole-segment recursive wildcard,
and a task scope must be a real subset of the plan scope rather than a lexical
prefix. Rename/copy/delete evidence retains and validates both affected
endpoints where applicable.

After structural pass, `source_refs.evaluation_report_ref` may point to the
plan-quality `evaluation-report`, and `semantic_evaluation` exposes its status,
blocking policy, warnings, finding count, and report ref. Semantic warnings are
visible but advisory by default. A project profile may set
`structured_plan_policy.semantic_evaluator_blocking: true`; a non-pass result
then changes the candidate to `revision-required`. Deterministic completeness
remains the universal approval gate.

For implementation work, the ticket also preserves planning-grade content from the approved intake or spec:
- `goals[]` and `definition_of_done[]` at the top level when supplied by the intake/spec.
- `local_tasks[]` with bounded objectives and task-level acceptance criteria.
- `acceptance_criteria[]` and `expected_evidence[]` that make completeness reviewable before handoff.
- `verification_plan.command_groups[]` when the source mission declares bounded
  setup, baseline, post-change, or diagnostic verification. Legacy
  `verification_expectations.primary_commands[]` may remain for compatibility,
  but command groups are the generic executable contract.
- Command groups may include W54 authoring metadata (`repo_id`, `working_dir`,
  `depends_on[]`, `detected_from[]`, `package_manager`,
  `tool_requirements[]`, and `skip_policy`) but must remain generic AOR
  verification evidence rather than private proof-harness profile data.
- `scope.allowed_paths[]` narrowed from mission path hints when available; use `**` only when no narrower source-of-truth scope exists.
