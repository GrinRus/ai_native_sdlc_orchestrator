import fs from "node:fs";
import path from "node:path";

import {
  UsageError,
  asNonEmptyString,
  asRecord,
  asStringArray,
  nowIso,
  readJson,
  uniqueStrings,
  writeJson,
} from "./common.mjs";

export const OPERATOR_DECISION_ACTIONS = Object.freeze([
  "continue",
  "answer",
  "frontend_interact",
  "retry_public_step",
  "diagnose",
  "block",
]);

/**
 * @param {string} status
 * @returns {"pass" | "warn" | "not_pass" | "blocked" | "interaction_required" | "resumed"}
 */
function normalizeObservationStatus(status) {
  const normalized = asNonEmptyString(status).toLowerCase();
  if (normalized === "pass" || normalized === "passed" || normalized === "success") return "pass";
  if (normalized === "warn" || normalized === "warning" || normalized === "skipped") return "warn";
  if (normalized === "blocked" || normalized === "block") return "blocked";
  if (normalized === "interaction_required" || normalized === "interactive" || normalized === "requested") {
    return "interaction_required";
  }
  if (normalized === "resumed") return "resumed";
  return "not_pass";
}

/**
 * @param {Record<string, unknown>} request
 * @returns {string[]}
 */
export function resolveSupportedDecisionActions(request) {
  const shapeAction = asNonEmptyString(asRecord(request.expected_response_shape).action);
  const fromShape = shapeAction
    .split("|")
    .map((entry) => entry.trim())
    .filter((entry) => OPERATOR_DECISION_ACTIONS.includes(entry));
  return fromShape.length > 0 ? uniqueStrings(fromShape) : [...OPERATOR_DECISION_ACTIONS];
}

/**
 * @param {Record<string, unknown>} request
 * @returns {string[]}
 */
export function resolveRequiredInspectedEvidenceRefs(request) {
  const rubricRefs = asStringArray(asRecord(request.decision_rubric).required_evidence_refs);
  if (rubricRefs.length > 0) return uniqueStrings(rubricRefs);
  return uniqueStrings(asStringArray(asRecord(request.expected_response_shape).inspected_evidence_refs));
}

/**
 * @param {Record<string, unknown>} request
 * @returns {string[]}
 */
export function resolveFrontendEvidenceRefs(request) {
  const rubric = asRecord(request.decision_rubric);
  const expected = asRecord(request.expected_response_shape);
  return uniqueStrings([
    ...asStringArray(rubric.frontend_evidence_refs),
    ...asStringArray(expected.frontend_evidence_refs),
    ...resolveLateBrowserTaskProofEvidenceRefs([
      ...asStringArray(rubric.frontend_evidence_refs),
      ...asStringArray(expected.frontend_evidence_refs),
    ]),
  ]);
}

/**
 * @param {string} filePath
 * @returns {Record<string, unknown>}
 */
function readJsonIfPresent(filePath) {
  const resolved = asNonEmptyString(filePath);
  if (!resolved || !fs.existsSync(resolved)) return {};
  try {
    return asRecord(readJson(resolved));
  } catch {
    return {};
  }
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function isLocalJsonFile(filePath) {
  const resolved = asNonEmptyString(filePath);
  return Boolean(resolved && path.isAbsolute(resolved) && resolved.endsWith(".json") && fs.existsSync(resolved));
}

/**
 * @param {Record<string, unknown>} request
 * @returns {string[]}
 */
function resolveBrowserTaskProofRefsFromRequest(request) {
  const expectedProofFile = asNonEmptyString(request.expected_browser_task_proof_file);
  const directProofFile = asNonEmptyString(request.browser_task_proof_file);
  const proofFile = directProofFile || expectedProofFile;
  const proof = proofFile && fs.existsSync(proofFile) ? readJsonIfPresent(proofFile) : {};
  return uniqueStrings([
    expectedProofFile,
    directProofFile,
    Object.keys(proof).length > 0 ? proofFile : "",
    ...asStringArray(proof.screenshot_files),
    ...asStringArray(proof.screenshot_refs),
    asNonEmptyString(proof.rendered_html_file),
    asNonEmptyString(proof.html_ref),
    asNonEmptyString(proof.dom_snapshot_file),
    asNonEmptyString(proof.dom_snapshot_ref),
    asNonEmptyString(proof.accessibility_summary_file),
    asNonEmptyString(proof.accessibility_summary_ref),
    asNonEmptyString(proof.visual_guardrail_file),
  ]);
}

/**
 * @param {Record<string, unknown>} webSmoke
 * @returns {string[]}
 */
function resolveBrowserTaskProofRefsFromWebSmoke(webSmoke) {
  const requestFile = asNonEmptyString(webSmoke.browser_task_proof_request_file);
  const request = readJsonIfPresent(requestFile);
  return uniqueStrings([
    requestFile,
    asNonEmptyString(webSmoke.browser_task_proof_file),
    ...asStringArray(webSmoke.screenshot_files),
    ...asStringArray(webSmoke.screenshot_refs),
    ...resolveBrowserTaskProofRefsFromRequest(request),
  ]);
}

/**
 * @param {string[]} frontendRefs
 * @returns {string[]}
 */
function resolveLateBrowserTaskProofEvidenceRefs(frontendRefs) {
  const refs = [];
  for (const ref of frontendRefs) {
    if (!isLocalJsonFile(ref)) continue;
    const payload = readJsonIfPresent(ref);
    refs.push(...resolveBrowserTaskProofRefsFromWebSmoke(payload));
    refs.push(...resolveBrowserTaskProofRefsFromRequest(payload));
  }
  return uniqueStrings(refs);
}

/**
 * @param {Record<string, unknown>} request
 * @returns {string[]}
 */
function resolveDecisionEvidenceRefs(request) {
  return uniqueStrings([
    ...asStringArray(asRecord(request.expected_response_shape).evidence_refs),
    ...resolveRequiredInspectedEvidenceRefs(request),
    ...resolveFrontendEvidenceRefs(request),
  ]);
}

/**
 * @param {string} action
 * @param {Record<string, unknown>} request
 * @returns {"pass" | "warn" | "not_pass" | "blocked" | "interaction_required" | "resumed"}
 */
function defaultSemanticStatus(action, request) {
  if (action === "block") return "blocked";
  if (action === "answer" || action === "frontend_interact") return "interaction_required";
  if (action === "retry_public_step") return "warn";
  if (action === "diagnose") return "not_pass";

  const deterministicStatus = normalizeObservationStatus(asNonEmptyString(asRecord(request.deterministic_analysis).status));
  return ["pass", "warn", "resumed"].includes(deterministicStatus) ? deterministicStatus : "not_pass";
}

/**
 * @param {string} action
 * @returns {string}
 */
function defaultReason(action) {
  if (action === "continue") return "Skill-agent accepted public evidence and required inspection refs.";
  if (action === "answer") return "Skill-agent will answer the requested public interaction.";
  if (action === "frontend_interact") return "Skill-agent will complete frontend interaction proof before continuation.";
  if (action === "retry_public_step") return "Skill-agent requested retry through public live E2E surfaces.";
  if (action === "diagnose") return "Skill-agent requested diagnosis through public live E2E surfaces.";
  if (action === "block") return "Skill-agent blocked continuation after reviewing public evidence.";
  return "Skill-agent prepared an operator decision artifact.";
}

/**
 * @param {{
 *   request: Record<string, unknown>,
 *   action: string,
 *   semanticStatus: string,
 *   inspectedEvidenceRefs: string[],
 *   evidenceRefs: string[],
 * }} options
 */
function buildValidationPreview(options) {
  const supportedActions = resolveSupportedDecisionActions(options.request);
  const requiredRefs = resolveRequiredInspectedEvidenceRefs(options.request);
  const frontendRefs = resolveFrontendEvidenceRefs(options.request);
  const deterministicStatus = normalizeObservationStatus(
    asNonEmptyString(asRecord(options.request.deterministic_analysis).status),
  );
  const semanticStatus = normalizeObservationStatus(options.semanticStatus);
  const missingRequired = requiredRefs.filter((ref) => !options.inspectedEvidenceRefs.includes(ref));
  const missingFrontend = frontendRefs.filter((ref) => !options.evidenceRefs.includes(ref));
  const rejectionRisks = uniqueStrings([
    supportedActions.includes(options.action) ? "" : `Action '${options.action}' is not supported by the request.`,
    missingRequired.length > 0 ? "Decision is missing required inspected evidence refs." : "",
    missingFrontend.length > 0 ? "Decision is missing required frontend evidence refs." : "",
    options.action === "continue" && !["pass", "warn", "resumed"].includes(deterministicStatus)
      ? `Continue is not allowed with deterministic status '${deterministicStatus}'.`
      : "",
    options.action === "continue" && !["pass", "warn", "resumed"].includes(semanticStatus)
      ? `Continue is not allowed with semantic status '${semanticStatus}'.`
      : "",
  ]);

  return {
    supported_actions: supportedActions,
    action_supported: supportedActions.includes(options.action),
    deterministic_status: deterministicStatus,
    semantic_status: semanticStatus,
    required_inspected_evidence_ref_count: requiredRefs.length,
    missing_required_inspected_evidence_refs: missingRequired,
    frontend_evidence_ref_count: frontendRefs.length,
    missing_frontend_evidence_refs: missingFrontend,
    rejection_risks: rejectionRisks,
    corrected_draft_available: missingRequired.length > 0 || missingFrontend.length > 0,
  };
}

/**
 * @param {{
 *   request: Record<string, unknown>,
 *   requestFile: string,
 *   action: string,
 *   semanticStatus?: string | null,
 *   findings?: string[],
 *   operatorNote?: string | null,
 *   reason?: string | null,
 * }} options
 * @returns {Record<string, unknown>}
 */
export function buildOperatorDecisionDraft(options) {
  const request = asRecord(options.request);
  const action = asNonEmptyString(options.action);
  if (!OPERATOR_DECISION_ACTIONS.includes(action)) {
    throw new UsageError(`Decision action must be one of: ${OPERATOR_DECISION_ACTIONS.join(", ")}.`);
  }

  const supportedActions = resolveSupportedDecisionActions(request);
  if (!supportedActions.includes(action)) {
    throw new UsageError(`Decision request does not support action '${action}'.`);
  }

  const frontendRefs = resolveFrontendEvidenceRefs(request);
  const inspectedEvidenceRefs = uniqueStrings([...resolveRequiredInspectedEvidenceRefs(request), ...frontendRefs]);
  const evidenceRefs = uniqueStrings([...resolveDecisionEvidenceRefs(request), ...inspectedEvidenceRefs]);
  const semanticStatus = normalizeObservationStatus(
    asNonEmptyString(options.semanticStatus) || defaultSemanticStatus(action, request),
  );
  const expected = asRecord(request.expected_response_shape);
  const operatorContext = asRecord(request.operator_context);
  const findings = uniqueStrings([
    ...asStringArray(options.findings),
    asNonEmptyString(options.operatorNote),
  ]);
  const uiUxStatus = semanticStatus === "interaction_required" ? "not_pass" : semanticStatus;
  const uiUxAnalysis =
    Object.keys(asRecord(expected.ui_ux_analysis)).length > 0 || frontendRefs.length > 0
      ? {
          status: action === "frontend_interact" ? "not_pass" : uiUxStatus,
          task_outcome: action === "frontend_interact" ? "not_pass" : uiUxStatus,
          findings,
          frontend_evidence_refs: frontendRefs,
        }
      : null;

  return {
    request_id: asNonEmptyString(request.request_id) || null,
    step_id: asNonEmptyString(request.step_id) || asNonEmptyString(expected.step_id) || null,
    step_instance_id: asNonEmptyString(request.step_instance_id) || asNonEmptyString(expected.step_instance_id) || null,
    iteration: Number(request.iteration) || Number(expected.iteration) || 1,
    status: "accepted",
    operator_ref:
      asNonEmptyString(expected.operator_ref) ||
      asNonEmptyString(operatorContext.operator_ref) ||
      "skill://live-e2e-runner",
    action,
    reason: asNonEmptyString(options.reason) || defaultReason(action),
    inspected_evidence_refs: inspectedEvidenceRefs,
    evidence_refs: evidenceRefs,
    frontend_evidence_refs: frontendRefs,
    semantic_analysis: {
      status: semanticStatus,
      judge_source: "skill-agent",
      findings,
    },
    ui_ux_analysis: uiUxAnalysis,
    source_agent_decision_request_ref: path.resolve(options.requestFile),
    created_at: nowIso(),
  };
}

/**
 * @param {{
 *   requestFile: string,
 *   action: string,
 *   semanticStatus?: string | null,
 *   findings?: string[],
 *   operatorNote?: string | null,
 *   reason?: string | null,
 *   outputFile?: string | null,
 *   write?: boolean,
 * }} options
 */
export function prepareOperatorDecisionArtifact(options) {
  const requestFile = path.resolve(options.requestFile);
  const request = asRecord(readJson(requestFile));
  const expectedRef = asNonEmptyString(request.operator_decision_expected_ref);
  const outputFile = options.outputFile ? path.resolve(options.outputFile) : expectedRef ? path.resolve(expectedRef) : null;
  if (!outputFile) {
    throw new UsageError("Decision request does not declare operator_decision_expected_ref; pass --output <path>.");
  }
  const decision = buildOperatorDecisionDraft({
    request,
    requestFile,
    action: options.action,
    semanticStatus: options.semanticStatus,
    findings: options.findings,
    operatorNote: options.operatorNote,
    reason: options.reason,
  });
  const validationPreview = buildValidationPreview({
    request,
    action: asNonEmptyString(decision.action),
    semanticStatus: asNonEmptyString(asRecord(decision.semantic_analysis).status),
    inspectedEvidenceRefs: asStringArray(decision.inspected_evidence_refs),
    evidenceRefs: asStringArray(decision.evidence_refs),
  });
  if (options.write !== false) {
    writeJson(outputFile, decision);
  }
  return {
    command: "scripts live-e2e decision prepare",
    status: options.write === false ? "preview" : "prepared",
    action: asNonEmptyString(decision.action),
    request_ref: requestFile,
    output_ref: outputFile,
    expected_operator_decision_ref: expectedRef || outputFile,
    inspected_evidence_ref_count: asStringArray(decision.inspected_evidence_refs).length,
    frontend_evidence_ref_count: asStringArray(decision.frontend_evidence_refs).length,
    validation_preview: validationPreview,
    install_hint:
      "Resume with manual-live-e2e using the same --project-ref, --profile, --run-id, and --operator-decision-file <output_ref>.",
    decision_preview: decision,
  };
}
