export type ContractFamily =
  | "project-profile"
  | "onboarding-report"
  | "next-action-report"
  | "project-analysis-report"
  | "discovery-research-report"
  | "artifact-packet"
  | "intake-request-body"
  | "wave-ticket"
  | "handoff-packet"
  | "execution-plan"
  | "task-progress-report"
  | "release-packet"
  | "delivery-plan"
  | "delivery-manifest"
  | "incident-report"
  | "step-result"
  | "validation-report"
  | "evaluation-report"
  | "evaluation-case-input"
  | "evaluation-case-expected"
  | "review-report"
  | "review-decision"
  | "quality-repair-request"
  | "runtime-harness-report"
  | "multirepo-coordination-status"
  | "planner-metrics-snapshot"
  | "finance-monitoring-snapshot"
  | "compiler-revision-status"
  | "dataset"
  | "evaluation-suite"
  | "promotion-decision"
  | "compiled-context-artifact"
  | "operator-request"
  | "provider-route-profile"
  | "wrapper-profile"
  | "prompt-bundle"
  | "context-doc"
  | "context-rule"
  | "context-skill"
  | "context-bundle"
  | "step-policy-profile"
  | "adapter-capability-profile"
  | "skill-profile"
  | "live-run-event"
  | "run-job"
  | "learning-loop-scorecard"
  | "learning-loop-handoff"
  | "incident-backfill-proposal"
  | "control-plane-api";

export type ContractFieldType = "string" | "number" | "boolean" | "array" | "object";

export type ContractValidationIssueCode =
  | "unknown_contract_family"
  | "contract_family_limitation"
  | "document_type_invalid"
  | "required_field_missing"
  | "field_type_mismatch"
  | "unsupported_field_present"
  | "enum_value_invalid"
  | "identifier_format_invalid"
  | "path_scope_invalid"
  | "reference_base_invalid"
  | "yaml_parse_error";

export interface ContractValidationIssue {
  code: ContractValidationIssueCode;
  source: string;
  field: string | null;
  expected: string | null;
  actual: string | null;
  message: string;
}

export interface ContractValidationResult {
  ok: boolean;
  family: ContractFamily | null;
  source: string;
  issues: ContractValidationIssue[];
}

export interface ContractEnumCheck {
  field: string;
  allowedValues: string[];
}

export interface ContractFamilyIndexEntry {
  family: ContractFamily;
  familyGroup: "core-packets-and-profiles" | "execution-and-quality" | "platform-assets" | "operations";
  sourceContract: string;
  exampleGlob: string;
  status: "implemented" | "limitation";
  limitation?: string;
  requiredFields: string[];
  forbiddenFields?: string[];
  fieldTypes: Record<string, ContractFieldType>;
  enumChecks: ContractEnumCheck[];
}

export interface LoadContractFileOptions {
  filePath: string;
  family?: ContractFamily;
}

export interface LoadedContractFile {
  ok: boolean;
  family: ContractFamily | null;
  source: string;
  document: unknown;
  validation: ContractValidationResult;
}

export interface LoadExampleContractsOptions {
  workspaceRoot?: string;
  examplesRoot?: string;
}

export interface LoadedExampleContracts {
  ok: boolean;
  workspaceRoot: string;
  examplesRoot: string;
  results: LoadedContractFile[];
  issues: ContractValidationIssue[];
}

export type ReferenceValidationIssueCode =
  | "reference_format_invalid"
  | "reference_target_missing"
  | "reference_target_type_mismatch"
  | "reference_target_incompatible";

export interface ReferenceValidationIssue {
  code: ReferenceValidationIssueCode;
  source: string;
  field: string | null;
  expected: string | null;
  actual: string | null;
  reference: string | null;
  message: string;
}

export interface ReferenceValidationResult {
  ok: boolean;
  workspaceRoot: string;
  examplesRoot: string;
  checkedReferences: number;
  checkedCompatibility: number;
  issues: ReferenceValidationIssue[];
}

export function getContractFamilyIndex(): ContractFamilyIndexEntry[];

export function validateContractDocument(options: {
  family: ContractFamily;
  document: unknown;
  source?: string;
}): ContractValidationResult;

export const STRUCTURED_TASK_MODEL_VERSION: 1;
export const PLAN_STATUS_VALUES: readonly string[];
export const PLAN_SIZE_VALUES: readonly string[];
export const TASK_TYPE_VALUES: readonly string[];
export const CRITERION_KIND_VALUES: readonly string[];
export function validateStructuredTaskPlan(
  document: Record<string, unknown>,
  source: string,
): ContractValidationIssue[];

export function loadContractFile(options: LoadContractFileOptions): LoadedContractFile;

export function loadExampleContracts(options?: LoadExampleContractsOptions): LoadedExampleContracts;

export function validateExampleReferences(options?: LoadExampleContractsOptions): ReferenceValidationResult;

export const PUBLIC_ID_PATTERN: RegExp;
export const PUBLIC_ID_FIELDS: readonly string[];
export const CANONICAL_REFERENCE_BASES: readonly string[];
export function validatePublicId(value: unknown): { ok: boolean; value_class: string; migration: string | null };
export function derivePublicId(components: string[], fallbackPrefix: string): string;
export function validateAllowedPathPattern(value: unknown): { ok: boolean; value_class: string; migration: string | null };
export function matchesAllowedPath(pattern: string, candidate: string): boolean;
export function classifyAllowedPaths(value: unknown): { ok: boolean; state: string; patterns: string[] };
export function validateReferenceBinding(options: { reference: unknown; base: unknown }): {
  ok: boolean;
  value_class: string;
  migration: string | null;
};
