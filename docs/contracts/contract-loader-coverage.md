# Contract loader coverage

This table maps documented contracts to loader coverage for `W0-S02`.

| Contract family | Source contract | Loader family key | Example glob | Status | Notes |
|---|---|---|---|---|---|
| Core packets and profiles | `project-profile.md` | `project-profile` | `examples/project*.aor.yaml` | implemented | Required fields + top-level type checks. |
| Core packets and profiles | `project-analysis-report.md` | `project-analysis-report` | `examples/project-analysis-report.sample.yaml` | implemented | Required fields + top-level type checks, including route, asset, policy, evaluation-registry payloads, and later-maturity completeness/traceability fields. |
| Core packets and profiles | `artifact-packet.md` | `artifact-packet` | none | implemented | Contract is loader-covered; no YAML example in this repo yet. |
| Core packets and profiles | `wave-ticket.md` | `wave-ticket` | `examples/packets/wave-ticket-*.yaml` | implemented | Required fields + top-level type checks. |
| Core packets and profiles | `handoff-packet.md` | `handoff-packet` | `examples/packets/handoff-*.yaml` | implemented | Required fields + top-level type checks, including approval-state and writeback boundary fields. |
| Core packets and profiles | `release-packet.md` | `release-packet` | `examples/packets/release-*.yaml` | implemented | Required fields + top-level type checks, including `delivery_manifest_ref`, `evidence_lineage`, and `created_at`. |
| Core packets and profiles | `delivery-plan.md` | `delivery-plan` | `examples/packets/delivery-plan-*.yaml` | implemented | Includes closed-set enum checks for `delivery_mode` (`no-write|patch-only|local-branch|fork-first-pr`) and `status` (`ready|blocked`). |
| Core packets and profiles | `delivery-manifest.md` | `delivery-manifest` | `examples/delivery-manifest*.yaml` | implemented | Required fields + top-level type checks, including `step_ref`, `approval_context`, `evidence_root`, `source_refs`, and `created_at`. |
| Core packets and profiles | `incident-report.md` | `incident-report` | none | implemented | Contract is loader-covered; no YAML example in this repo yet. |
| Execution and quality | `step-result.md` | `step-result` | none | implemented | Includes closed-set enum check for `step_class`; routed replay metadata (including completeness gate and architecture traceability) is optional. |
| Execution and quality | `validation-report.md` | `validation-report` | none | implemented | Contract is loader-covered; no YAML example in this repo yet. |
| Execution and quality | `evaluation-report.md` | `evaluation-report` | `examples/eval/report-*.sample.yaml` | implemented | Required fields + top-level type checks, including scorer metadata and summary metrics. |
| Execution and quality | `dataset.md` | `dataset` | `examples/eval/dataset-*.yaml` | implemented | Required fields + top-level type checks. |
| Execution and quality | `evaluation-suite.md` | `evaluation-suite` | `examples/eval/suite-*.yaml` | implemented | Required fields + top-level type checks. |
| Execution and quality | `promotion-decision.md` | `promotion-decision` | `examples/packets/promotion-decision-*.yaml` | implemented | Includes closed-set enum checks for promotion channels and certification status (`pass|hold|fail`). |
| Platform assets | `provider-route-profile.md` | `provider-route-profile` | `examples/routes/*.yaml` | implemented | Required fields + top-level type checks. |
| Platform assets | `wrapper-profile.md` | `wrapper-profile` | `examples/wrappers/*.yaml` | implemented | Includes closed-set enum check for `step_class`. |
| Platform assets | `prompt-bundle.md` | `prompt-bundle` | `examples/prompts/*.yaml` | implemented | Includes closed-set enum check for `step_class`. |
| Platform assets | `step-policy-profile.md` | `step-policy-profile` | `examples/policies/*.yaml` | implemented | Includes closed-set enum check for `step_class`. |
| Platform assets | `adapter-capability-profile.md` | `adapter-capability-profile` | `examples/adapters/*.yaml` | implemented | Required fields + top-level type checks, including deterministic `mock-runner` baseline profile. |
| Operations | `live-run-event.md` | `live-run-event` | none | implemented | Contract is loader-covered with closed-set `event_type` validation; no YAML example in this repo yet. |
| Operations | `live-e2e-profile.md` | `live-e2e-profile` | `examples/live-e2e/*.yaml` | implemented | Required fields + top-level type checks, including `preflight` no-write shape. |
| Operations | `control-plane-api.md` | `control-plane-api` | none | limitation | Narrative contract; no YAML schema in `W0-S02`. TODO: add machine-loadable shape in a dedicated schema slice. |

## Reference integrity and compatibility checks (W3-S01)

The reference-integrity validator checks only local example graph refs and intentionally ignores external namespaces (for example `evidence://`, `schema://`, `approval://`, `incident://`, `review://`, `redact://`, `validate.*`, `retry.*`, `repair.*`).

| Source family | Field path | Expected target |
|---|---|---|
| `project-profile` | `default_route_profiles.*` | existing `route_id` (`provider-route-profile`) |
| `project-profile` | `default_wrapper_profiles.*` | existing `wrapper_id@vN` (`wrapper-profile`) |
| `project-profile` | `default_step_policies.*` | existing `policy_id` (`step-policy-profile`) |
| `project-profile` | `eval_policy.default_release_suite_ref` | existing `suite_id@vN` (`evaluation-suite`) |
| `project-profile` | `live_e2e_defaults.profiles.*` | existing `profile_id@vN` (`live-e2e-profile`) |
| `provider-route-profile` | `wrapper_profile_ref` | existing `wrapper_id@vN` (`wrapper-profile`) |
| `provider-route-profile` | `primary.adapter` | existing `adapter_id` (`adapter-capability-profile`) |
| `provider-route-profile` | `fallback[].adapter` | existing `adapter_id` (`adapter-capability-profile`) |
| `wrapper-profile` | `prompt_bundle_ref` | existing `prompt-bundle://prompt_bundle_id@vN` (`prompt-bundle`) |
| `evaluation-suite` | `dataset_ref` | existing `dataset://dataset_id@version` (`dataset`) |
| `step-policy-profile` | `quality_gate.suite_ref` (if present) | existing `suite_id@vN` (`evaluation-suite`) |
| `prompt-bundle` | `certification_hints.default_suite_refs[]` (if present) | existing `suite_id@vN` (`evaluation-suite`) |
| `live-e2e-profile` | `project_profile_template_ref` | existing example file resolved as `project-profile` |
| `live-e2e-profile` | `verification.eval_suites[]` (if present) | existing `suite_id@vN` (`evaluation-suite`) |

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
