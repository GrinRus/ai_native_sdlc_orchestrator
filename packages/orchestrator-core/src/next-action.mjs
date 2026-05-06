import fs from "node:fs";
import path from "node:path";

import { validateContractDocument } from "../../contracts/src/index.mjs";
import { initializeProjectRuntime } from "./project-init.mjs";

const TERMINAL_RUN_STATUSES = new Set(["canceled", "cancelled", "completed", "failed", "pass", "fail", "aborted"]);

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
 * @param {string} value
 * @returns {string}
 */
function shellQuote(value) {
  return /^[A-Za-z0-9_./:@=-]+$/u.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
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
 * @returns {Record<string, unknown> | null}
 */
function readJsonFile(filePath) {
  try {
    return /** @type {Record<string, unknown>} */ (JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return null;
  }
}

/**
 * @param {string} dirPath
 * @returns {string[]}
 */
function listJsonFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
}

/**
 * @param {string} command
 * @param {string} projectRoot
 * @returns {string}
 */
function projectCommand(command, projectRoot) {
  return `aor ${command} --project-ref ${shellQuote(projectRoot)}`;
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @returns {{ packetFile: string, bodyFile: string | null, packet: Record<string, unknown>, body: Record<string, unknown> | null } | null}
 */
function findLatestIntakePacket(init) {
  for (const filePath of listJsonFiles(init.runtimeLayout.artifactsRoot)) {
    if (!path.basename(filePath).includes(".artifact.intake.")) continue;
    const packet = readJsonFile(filePath);
    if (asString(packet?.packet_type) !== "intake-request") continue;
    const bodyFile = asString(packet?.body_ref);
    return {
      packetFile: filePath,
      bodyFile,
      packet,
      body: bodyFile && fs.existsSync(bodyFile) ? readJsonFile(bodyFile) : null,
    };
  }
  return null;
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @returns {{ stateFile: string, state: Record<string, unknown> } | null}
 */
function findActiveRun(init) {
  for (const filePath of listJsonFiles(init.runtimeLayout.stateRoot)) {
    if (!path.basename(filePath).startsWith("run-control-state-")) continue;
    const state = readJsonFile(filePath);
    const status = asString(state?.status);
    if (status && !TERMINAL_RUN_STATUSES.has(status)) {
      return { stateFile: filePath, state };
    }
  }
  return null;
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @returns {string | null}
 */
function findDiscoveryReport(init) {
  return (
    listJsonFiles(init.runtimeLayout.reportsRoot).find((filePath) => {
      const report = readJsonFile(filePath);
      return asString(report?.report_id)?.includes(".analysis.") || asRecord(report?.discovery_research).status;
    }) ?? null
  );
}

/**
 * @param {{ projectRoot: string, code: string, summary: string, evidenceRefs?: string[], nextCommand: string }} blocker
 * @returns {Record<string, unknown>}
 */
function createBlocker(blocker) {
  return {
    code: blocker.code,
    summary: blocker.summary,
    evidence_refs: blocker.evidenceRefs ?? [],
    next_command: blocker.nextCommand,
  };
}

/**
 * @param {Record<string, unknown> | null} body
 * @returns {{ deliveryMode: string, allowedPaths: string[], forbiddenPaths: string[], missingFields: string[], missionId: string | null, completenessStatus: string }}
 */
function resolveMissionState(body) {
  const missionTraceability = asRecord(body?.mission_traceability);
  const featureRequest = asRecord(body?.feature_request);
  const requestDocument = asRecord(featureRequest.request_document);
  const missionScope = asRecord(body?.mission_scope);
  const completeness = asRecord(body?.product_intake_completeness);
  return {
    deliveryMode:
      asString(missionScope.delivery_mode) ??
      asString(missionTraceability.delivery_mode) ??
      asString(featureRequest.delivery_mode) ??
      asString(requestDocument.delivery_mode) ??
      asString(requestDocument.write_mode) ??
      "no-write",
    allowedPaths: asStringArray(missionScope.allowed_paths).length > 0
      ? asStringArray(missionScope.allowed_paths)
      : asStringArray(featureRequest.allowed_paths).length > 0
        ? asStringArray(featureRequest.allowed_paths)
        : asStringArray(requestDocument.allowed_paths),
    forbiddenPaths: asStringArray(missionScope.forbidden_paths).length > 0
      ? asStringArray(missionScope.forbidden_paths)
      : asStringArray(featureRequest.forbidden_paths).length > 0
        ? asStringArray(featureRequest.forbidden_paths)
        : asStringArray(requestDocument.forbidden_paths),
    missingFields: asStringArray(completeness.missing_fields),
    missionId: asString(missionTraceability.mission_id),
    completenessStatus: asString(completeness.status) ?? "incomplete",
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 * }} options
 */
export function resolveNextAction(options = {}) {
  const init = initializeProjectRuntime({
    cwd: options.cwd,
    projectRef: options.projectRef,
    projectProfile: options.projectProfile,
    runtimeRoot: options.runtimeRoot,
    command: "aor next",
  });
  const projectRoot = init.projectRoot;
  const reportFile = path.join(init.runtimeLayout.reportsRoot, "next-action-report.json");
  const onboardingStatus = asString(init.onboardingReport?.status) ?? "blocked";
  const onboardingEvidenceRef = toEvidenceRef(projectRoot, init.onboardingReportFile);
  const evidenceRefs = [toEvidenceRef(projectRoot, init.stateFile), onboardingEvidenceRef];

  let status = "ready";
  let stage = "mission-intake";
  let primaryAction = {
    action_id: "mission-create",
    command: `${projectCommand("mission create", projectRoot)} --delivery-mode no-write`,
    reason: "No intake-request packet exists yet.",
    low_level_command: "intake create",
    evidence_refs: [...evidenceRefs],
  };
  let blockers = [];
  let missionState = {
    intake_packet_ref: null,
    intake_body_ref: null,
    completeness_status: "missing",
    missing_fields: ["intake-request"],
    mission_id: null,
    delivery_mode: "no-write",
    allowed_paths: [],
    forbidden_paths: [],
  };

  const activeRun = findActiveRun(init);
  if (activeRun) {
    const runId = asString(activeRun.state.run_id) ?? "current";
    const activeRunRef = toEvidenceRef(projectRoot, activeRun.stateFile);
    status = "ready";
    stage = "run-active";
    primaryAction = {
      action_id: "inspect-active-run",
      command: `${projectCommand("run status", projectRoot)} --run-id ${shellQuote(runId)}`,
      reason: "A non-terminal run-control state is already present; inspect it before starting another action.",
      low_level_command: "run status",
      evidence_refs: [...evidenceRefs, activeRunRef],
    };
  } else if (onboardingStatus !== "ready") {
    status = "blocked";
    stage = "onboarding";
    const nextCommand = asString(asRecord(init.onboardingReport?.next_action).command) ?? projectCommand("onboard", projectRoot);
    blockers = asRecord(init.onboardingReport).blockers && Array.isArray(asRecord(init.onboardingReport).blockers)
      ? /** @type {Array<Record<string, unknown>>} */ (asRecord(init.onboardingReport).blockers)
      : [
          createBlocker({
            projectRoot,
            code: "onboarding-blocked",
            summary: "Onboarding report is not ready.",
            evidenceRefs: [onboardingEvidenceRef],
            nextCommand,
          }),
        ];
    primaryAction = {
      action_id: "fix-onboarding",
      command: nextCommand,
      reason: "Onboarding readiness must pass before mission intake or execution planning.",
      low_level_command: "onboard",
      evidence_refs: [...evidenceRefs],
    };
  } else {
    const intake = findLatestIntakePacket(init);
    if (intake) {
      const packetRef = toEvidenceRef(projectRoot, intake.packetFile);
      const bodyRef = intake.bodyFile ? toEvidenceRef(projectRoot, intake.bodyFile) : null;
      evidenceRefs.push(packetRef);
      if (bodyRef) evidenceRefs.push(bodyRef);
      if (!intake.body) {
        status = "blocked";
        stage = "mission-intake";
        blockers = [
          createBlocker({
            projectRoot,
            code: "intake-body-missing",
            summary: "Latest intake-request packet does not have a readable body_ref.",
            evidenceRefs: [packetRef],
            nextCommand: projectCommand("mission create", projectRoot),
          }),
        ];
        primaryAction = {
          action_id: "repair-mission-intake",
          command: projectCommand("mission create", projectRoot),
          reason: "The latest mission intake evidence is not readable.",
          low_level_command: "intake create",
          evidence_refs: [...evidenceRefs],
        };
      } else {
        const resolvedMissionState = resolveMissionState(intake.body);
        missionState = {
          intake_packet_ref: packetRef,
          intake_body_ref: bodyRef,
          completeness_status: resolvedMissionState.completenessStatus,
          missing_fields: resolvedMissionState.missingFields,
          mission_id: resolvedMissionState.missionId,
          delivery_mode: resolvedMissionState.deliveryMode,
          allowed_paths: resolvedMissionState.allowedPaths,
          forbidden_paths: resolvedMissionState.forbiddenPaths,
        };
        if (resolvedMissionState.completenessStatus !== "complete") {
          status = "blocked";
          stage = "mission-intake";
          blockers = resolvedMissionState.missingFields.map((field) =>
            createBlocker({
              projectRoot,
              code: `mission-${field}-missing`,
              summary: `Mission intake is missing ${field}.`,
              evidenceRefs: [packetRef, ...(bodyRef ? [bodyRef] : [])],
              nextCommand: `${projectCommand("mission create", projectRoot)} --delivery-mode ${shellQuote(resolvedMissionState.deliveryMode)}`,
            }),
          );
          primaryAction = {
            action_id: "complete-mission-intake",
            command: `${projectCommand("mission create", projectRoot)} --delivery-mode ${shellQuote(resolvedMissionState.deliveryMode)}`,
            reason: "Mission intake must include goals, constraints, KPIs, Definition of Done, and source refs before discovery planning.",
            low_level_command: "intake create",
            evidence_refs: [...evidenceRefs],
          };
        } else {
          const discoveryReport = findDiscoveryReport(init);
          if (discoveryReport) {
            const discoveryRef = toEvidenceRef(projectRoot, discoveryReport);
            stage = "spec-build";
            primaryAction = {
              action_id: "spec-build",
              command: `${projectCommand("spec build", projectRoot)} --input-packet ${shellQuote(intake.packetFile)}`,
              reason: "Mission intake and discovery evidence exist; build the routed specification next.",
              low_level_command: "spec build",
              evidence_refs: [...evidenceRefs, discoveryRef],
            };
          } else {
            stage = "discovery";
            primaryAction = {
              action_id: "discovery-run",
              command: `${projectCommand("discovery run", projectRoot)} --input-packet ${shellQuote(intake.packetFile)}`,
              reason: "Mission intake is complete; discovery should collect repository and research evidence before planning.",
              low_level_command: "discovery run",
              evidence_refs: [...evidenceRefs],
            };
          }
        }
      }
    }
  }

  const report = {
    report_id: `${init.projectId}.next-action.v1`,
    project_id: init.projectId,
    version: 1,
    generated_from: {
      command: "aor next",
      project_root: projectRoot,
      project_profile_ref: init.projectProfileRef,
    },
    project_state: {
      stage,
      runtime_root: init.runtimeRoot,
      runtime_state_file: init.stateFile,
      onboarding_report_ref: onboardingEvidenceRef,
      active_run_ref: activeRun ? toEvidenceRef(projectRoot, activeRun.stateFile) : null,
    },
    mission_state: missionState,
    primary_action: primaryAction,
    blockers,
    bounded_execution: {
      requested_delivery_mode: missionState.delivery_mode,
      upstream_writes_default: false,
      delivery_capable_mode: missionState.delivery_mode !== "no-write",
      allowed_paths: missionState.allowed_paths,
      forbidden_paths: missionState.forbidden_paths,
      requires_review_before_writeback: missionState.delivery_mode !== "no-write",
    },
    evidence_refs: Array.from(new Set([...evidenceRefs, ...primaryAction.evidence_refs])),
    status,
    created_at: new Date().toISOString(),
  };

  const validation = validateContractDocument({
    family: "next-action-report",
    document: report,
    source: "runtime://next-action-report",
  });
  if (!validation.ok) {
    const issueSummary = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated next-action report failed contract validation: ${issueSummary}`);
  }
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return {
    ...init,
    nextActionReport: report,
    nextActionReportFile: reportFile,
    nextActionReportId: report.report_id,
  };
}
