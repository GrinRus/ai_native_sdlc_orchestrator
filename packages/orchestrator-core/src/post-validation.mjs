import { derivePublicId } from "../../contracts/src/index.mjs";

export const POST_VALIDATOR_IDS = Object.freeze([
  "output-schema",
  "evidence-complete",
  "validation-commands",
]);

const FAILURE_CLASS_BY_VALIDATOR = Object.freeze({
  "output-schema": "schema-mismatch",
  "evidence-complete": "missing-evidence",
  "validation-commands": "validation-commands-failed",
});

const FAILURE_CLASS_BY_ISSUE = Object.freeze({
  "runner-result-partial": "incomplete-result",
  "runner-verification-contradiction": "verification-contradiction",
});

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function issue(code, summary, field, repairKind) {
  return {
    code,
    summary,
    field: field ?? null,
    repair_kind: repairKind,
  };
}

function validationReport(options) {
  const reportId = derivePublicId(
    [options.runId ?? "unknown-run", options.stepId ?? "unknown-step", "post-validation"],
    "validation-report",
  );
  return {
    report_id: reportId,
    subject_ref: `run://${options.runId ?? "unknown"}/step/${options.stepId ?? "unknown"}`,
    validators: options.validators,
    status: options.status,
    evidence_refs: uniqueStrings(options.evidenceRefs),
  };
}

/**
 * Resolve the only post-validator IDs that have executable semantics. The
 * registry is intentionally closed: an unrecognised or repeated policy entry
 * is a pre-spawn blocker rather than a silent no-op.
 */
export function resolvePostValidatorPlan(value) {
  const requested = Array.isArray(value) ? value : [];
  const validators = [];
  const blockers = [];
  const seen = new Set();
  for (const entry of requested) {
    const validatorId = asString(entry);
    if (!validatorId) {
      blockers.push(issue("validator-id-invalid", "Post-validator IDs must be non-empty strings.", "post_validators", "evidence-reconciliation"));
      continue;
    }
    if (!POST_VALIDATOR_IDS.includes(validatorId)) {
      blockers.push(issue("validator-unsupported", `Post-validator '${validatorId}' is not executable.`, "post_validators", "evidence-reconciliation"));
      continue;
    }
    if (seen.has(validatorId)) {
      blockers.push(issue("validator-duplicate", `Post-validator '${validatorId}' is declared more than once.`, "post_validators", "evidence-reconciliation"));
      continue;
    }
    seen.add(validatorId);
    validators.push(validatorId);
  }
  return { ok: blockers.length === 0, validators, blockers };
}

function validateOutputSchema(options) {
  const output = asRecord(options.adapterResponse.output);
  const routeProfile = asRecord(options.adapterRequest.route).route_profile;
  const route = asRecord(routeProfile);
  const requiredSchemaRef = asString(route.required_output_schema_ref);
  const requiredOutputMode = asString(route.required_output_mode);
  const strict = Boolean(requiredSchemaRef || requiredOutputMode);
  const envelope = asRecord(output.runner_output);
  if (!strict) {
    return {
      status: "warn",
      blocking: false,
      summary: "Route has no strict output schema; legacy adapter output remains diagnostic-only.",
      details: { strict_route: false, compatibility: "legacy-output" },
      evidenceRefs: [],
      repairKind: "output-contract",
    };
  }
  const findings = [];
  if (Object.keys(envelope).length === 0) findings.push(issue("runner-output-missing", "Strict route did not expose a normalized runner-output envelope.", "runner_output", "output-contract"));
  if (envelope.parse_status !== "valid") findings.push(issue(`runner-output-${asString(envelope.parse_status) ?? "unsupported"}`, `Normalized output parse status is '${asString(envelope.parse_status) ?? "missing"}'.`, "runner_output.parse_status", "output-contract"));
  if (requiredSchemaRef && envelope.requested_schema_ref !== requiredSchemaRef) findings.push(issue("runner-schema-ref-mismatch", `Requested schema '${String(envelope.requested_schema_ref)}' does not match route schema '${requiredSchemaRef}'.`, "runner_output.requested_schema_ref", "output-contract"));
  if (!envelope.candidate || typeof envelope.candidate !== "object" || Array.isArray(envelope.candidate)) findings.push(issue("runner-candidate-missing", "Strict output must contain exactly one candidate object.", "runner_output.candidate", "output-contract"));
  const candidateStatus = asString(asRecord(envelope.candidate).status);
  if (candidateStatus === "partial" || candidateStatus === "blocked") {
    findings.push(issue("runner-result-partial", `Runner returned non-completed work-product status '${candidateStatus}'.`, "runner_output.candidate.status", "work-product"));
  }
  const outcome = asRecord(output.execution_outcome);
  if (asString(outcome.parsing?.status) !== "valid") findings.push(issue("runner-parsing-not-valid", "Execution parsing outcome is not valid.", "execution_outcome.parsing.status", "output-contract"));
  if (asString(outcome.candidate?.status) !== "accepted") findings.push(issue("runner-candidate-not-accepted", "Execution candidate outcome is not accepted.", "execution_outcome.candidate.status", "output-contract"));
  const status = findings.length > 0 ? "fail" : "pass";
  return {
    status,
    blocking: findings.length > 0,
    summary: findings.length > 0 ? "Strict output-schema validation rejected the adapter response." : "Strict output-schema validation passed.",
    details: { strict_route: true, schema_ref: requiredSchemaRef, output_mode: requiredOutputMode, findings },
    evidenceRefs: [],
    repairKind: "output-contract",
  };
}

function validateEvidenceComplete(options) {
  const output = asRecord(options.adapterResponse.output);
  const refs = asStringArray(options.adapterResponse.evidence_refs);
  const findings = [];
  if (new Set(refs).size !== refs.length) findings.push(issue("evidence-duplicate", "Adapter evidence references must be unique.", "evidence_refs", "evidence-reconciliation"));
  if (options.adapterResponse.status === "success" && refs.length === 0) findings.push(issue("evidence-missing", "Accepted adapter responses must carry evidence references.", "evidence_refs", "evidence-reconciliation"));
  const rawRef = asString(asRecord(output.external_runner).raw_evidence_ref) ?? asString(asRecord(output.runner_output).raw_evidence_ref);
  if (options.strict && options.adapterResponse.status === "success" && !rawRef) findings.push(issue("raw-evidence-missing", "Strict accepted output must reference immutable raw provider evidence.", "raw_evidence_ref", "evidence-reconciliation"));
  if (rawRef && !refs.includes(rawRef)) findings.push(issue("raw-evidence-unlinked", "Raw provider evidence must be linked from adapter evidence_refs.", "evidence_refs", "evidence-reconciliation"));
  return {
    status: findings.length > 0 ? "fail" : "pass",
    blocking: findings.length > 0,
    summary: findings.length > 0 ? "Evidence-complete validation rejected the adapter response." : "Evidence-complete validation passed.",
    details: { evidence_count: refs.length, raw_evidence_ref: rawRef, findings },
    evidenceRefs: refs,
    repairKind: "evidence-reconciliation",
  };
}

function validateCommands(options) {
  const output = asRecord(options.adapterResponse.output);
  const envelope = asRecord(output.runner_output);
  const candidate = asRecord(envelope.candidate);
  const claims = Array.isArray(candidate.command_result_claims) ? candidate.command_result_claims : [];
  const policyBundle = asRecord(options.adapterRequest.policy_bundle);
  const resolvedBounds = asRecord(policyBundle.resolved_bounds);
  const commands = asStringArray(asRecord(resolvedBounds.command_constraints).allowed_commands);
  if (!options.strict || commands.length === 0) {
    return {
      status: "warn",
      blocking: false,
      summary: "Controller command results are not required for this compatibility route.",
      details: { required_commands: commands, claims: claims.length },
      evidenceRefs: [],
      repairKind: "evidence-reconciliation",
    };
  }
  const claimedCommands = claims.map((entry) => asString(asRecord(entry).command)).filter(Boolean);
  const missing = commands.filter((command) => !claimedCommands.includes(command));
  const unknown = claimedCommands.filter((command) => !commands.includes(command));
  const findings = [];
  if (missing.length > 0) findings.push(issue("command-evidence-missing", `Required command claims are missing: ${missing.join(", ")}.`, "command_result_claims", "evidence-reconciliation"));
  if (unknown.length > 0) findings.push(issue("command-evidence-unknown", `Command claims are not controller-owned: ${unknown.join(", ")}.`, "command_result_claims", "evidence-reconciliation"));
  return {
    status: findings.length > 0 ? "fail" : "pass",
    blocking: findings.length > 0,
    summary: findings.length > 0 ? "Validation-command evidence did not match controller-owned commands." : "Validation-command evidence matched controller-owned commands.",
    details: { required_commands: commands, claimed_commands: claimedCommands, findings },
    evidenceRefs: [],
    repairKind: "evidence-reconciliation",
  };
}

/** Execute the ordered post-validator plan and build one deterministic report. */
export function executePostValidators(options) {
  const route = asRecord(options.adapterRequest.route);
  const routeProfile = asRecord(route.route_profile);
  const strict = Boolean(asString(routeProfile.required_output_schema_ref) || asString(routeProfile.required_output_mode));
  const plan = options.plan ?? resolvePostValidatorPlan(asRecord(asRecord(options.adapterRequest.policy_bundle).policy).profile?.post_validators);
  const entries = [];
  const evidenceRefs = asStringArray(options.adapterResponse.evidence_refs);
  if (!plan.ok) {
    for (const blocker of plan.blockers) {
      entries.push({ validator_id: "registry", status: "blocked", summary: blocker.summary, details: blocker, evidence_refs: [] });
    }
    return {
      accepted: false,
      status: "blocked",
      failureClass: "validator-policy-invalid",
      repairKind: "evidence-reconciliation",
      report: validationReport({ runId: options.runId, stepId: options.stepId, status: "blocked", validators: entries, evidenceRefs }),
    };
  }
  for (const validatorId of plan.validators) {
    const result = validatorId === "output-schema"
      ? validateOutputSchema({ ...options, strict })
      : validatorId === "evidence-complete"
        ? validateEvidenceComplete({ ...options, strict })
        : validateCommands({ ...options, strict });
    entries.push({
      validator_id: validatorId,
      status: result.status,
      summary: result.summary,
      details: result.details,
      evidence_refs: uniqueStrings([...evidenceRefs, ...result.evidenceRefs]),
    });
  }
  const blockingFailure = entries.find((entry) => entry.status === "fail" || entry.status === "blocked");
  const firstFinding = blockingFailure?.details?.findings?.[0];
  const status = blockingFailure ? (blockingFailure.status === "blocked" ? "blocked" : "fail") : entries.some((entry) => entry.status === "warn") ? "warn" : "pass";
  return {
    accepted: blockingFailure === undefined,
    status,
    failureClass: blockingFailure
      ? FAILURE_CLASS_BY_ISSUE[firstFinding?.code] ?? FAILURE_CLASS_BY_VALIDATOR[blockingFailure.validator_id] ?? "validator-failed"
      : null,
    repairKind: blockingFailure ? (firstFinding?.repair_kind ?? "evidence-reconciliation") : null,
    report: validationReport({ runId: options.runId, stepId: options.stepId, status, validators: entries, evidenceRefs }),
  };
}
