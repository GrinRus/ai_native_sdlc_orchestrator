import fs from "node:fs";
import path from "node:path";

import {
  loadContractFile,
  validateContractDocument,
  validateExampleReferences,
} from "../../contracts/src/index.mjs";

import { initializeProjectRuntime } from "./project-init.mjs";

/**
 * @param {Array<{ validator_id: string, status: "pass" | "warn" | "fail", summary: string, details?: Record<string, unknown> }>} validators
 * @returns {"pass" | "warn" | "fail"}
 */
function summarizeValidationStatus(validators) {
  if (validators.some((validator) => validator.status === "fail")) return "fail";
  if (validators.some((validator) => validator.status === "warn")) return "warn";
  return "pass";
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {{ status: "pass" | "fail", summary: string, details?: Record<string, unknown> }}
 */
function validateProfileDefaults(profile) {
  const details = {
    default_route_profiles: typeof profile.default_route_profiles,
    default_step_policies: typeof profile.default_step_policies,
    default_wrapper_profiles: typeof profile.default_wrapper_profiles,
  };

  if (
    typeof profile.default_route_profiles !== "object" ||
    profile.default_route_profiles === null ||
    typeof profile.default_step_policies !== "object" ||
    profile.default_step_policies === null ||
    typeof profile.default_wrapper_profiles !== "object" ||
    profile.default_wrapper_profiles === null
  ) {
    return {
      status: "fail",
      summary: "Required default refs are missing or malformed in project profile.",
      details,
    };
  }

  return {
    status: "pass",
    summary: "Project profile default refs are present.",
    details,
  };
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {{ status: "pass" | "fail", summary: string, details?: Record<string, unknown> }}
 */
function validateWritebackSafety(profile) {
  const writebackPolicy = /** @type {Record<string, unknown>} */ (profile.writeback_policy ?? {});
  const allowDirectWrite = writebackPolicy.allow_direct_write;

  if (allowDirectWrite === true) {
    return {
      status: "fail",
      summary: "Write-back safety policy allows direct write; expected no direct write by default.",
      details: { allow_direct_write: allowDirectWrite },
    };
  }

  return {
    status: "pass",
    summary: "Write-back safety defaults keep direct writes disabled.",
    details: { allow_direct_write: allowDirectWrite ?? false },
  };
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {{ status: "pass" | "fail", summary: string, details?: Record<string, unknown> }}
 */
function validateRuntimeDefaults(profile) {
  const runtimeDefaults = /** @type {Record<string, unknown>} */ (profile.runtime_defaults ?? {});
  const runtimeRoot = runtimeDefaults.runtime_root;

  if (typeof runtimeRoot !== "string" || runtimeRoot.trim().length === 0) {
    return {
      status: "fail",
      summary: "runtime_defaults.runtime_root is missing or invalid.",
      details: { runtime_root: runtimeRoot ?? null },
    };
  }

  return {
    status: "pass",
    summary: "runtime_defaults.runtime_root is configured.",
    details: { runtime_root: runtimeRoot },
  };
}

/**
 * @param {string} reportPath
 * @returns {{ exists: boolean, status: string | null }}
 */
function readAnalysisReportStatus(reportPath) {
  if (!fs.existsSync(reportPath)) {
    return { exists: false, status: null };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    return { exists: true, status: typeof parsed.status === "string" ? parsed.status : null };
  } catch {
    return { exists: true, status: null };
  }
}

/**
 * @param {{
 *  cwd?: string,
 *  projectRef?: string,
 *  projectProfile?: string,
 *  runtimeRoot?: string,
 * }} options
 */
export function validateProjectRuntime(options = {}) {
  const init = initializeProjectRuntime(options);

  /** @type {Array<{ validator_id: string, status: "pass" | "warn" | "fail", summary: string, details?: Record<string, unknown> }>} */
  const validators = [];
  /** @type {string[]} */
  const evidenceRefs = [init.stateFile];

  const loadedProfile = loadContractFile({
    filePath: init.projectProfilePath,
    family: "project-profile",
  });

  if (!loadedProfile.ok) {
    validators.push({
      validator_id: "profile-contract",
      status: "fail",
      summary: "Project profile contract validation failed.",
      details: {
        issues: loadedProfile.validation.issues.map((issue) => issue.message),
      },
    });
  } else {
    validators.push({
      validator_id: "profile-contract",
      status: "pass",
      summary: "Project profile contract validation passed.",
    });
  }

  const profile = /** @type {Record<string, unknown>} */ (loadedProfile.document ?? {});

  const defaultsCheck = validateProfileDefaults(profile);
  validators.push({
    validator_id: "profile-default-refs",
    status: defaultsCheck.status,
    summary: defaultsCheck.summary,
    details: defaultsCheck.details,
  });

  const runtimeDefaultsCheck = validateRuntimeDefaults(profile);
  validators.push({
    validator_id: "runtime-defaults",
    status: runtimeDefaultsCheck.status,
    summary: runtimeDefaultsCheck.summary,
    details: runtimeDefaultsCheck.details,
  });

  const writebackCheck = validateWritebackSafety(profile);
  validators.push({
    validator_id: "writeback-safety",
    status: writebackCheck.status,
    summary: writebackCheck.summary,
    details: writebackCheck.details,
  });

  const analysisReportPath = path.join(init.runtimeLayout.reportsRoot, "project-analysis-report.json");
  const analysisReportStatus = readAnalysisReportStatus(analysisReportPath);
  if (!analysisReportStatus.exists) {
    validators.push({
      validator_id: "analysis-report-presence",
      status: "warn",
      summary: "No project-analysis-report found; continuing with profile-only validation.",
      details: { expected_report: analysisReportPath },
    });
  } else {
    evidenceRefs.push(analysisReportPath);
    validators.push({
      validator_id: "analysis-report-presence",
      status: "pass",
      summary: "project-analysis-report is present and reusable.",
      details: { status: analysisReportStatus.status },
    });
  }

  const examplesDir = path.join(init.projectRoot, "examples");
  if (!fs.existsSync(examplesDir)) {
    validators.push({
      validator_id: "asset-reference-integrity",
      status: "warn",
      summary: "No examples directory found; reference integrity checks were skipped.",
    });
  } else {
    const referenceIntegrity = validateExampleReferences({ workspaceRoot: init.projectRoot });
    validators.push({
      validator_id: "asset-reference-integrity",
      status: referenceIntegrity.ok ? "pass" : "fail",
      summary: referenceIntegrity.ok
        ? "Example reference integrity checks passed."
        : `Example reference integrity checks failed with ${referenceIntegrity.issues.length} issue(s).`,
      details: {
        checked_references: referenceIntegrity.checkedReferences,
        issues: referenceIntegrity.issues,
      },
    });
    evidenceRefs.push(`reference-integrity:${referenceIntegrity.checkedReferences}`);
  }

  const status = summarizeValidationStatus(validators);
  const report = {
    report_id: `${init.projectId}.validation.v1`,
    subject_ref: init.projectProfileRef,
    validators,
    status,
    evidence_refs: evidenceRefs,
  };

  const reportValidation = validateContractDocument({
    family: "validation-report",
    document: report,
    source: "runtime://validation-report",
  });

  if (!reportValidation.ok) {
    const issueSummary = reportValidation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated validation report failed contract validation: ${issueSummary}`);
  }

  const validationReportPath = path.join(init.runtimeLayout.reportsRoot, "validation-report.json");
  fs.writeFileSync(validationReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return {
    ...init,
    validationReportPath,
    report,
    blocking: status === "fail",
  };
}
