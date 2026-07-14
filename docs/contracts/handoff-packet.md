# Handoff packet

## Purpose
Approved execution boundary for runner-backed work. It defines allowed repos, paths, commands, verification expectations, approvals, and route overrides.

## Required fields
- `packet_id`
- `project_id`
- `ticket_id`
- `version`
- `status`
- `risk_tier`
- `approved_objective`
- `repo_scopes`
- `allowed_paths`
- `allowed_commands`
- `verification_plan`
- `scope_constraints`
- `command_policy`
- `writeback_mode`
- `approval_state`

## Notes
A handoff packet is the formal approval boundary for implementation work.
`approval_state` must be machine-checkable and distinguish `pending` from `approved`.
`writeback_mode`, `scope_constraints`, and `command_policy` keep downstream execution bounded.
Packets without `task_model_version` retain the legacy compact task shape and
remain loadable and approvable under their original contract. New packets copy
the structured task plan from the owning wave ticket without allowing the
handoff step to invent, widen, or silently rewrite tasks.

Structured packets carry `task_model_version`, `plan_id`, `plan_version`,
`plan_status`, `plan_size`, `previous_plan_ref`, `criteria_catalog`,
`revision_summary`, and `source_refs`. Their `local_tasks[]` use the structured
task record defined by `wave-ticket.md`.

Approval is bound to the exact `plan_id`, `plan_version`, and canonical plan
digest. A packet with `plan_status=revision-required`,
`plan_status=revision-requested`, or `plan_status=superseded` cannot be
approved. A revision request invalidates new execution starts against the old
approval, while preserving the old packet and evidence for audit.

Deterministic completeness validation runs before approval and before any
optional semantic task-quality evaluation. Invalid dependency graphs, scope
widening, orphaned criteria, missing verification, missing evidence ownership,
or invalid execution grouping fail closed with stable findings.

Structured packets copy `semantic_evaluation` and
`source_refs.evaluation_report_ref` from the owning plan. They do not run a
second evaluator or reinterpret advisory findings. When the project profile
makes semantic evaluation blocking, a non-pass evaluation keeps both plan and
handoff in `revision-required` state.

For structured implementation work, the packet carries the same planning-grade content approved in the wave ticket:
- `goals[]`, `definition_of_done[]`, `local_tasks[]`, `acceptance_criteria[]`, `expected_evidence[]`, and `kpis[]` from the approved intake/spec when present.
- `verification_expectations` copied from the wave ticket so review and operator checks can inspect the mission verification contract directly.
- `verification_plan.command_groups[]` populated with generic AOR command groups for setup, baseline, post-change, and diagnostic checks. Legacy `verification_plan.commands[]` may remain as a compatibility read model for older packets, but new packets should treat command groups as the executable verification contract.
- Command groups may carry W54 authoring metadata (`repo_id`, `working_dir`,
  `depends_on[]`, `detected_from[]`, `package_manager`,
  `tool_requirements[]`, and `skip_policy`) as long as generated handoffs do not
  embed private proof-harness target-matrix, run-health, or step-quality fields.
- `allowed_paths[]` narrowed from mission `change_evidence.required_path_prefixes[]` when available; broad `**` scope is acceptable only when the upstream artifact provides no narrower path hints.
Runner prompts and review gates may use these optional fields as completeness evidence, but older handoff packets without them remain loadable.

## Example
See `examples/packets/handoff-wave-004.yaml`.
