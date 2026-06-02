import fs from "node:fs";
import path from "node:path";

import { loadContractFile, validateContractDocument } from "../../contracts/src/index.mjs";

import { executeRoutedStep } from "./step-execution-engine.mjs";
import { initializeProjectRuntime } from "./project-init.mjs";
import { resolveNextAction } from "./next-action.mjs";
import { assertFlowMutationAllowed } from "./control-plane/flow-projections.mjs";

export const OPERATOR_REQUEST_INTENTS = Object.freeze([
  "analyze",
  "explain",
  "revise-document",
  "create-document",
  "repair",
  "validate",
  "plan",
  "implement",
  "review",
]);

export const OPERATOR_REQUEST_STAGES = Object.freeze([
  "readiness",
  "mission",
  "discovery",
  "research",
  "spec",
  "planning",
  "implement",
  "review",
  "qa",
  "repair",
  "delivery",
  "release",
  "learning",
]);

export const OPERATOR_REQUEST_TARGET_STEPS = Object.freeze([
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
]);

const DELIVERY_MODES = Object.freeze(["no-write", "patch-only", "local-branch", "fork-first-pr"]);
const OPERATOR_INTERVENTION_CONTEXT_BUNDLE = "context-bundle://context.bundle.operator-intervention@v1";
const REQUEST_FILE_REGEX = /^operator-request-.*\.json$/u;

export class OperatorRequestError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} [statusCode]
   */
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "OperatorRequestError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeForId(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
}

/**
 * @param {string} value
 * @returns {string}
 */
function toPosix(value) {
  return value.replace(/\\/g, "/");
}

/**
 * @param {string} projectRoot
 * @param {string} filePath
 * @returns {string}
 */
function toEvidenceRef(projectRoot, filePath) {
  return `evidence://${toPosix(path.relative(projectRoot, filePath))}`;
}

/**
 * @param {string} projectRoot
 * @param {string} filePath
 * @returns {string}
 */
function toOperatorRequestPacketRef(projectRoot, filePath) {
  return `packet://operator-request@${toEvidenceRef(projectRoot, filePath)}`;
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0))];
}

/**
 * @param {string} requestText
 * @returns {string}
 */
export function summarizeOperatorRequest(requestText) {
  const normalized = requestText.replace(/\s+/gu, " ").trim();
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
}

/**
 * @param {string} ref
 * @returns {string}
 */
function extractEvidenceRef(ref) {
  const packetMatch = /^packet:\/\/operator-request@(.+)$/u.exec(ref);
  return packetMatch ? packetMatch[1] : ref;
}

/**
 * @param {string} root
 * @param {string} filePath
 * @returns {boolean}
 */
function isPathInsideRoot(root, filePath) {
  const normalizedRoot = path.resolve(root);
  const normalizedFile = path.resolve(filePath);
  return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}${path.sep}`);
}

/**
 * @param {{ projectRoot: string, runtimeRoot?: string }} options
 * @param {string} ref
 * @returns {string | null}
 */
function resolveEvidenceRef(options, ref) {
  const evidenceRef = extractEvidenceRef(ref);
  if (!evidenceRef.startsWith("evidence://")) {
    return null;
  }
  const evidencePath = evidenceRef.slice("evidence://".length);
  if (!evidencePath) {
    return null;
  }
  const resolved = path.isAbsolute(evidencePath) ? evidencePath : path.resolve(options.projectRoot, evidencePath);
  const allowedRoots = [options.projectRoot, options.runtimeRoot].filter((entry) => typeof entry === "string");
  if (!allowedRoots.some((root) => isPathInsideRoot(root, resolved))) {
    throw new OperatorRequestError(
      "operator_request.ref_outside_project",
      `Operator request ref '${ref}' resolves outside the project runtime boundary.`,
      400,
    );
  }
  return path.resolve(resolved);
}

/**
 * @param {{ projectRoot: string, runtimeRoot?: string, targetRefs: string[], allowedPaths: string[], deliveryMode: string }} options
 */
function validateRequestScope(options) {
  for (const targetRef of options.targetRefs) {
    if (
      targetRef.startsWith("evidence://") ||
      targetRef.startsWith("packet://") ||
      targetRef.startsWith("compiled-context://") ||
      targetRef.startsWith("run://")
    ) {
      if (targetRef.startsWith("evidence://") || targetRef.startsWith("packet://operator-request@evidence://")) {
        resolveEvidenceRef(options, targetRef);
      }
      continue;
    }
    const resolved = path.isAbsolute(targetRef)
      ? path.resolve(targetRef)
      : path.resolve(options.projectRoot, targetRef);
    const normalizedRoot = path.resolve(options.projectRoot);
    if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
      throw new OperatorRequestError(
        "operator_request.invalid_target_ref",
        `Target ref '${targetRef}' must stay inside the project root or use a supported evidence/packet ref.`,
        400,
      );
    }
  }

  for (const allowedPath of options.allowedPaths) {
    if (path.isAbsolute(allowedPath)) {
      const resolved = path.resolve(allowedPath);
      const normalizedRoot = path.resolve(options.projectRoot);
      if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
        throw new OperatorRequestError(
          "operator_request.invalid_allowed_path",
          `Allowed path '${allowedPath}' must stay inside the project root.`,
          400,
        );
      }
      continue;
    }
    if (allowedPath === ".." || allowedPath.startsWith("../") || allowedPath.includes("/../")) {
      throw new OperatorRequestError(
        "operator_request.invalid_allowed_path",
        `Allowed path '${allowedPath}' must stay inside the project root.`,
        400,
      );
    }
  }

  if (options.deliveryMode !== "no-write" && options.allowedPaths.length === 0) {
    throw new OperatorRequestError(
      "operator_request.scope_required",
      "Non-no-write operator requests require at least one --allowed-path.",
      400,
    );
  }
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} filePath
 */
function assertRequestFileInRuntimeReports(init, filePath) {
  if (!isPathInsideRoot(init.runtimeLayout.reportsRoot, filePath)) {
    throw new OperatorRequestError(
      "operator_request.invalid_request_ref",
      "Operator request file refs must resolve under the project runtime reports directory.",
      400,
    );
  }
}

/**
 * @param {string} targetStep
 */
function assertSupportedTargetStep(targetStep) {
  if (!OPERATOR_REQUEST_TARGET_STEPS.includes(targetStep)) {
    throw new OperatorRequestError(
      "operator_request.invalid_target_step",
      `Unsupported operator request target step '${targetStep}'.`,
      400,
    );
  }
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} source
 */
function assertValidOperatorRequest(document, source) {
  const validation = validateContractDocument({
    family: "operator-request",
    document,
    source,
  });
  if (!validation.ok) {
    const message = validation.issues.map((issue) => issue.message).join("; ");
    throw new OperatorRequestError("operator_request.contract_invalid", message, 500);
  }
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @returns {Array<{ file: string, artifact_ref: string, operator_request_ref: string, document: Record<string, unknown> }>}
 */
function listRawOperatorRequestsForInit(init) {
  if (!fs.existsSync(init.runtimeLayout.reportsRoot)) {
    return [];
  }
  return fs
    .readdirSync(init.runtimeLayout.reportsRoot)
    .filter((entry) => REQUEST_FILE_REGEX.test(entry))
    .map((entry) => path.join(init.runtimeLayout.reportsRoot, entry))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)
    .flatMap((filePath) => {
      const loaded = loadContractFile({ filePath, family: "operator-request" });
      if (!loaded.ok || typeof loaded.document !== "object" || loaded.document === null || Array.isArray(loaded.document)) {
        return [];
      }
      return [
        {
          file: filePath,
          artifact_ref: toEvidenceRef(init.projectRoot, filePath),
          operator_request_ref: toOperatorRequestPacketRef(init.projectRoot, filePath),
          document: /** @type {Record<string, unknown>} */ (loaded.document),
        },
      ];
    });
}

/**
 * @param {Record<string, unknown>} document
 * @returns {Record<string, unknown>}
 */
export function sanitizeOperatorRequestDocument(document) {
  const sanitized = { ...document };
  delete sanitized.request_text;
  sanitized.request_summary = asString(document.request_summary) ?? summarizeOperatorRequest(asString(document.request_text) ?? "");
  return sanitized;
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 * }} options
 */
export function listOperatorRequests(options = {}) {
  const init = initializeProjectRuntime(options);
  return listRawOperatorRequestsForInit(init).map((entry) => ({
    ...entry,
    document: sanitizeOperatorRequestDocument(entry.document),
  }));
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   requestRef: string,
 * }} options
 */
function readOperatorRequest(options) {
  const init = initializeProjectRuntime(options);
  const requestRef = asString(options.requestRef);
  if (!requestRef) {
    throw new OperatorRequestError("operator_request.ref_required", "Operator request ref is required.", 400);
  }

  const directFile = path.isAbsolute(requestRef)
    ? requestRef
    : requestRef.startsWith("evidence://") || requestRef.startsWith("packet://operator-request@evidence://")
      ? resolveEvidenceRef({ projectRoot: init.projectRoot, runtimeRoot: init.runtimeLayout.projectRuntimeRoot }, requestRef)
      : null;
  if (directFile && fs.existsSync(directFile)) {
    assertRequestFileInRuntimeReports(init, directFile);
    const loaded = loadContractFile({ filePath: directFile, family: "operator-request" });
    if (!loaded.ok || typeof loaded.document !== "object" || loaded.document === null || Array.isArray(loaded.document)) {
      throw new OperatorRequestError("operator_request.not_found", `Operator request '${requestRef}' was not found.`, 404);
    }
    return {
      init,
      file: directFile,
      artifact_ref: toEvidenceRef(init.projectRoot, directFile),
      operator_request_ref: toOperatorRequestPacketRef(init.projectRoot, directFile),
      document: /** @type {Record<string, unknown>} */ (loaded.document),
    };
  }

  const normalizedRef = normalizeForId(requestRef);
  const found = listRawOperatorRequestsForInit(init).find((entry) => {
    const requestId = asString(entry.document.request_id) ?? "";
    return (
      requestId === requestRef ||
      normalizeForId(requestId) === normalizedRef ||
      entry.artifact_ref === requestRef ||
      entry.operator_request_ref === requestRef ||
      path.basename(entry.file) === requestRef
    );
  });
  if (!found) {
    throw new OperatorRequestError("operator_request.not_found", `Operator request '${requestRef}' was not found.`, 404);
  }
  return { init, ...found };
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} targetStep
 * @returns {Record<string, string[]> | undefined}
 */
function resolveContextBundleOverrides(init, targetStep) {
  const profile = loadContractFile({ filePath: init.projectProfilePath, family: "project-profile" });
  if (!profile.ok || typeof profile.document !== "object" || profile.document === null || Array.isArray(profile.document)) {
    return undefined;
  }
  const projectProfile = /** @type {Record<string, unknown>} */ (profile.document);
  const defaultContextBundles =
    typeof projectProfile.default_context_bundles === "object" && projectProfile.default_context_bundles !== null
      ? /** @type {Record<string, unknown>} */ (projectProfile.default_context_bundles)
      : {};
  const existing = asStringArray(defaultContextBundles[targetStep]);
  return {
    [targetStep]: uniqueStrings([...existing, OPERATOR_INTERVENTION_CONTEXT_BUNDLE]),
  };
}

/**
 * @param {string} intentType
 * @param {string} targetStage
 * @returns {string}
 */
function resolveTargetStep(intentType, targetStage) {
  if (intentType === "plan") return "planning";
  if (intentType === "implement") return "implement";
  if (intentType === "review") return "review";
  if (intentType === "validate") return "qa";
  if (intentType === "repair") return "repair";
  if (intentType === "revise-document" || intentType === "create-document") return "spec";
  if (targetStage === "planning") return "planning";
  if (targetStage === "implement") return "implement";
  if (targetStage === "review") return "review";
  if (targetStage === "qa") return "qa";
  if (targetStage === "repair") return "repair";
  if (targetStage === "research") return "research";
  if (targetStage === "spec") return "spec";
  return "discovery";
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   sourceSurface?: string,
 *   targetStage: string,
 *   intentType: string,
 *   requestText: string,
 *   targetRefs?: string[],
 *   allowedPaths?: string[],
 *   deliveryMode?: string,
 *   targetFlowId?: string,
 * }} options
 */
export function createOperatorRequest(options) {
  const init = initializeProjectRuntime(options);
  const targetStage = asString(options.targetStage);
  const intentType = asString(options.intentType);
  const requestText = asString(options.requestText);
  const sourceSurface = asString(options.sourceSurface) ?? "cli";
  const deliveryMode = asString(options.deliveryMode) ?? "no-write";
  const targetFlowId = asString(options.targetFlowId);
  const targetRefs = uniqueStrings(options.targetRefs ?? []);
  const allowedPaths = uniqueStrings(options.allowedPaths ?? []);

  if (!targetStage || !OPERATOR_REQUEST_STAGES.includes(targetStage)) {
    throw new OperatorRequestError(
      "operator_request.invalid_stage",
      `Unsupported operator request stage '${targetStage ?? "missing"}'.`,
      400,
    );
  }
  if (!intentType || !OPERATOR_REQUEST_INTENTS.includes(intentType)) {
    throw new OperatorRequestError(
      "operator_request.invalid_intent",
      `Unsupported operator request intent '${intentType ?? "missing"}'.`,
      400,
    );
  }
  if (!requestText) {
    throw new OperatorRequestError("operator_request.request_required", "Operator request text is required.", 400);
  }
  if (!DELIVERY_MODES.includes(deliveryMode)) {
    throw new OperatorRequestError(
      "operator_request.invalid_delivery_mode",
      `Unsupported operator request delivery mode '${deliveryMode}'.`,
      400,
    );
  }
  validateRequestScope({
    projectRoot: init.projectRoot,
    runtimeRoot: init.runtimeLayout.projectRuntimeRoot,
    targetRefs,
    allowedPaths,
    deliveryMode,
  });
  try {
    assertFlowMutationAllowed({
      projectRef: init.projectRoot,
      cwd: init.projectRoot,
      runtimeRoot: init.runtimeRoot,
      projectProfile: init.projectProfilePath,
      targetFlowId,
      intentType,
      deliveryMode,
    });
  } catch (error) {
    throw new OperatorRequestError(
      error instanceof Error && "code" in error ? String(error.code) : "operator_request.target_flow_invalid",
      error instanceof Error ? error.message : String(error),
      error instanceof Error && "statusCode" in error ? Number(error.statusCode) : 409,
    );
  }

  const timestamp = new Date().toISOString();
  const suffix = normalizeForId(`${targetStage}-${intentType}-${timestamp}`) || String(Date.now());
  const requestId = `operator-request.${init.projectId}.${suffix}`;
  const filePath = path.join(init.runtimeLayout.reportsRoot, `operator-request-${normalizeForId(requestId)}.json`);
  const operatorRequestRef = toOperatorRequestPacketRef(init.projectRoot, filePath);
  const document = {
    request_id: requestId,
    project_id: init.projectId,
    version: 1,
    source_surface: sourceSurface,
    target_stage: targetStage,
    ...(targetFlowId ? { target_flow_id: targetFlowId } : {}),
    intent_type: intentType,
    request_text: requestText,
    request_summary: summarizeOperatorRequest(requestText),
    target_refs: targetRefs,
    allowed_paths: allowedPaths,
    delivery_mode: deliveryMode,
    status: "created",
    created_at: timestamp,
    updated_at: timestamp,
    result_refs: [],
    evidence_refs: [operatorRequestRef],
  };
  assertValidOperatorRequest(document, filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return {
    operatorRequest: sanitizeOperatorRequestDocument(document),
    operatorRequestFile: filePath,
    operatorRequestRef: operatorRequestRef,
    requestId,
    status: "created",
    projectRoot: init.projectRoot,
    runtimeRoot: init.runtimeRoot,
  };
}

/**
 * @param {{
 *   init: ReturnType<typeof initializeProjectRuntime>,
 *   request: Record<string, unknown>,
 *   requestFile: string,
 *   status: string,
 *   patchRefs?: string[],
 *   proposalRefs?: string[],
 *   resultRefs?: string[],
 *   evidenceRefs?: string[],
 *   execution?: Record<string, unknown>,
 * }} options
 */
function updateOperatorRequest(options) {
  const updatedAt = new Date().toISOString();
  const document = {
    ...options.request,
    status: options.status,
    updated_at: updatedAt,
    result_refs: uniqueStrings([
      ...asStringArray(options.request.result_refs),
      ...asStringArray(options.resultRefs),
      ...asStringArray(options.proposalRefs),
      ...asStringArray(options.patchRefs),
    ]),
    evidence_refs: uniqueStrings([
      ...asStringArray(options.request.evidence_refs),
      ...asStringArray(options.evidenceRefs),
      ...asStringArray(options.proposalRefs),
      ...asStringArray(options.patchRefs),
    ]),
    ...(options.execution ? { execution: options.execution } : {}),
  };
  assertValidOperatorRequest(document, options.requestFile);
  fs.writeFileSync(options.requestFile, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return document;
}

/**
 * @param {{
 *   init: ReturnType<typeof initializeProjectRuntime>,
 *   request: Record<string, unknown>,
 *   targetStep: string,
 *   stepResultRef: string | null,
 *   compiledContextRef: string | null,
 * }} options
 * @returns {{ proposalRefs: string[], patchRefs: string[] }}
 */
function writeProposalArtifacts(options) {
  const requestId = asString(options.request.request_id) ?? "operator-request";
  const normalizedRequestId = normalizeForId(requestId) || "operator-request";
  const proposalFile = path.join(
    options.init.runtimeLayout.reportsRoot,
    `operator-request-proposal-${normalizedRequestId}.json`,
  );
  const proposal = {
    proposal_id: `proposal.${requestId}`,
    request_id: requestId,
    project_id: options.init.projectId,
    created_at: new Date().toISOString(),
    intent_type: asString(options.request.intent_type),
    delivery_mode: asString(options.request.delivery_mode) ?? "no-write",
    target_step: options.targetStep,
    target_refs: asStringArray(options.request.target_refs),
    allowed_paths: asStringArray(options.request.allowed_paths),
    summary: asString(options.request.request_summary),
    step_result_ref: options.stepResultRef,
    compiled_context_ref: options.compiledContextRef,
    runtime_behavior:
      asString(options.request.delivery_mode) === "patch-only"
        ? "Patch-only evidence was materialized; source files were not mutated by v1 operator request runtime."
        : "No-write evidence was materialized; source files were not mutated.",
  };
  fs.writeFileSync(proposalFile, `${JSON.stringify(proposal, null, 2)}\n`, "utf8");

  const proposalRefs = [toEvidenceRef(options.init.projectRoot, proposalFile)];
  const patchRefs = [];
  if (asString(options.request.delivery_mode) === "patch-only") {
    const patchFile = path.join(
      options.init.runtimeLayout.artifactsRoot,
      `operator-request-${normalizedRequestId}.patch`,
    );
    fs.mkdirSync(path.dirname(patchFile), { recursive: true });
    const patchTarget = asStringArray(options.request.allowed_paths)[0] ?? "docs/**";
    const patchBody = [
      `# Operator request patch proposal: ${requestId}`,
      `# Target step: ${options.targetStep}`,
      `# Scope: ${patchTarget}`,
      "#",
      "# This is patch evidence only. AOR v1 operator requests do not silently mutate target files.",
      "# Apply manually or route through an explicit future writeback flow after review.",
      "",
    ].join("\n");
    fs.writeFileSync(patchFile, patchBody, "utf8");
    patchRefs.push(toEvidenceRef(options.init.projectRoot, patchFile));
  }
  return { proposalRefs, patchRefs };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   requestRef: string,
 *   targetStep?: string,
 * }} options
 */
export function runOperatorRequest(options) {
  const loaded = readOperatorRequest(options);
  const request = loaded.document;
  const deliveryMode = asString(request.delivery_mode) ?? "no-write";
  const intentType = asString(request.intent_type) ?? "analyze";
  const targetStage = asString(request.target_stage) ?? "discovery";
  const targetFlowId = asString(request.target_flow_id);
  const targetStep = asString(options.targetStep) ?? resolveTargetStep(intentType, targetStage);
  const operatorRequestRef = loaded.operator_request_ref;
  assertSupportedTargetStep(targetStep);
  validateRequestScope({
    projectRoot: loaded.init.projectRoot,
    runtimeRoot: loaded.init.runtimeLayout.projectRuntimeRoot,
    targetRefs: asStringArray(request.target_refs),
    allowedPaths: asStringArray(request.allowed_paths),
    deliveryMode,
  });
  try {
    assertFlowMutationAllowed({
      projectRef: loaded.init.projectRoot,
      cwd: loaded.init.projectRoot,
      runtimeRoot: loaded.init.runtimeRoot,
      targetFlowId,
      intentType,
      deliveryMode,
    });
  } catch (error) {
    throw new OperatorRequestError(
      error instanceof Error && "code" in error ? String(error.code) : "operator_request.target_flow_invalid",
      error instanceof Error ? error.message : String(error),
      error instanceof Error && "statusCode" in error ? Number(error.statusCode) : 409,
    );
  }

  const runningDocument = updateOperatorRequest({
    init: loaded.init,
    request,
    requestFile: loaded.file,
    status: "running",
    evidenceRefs: [operatorRequestRef],
  });

  try {
    const runId = `operator-request.${normalizeForId(asString(request.request_id) ?? "request")}`;
    const stepId = `operator-request.${normalizeForId(targetStep) || "step"}`;
    const contextBundleOverrides = resolveContextBundleOverrides(loaded.init, targetStep);
    const routedExecution = executeRoutedStep({
      cwd: options.cwd,
      projectRef: options.projectRef,
      projectProfile: options.projectProfile,
      runtimeRoot: options.runtimeRoot,
      stepClass: targetStep,
      dryRun: true,
      runId,
      stepId,
      requireDiscoveryCompleteness: false,
      runtimeEvidenceRefs: [operatorRequestRef],
      contextBundleOverrides,
      operatorRequestRef,
    });
    const stepResultRef = toEvidenceRef(loaded.init.projectRoot, routedExecution.stepResultPath);
    const compiledContextRef =
      typeof routedExecution.stepResult.routed_execution?.context_compilation?.compiled_context_ref === "string"
        ? routedExecution.stepResult.routed_execution.context_compilation.compiled_context_ref
        : null;
    const proposalArtifacts = writeProposalArtifacts({
      init: loaded.init,
      request,
      targetStep,
      stepResultRef,
      compiledContextRef,
    });
    let nextAction = null;
    try {
      nextAction = resolveNextAction({
        cwd: options.cwd,
        projectRef: options.projectRef,
        projectProfile: options.projectProfile,
        runtimeRoot: options.runtimeRoot,
      });
    } catch {
      nextAction = null;
    }
    const nextActionReportFile =
      typeof nextAction?.reportPath === "string"
        ? nextAction.reportPath
        : typeof nextAction?.nextActionReportFile === "string"
          ? nextAction.nextActionReportFile
          : null;
    const nextActionReportRef = nextActionReportFile ? toEvidenceRef(loaded.init.projectRoot, nextActionReportFile) : null;
    const resultRefs = uniqueStrings([
      stepResultRef,
      compiledContextRef ?? "",
      nextActionReportRef ?? "",
    ]);
    const completedDocument = updateOperatorRequest({
      init: loaded.init,
      request: runningDocument,
      requestFile: loaded.file,
      status: "completed",
      resultRefs,
      proposalRefs: proposalArtifacts.proposalRefs,
      patchRefs: proposalArtifacts.patchRefs,
      evidenceRefs: uniqueStrings([
        operatorRequestRef,
        stepResultRef,
        compiledContextRef ?? "",
        nextActionReportRef ?? "",
      ]),
      execution: {
        run_id: runId,
        target_step: targetStep,
        routed_step_result_file: routedExecution.stepResultPath,
        routed_step_result_ref: stepResultRef,
        compiled_context_ref: compiledContextRef,
        delivery_mode: deliveryMode,
        no_write_enforced: true,
      },
    });
    return {
      operatorRequest: sanitizeOperatorRequestDocument(completedDocument),
      operatorRequestFile: loaded.file,
      operatorRequestRef,
      requestId: asString(request.request_id),
      status: "completed",
      runId,
      routedStepResultFile: routedExecution.stepResultPath,
      routedStepResultRef: stepResultRef,
      compiledContextRef,
      proposalRefs: proposalArtifacts.proposalRefs,
      patchRefs: proposalArtifacts.patchRefs,
      nextActionReportFile,
      nextActionReportRef,
      projectRoot: loaded.init.projectRoot,
      runtimeRoot: loaded.init.runtimeRoot,
    };
  } catch (error) {
    const failedDocument = updateOperatorRequest({
      init: loaded.init,
      request: runningDocument,
      requestFile: loaded.file,
      status: "failed",
      evidenceRefs: [operatorRequestRef],
      execution: {
        error: error instanceof Error ? error.message : String(error),
        target_step: targetStep,
        delivery_mode: deliveryMode,
      },
    });
    if (error instanceof OperatorRequestError) {
      throw error;
    }
    const wrapped = new OperatorRequestError(
      "operator_request.run_failed",
      error instanceof Error ? error.message : String(error),
      500,
    );
    wrapped.operatorRequest = sanitizeOperatorRequestDocument(failedDocument);
    throw wrapped;
  }
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   requestRef: string,
 * }} options
 */
export function getOperatorRequestStatus(options) {
  const loaded = readOperatorRequest(options);
  return {
    operatorRequest: sanitizeOperatorRequestDocument(loaded.document),
    operatorRequestFile: loaded.file,
    operatorRequestRef: loaded.operator_request_ref,
    requestId: asString(loaded.document.request_id),
    status: asString(loaded.document.status) ?? "unknown",
    projectRoot: loaded.init.projectRoot,
    runtimeRoot: loaded.init.runtimeRoot,
  };
}
