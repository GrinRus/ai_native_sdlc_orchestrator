import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const STEP_CLASS_VALUES = ["artifact", "planner", "runner", "repair", "eval", "harness"];
const PROMOTION_CHANNEL_VALUES = ["draft", "candidate", "stable", "frozen", "demoted"];

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
      "default_route_profiles",
      "default_step_policies",
      "default_wrapper_profiles",
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
      default_route_profiles: "object",
      default_step_policies: "object",
      default_wrapper_profiles: "object",
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
    exampleGlob: "none",
    status: "implemented",
    requiredFields: ["ticket_id", "project_id", "objective", "scope", "dependencies", "risk_tier", "status"],
    fieldTypes: {
      ticket_id: "string",
      project_id: "string",
      objective: "string",
      scope: "object",
      dependencies: "array",
      risk_tier: "string",
      status: "string",
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
    },
    enumChecks: [],
  },
  {
    family: "release-packet",
    familyGroup: "core-packets-and-profiles",
    sourceContract: "docs/contracts/release-packet.md",
    exampleGlob: "examples/packets/release-*.yaml",
    status: "implemented",
    requiredFields: ["packet_id", "project_id", "ticket_id", "run_refs", "change_summary", "verification_refs", "status"],
    fieldTypes: {
      packet_id: "string",
      project_id: "string",
      ticket_id: "string",
      run_refs: "array",
      change_summary: "string",
      verification_refs: "array",
      status: "string",
    },
    enumChecks: [],
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
      "delivery_mode",
      "writeback_policy",
      "repo_deliveries",
      "verification_refs",
      "status",
    ],
    fieldTypes: {
      manifest_id: "string",
      project_id: "string",
      ticket_id: "string",
      run_refs: "array",
      delivery_mode: "string",
      writeback_policy: "object",
      repo_deliveries: "array",
      verification_refs: "array",
      status: "string",
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
    exampleGlob: "none",
    status: "implemented",
    requiredFields: ["report_id", "subject_ref", "suite_ref", "grader_results", "status", "evidence_refs"],
    fieldTypes: {
      report_id: "string",
      subject_ref: "string",
      suite_ref: "string",
      grader_results: "object",
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
    exampleGlob: "none",
    status: "implemented",
    requiredFields: ["decision_id", "subject_ref", "from_channel", "to_channel", "evidence_refs", "status"],
    fieldTypes: {
      decision_id: "string",
      subject_ref: "string",
      from_channel: "string",
      to_channel: "string",
      evidence_refs: "array",
      status: "string",
    },
    enumChecks: [
      { field: "from_channel", allowedValues: PROMOTION_CHANNEL_VALUES },
      { field: "to_channel", allowedValues: PROMOTION_CHANNEL_VALUES },
    ],
  },
  {
    family: "provider-route-profile",
    familyGroup: "platform-assets",
    sourceContract: "docs/contracts/provider-route-profile.md",
    exampleGlob: "examples/routes/*.yaml",
    status: "implemented",
    requiredFields: ["route_id", "step", "route_class", "risk_tier", "primary", "wrapper_profile_ref"],
    fieldTypes: {
      route_id: "string",
      step: "string",
      route_class: "string",
      risk_tier: "string",
      primary: "object",
      wrapper_profile_ref: "string",
    },
    enumChecks: [],
  },
  {
    family: "wrapper-profile",
    familyGroup: "platform-assets",
    sourceContract: "docs/contracts/wrapper-profile.md",
    exampleGlob: "examples/wrappers/*.yaml",
    status: "implemented",
    requiredFields: ["wrapper_id", "version", "step_class", "prompt_bundle_ref", "tool_policy", "command_policy"],
    fieldTypes: {
      wrapper_id: "string",
      version: "number",
      step_class: "string",
      prompt_bundle_ref: "string",
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
    enumChecks: [],
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
  { regex: /^examples\/delivery-manifest[^/]*\.ya?ml$/, family: "delivery-manifest" },
  { regex: /^examples\/eval\/dataset-[^/]+\.ya?ml$/, family: "dataset" },
  { regex: /^examples\/eval\/suite-[^/]+\.ya?ml$/, family: "evaluation-suite" },
  { regex: /^examples\/live-e2e\/[^/]+\.ya?ml$/, family: "live-e2e-profile" },
  { regex: /^examples\/packets\/handoff-[^/]+\.ya?ml$/, family: "handoff-packet" },
  { regex: /^examples\/packets\/release-[^/]+\.ya?ml$/, family: "release-packet" },
  { regex: /^examples\/policies\/[^/]+\.ya?ml$/, family: "step-policy-profile" },
  { regex: /^examples\/project-analysis-report\.sample\.ya?ml$/, family: "project-analysis-report" },
  { regex: /^examples\/project[^/]*\.aor\.ya?ml$/, family: "project-profile" },
  { regex: /^examples\/prompts\/[^/]+\.ya?ml$/, family: "prompt-bundle" },
  { regex: /^examples\/routes\/[^/]+\.ya?ml$/, family: "provider-route-profile" },
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
 * @param {string} input
 * @returns {string}
 */
function normalizePath(input) {
  return input.split(path.sep).join("/");
}
