import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const STEP_CLASS_VALUES = ["artifact", "planner", "runner", "repair", "eval", "harness"];
const ROUTE_STEP_VALUES = [
  "discovery",
  "research",
  "spec",
  "planning",
  "implement",
  "review",
  "qa",
  "repair",
  "eval",
  "harness",
];
const PROMOTION_CHANNEL_VALUES = ["draft", "candidate", "stable", "frozen", "demoted"];
const EXTERNAL_REFERENCE_PREFIXES = [
  "evidence://",
  "schema://",
  "approval://",
  "incident://",
  "review://",
  "redact://",
  "validate.",
  "retry.",
  "repair.",
];

/** @type {ReadonlyArray<import("./index.d.ts").ContractFamilyIndexEntry>} */
const CONTRACT_FAMILY_INDEX = Object.freeze([
  {
    family: "project-profile",
    familyGroup: "core-packets-and-profiles",
    sourceContract: "docs/contracts/project-profile.md",
    exampleGlob: "examples/project*.aor.yaml",
    status: "implemented",
    requiredFields: [
      "project_id",
      "display_name",
      "repo_topology",
      "repos",
      "allowed_providers",
      "allowed_adapters",
      "registry_roots",
      "default_route_profiles",
      "default_step_policies",
      "default_wrapper_profiles",
      "default_prompt_bundles",
      "default_context_bundles",
      "default_skill_profiles",
      "skill_overrides",
      "budget_policy",
      "approval_policy",
      "security_policy",
      "runtime_defaults",
      "writeback_policy",
    ],
    fieldTypes: {
      project_id: "string",
      display_name: "string",
      repo_topology: "string",
      repos: "array",
      allowed_providers: "array",
      allowed_adapters: "array",
      registry_roots: "object",
      default_route_profiles: "object",
      default_step_policies: "object",
      default_wrapper_profiles: "object",
      default_prompt_bundles: "object",
      default_context_bundles: "object",
      default_skill_profiles: "object",
      skill_overrides: "object",
      budget_policy: "object",
      approval_policy: "object",
      security_policy: "object",
      runtime_defaults: "object",
      writeback_policy: "object",
    },
    enumChecks: [],
  },
  {
    family: "project-analysis-report",
    familyGroup: "core-packets-and-profiles",
    sourceContract: "docs/contracts/project-analysis-report.md",
    exampleGlob: "examples/project-analysis-report.sample.yaml",
    status: "implemented",
    requiredFields: [
      "report_id",
      "project_id",
      "version",
      "generated_from",
      "repo_facts",
      "toolchain_facts",
      "command_catalog",
      "route_resolution",
      "asset_resolution",
      "policy_resolution",
      "evaluation_registry",
      "verification_plan",
      "status",
    ],
    fieldTypes: {
      report_id: "string",
      project_id: "string",
      version: "number",
      generated_from: "object",
      repo_facts: "object",
      toolchain_facts: "object",
      command_catalog: "object",
      route_resolution: "object",
      asset_resolution: "object",
      policy_resolution: "object",
      evaluation_registry: "object",
      verification_plan: "object",
      status: "string",
    },
    enumChecks: [],
  },
  {
    family: "artifact-packet",
    familyGroup: "core-packets-and-profiles",
    sourceContract: "docs/contracts/artifact-packet.md",
    exampleGlob: "none",
    status: "implemented",
    requiredFields: ["packet_id", "project_id", "packet_type", "version", "status", "summary", "body_ref"],
    fieldTypes: {
      packet_id: "string",
      project_id: "string",
      packet_type: "string",
      version: "number",
      status: "string",
      summary: "string",
      body_ref: "string",
    },
    enumChecks: [],
  },
  {
    family: "wave-ticket",
    familyGroup: "core-packets-and-profiles",
    sourceContract: "docs/contracts/wave-ticket.md",
    exampleGlob: "examples/packets/wave-ticket-*.yaml",
    status: "implemented",
    requiredFields: [
      "ticket_id",
      "project_id",
      "objective",
      "scope",
      "dependencies",
      "risk_tier",
      "status",
      "approved_input_ref",
    ],
    fieldTypes: {
      ticket_id: "string",
      project_id: "string",
      objective: "string",
      scope: "object",
      dependencies: "array",
      risk_tier: "string",
      status: "string",
      approved_input_ref: "string",
    },
    enumChecks: [],
  },
  {
    family: "handoff-packet",
    familyGroup: "core-packets-and-profiles",
    sourceContract: "docs/contracts/handoff-packet.md",
    exampleGlob: "examples/packets/handoff-*.yaml",
    status: "implemented",
    requiredFields: [
      "packet_id",
      "project_id",
      "ticket_id",
      "version",
      "status",
      "risk_tier",
      "approved_objective",
      "repo_scopes",
      "allowed_paths",
      "allowed_commands",
      "verification_plan",
      "scope_constraints",
      "command_policy",
      "writeback_mode",
      "approval_state",
    ],
    fieldTypes: {
      packet_id: "string",
      project_id: "string",
      ticket_id: "string",
      version: "number",
      status: "string",
      risk_tier: "string",
      approved_objective: "string",
      repo_scopes: "array",
      allowed_paths: "array",
      allowed_commands: "array",
      verification_plan: "object",
      scope_constraints: "object",
      command_policy: "object",
      writeback_mode: "string",
      approval_state: "object",
    },
    enumChecks: [],
  },
  {
    family: "release-packet",
    familyGroup: "core-packets-and-profiles",
    sourceContract: "docs/contracts/release-packet.md",
    exampleGlob: "examples/packets/release-*.yaml",
    status: "implemented",
    requiredFields: [
      "packet_id",
      "project_id",
      "ticket_id",
      "run_refs",
      "change_summary",
      "verification_refs",
      "delivery_manifest_ref",
      "evidence_lineage",
      "status",
      "created_at",
    ],
    fieldTypes: {
      packet_id: "string",
      project_id: "string",
      ticket_id: "string",
      run_refs: "array",
      change_summary: "string",
      verification_refs: "array",
      delivery_manifest_ref: "string",
      evidence_lineage: "object",
      status: "string",
      created_at: "string",
    },
    enumChecks: [],
  },
  {
    family: "delivery-plan",
    familyGroup: "core-packets-and-profiles",
    sourceContract: "docs/contracts/delivery-plan.md",
    exampleGlob: "examples/packets/delivery-plan-*.yaml",
    status: "implemented",
    requiredFields: [
      "plan_id",
      "project_id",
      "run_id",
      "step_class",
      "delivery_mode",
      "mode_source",
      "preconditions",
      "writeback_allowed",
      "blocking_reasons",
      "status",
      "evidence_refs",
      "created_at",
    ],
    fieldTypes: {
      plan_id: "string",
      project_id: "string",
      run_id: "string",
      step_class: "string",
      delivery_mode: "string",
      mode_source: "object",
      preconditions: "object",
      writeback_allowed: "boolean",
      blocking_reasons: "array",
      status: "string",
      evidence_refs: "array",
      created_at: "string",
    },
    enumChecks: [
      { field: "delivery_mode", allowedValues: DELIVERY_MODE_VALUES },
      { field: "status", allowedValues: DELIVERY_PLAN_STATUS_VALUES },
    ],
  },
  {
    family: "delivery-manifest",
    familyGroup: "core-packets-and-profiles",
    sourceContract: "docs/contracts/delivery-manifest.md",
    exampleGlob: "examples/delivery-manifest*.yaml",
    status: "implemented",
    requiredFields: [
      "manifest_id",
      "project_id",
      "ticket_id",
      "run_refs",
      "step_ref",
      "delivery_mode",
      "writeback_policy",
      "repo_deliveries",
      "verification_refs",
      "approval_context",
      "evidence_root",
      "source_refs",
      "status",
      "created_at",
    ],
    fieldTypes: {
      manifest_id: "string",
      project_id: "string",
      ticket_id: "string",
      run_refs: "array",
      step_ref: "string",
      delivery_mode: "string",
      writeback_policy: "object",
      repo_deliveries: "array",
      verification_refs: "array",
      approval_context: "object",
      evidence_root: "string",
      source_refs: "object",
      status: "string",
      created_at: "string",
    },
    enumChecks: [],
  },
  {
    family: "incident-report",
    familyGroup: "core-packets-and-profiles",
    sourceContract: "docs/contracts/incident-report.md",
    exampleGlob: "none",
    status: "implemented",
    requiredFields: ["incident_id", "project_id", "severity", "summary", "linked_run_refs", "linked_asset_refs", "status"],
    fieldTypes: {
      incident_id: "string",
      project_id: "string",
      severity: "string",
      summary: "string",
      linked_run_refs: "array",
      linked_asset_refs: "array",
      status: "string",
    },
    enumChecks: [],
  },
  {
    family: "step-result",
    familyGroup: "execution-and-quality",
    sourceContract: "docs/contracts/step-result.md",
    exampleGlob: "none",
    status: "implemented",
    requiredFields: ["step_result_id", "run_id", "step_id", "step_class", "status", "summary", "evidence_refs"],
    fieldTypes: {
      step_result_id: "string",
      run_id: "string",
      step_id: "string",
      step_class: "string",
      status: "string",
      summary: "string",
      evidence_refs: "array",
    },
    enumChecks: [{ field: "step_class", allowedValues: STEP_CLASS_VALUES }],
  },
  {
    family: "validation-report",
    familyGroup: "execution-and-quality",
    sourceContract: "docs/contracts/validation-report.md",
    exampleGlob: "none",
    status: "implemented",
    requiredFields: ["report_id", "subject_ref", "validators", "status", "evidence_refs"],
    fieldTypes: {
      report_id: "string",
      subject_ref: "string",
      validators: "array",
      status: "string",
      evidence_refs: "array",
    },
    enumChecks: [],
  },
  {
    family: "evaluation-report",
    familyGroup: "execution-and-quality",
    sourceContract: "docs/contracts/evaluation-report.md",
    exampleGlob: "examples/eval/report-*.sample.yaml",
    status: "implemented",
    requiredFields: [
      "report_id",
      "subject_ref",
      "subject_type",
      "subject_fingerprint",
      "suite_ref",
      "dataset_ref",
      "scorer_metadata",
      "grader_results",
      "summary_metrics",
      "status",
      "evidence_refs",
    ],
    fieldTypes: {
      report_id: "string",
      subject_ref: "string",
      subject_type: "string",
      subject_fingerprint: "string",
      suite_ref: "string",
      dataset_ref: "string",
      scorer_metadata: "array",
      grader_results: "object",
      summary_metrics: "object",
      status: "string",
      evidence_refs: "array",
    },
    enumChecks: [],
  },
  {
    family: "dataset",
    familyGroup: "execution-and-quality",
    sourceContract: "docs/contracts/dataset.md",
    exampleGlob: "examples/eval/dataset-*.yaml",
    status: "implemented",
    requiredFields: ["dataset_id", "version", "subject_type", "provenance", "cases"],
    fieldTypes: {
      dataset_id: "string",
      version: "string",
      subject_type: "string",
      provenance: "object",
      cases: "array",
    },
    enumChecks: [],
  },
  {
    family: "evaluation-suite",
    familyGroup: "execution-and-quality",
    sourceContract: "docs/contracts/evaluation-suite.md",
    exampleGlob: "examples/eval/suite-*.yaml",
    status: "implemented",
    requiredFields: ["suite_id", "version", "subject_type", "dataset_ref", "graders", "thresholds"],
    fieldTypes: {
      suite_id: "string",
      version: "number",
      subject_type: "string",
      dataset_ref: "string",
      graders: "array",
      thresholds: "object",
    },
    enumChecks: [],
  },
  {
    family: "promotion-decision",
    familyGroup: "execution-and-quality",
    sourceContract: "docs/contracts/promotion-decision.md",
    exampleGlob: "examples/packets/promotion-decision-*.yaml",
    status: "implemented",
    requiredFields: [
      "decision_id",
      "subject_ref",
      "from_channel",
      "to_channel",
      "evidence_refs",
      "evidence_summary",
      "status",
    ],
    fieldTypes: {
      decision_id: "string",
      subject_ref: "string",
      from_channel: "string",
      to_channel: "string",
      evidence_refs: "array",
      evidence_summary: "object",
      status: "string",
    },
    enumChecks: [
      { field: "from_channel", allowedValues: PROMOTION_CHANNEL_VALUES },
      { field: "to_channel", allowedValues: PROMOTION_CHANNEL_VALUES },
      { field: "status", allowedValues: ["pass", "hold", "fail"] },
    ],
  },
  {
    family: "compiled-context-artifact",
    familyGroup: "execution-and-quality",
    sourceContract: "docs/contracts/compiled-context-artifact.md",
    exampleGlob: "examples/context/compiled/*.yaml",
    status: "implemented",
    requiredFields: [
      "compiled_context_id",
      "version",
      "step",
      "prompt_bundle_ref",
      "context_bundle_refs",
      "context_doc_refs",
      "context_rule_refs",
      "context_skill_refs",
      "packet_refs",
      "hashes",
      "provenance",
    ],
    fieldTypes: {
      compiled_context_id: "string",
      version: "number",
      step: "string",
      prompt_bundle_ref: "string",
      context_bundle_refs: "array",
      context_doc_refs: "array",
      context_rule_refs: "array",
      context_skill_refs: "array",
      packet_refs: "array",
      hashes: "object",
      provenance: "object",
    },
    enumChecks: [],
  },
  {
    family: "provider-route-profile",
    familyGroup: "platform-assets",
    sourceContract: "docs/contracts/provider-route-profile.md",
    exampleGlob: "examples/routes/*.yaml",
    status: "implemented",
    requiredFields: ["route_id", "step", "route_class", "risk_tier", "primary"],
    forbiddenFields: ["wrapper_profile_ref"],
    fieldTypes: {
      route_id: "string",
      step: "string",
      route_class: "string",
      risk_tier: "string",
      primary: "object",
    },
    enumChecks: [],
  },
  {
    family: "wrapper-profile",
    familyGroup: "platform-assets",
    sourceContract: "docs/contracts/wrapper-profile.md",
    exampleGlob: "examples/wrappers/*.yaml",
    status: "implemented",
    requiredFields: ["wrapper_id", "version", "step_class", "tool_policy", "command_policy"],
    forbiddenFields: ["prompt_bundle_ref", "session_bootstrap"],
    fieldTypes: {
      wrapper_id: "string",
      version: "number",
      step_class: "string",
      tool_policy: "object",
      command_policy: "object",
    },
    enumChecks: [{ field: "step_class", allowedValues: STEP_CLASS_VALUES }],
  },
  {
    family: "prompt-bundle",
    familyGroup: "platform-assets",
    sourceContract: "docs/contracts/prompt-bundle.md",
    exampleGlob: "examples/prompts/*.yaml",
    status: "implemented",
    requiredFields: ["prompt_bundle_id", "version", "step_class", "objective", "instructions", "required_inputs"],
    fieldTypes: {
      prompt_bundle_id: "string",
      version: "number",
      step_class: "string",
      objective: "string",
      instructions: "object",
      required_inputs: "object",
    },
    enumChecks: [{ field: "step_class", allowedValues: STEP_CLASS_VALUES }],
  },
  {
    family: "context-doc",
    familyGroup: "platform-assets",
    sourceContract: "docs/contracts/context-doc.md",
    exampleGlob: "examples/context/docs/*.yaml",
    status: "implemented",
    requiredFields: ["context_doc_id", "version", "title", "metadata", "source", "applies_to"],
    fieldTypes: {
      context_doc_id: "string",
      version: "number",
      title: "string",
      metadata: "object",
      source: "object",
      applies_to: "object",
    },
    enumChecks: [],
  },
  {
    family: "context-rule",
    familyGroup: "platform-assets",
    sourceContract: "docs/contracts/context-rule.md",
    exampleGlob: "examples/context/rules/*.yaml",
    status: "implemented",
    requiredFields: ["context_rule_id", "version", "title", "metadata", "instruction", "source_refs", "applies_to"],
    fieldTypes: {
      context_rule_id: "string",
      version: "number",
      title: "string",
      metadata: "object",
      instruction: "string",
      source_refs: "array",
      applies_to: "object",
    },
    enumChecks: [],
  },
  {
    family: "context-skill",
    familyGroup: "platform-assets",
    sourceContract: "docs/contracts/context-skill.md",
    exampleGlob: "examples/context/skills/*.yaml",
    status: "implemented",
    requiredFields: [
      "context_skill_id",
      "version",
      "title",
      "metadata",
      "objective",
      "workflow",
      "source_refs",
      "applies_to",
    ],
    fieldTypes: {
      context_skill_id: "string",
      version: "number",
      title: "string",
      metadata: "object",
      objective: "string",
      workflow: "object",
      source_refs: "array",
      applies_to: "object",
    },
    enumChecks: [],
  },
  {
    family: "context-bundle",
    familyGroup: "platform-assets",
    sourceContract: "docs/contracts/context-bundle.md",
    exampleGlob: "examples/context/bundles/*.yaml",
    status: "implemented",
    requiredFields: [
      "context_bundle_id",
      "version",
      "title",
      "metadata",
      "applies_to",
      "context_doc_refs",
      "context_rule_refs",
      "context_skill_refs",
      "source_refs",
      "selection_policy",
    ],
    fieldTypes: {
      context_bundle_id: "string",
      version: "number",
      title: "string",
      metadata: "object",
      applies_to: "object",
      context_doc_refs: "array",
      context_rule_refs: "array",
      context_skill_refs: "array",
      source_refs: "array",
      selection_policy: "object",
    },
    enumChecks: [],
  },
  {
    family: "step-policy-profile",
    familyGroup: "platform-assets",
    sourceContract: "docs/contracts/step-policy-profile.md",
    exampleGlob: "examples/policies/*.yaml",
    status: "implemented",
    requiredFields: ["policy_id", "step_class", "pre_validators", "post_validators", "quality_gate"],
    fieldTypes: {
      policy_id: "string",
      step_class: "string",
      pre_validators: "array",
      post_validators: "array",
      quality_gate: "object",
    },
    enumChecks: [{ field: "step_class", allowedValues: STEP_CLASS_VALUES }],
  },
  {
    family: "adapter-capability-profile",
    familyGroup: "platform-assets",
    sourceContract: "docs/contracts/adapter-capability-profile.md",
    exampleGlob: "examples/adapters/*.yaml",
    status: "implemented",
    requiredFields: ["adapter_id", "version", "capabilities", "constraints"],
    fieldTypes: {
      adapter_id: "string",
      version: "number",
      capabilities: "object",
      constraints: "object",
    },
    enumChecks: [],
  },
  {
    family: "skill-profile",
    familyGroup: "platform-assets",
    sourceContract: "docs/contracts/skill-profile.md",
    exampleGlob: "examples/skills/*.yaml",
    status: "implemented",
    requiredFields: ["skill_id", "version", "step_class", "summary", "workflow"],
    fieldTypes: {
      skill_id: "string",
      version: "number",
      step_class: "string",
      summary: "string",
      workflow: "array",
    },
    enumChecks: [{ field: "step_class", allowedValues: STEP_CLASS_VALUES }],
  },
  {
    family: "live-run-event",
    familyGroup: "operations",
    sourceContract: "docs/contracts/live-run-event.md",
    exampleGlob: "none",
    status: "implemented",
    requiredFields: ["event_id", "run_id", "timestamp", "event_type", "payload"],
    fieldTypes: {
      event_id: "string",
      run_id: "string",
      timestamp: "string",
      event_type: "string",
      payload: "object",
    },
    enumChecks: [{ field: "event_type", allowedValues: LIVE_RUN_EVENT_TYPE_VALUES }],
  },
  {
    family: "live-e2e-profile",
    familyGroup: "operations",
    sourceContract: "docs/contracts/live-e2e-profile.md",
    exampleGlob: "examples/live-e2e/*.yaml",
    status: "implemented",
    requiredFields: [
      "profile_id",
      "version",
      "flow_kind",
      "duration_class",
      "project_profile_template_ref",
      "target_repo",
      "preflight",
      "runtime",
      "objective",
      "stages",
      "verification",
      "budgets",
      "approvals",
      "output_policy",
      "ui",
    ],
    fieldTypes: {
      profile_id: "string",
      version: "number",
      flow_kind: "string",
      duration_class: "string",
      project_profile_template_ref: "string",
      target_repo: "object",
      preflight: "object",
      runtime: "object",
      objective: "object",
      stages: "array",
      verification: "object",
      budgets: "object",
      approvals: "object",
      output_policy: "object",
      ui: "object",
    },
    enumChecks: [],
  },
  {
    family: "control-plane-api",
    familyGroup: "operations",
    sourceContract: "docs/contracts/control-plane-api.md",
    exampleGlob: "none",
    status: "limitation",
    limitation:
      "Narrative contract only in W0-S02. TODO: add a machine-loadable schema contract in a dedicated slice.",
    requiredFields: [],
    fieldTypes: {},
    enumChecks: [],
  },
]);

const EXAMPLE_FAMILY_RESOLUTION_RULES = Object.freeze([
  { regex: /^examples\/adapters\/[^/]+\.ya?ml$/, family: "adapter-capability-profile" },
  { regex: /^examples\/context\/bundles\/[^/]+\.ya?ml$/, family: "context-bundle" },
  { regex: /^examples\/context\/compiled\/[^/]+\.ya?ml$/, family: "compiled-context-artifact" },
  { regex: /^examples\/context\/docs\/[^/]+\.ya?ml$/, family: "context-doc" },
  { regex: /^examples\/context\/rules\/[^/]+\.ya?ml$/, family: "context-rule" },
  { regex: /^examples\/context\/skills\/[^/]+\.ya?ml$/, family: "context-skill" },
  { regex: /^examples\/delivery-manifest[^/]*\.ya?ml$/, family: "delivery-manifest" },
  { regex: /^examples\/packets\/delivery-plan-[^/]+\.ya?ml$/, family: "delivery-plan" },
  { regex: /^examples\/eval\/dataset-[^/]+\.ya?ml$/, family: "dataset" },
  { regex: /^examples\/eval\/report-[^/]+\.sample\.ya?ml$/, family: "evaluation-report" },
  { regex: /^examples\/eval\/suite-[^/]+\.ya?ml$/, family: "evaluation-suite" },
  { regex: /^examples\/live-e2e\/[^/]+\.ya?ml$/, family: "live-e2e-profile" },
  { regex: /^examples\/packets\/wave-ticket-[^/]+\.ya?ml$/, family: "wave-ticket" },
  { regex: /^examples\/packets\/handoff-[^/]+\.ya?ml$/, family: "handoff-packet" },
  { regex: /^examples\/packets\/promotion-decision-[^/]+\.ya?ml$/, family: "promotion-decision" },
  { regex: /^examples\/packets\/release-[^/]+\.ya?ml$/, family: "release-packet" },
  { regex: /^examples\/policies\/[^/]+\.ya?ml$/, family: "step-policy-profile" },
  { regex: /^examples\/project-analysis-report\.sample\.ya?ml$/, family: "project-analysis-report" },
  { regex: /^examples\/project[^/]*\.aor\.ya?ml$/, family: "project-profile" },
  { regex: /^examples\/prompts\/[^/]+\.ya?ml$/, family: "prompt-bundle" },
  { regex: /^examples\/routes\/[^/]+\.ya?ml$/, family: "provider-route-profile" },
  { regex: /^examples\/skills\/[^/]+\.ya?ml$/, family: "skill-profile" },
  { regex: /^examples\/wrappers\/[^/]+\.ya?ml$/, family: "wrapper-profile" },
]);

/**
 * @returns {import("./index.d.ts").ContractFamilyIndexEntry[]}
 */
export function getContractFamilyIndex() {
  return cloneJson(CONTRACT_FAMILY_INDEX);
}

/**
 * @param {{ family: import("./index.d.ts").ContractFamily, document: unknown, source?: string }} options
 * @returns {import("./index.d.ts").ContractValidationResult}
 */
export function validateContractDocument({ family, document, source = "<in-memory>" }) {
  const entry = CONTRACT_FAMILY_INDEX.find((candidate) => candidate.family === family);
  if (!entry) {
    return {
      ok: false,
      family,
      source,
      issues: [
        issue({
          code: "unknown_contract_family",
          source,
          expected: "known contract family",
          actual: String(family),
          message: `Unknown contract family '${family}'.`,
        }),
      ],
    };
  }

  if (entry.status !== "implemented") {
    return {
      ok: false,
      family,
      source,
      issues: [
        issue({
          code: "contract_family_limitation",
          source,
          expected: "implemented contract family",
          actual: entry.status,
          message: entry.limitation ?? "This contract family is intentionally not machine-loadable yet.",
        }),
      ],
    };
  }

  if (!isPlainObject(document)) {
    return {
      ok: false,
      family,
      source,
      issues: [
        issue({
          code: "document_type_invalid",
          source,
          expected: "object",
          actual: describeActualType(document),
          message: "Contract document must be a YAML mapping (object).",
        }),
      ],
    };
  }

  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];

  for (const field of entry.requiredFields) {
    if (!(field in document)) {
      issues.push(
        issue({
          code: "required_field_missing",
          source,
          field,
          expected: "present",
          actual: "missing",
          message: `Missing required field '${field}'.`,
        }),
      );
      continue;
    }

    const expectedType = entry.fieldTypes[field];
    if (!expectedType) {
      continue;
    }

    const value = document[field];
    if (!isExpectedType(value, expectedType)) {
      issues.push(
        issue({
          code: "field_type_mismatch",
          source,
          field,
          expected: expectedType,
          actual: describeActualType(value),
          message: `Field '${field}' must be '${expectedType}'.`,
        }),
      );
    }
  }

  for (const field of entry.forbiddenFields ?? []) {
    if (!(field in document)) {
      continue;
    }

    issues.push(
      issue({
        code: "unsupported_field_present",
        source,
        field,
        expected: "field omitted",
        actual: "present",
        message: `Field '${field}' is not supported in the current contract shape.`,
      }),
    );
  }

  for (const enumCheck of entry.enumChecks) {
    const value = document[enumCheck.field];
    if (typeof value !== "string") {
      continue;
    }

    if (!enumCheck.allowedValues.includes(value)) {
      issues.push(
        issue({
          code: "enum_value_invalid",
          source,
          field: enumCheck.field,
          expected: enumCheck.allowedValues.join("|"),
          actual: value,
          message: `Field '${enumCheck.field}' has unsupported value '${value}'.`,
        }),
      );
    }
  }

  return {
    ok: issues.length === 0,
    family,
    source,
    issues,
  };
}

/**
 * @param {{ filePath: string, family?: import("./index.d.ts").ContractFamily }} options
 * @returns {import("./index.d.ts").LoadedContractFile}
 */
export function loadContractFile({ filePath, family }) {
  const source = path.resolve(filePath);
  const raw = fs.readFileSync(source, "utf8");

  /** @type {unknown} */
  let document;
  try {
    document = parseYaml(raw);
  } catch (error) {
    const parseMessage = error instanceof Error ? error.message : String(error);
    const parseValidation = {
      ok: false,
      family: family ?? null,
      source,
      issues: [
        issue({
          code: "yaml_parse_error",
          source,
          expected: "valid YAML",
          actual: "parse error",
          message: parseMessage,
        }),
      ],
    };

    return {
      ok: false,
      family: family ?? null,
      source,
      document: null,
      validation: parseValidation,
    };
  }

  const resolvedFamily = family ?? inferFamilyFromExamplePath(source);
  if (!resolvedFamily) {
    const unresolvedValidation = {
      ok: false,
      family: null,
      source,
      issues: [
        issue({
          code: "unknown_contract_family",
          source,
          expected: "supported example path",
          actual: "unmapped file path",
          message: "Could not infer contract family from file path. Provide the family explicitly.",
        }),
      ],
    };

    return {
      ok: false,
      family: null,
      source,
      document,
      validation: unresolvedValidation,
    };
  }

  const validation = validateContractDocument({ family: resolvedFamily, document, source });
  return {
    ok: validation.ok,
    family: resolvedFamily,
    source,
    document,
    validation,
  };
}

/**
 * @param {{ workspaceRoot?: string, examplesRoot?: string }} [options]
 * @returns {import("./index.d.ts").LoadedExampleContracts}
 */
export function loadExampleContracts(options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const examplesRoot = path.resolve(workspaceRoot, options.examplesRoot ?? "examples");
  const files = collectYamlFiles(examplesRoot).sort();

  /** @type {import("./index.d.ts").LoadedContractFile[]} */
  const results = [];
  for (const filePath of files) {
    const family = inferFamilyFromExamplePath(filePath);
    results.push(loadContractFile({ filePath, family: family ?? undefined }));
  }

  const issues = results.flatMap((result) => result.validation.issues);
  return {
    ok: issues.length === 0,
    workspaceRoot,
    examplesRoot,
    results,
    issues,
  };
}

/**
 * @param {{ workspaceRoot?: string, examplesRoot?: string }} [options]
 * @returns {import("./index.d.ts").ReferenceValidationResult}
 */
export function validateExampleReferences(options = {}) {
  const loaded = loadExampleContracts(options);
  const registry = buildReferenceRegistry(loaded.results, loaded.workspaceRoot);
  /** @type {import("./index.d.ts").ReferenceValidationIssue[]} */
  const issues = [];
  let checkedReferences = 0;

  for (const result of loaded.results) {
    if (!result.ok || !result.family || !isPlainObject(result.document)) {
      continue;
    }

    const document = result.document;
    const source = result.source;

    if (result.family === "project-profile") {
      const defaultRouteProfiles = document.default_route_profiles;
      if (isPlainObject(defaultRouteProfiles)) {
        for (const [key, rawValue] of Object.entries(defaultRouteProfiles)) {
          checkedReferences += 1;
          const field = `default_route_profiles.${key}`;
          const reference = asReferenceString(rawValue, { issues, source, field });
          if (!reference || isExternalReference(reference)) continue;
          validateReferenceTarget({
            issues,
            source,
            field,
            reference,
            expected: "existing route_id",
            expectedFamily: "provider-route-profile",
            expectedSet: registry.routeIds,
            registry,
          });
        }
      }

      const defaultWrapperProfiles = document.default_wrapper_profiles;
      if (isPlainObject(defaultWrapperProfiles)) {
        for (const [key, rawValue] of Object.entries(defaultWrapperProfiles)) {
          checkedReferences += 1;
          const field = `default_wrapper_profiles.${key}`;
          const reference = asReferenceString(rawValue, { issues, source, field });
          if (!reference || isExternalReference(reference)) continue;
          if (!isVersionedRef(reference)) {
            issues.push(
              referenceIssue({
                code: "reference_format_invalid",
                source,
                field,
                reference,
                expected: "wrapper_id@vN",
                actual: reference,
                message: `Field '${field}' must use wrapper_id@vN format.`,
              }),
            );
            continue;
          }
          validateReferenceTarget({
            issues,
            source,
            field,
            reference,
            expected: "existing wrapper_id@vN",
            expectedFamily: "wrapper-profile",
            expectedSet: registry.wrapperRefs,
            registry,
          });
        }
      }

      const defaultStepPolicies = document.default_step_policies;
      if (isPlainObject(defaultStepPolicies)) {
        for (const [key, rawValue] of Object.entries(defaultStepPolicies)) {
          checkedReferences += 1;
          const field = `default_step_policies.${key}`;
          const reference = asReferenceString(rawValue, { issues, source, field });
          if (!reference || isExternalReference(reference)) continue;
          validateReferenceTarget({
            issues,
            source,
            field,
            reference,
            expected: "existing policy_id",
            expectedFamily: "step-policy-profile",
            expectedSet: registry.policyIds,
            registry,
          });
        }
      }

      const defaultReleaseSuiteRef = document.eval_policy?.default_release_suite_ref;
      if (defaultReleaseSuiteRef !== undefined) {
        checkedReferences += 1;
        const field = "eval_policy.default_release_suite_ref";
        const reference = asReferenceString(defaultReleaseSuiteRef, { issues, source, field });
        if (reference && !isExternalReference(reference)) {
          if (!isVersionedRef(reference)) {
            issues.push(
              referenceIssue({
                code: "reference_format_invalid",
                source,
                field,
                reference,
                expected: "suite_id@vN",
                actual: reference,
                message: "default_release_suite_ref must use suite_id@vN format.",
              }),
            );
          } else {
            validateReferenceTarget({
              issues,
              source,
              field,
              reference,
              expected: "existing suite_id@vN",
              expectedFamily: "evaluation-suite",
              expectedSet: registry.suiteRefs,
              registry,
            });
          }
        }
      }

      const liveE2eProfiles = document.live_e2e_defaults?.profiles;
      if (isPlainObject(liveE2eProfiles)) {
        for (const [key, rawValue] of Object.entries(liveE2eProfiles)) {
          checkedReferences += 1;
          const field = `live_e2e_defaults.profiles.${key}`;
          const reference = asReferenceString(rawValue, { issues, source, field });
          if (!reference || isExternalReference(reference)) continue;
          if (!isVersionedRef(reference)) {
            issues.push(
              referenceIssue({
                code: "reference_format_invalid",
                source,
                field,
                reference,
                expected: "profile_id@vN",
                actual: reference,
                message: `Field '${field}' must use profile_id@vN format.`,
              }),
            );
            continue;
          }
          validateReferenceTarget({
            issues,
            source,
            field,
            reference,
            expected: "existing profile_id@vN",
            expectedFamily: "live-e2e-profile",
            expectedSet: registry.liveE2eProfileRefs,
            registry,
          });
        }
      }
    }

    if (result.family === "provider-route-profile") {
      checkedReferences += 1;
      const field = "wrapper_profile_ref";
      const reference = asReferenceString(document.wrapper_profile_ref, { issues, source, field });
      if (reference && !isExternalReference(reference)) {
        if (!isVersionedRef(reference)) {
          issues.push(
            referenceIssue({
              code: "reference_format_invalid",
              source,
              field,
              reference,
              expected: "wrapper_id@vN",
              actual: reference,
              message: "wrapper_profile_ref must use wrapper_id@vN format.",
            }),
          );
        } else {
          validateReferenceTarget({
            issues,
            source,
            field,
            reference,
            expected: "existing wrapper_id@vN",
            expectedFamily: "wrapper-profile",
            expectedSet: registry.wrapperRefs,
            registry,
          });
        }
      }
    }

    if (result.family === "wrapper-profile") {
      checkedReferences += 1;
      const field = "prompt_bundle_ref";
      const reference = asReferenceString(document.prompt_bundle_ref, { issues, source, field });
      if (reference && !isExternalReference(reference)) {
        if (!isPromptBundleRef(reference)) {
          issues.push(
            referenceIssue({
              code: "reference_format_invalid",
              source,
              field,
              reference,
              expected: "prompt-bundle://prompt_bundle_id@vN",
              actual: reference,
              message: "prompt_bundle_ref must use prompt-bundle://prompt_bundle_id@vN format.",
            }),
          );
        } else {
          validateReferenceTarget({
            issues,
            source,
            field,
            reference,
            expected: "existing prompt-bundle://prompt_bundle_id@vN",
            expectedFamily: "prompt-bundle",
            expectedSet: registry.promptBundleRefs,
            registry,
          });
        }
      }
    }

    if (result.family === "evaluation-suite") {
      checkedReferences += 1;
      const field = "dataset_ref";
      const reference = asReferenceString(document.dataset_ref, { issues, source, field });
      if (reference && !isExternalReference(reference)) {
        if (!isDatasetRef(reference)) {
          issues.push(
            referenceIssue({
              code: "reference_format_invalid",
              source,
              field,
              reference,
              expected: "dataset://dataset_id@version",
              actual: reference,
              message: "dataset_ref must use dataset://dataset_id@version format.",
            }),
          );
        } else {
          validateReferenceTarget({
            issues,
            source,
            field,
            reference,
            expected: "existing dataset://dataset_id@version",
            expectedFamily: "dataset",
            expectedSet: registry.datasetRefs,
            registry,
          });
        }
      }
    }

    if (result.family === "step-policy-profile") {
      const suiteRef = document.quality_gate?.suite_ref;
      if (suiteRef !== undefined) {
        checkedReferences += 1;
        const field = "quality_gate.suite_ref";
        const reference = asReferenceString(suiteRef, { issues, source, field });
        if (reference && !isExternalReference(reference)) {
          if (!isVersionedRef(reference)) {
            issues.push(
              referenceIssue({
                code: "reference_format_invalid",
                source,
                field,
                reference,
                expected: "suite_id@vN",
                actual: reference,
                message: "quality_gate.suite_ref must use suite_id@vN format.",
              }),
            );
          } else {
            validateReferenceTarget({
              issues,
              source,
              field,
              reference,
              expected: "existing suite_id@vN",
              expectedFamily: "evaluation-suite",
              expectedSet: registry.suiteRefs,
              registry,
            });
          }
        }
      }
    }

    if (result.family === "prompt-bundle") {
      const defaultSuiteRefs = document.certification_hints?.default_suite_refs;
      if (Array.isArray(defaultSuiteRefs)) {
        defaultSuiteRefs.forEach((rawValue, index) => {
          checkedReferences += 1;
          const field = `certification_hints.default_suite_refs[${index}]`;
          const reference = asReferenceString(rawValue, { issues, source, field });
          if (!reference || isExternalReference(reference)) return;
          if (!isVersionedRef(reference)) {
            issues.push(
              referenceIssue({
                code: "reference_format_invalid",
                source,
                field,
                reference,
                expected: "suite_id@vN",
                actual: reference,
                message: `${field} must use suite_id@vN format.`,
              }),
            );
            return;
          }
          validateReferenceTarget({
            issues,
            source,
            field,
            reference,
            expected: "existing suite_id@vN",
            expectedFamily: "evaluation-suite",
            expectedSet: registry.suiteRefs,
            registry,
          });
        });
      }
    }

    if (result.family === "live-e2e-profile") {
      checkedReferences += 1;
      const projectProfileField = "project_profile_template_ref";
      const projectProfileRef = asReferenceString(document.project_profile_template_ref, {
        issues,
        source,
        field: projectProfileField,
      });
      if (projectProfileRef && !isExternalReference(projectProfileRef)) {
        const resolvedProjectProfilePath = path.resolve(loaded.workspaceRoot, projectProfileRef);
        if (!fs.existsSync(resolvedProjectProfilePath)) {
          issues.push(
            referenceIssue({
              code: "reference_target_missing",
              source,
              field: projectProfileField,
              reference: projectProfileRef,
              expected: "existing project-profile file",
              actual: "missing file",
              message: `Referenced project profile file '${projectProfileRef}' does not exist.`,
            }),
          );
        } else {
          const loadedProjectProfile = loadContractFile({ filePath: resolvedProjectProfilePath });
          if (loadedProjectProfile.family !== "project-profile") {
            issues.push(
              referenceIssue({
                code: "reference_target_type_mismatch",
                source,
                field: projectProfileField,
                reference: projectProfileRef,
                expected: "project-profile",
                actual: loadedProjectProfile.family ?? "unknown",
                message: `Reference '${projectProfileRef}' does not point to a project-profile example.`,
              }),
            );
          }
        }
      }

      const evalSuites = document.verification?.eval_suites;
      if (Array.isArray(evalSuites)) {
        evalSuites.forEach((rawValue, index) => {
          checkedReferences += 1;
          const field = `verification.eval_suites[${index}]`;
          const reference = asReferenceString(rawValue, { issues, source, field });
          if (!reference || isExternalReference(reference)) return;
          if (!isVersionedRef(reference)) {
            issues.push(
              referenceIssue({
                code: "reference_format_invalid",
                source,
                field,
                reference,
                expected: "suite_id@vN",
                actual: reference,
                message: `${field} must use suite_id@vN format.`,
              }),
            );
            return;
          }
          validateReferenceTarget({
            issues,
            source,
            field,
            reference,
            expected: "existing suite_id@vN",
            expectedFamily: "evaluation-suite",
            expectedSet: registry.suiteRefs,
            registry,
          });
        });
      }
    }
  }

  return {
    ok: issues.length === 0,
    workspaceRoot: loaded.workspaceRoot,
    examplesRoot: loaded.examplesRoot,
    checkedReferences,
    issues,
  };
}

/**
 * @param {string} filePath
 * @returns {import("./index.d.ts").ContractFamily | null}
 */
function inferFamilyFromExamplePath(filePath) {
  const absolutePath = normalizePath(path.resolve(filePath));
  const marker = "/examples/";
  const markerIndex = absolutePath.lastIndexOf(marker);
  const normalized = markerIndex >= 0 ? absolutePath.slice(markerIndex + 1) : normalizePath(filePath);
  for (const rule of EXAMPLE_FAMILY_RESOLUTION_RULES) {
    if (rule.regex.test(normalized)) {
      return rule.family;
    }
  }
  return null;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function collectYamlFiles(root) {
  /** @type {string[]} */
  const files = [];
  /** @type {string[]} */
  const pending = [root];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }

    for (const dirent of fs.readdirSync(current, { withFileTypes: true })) {
      const childPath = path.join(current, dirent.name);
      if (dirent.isDirectory()) {
        pending.push(childPath);
        continue;
      }

      if (dirent.isFile() && /\.ya?ml$/i.test(dirent.name)) {
        files.push(childPath);
      }
    }
  }

  return files;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @param {import("./index.d.ts").ContractFieldType} expectedType
 * @returns {boolean}
 */
function isExpectedType(value, expectedType) {
  switch (expectedType) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return isPlainObject(value);
    default:
      return false;
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function describeActualType(value) {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

/**
 * @param {{ code: import("./index.d.ts").ContractValidationIssueCode, source: string, field?: string, expected?: string, actual?: string, message: string }} params
 * @returns {import("./index.d.ts").ContractValidationIssue}
 */
function issue({ code, source, field = null, expected = null, actual = null, message }) {
  return {
    code,
    source,
    field,
    expected,
    actual,
    message,
  };
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * @param {unknown} value
 * @param {{ issues: import("./index.d.ts").ReferenceValidationIssue[], source: string, field: string }} options
 * @returns {string | null}
 */
function asReferenceString(value, { issues, source, field }) {
  if (typeof value === "string") {
    return value;
  }

  issues.push(
    referenceIssue({
      code: "reference_format_invalid",
      source,
      field,
      reference: null,
      expected: "string reference",
      actual: describeActualType(value),
      message: `Field '${field}' must be a string reference.`,
    }),
  );
  return null;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isExternalReference(value) {
  return EXTERNAL_REFERENCE_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isVersionedRef(value) {
  return /^[A-Za-z0-9._-]+@v\d+$/.test(value);
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isPromptBundleRef(value) {
  return /^prompt-bundle:\/\/[A-Za-z0-9._-]+@v\d+$/.test(value);
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isDatasetRef(value) {
  return /^dataset:\/\/[A-Za-z0-9._-]+@[^@\s]+$/.test(value);
}

/**
 * @param {import("./index.d.ts").LoadedContractFile[]} results
 * @param {string} workspaceRoot
 * @returns {{
 *   routeIds: Set<string>,
 *   wrapperRefs: Set<string>,
 *   policyIds: Set<string>,
 *   suiteRefs: Set<string>,
 *   datasetRefs: Set<string>,
 *   liveE2eProfileRefs: Set<string>,
 *   promptBundleRefs: Set<string>,
 *   knownReferenceFamilies: Map<string, Set<import("./index.d.ts").ContractFamily>>,
 * }}
 */
function buildReferenceRegistry(results, workspaceRoot) {
  const routeIds = new Set();
  const wrapperRefs = new Set();
  const policyIds = new Set();
  const suiteRefs = new Set();
  const datasetRefs = new Set();
  const liveE2eProfileRefs = new Set();
  const promptBundleRefs = new Set();
  /** @type {Map<string, Set<import("./index.d.ts").ContractFamily>>} */
  const knownReferenceFamilies = new Map();

  for (const result of results) {
    if (!result.ok || !result.family || !isPlainObject(result.document)) {
      continue;
    }

    const document = result.document;
    switch (result.family) {
      case "provider-route-profile": {
        const routeId = document.route_id;
        if (typeof routeId === "string") {
          routeIds.add(routeId);
          registerKnownReference(knownReferenceFamilies, routeId, "provider-route-profile");
        }
        break;
      }
      case "wrapper-profile": {
        const wrapperId = document.wrapper_id;
        const version = document.version;
        if (typeof wrapperId === "string" && typeof version === "number") {
          const wrapperRef = `${wrapperId}@v${version}`;
          wrapperRefs.add(wrapperRef);
          registerKnownReference(knownReferenceFamilies, wrapperRef, "wrapper-profile");
        }
        break;
      }
      case "step-policy-profile": {
        const policyId = document.policy_id;
        if (typeof policyId === "string") {
          policyIds.add(policyId);
          registerKnownReference(knownReferenceFamilies, policyId, "step-policy-profile");
        }
        break;
      }
      case "evaluation-suite": {
        const suiteId = document.suite_id;
        const version = document.version;
        if (typeof suiteId === "string" && typeof version === "number") {
          const suiteRef = `${suiteId}@v${version}`;
          suiteRefs.add(suiteRef);
          registerKnownReference(knownReferenceFamilies, suiteRef, "evaluation-suite");
        }
        break;
      }
      case "dataset": {
        const datasetId = document.dataset_id;
        const version = document.version;
        if (typeof datasetId === "string" && typeof version === "string") {
          const datasetRef = `dataset://${datasetId}@${version}`;
          datasetRefs.add(datasetRef);
          registerKnownReference(knownReferenceFamilies, datasetRef, "dataset");
        }
        break;
      }
      case "live-e2e-profile": {
        const profileId = document.profile_id;
        const version = document.version;
        if (typeof profileId === "string" && typeof version === "number") {
          const profileRef = `${profileId}@v${version}`;
          liveE2eProfileRefs.add(profileRef);
          registerKnownReference(knownReferenceFamilies, profileRef, "live-e2e-profile");
        }
        break;
      }
      case "prompt-bundle": {
        const bundleId = document.prompt_bundle_id;
        const version = document.version;
        if (typeof bundleId === "string" && typeof version === "number") {
          const bundleRef = `prompt-bundle://${bundleId}@v${version}`;
          promptBundleRefs.add(bundleRef);
          registerKnownReference(knownReferenceFamilies, bundleRef, "prompt-bundle");
        }
        break;
      }
      case "project-profile": {
        const relativePath = normalizePath(path.relative(workspaceRoot, result.source));
        registerKnownReference(knownReferenceFamilies, relativePath, "project-profile");
        break;
      }
      default:
        break;
    }
  }

  return {
    routeIds,
    wrapperRefs,
    policyIds,
    suiteRefs,
    datasetRefs,
    liveE2eProfileRefs,
    promptBundleRefs,
    knownReferenceFamilies,
  };
}

/**
 * @param {{
 *   issues: import("./index.d.ts").ReferenceValidationIssue[],
 *   source: string,
 *   field: string,
 *   reference: string,
 *   expected: string,
 *   expectedFamily: import("./index.d.ts").ContractFamily,
 *   expectedSet: Set<string>,
 *   registry: { knownReferenceFamilies: Map<string, Set<import("./index.d.ts").ContractFamily>> }
 * }} params
 */
function validateReferenceTarget({ issues, source, field, reference, expected, expectedFamily, expectedSet, registry }) {
  if (expectedSet.has(reference)) {
    return;
  }

  const knownFamilies = registry.knownReferenceFamilies.get(reference);
  if (knownFamilies && knownFamilies.size > 0 && !knownFamilies.has(expectedFamily)) {
    issues.push(
      referenceIssue({
        code: "reference_target_type_mismatch",
        source,
        field,
        reference,
        expected: expectedFamily,
        actual: [...knownFamilies].join("|"),
        message: `Reference '${reference}' resolves to a different family than expected.`,
      }),
    );
    return;
  }

  issues.push(
    referenceIssue({
      code: "reference_target_missing",
      source,
      field,
      reference,
      expected,
      actual: "missing target",
      message: `Reference '${reference}' does not resolve to ${expected}.`,
    }),
  );
}

/**
 * @param {Map<string, Set<import("./index.d.ts").ContractFamily>>} registry
 * @param {string} reference
 * @param {import("./index.d.ts").ContractFamily} family
 */
function registerKnownReference(registry, reference, family) {
  const knownFamilies = registry.get(reference);
  if (knownFamilies) {
    knownFamilies.add(family);
    return;
  }
  registry.set(reference, new Set([family]));
}

/**
 * @param {{ code: import("./index.d.ts").ReferenceValidationIssueCode, source: string, field?: string | null, expected?: string | null, actual?: string | null, reference?: string | null, message: string }} params
 * @returns {import("./index.d.ts").ReferenceValidationIssue}
 */
function referenceIssue({ code, source, field = null, expected = null, actual = null, reference = null, message }) {
  return {
    code,
    source,
    field,
    expected,
    actual,
    reference,
    message,
  };
}

/**
 * @param {string} input
 * @returns {string}
 */
function normalizePath(input) {
  return input.split(path.sep).join("/");
}
