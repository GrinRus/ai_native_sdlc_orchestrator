export type ContractFamily =
  | "project-profile"
  | "project-analysis-report"
  | "artifact-packet"
  | "wave-ticket"
  | "handoff-packet"
  | "release-packet"
  | "delivery-plan"
  | "delivery-manifest"
  | "incident-report"
  | "step-result"
  | "validation-report"
  | "evaluation-report"
  | "review-report"
  | "runtime-harness-report"
  | "dataset"
  | "evaluation-suite"
  | "promotion-decision"
  | "compiled-context-artifact"
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
  | "learning-loop-scorecard"
  | "learning-loop-handoff"
  | "control-plane-api"
  | "live-e2e-provider-variant"
  | "live-e2e-scenario-policy"
  | "live-e2e-target-catalog";

export type ContractFieldType = "string" | "number" | "boolean" | "array" | "object";

export type ContractValidationIssueCode =
  | "unknown_contract_family"
  | "contract_family_limitation"
  | "document_type_invalid"
  | "required_field_missing"
  | "field_type_mismatch"
  | "unsupported_field_present"
  | "enum_value_invalid"
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

export interface ValidateLiveE2eCatalogReferencesOptions {
  workspaceRoot?: string;
  examplesRoot?: string;
  catalogRoot?: string;
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

export function loadContractFile(options: LoadContractFileOptions): LoadedContractFile;

export function loadExampleContracts(options?: LoadExampleContractsOptions): LoadedExampleContracts;

export function validateExampleReferences(options?: LoadExampleContractsOptions): ReferenceValidationResult;

export function validateLiveE2eCatalogReferences(
  options?: ValidateLiveE2eCatalogReferencesOptions,
): ReferenceValidationResult;
