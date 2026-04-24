import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { loadContractFile, validateContractDocument } from "../../contracts/src/index.mjs";

import { initializeProjectRuntime } from "./project-init.mjs";

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
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
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeId(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * @param {string} projectRoot
 * @param {string} filePath
 * @returns {string}
 */
function toEvidenceRef(projectRoot, filePath) {
  return `evidence://${path.relative(projectRoot, filePath).replace(/\\/g, "/")}`;
}

/**
 * @param {string} filePath
 * @returns {Record<string, unknown>}
 */
function readJson(filePath) {
  return /** @type {Record<string, unknown>} */ (JSON.parse(fs.readFileSync(filePath, "utf8")));
}

/**
 * @param {string} dirPath
 * @returns {string[]}
 */
function listJsonFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  return fs
    .readdirSync(dirPath)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
}

/**
 * @param {string} projectRoot
 * @param {string} filePath
 * @param {import("../../contracts/src/index.d.ts").ContractFamily} family
 */
function loadContractDocument(projectRoot, filePath, family) {
  const loaded = loadContractFile({ filePath, family });
  if (!loaded.ok) {
    return null;
  }
  return {
    file: filePath,
    artifact_ref: toEvidenceRef(projectRoot, filePath),
    document: asRecord(loaded.document),
  };
}

/**
 * @param {string} projectRoot
 * @param {string} artifactsRoot
 */
function loadPacketArtifacts(projectRoot, artifactsRoot) {
  const files = listJsonFiles(artifactsRoot);
  return files
    .map((filePath) => {
      if (path.basename(filePath).startsWith("wave-ticket-")) {
        return loadContractDocument(projectRoot, filePath, "wave-ticket");
      }
      if (path.basename(filePath).includes(".handoff.")) {
        return loadContractDocument(projectRoot, filePath, "handoff-packet");
      }
      if (path.basename(filePath).includes(".artifact.")) {
        return loadContractDocument(projectRoot, filePath, "artifact-packet");
      }
      if (path.basename(filePath).startsWith("delivery-manifest-")) {
        return loadContractDocument(projectRoot, filePath, "delivery-manifest");
      }
      if (path.basename(filePath).startsWith("release-packet-")) {
        return loadContractDocument(projectRoot, filePath, "release-packet");
      }
      return null;
    })
    .filter(Boolean);
}

/**
 * @param {string} projectRoot
 * @param {string} reportsRoot
 */
function loadStepResults(projectRoot, reportsRoot) {
  return listJsonFiles(reportsRoot)
    .filter((filePath) => path.basename(filePath).startsWith("step-result-"))
    .map((filePath) => loadContractDocument(projectRoot, filePath, "step-result"))
    .filter(Boolean);
}

/**
 * @param {string} projectRoot
 * @param {string} reportsRoot
 */
function loadOptionalQualityArtifact(projectRoot, reportsRoot, fileName, family) {
  const filePath = path.join(reportsRoot, fileName);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return loadContractDocument(projectRoot, filePath, family);
}

/**
 * @param {string} projectRoot
 * @returns {string[]}
 */
function listChangedPaths(projectRoot) {
  const run = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (run.status !== 0) {
    return [];
  }
  return (run.stdout ?? "")
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim())
    .map((candidate) => {
      const renameParts = candidate.split(" -> ");
      return renameParts.length > 1 ? renameParts[renameParts.length - 1] : candidate;
    })
    .map((candidate) => candidate.replace(/\\/g, "/"));
}

/**
 * @param {string} pattern
 * @param {string} candidate
 * @returns {boolean}
 */
function matchesScopePattern(pattern, candidate) {
  const normalizedPattern = pattern.replace(/\\/g, "/").replace(/^\.\//u, "");
  const normalizedCandidate = candidate.replace(/\\/g, "/").replace(/^\.\//u, "");
  if (normalizedPattern === "**") {
    return true;
  }
  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedCandidate === prefix || normalizedCandidate.startsWith(`${prefix}/`);
  }
  if (!normalizedPattern.includes("*")) {
    return normalizedCandidate === normalizedPattern;
  }
  const wildcardPrefix = normalizedPattern.slice(0, normalizedPattern.indexOf("*"));
  return normalizedCandidate.startsWith(wildcardPrefix);
}

/**
 * @param {{
 *   findings: Array<Record<string, unknown>>,
 *   severity: "warn" | "fail",
 *   category: string,
 *   summary: string,
 *   evidenceRefs?: string[],
 * }} options
 */
function pushFinding(options) {
  options.findings.push({
    finding_id: `${options.category}.${String(options.findings.length + 1).padStart(2, "0")}`,
    severity: options.severity,
    category: options.category,
    summary: options.summary,
    evidence_refs: uniqueStrings(options.evidenceRefs ?? []),
  });
}

/**
 * @param {Array<Record<string, unknown>>} findings
 * @returns {"pass" | "warn" | "fail"}
 */
function summarizeFindings(findings) {
  if (findings.some((finding) => finding.severity === "fail")) {
    return "fail";
  }
  if (findings.length > 0) {
    return "warn";
  }
  return "pass";
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   runId: string,
 * }} options
 */
export function materializeReviewReport(options) {
  const init = initializeProjectRuntime(options);
  const packetArtifacts = loadPacketArtifacts(init.projectRoot, init.runtimeLayout.artifactsRoot);
  const stepResults = loadStepResults(init.projectRoot, init.runtimeLayout.reportsRoot);
  const analysisReport = loadOptionalQualityArtifact(
    init.projectRoot,
    init.runtimeLayout.reportsRoot,
    "project-analysis-report.json",
    "project-analysis-report",
  );
  const verifySummaryPath = path.join(init.runtimeLayout.reportsRoot, "verify-summary.json");
  const verifySummary = fs.existsSync(verifySummaryPath) ? readJson(verifySummaryPath) : null;

  const intakePacket =
    packetArtifacts.find((artifact) => artifact.document.packet_type === "intake-request") ?? null;
  const intakePacketBody =
    intakePacket && typeof intakePacket.document.body_ref === "string" && fs.existsSync(intakePacket.document.body_ref)
      ? readJson(intakePacket.document.body_ref)
      : {};
  const missionTraceability = asRecord(intakePacketBody.mission_traceability);
  const featureRequest = asRecord(intakePacketBody.feature_request);
  const requestDocument = asRecord(featureRequest.request_document);
  const missionId = asString(missionTraceability.mission_id);

  const latestSpecStep =
    stepResults.find((artifact) => asString(artifact.document.step_id)?.includes("spec") === true) ?? null;
  const latestHandoffPacket =
    packetArtifacts.find((artifact) => Object.prototype.hasOwnProperty.call(artifact.document, "approval_state")) ?? null;
  const executionStepResults = stepResults.filter((artifact) => asString(artifact.document.run_id) === options.runId);
  const implementStep =
    executionStepResults.find((artifact) => asString(asRecord(artifact.document.routed_execution).mode) !== null) ?? null;
  const deliveryManifest =
    packetArtifacts.find(
      (artifact) => artifact.document.run_id === options.runId && path.basename(artifact.file).startsWith("delivery-manifest-"),
    ) ?? null;
  const releasePacket =
    packetArtifacts.find(
      (artifact) => artifact.document.run_id === options.runId && path.basename(artifact.file).startsWith("release-packet-"),
    ) ?? null;

  /** @type {Array<Record<string, unknown>>} */
  const featureTraceabilityFindings = [];
  if (!intakePacket) {
    pushFinding({
      findings: featureTraceabilityFindings,
      severity: "fail",
      category: "feature-traceability",
      summary: "No intake-request artifact-packet is present for review traceability.",
    });
  }
  if (!missionId) {
    pushFinding({
      findings: featureTraceabilityFindings,
      severity: "warn",
      category: "feature-traceability",
      summary: "Mission id is missing from the intake packet body.",
      evidenceRefs: intakePacket ? [intakePacket.artifact_ref] : [],
    });
  }
  const analysisFeatureTraceability = asRecord(asRecord(analysisReport?.document).feature_traceability);
  if (!analysisReport) {
    pushFinding({
      findings: featureTraceabilityFindings,
      severity: "fail",
      category: "feature-traceability",
      summary: "Project analysis report is missing for review traceability.",
    });
  } else if (missionId && asString(analysisFeatureTraceability.mission_id) !== missionId) {
    pushFinding({
      findings: featureTraceabilityFindings,
      severity: "fail",
      category: "feature-traceability",
      summary: "Discovery analysis does not preserve the selected mission id.",
      evidenceRefs: [analysisReport.artifact_ref],
    });
  }

  /** @type {Array<Record<string, unknown>>} */
  const discoveryFindings = [];
  if (!latestSpecStep) {
    pushFinding({
      findings: discoveryFindings,
      severity: "fail",
      category: "discovery-quality",
      summary: "No spec step-result is available to prove discovery-to-spec closure.",
    });
  } else {
    const specFeatureTraceability = asRecord(asRecord(latestSpecStep.document.routed_execution).feature_traceability);
    if (missionId && asString(specFeatureTraceability.mission_id) !== missionId) {
      pushFinding({
        findings: discoveryFindings,
        severity: "fail",
        category: "discovery-quality",
        summary: "Spec step-result is not traceable to the selected feature mission.",
        evidenceRefs: [latestSpecStep.artifact_ref],
      });
    }
  }
  if (!latestHandoffPacket) {
    pushFinding({
      findings: discoveryFindings,
      severity: "fail",
      category: "discovery-quality",
      summary: "No handoff packet is available for review.",
    });
  } else {
    const handoffFeatureTraceability = asRecord(latestHandoffPacket.document.feature_traceability);
    if (missionId && asString(handoffFeatureTraceability.mission_id) !== missionId) {
      pushFinding({
        findings: discoveryFindings,
        severity: "warn",
        category: "discovery-quality",
        summary: "Handoff packet does not explicitly preserve the selected mission id.",
        evidenceRefs: [latestHandoffPacket.artifact_ref],
      });
    }
  }

  /** @type {Array<Record<string, unknown>>} */
  const artifactFindings = [];
  if (!verifySummary || verifySummary.status !== "passed") {
    pushFinding({
      findings: artifactFindings,
      severity: "fail",
      category: "artifact-quality",
      summary: "Verify-summary is missing or did not pass, so build/lint/test linkage is incomplete.",
      evidenceRefs: fs.existsSync(verifySummaryPath) ? [toEvidenceRef(init.projectRoot, verifySummaryPath)] : [],
    });
  }
  if (executionStepResults.length === 0) {
    pushFinding({
      findings: artifactFindings,
      severity: "fail",
      category: "artifact-quality",
      summary: `No execution step-result is linked to run '${options.runId}'.`,
    });
  }
  if (implementStep) {
    const routedExecution = asRecord(implementStep.document.routed_execution);
    const contextCompilation = asRecord(routedExecution.context_compilation);
    if (!asString(contextCompilation.compiled_context_ref)) {
      pushFinding({
        findings: artifactFindings,
        severity: "warn",
        category: "artifact-quality",
        summary: "Execution step-result is missing compiled-context linkage.",
        evidenceRefs: [implementStep.artifact_ref],
      });
    }
  }
  if (deliveryManifest) {
    const repoDeliveries = Array.isArray(deliveryManifest.document.repo_deliveries) ? deliveryManifest.document.repo_deliveries : [];
    const firstRepoDelivery = asRecord(repoDeliveries[0]);
    if (asString(firstRepoDelivery.repo_root) && asString(firstRepoDelivery.repo_root) !== init.projectRoot) {
      pushFinding({
        findings: artifactFindings,
        severity: "fail",
        category: "artifact-quality",
        summary: "Delivery manifest repo root is not anchored to the target checkout.",
        evidenceRefs: [deliveryManifest.artifact_ref],
      });
    }
  }
  if (releasePacket && !asString(releasePacket.document.delivery_manifest_ref)) {
    pushFinding({
      findings: artifactFindings,
      severity: "fail",
      category: "artifact-quality",
      summary: "Release packet is missing delivery-manifest lineage.",
      evidenceRefs: [releasePacket.artifact_ref],
    });
  }

  /** @type {Array<Record<string, unknown>>} */
  const codeFindings = [];
  const bootstrapOwnedPrefixes = ["examples/", "context/", ".aor/"];
  const bootstrapOwnedFiles = new Set(["project.aor.yaml"]);
  const ignoredInputFiles = new Set();
  const requestFile = asString(featureRequest.request_file);
  if (requestFile) {
    const resolvedRequestFile = path.isAbsolute(requestFile)
      ? requestFile
      : path.resolve(init.projectRoot, requestFile);
    const relativeRequestFile = path.relative(init.projectRoot, resolvedRequestFile).replace(/\\/g, "/");
    if (!relativeRequestFile.startsWith("../") && relativeRequestFile !== "") {
      ignoredInputFiles.add(relativeRequestFile);
    }
  }
  const rawChangedPaths = listChangedPaths(init.projectRoot);
  const codeChangedPaths = rawChangedPaths.filter((candidate) => {
    if (ignoredInputFiles.has(candidate)) return false;
    if (bootstrapOwnedFiles.has(candidate)) return false;
    return !bootstrapOwnedPrefixes.some((prefix) => candidate === prefix.slice(0, -1) || candidate.startsWith(prefix));
  });
  const allowedPaths = asStringArray(requestDocument.allowed_paths);
  const forbiddenPaths = asStringArray(requestDocument.forbidden_paths);
  if (codeChangedPaths.length === 0) {
    pushFinding({
      findings: codeFindings,
      severity: "warn",
      category: "code-quality",
      summary: "No non-bootstrap changed paths were detected for the reviewed run.",
      evidenceRefs: implementStep ? [implementStep.artifact_ref] : [],
    });
  }
  for (const changedPath of codeChangedPaths) {
    if (forbiddenPaths.some((pattern) => matchesScopePattern(pattern, changedPath))) {
      pushFinding({
        findings: codeFindings,
        severity: "fail",
        category: "code-quality",
        summary: `Changed path '${changedPath}' falls inside a forbidden mission scope.`,
      });
    }
    if (allowedPaths.length > 0 && !allowedPaths.some((pattern) => matchesScopePattern(pattern, changedPath))) {
      pushFinding({
        findings: codeFindings,
        severity: "fail",
        category: "code-quality",
        summary: `Changed path '${changedPath}' is outside the allowed mission scope.`,
      });
    }
    if (
      changedPath.startsWith("docs/backlog/") ||
      changedPath.startsWith(".agents/") ||
      changedPath.startsWith("scripts/live-e2e/")
    ) {
      pushFinding({
        findings: codeFindings,
        severity: "fail",
        category: "code-quality",
        summary: `Changed path '${changedPath}' leaks into control-plane-only content.`,
      });
    }
  }

  const allFindings = [
    ...featureTraceabilityFindings,
    ...discoveryFindings,
    ...artifactFindings,
    ...codeFindings,
  ];
  const overallStatus = summarizeFindings(allFindings);
  const reviewRecommendation =
    overallStatus === "fail" ? "repair" : overallStatus === "warn" ? "required-human-review" : "proceed";
  const evidenceRefs = uniqueStrings([
    ...(intakePacket ? [intakePacket.artifact_ref] : []),
    ...(analysisReport ? [analysisReport.artifact_ref] : []),
    ...(latestSpecStep ? [latestSpecStep.artifact_ref] : []),
    ...(latestHandoffPacket ? [latestHandoffPacket.artifact_ref] : []),
    ...executionStepResults.map((artifact) => artifact.artifact_ref),
    ...(deliveryManifest ? [deliveryManifest.artifact_ref] : []),
    ...(releasePacket ? [releasePacket.artifact_ref] : []),
    ...(fs.existsSync(verifySummaryPath) ? [toEvidenceRef(init.projectRoot, verifySummaryPath)] : []),
  ]);
  const reviewReport = {
    review_report_id: `${options.runId}.review-report.v1`,
    project_id: init.projectId,
    run_id: options.runId,
    generated_at: new Date().toISOString(),
    overall_status: overallStatus,
    review_recommendation: reviewRecommendation,
    feature_traceability: {
      status: summarizeFindings(featureTraceabilityFindings),
      mission_id: missionId,
      input_packet_ref: intakePacket?.artifact_ref ?? null,
      request_title: asString(featureRequest.title),
      request_brief: asString(featureRequest.brief),
    },
    discovery_quality: {
      status: summarizeFindings(discoveryFindings),
      analysis_report_ref: analysisReport?.artifact_ref ?? null,
      spec_step_result_ref: latestSpecStep?.artifact_ref ?? null,
      handoff_packet_ref: latestHandoffPacket?.artifact_ref ?? null,
      findings: discoveryFindings,
    },
    artifact_quality: {
      status: summarizeFindings(artifactFindings),
      verify_summary_ref: fs.existsSync(verifySummaryPath) ? toEvidenceRef(init.projectRoot, verifySummaryPath) : null,
      execution_step_result_refs: executionStepResults.map((artifact) => artifact.artifact_ref),
      delivery_manifest_ref: deliveryManifest?.artifact_ref ?? null,
      release_packet_ref: releasePacket?.artifact_ref ?? null,
      findings: artifactFindings,
    },
    code_quality: {
      status: summarizeFindings(codeFindings),
      changed_paths: codeChangedPaths,
      allowed_paths: allowedPaths,
      forbidden_paths: forbiddenPaths,
      findings: codeFindings,
    },
    findings: allFindings,
    evidence_refs: evidenceRefs,
  };

  const validation = validateContractDocument({
    family: "review-report",
    document: reviewReport,
    source: "runtime://review-report",
  });
  if (!validation.ok) {
    const issues = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated review-report failed contract validation: ${issues}`);
  }

  const reviewReportFile = path.join(init.runtimeLayout.reportsRoot, `review-report-${normalizeId(options.runId)}.json`);
  fs.writeFileSync(reviewReportFile, `${JSON.stringify(reviewReport, null, 2)}\n`, "utf8");

  return {
    ...init,
    reviewReport,
    reviewReportFile,
  };
}
