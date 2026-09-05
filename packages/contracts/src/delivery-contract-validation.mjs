import { validateAllowedPathPattern, validatePublicId } from "./canonical-values.mjs";
import { describeActualType, isPlainObject, issue } from "./utils.mjs";

export const DELIVERY_MANIFEST_STATUS_VALUES = Object.freeze(["draft", "submitted", "complete", "partial", "blocked", "failed"]);
export const RELEASE_PACKET_STATUS_VALUES = Object.freeze(["draft", "ready-for-close", "released", "blocked", "failed"]);
export const INTEGRATION_REPORT_STATUS_VALUES = Object.freeze(["pending", "applying", "verification-pending", "blocked", "repair-required", "passed"]);
export const TRANSACTION_STATUS_VALUES = Object.freeze(["complete", "partial", "blocked"]);

function add(issues, source, code, field, expected, actual, message) {
  issues.push(issue({ code, source, field, expected, actual, message }));
}

function requiredString(record, field, source, issues) {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    add(issues, source, value === undefined ? "required_field_missing" : "field_type_mismatch", field, "non-empty string", value === undefined ? "missing" : describeActualType(value), `Field '${field}' must be a non-empty string.`);
    return null;
  }
  return value.trim();
}

function stringArray(record, field, source, issues, required = false) {
  const value = record[field];
  if (value === undefined && !required) return [];
  if (!Array.isArray(value)) {
    add(issues, source, value === undefined ? "required_field_missing" : "field_type_mismatch", field, "array", value === undefined ? "missing" : describeActualType(value), `Field '${field}' must be an array.`);
    return [];
  }
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) add(issues, source, "field_type_mismatch", `${field}[${index}]`, "non-empty string", describeActualType(entry), `Field '${field}[${index}]' must be a non-empty string.`);
  });
  return value;
}

function status(record, field, values, source, issues) {
  const value = requiredString(record, field, source, issues);
  if (value && !values.includes(value)) add(issues, source, "enum_value_invalid", field, values.join("|"), value, `Field '${field}' has unsupported value '${value}'.`);
  return value;
}

function publicIdIfPresent(value, field, source, issues) {
  if (value === undefined || value === null) return;
  const result = validatePublicId(value);
  if (!result.ok) add(issues, source, "identifier_format_invalid", field, "canonical lowercase ASCII public identifier", `${result.value_class}: ${JSON.stringify(value)}`, `Field '${field}' rejects ${result.value_class} identifier.`);
}

function digestIfPresent(value, field, source, issues) {
  if (value === undefined || value === null) return;
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) add(issues, source, "digest_format_invalid", field, "64 lowercase hexadecimal characters", describeActualType(value), `Field '${field}' must contain a SHA-256 digest.`);
}

function evidenceRefs(value, field, source, issues) {
  const refs = Array.isArray(value) ? value : [];
  if (!Array.isArray(value)) {
    add(issues, source, "field_type_mismatch", field, "array", describeActualType(value), `Field '${field}' must be an array.`);
    return refs;
  }
  refs.forEach((ref, index) => {
    const supportedScheme = typeof ref === "string" && ["evidence://", "validation://", "approval://", "run://", "packet://", "compiled-context://", "runtime://", "step://", "review://", "incident://", "redact://"].some((prefix) => ref.startsWith(prefix));
    if (typeof ref !== "string" || ref.trim().length === 0 || (ref.includes("://") && !supportedScheme)) {
      add(issues, source, "evidence_reference_invalid", `${field}[${index}]`, "canonical evidence/validation/approval/run reference", describeActualType(ref), `Field '${field}[${index}]' is not a supported evidence reference.`);
    }
  });
  return refs;
}

function validatePlanIdentity(document, source, issues) {
  for (const field of ["plan_id", "project_id", "run_id"]) publicIdIfPresent(document[field], field, source, issues);
  const locks = Array.isArray(document.evidence_locks) ? document.evidence_locks : [];
  locks.forEach((lock, index) => {
    const field = `evidence_locks[${index}]`;
    if (!isPlainObject(lock)) {
      add(issues, source, "field_type_mismatch", field, "object", describeActualType(lock), `Field '${field}' must be an object.`);
      return;
    }
    requiredString(lock, "ref", source, issues);
    const lockStatus = requiredString(lock, "status", source, issues);
    if (lockStatus && !["locked", "missing", "unresolved"].includes(lockStatus)) add(issues, source, "enum_value_invalid", `${field}.status`, "locked|missing|unresolved", lockStatus, `Field '${field}.status' has unsupported value.`);
    digestIfPresent(lock.sha256, `${field}.sha256`, source, issues);
    if (lockStatus === "locked" && (!lock.sha256 || !/^[a-f0-9]{64}$/u.test(String(lock.sha256)))) add(issues, source, "contract_invariant_failed", field, "locked evidence with SHA-256 digest", lockStatus, `Locked evidence '${field}' must carry a SHA-256 digest.`);
  });
}

export function validateDeliveryPlanContract(document, source) {
  const issues = [];
  validatePlanIdentity(document, source, issues);
  const planStatus = status(document, "status", ["ready", "blocked"], source, issues);
  const mode = requiredString(document, "delivery_mode", source, issues);
  const executionAllowed = document.execution_allowed;
  const writebackAllowed = document.writeback_allowed;
  if (typeof executionAllowed !== "boolean") add(issues, source, "field_type_mismatch", "execution_allowed", "boolean", describeActualType(executionAllowed), "Delivery-plan execution_allowed must be boolean.");
  if (typeof writebackAllowed !== "boolean") add(issues, source, "field_type_mismatch", "writeback_allowed", "boolean", describeActualType(writebackAllowed), "Delivery-plan writeback_allowed must be boolean.");
  const blockers = stringArray(document, "blocking_reasons", source, issues, true);
  evidenceRefs(document.evidence_refs, "evidence_refs", source, issues);
  if (planStatus === "ready" && blockers.length > 0) add(issues, source, "contract_invariant_failed", "blocking_reasons", "empty for ready plan", String(blockers.length), "A ready delivery plan cannot retain blocking reasons.");
  if (planStatus === "blocked" && executionAllowed === true) add(issues, source, "contract_invariant_failed", "execution_allowed", "false when status is blocked", "true", "A blocked delivery plan cannot authorize execution.");
  if (planStatus === "ready" && executionAllowed === false) add(issues, source, "contract_invariant_failed", "execution_allowed", "true when status is ready", "false", "A ready delivery plan must authorize execution.");
  if (mode && mode !== "no-write" && writebackAllowed === true) {
    const preconditions = isPlainObject(document.preconditions) ? document.preconditions : {};
    for (const [name, expected] of [["approved_handoff", "present"], ["promotion_evidence", "present"]]) {
      const value = isPlainObject(preconditions[name]) ? preconditions[name].status : undefined;
      if (value !== expected) add(issues, source, "contract_invariant_failed", `preconditions.${name}.status`, expected, describeActualType(value), `Write-capable delivery requires ${name} to be present.`);
    }
  }
  return issues;
}

export function validateDeliveryManifestContract(document, source) {
  const issues = [];
  for (const field of ["manifest_id", "project_id", "ticket_id"]) publicIdIfPresent(document[field], field, source, issues);
  const manifestStatus = status(document, "status", DELIVERY_MANIFEST_STATUS_VALUES, source, issues);
  const runRefs = stringArray(document, "run_refs", source, issues, true);
  evidenceRefs(document.verification_refs, "verification_refs", source, issues);
  if (!isPlainObject(document.writeback_policy)) add(issues, source, "field_type_mismatch", "writeback_policy", "object", describeActualType(document.writeback_policy), "Delivery manifest writeback_policy must be an object.");
  const repos = document.repo_deliveries;
  if (!Array.isArray(repos) || repos.length === 0) add(issues, source, repos === undefined ? "required_field_missing" : "field_type_mismatch", "repo_deliveries", "non-empty array", describeActualType(repos), "Delivery manifest must list at least one repository delivery.");
  if (Array.isArray(repos)) repos.forEach((repo, index) => {
    const field = `repo_deliveries[${index}]`;
    if (!isPlainObject(repo)) return add(issues, source, "field_type_mismatch", field, "object", describeActualType(repo), `Field '${field}' must be an object.`);
    publicIdIfPresent(repo.repo_id, `${field}.repo_id`, source, issues);
    if (repo.changed_paths !== undefined) {
      if (!Array.isArray(repo.changed_paths)) add(issues, source, "field_type_mismatch", `${field}.changed_paths`, "array", describeActualType(repo.changed_paths), `Field '${field}.changed_paths' must be an array.`);
      else repo.changed_paths.forEach((candidate, pathIndex) => {
        const result = validateAllowedPathPattern(candidate);
        if (!result.ok || candidate.includes("*")) add(issues, source, "path_scope_invalid", `${field}.changed_paths[${pathIndex}]`, "literal project-relative POSIX path", String(candidate), `Changed path '${field}.changed_paths[${pathIndex}]' must be canonical and literal.`);
      });
    }
    digestIfPresent(repo.output_digest, `${field}.output_digest`, source, issues);
  });
  if (isPlainObject(document.coordination_transaction)) {
    const transaction = document.coordination_transaction;
    const transactionStatus = status(transaction, "status", TRANSACTION_STATUS_VALUES, source, issues);
    const completed = stringArray(transaction, "completed_repo_ids", source, issues);
    const failed = stringArray(transaction, "failed_repo_ids", source, issues);
    if (transactionStatus === "complete" && failed.length > 0) add(issues, source, "contract_invariant_failed", "coordination_transaction.failed_repo_ids", "empty for complete transaction", String(failed.length), "A complete coordination transaction cannot contain failed repositories.");
    if (transactionStatus === "partial" && (completed.length === 0 || failed.length === 0)) add(issues, source, "contract_invariant_failed", "coordination_transaction", "both completed and failed repository ids for partial transaction", transactionStatus, "A partial transaction must expose both successful and failed repository effects.");
    if (manifestStatus === "submitted" && transactionStatus === "partial") add(issues, source, "contract_invariant_failed", "status", "non-success status for partial transaction", manifestStatus, "A submitted manifest cannot hide a partial transaction.");
  }
  if (manifestStatus === "complete" && runRefs.length === 0) add(issues, source, "contract_invariant_failed", "run_refs", "at least one run reference", "empty", "A complete manifest must retain run lineage.");
  return issues;
}

export function validateReleasePacketContract(document, source) {
  const issues = [];
  for (const field of ["packet_id", "project_id", "ticket_id"]) publicIdIfPresent(document[field], field, source, issues);
  const packetStatus = status(document, "status", RELEASE_PACKET_STATUS_VALUES, source, issues);
  const runRefs = stringArray(document, "run_refs", source, issues, true);
  const verificationRefs = evidenceRefs(document.verification_refs, "verification_refs", source, issues);
  const manifestRef = requiredString(document, "delivery_manifest_ref", source, issues);
  const lineage = document.evidence_lineage;
  if (!isPlainObject(lineage)) add(issues, source, "field_type_mismatch", "evidence_lineage", "object", describeActualType(lineage), "Release packet evidence_lineage must be an object.");
  else {
    const executionRefs = evidenceRefs(lineage.execution_refs, "evidence_lineage.execution_refs", source, issues);
    const outputRefs = evidenceRefs(lineage.delivery_output_refs, "evidence_lineage.delivery_output_refs", source, issues);
    if (packetStatus === "ready-for-close" && (executionRefs.length === 0 || outputRefs.length === 0)) add(issues, source, "contract_invariant_failed", "evidence_lineage", "execution and delivery output lineage", "incomplete", "A release ready for close must retain execution and delivery output evidence.");
  }
  if (packetStatus === "ready-for-close" && (!manifestRef || verificationRefs.length === 0 || runRefs.length === 0)) add(issues, source, "contract_invariant_failed", "status", "complete release lineage", packetStatus, "A release ready for close must point to a delivery manifest, run, and verification evidence.");
  return issues;
}

export function validateIntegrationReportContract(document, source) {
  const issues = [];
  for (const field of ["report_id", "project_id", "parent_run_id"]) publicIdIfPresent(document[field], field, source, issues);
  const reportStatus = status(document, "status", INTEGRATION_REPORT_STATUS_VALUES, source, issues);
  const sourceAttempts = Array.isArray(document.source_attempts) ? document.source_attempts : [];
  const repositories = Array.isArray(document.repository_results) ? document.repository_results : [];
  const gates = Array.isArray(document.aggregate_gates) ? document.aggregate_gates : [];
  if (!Array.isArray(document.blockers)) add(issues, source, document.blockers === undefined ? "required_field_missing" : "field_type_mismatch", "blockers", "array", describeActualType(document.blockers), "Field 'blockers' must be an array.");
  if (!Array.isArray(document.stale_units)) add(issues, source, document.stale_units === undefined ? "required_field_missing" : "field_type_mismatch", "stale_units", "array", describeActualType(document.stale_units), "Field 'stale_units' must be an array.");
  evidenceRefs(document.evidence_refs, "evidence_refs", source, issues);
  const repoIds = new Set(repositories.map((repo) => isPlainObject(repo) ? repo.repo_id : null));
  sourceAttempts.forEach((attempt, index) => {
    if (!isPlainObject(attempt)) return;
    if (attempt.project_id !== undefined && attempt.project_id !== document.project_id) add(issues, source, "identity_binding_mismatch", `source_attempts[${index}].project_id`, String(document.project_id), String(attempt.project_id), "Child attempt project ownership does not match integration report.");
    if (attempt.parent_run_id !== undefined && attempt.parent_run_id !== document.parent_run_id) add(issues, source, "identity_binding_mismatch", `source_attempts[${index}].parent_run_id`, String(document.parent_run_id), String(attempt.parent_run_id), "Child attempt parent run does not match integration report.");
    digestIfPresent(attempt.output_digest, `source_attempts[${index}].output_digest`, source, issues);
    if (attempt.repo_id !== undefined && repoIds.size > 0 && !repoIds.has(attempt.repo_id)) add(issues, source, "identity_binding_mismatch", `source_attempts[${index}].repo_id`, "repository_results.repo_id", String(attempt.repo_id), "Child attempt repository is absent from integration results.");
  });
  const requiredGateFailures = gates.filter((gate) => isPlainObject(gate) && gate.required !== false && gate.status !== "passed");
  if (reportStatus === "passed" && (sourceAttempts.length === 0 || repositories.length === 0 || requiredGateFailures.length > 0 || (Array.isArray(document.blockers) && document.blockers.length > 0) || (Array.isArray(document.stale_units) && document.stale_units.length > 0))) add(issues, source, "contract_invariant_failed", "status", "passed only with complete gates and no blockers/stale units", reportStatus, "An integration report cannot assert passed while inputs, gates, blockers, or stale units remain unresolved.");
  return issues;
}
