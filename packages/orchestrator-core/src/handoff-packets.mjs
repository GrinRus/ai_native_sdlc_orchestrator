import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

import { loadContractFile, validateContractDocument } from "../../contracts/src/index.mjs";

import { initializeProjectRuntime } from "./project-init.mjs";

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function unique(values) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.length > 0)));
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
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {unknown} value
 * @returns {Array<Record<string, unknown>>}
 */
function asRecordArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    : [];
}

/**
 * @param {string} value
 * @returns {string}
 */
function sanitizeFileSegment(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function stableDigest(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function toEvidenceRef(projectRoot, filePath) {
  return `evidence://${path.relative(projectRoot, filePath).replaceAll("\\", "/")}`;
}

function stableTaskSegment(value, fallback) {
  const normalized = sanitizeFileSegment(String(value ?? "").trim().toLowerCase()).replace(/^[._-]+|[._-]+$/gu, "");
  return normalized || fallback;
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const document = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return typeof document === "object" && document !== null && !Array.isArray(document) ? document : null;
  } catch {
    return null;
  }
}

function archivePlanRevision(filePath, document) {
  if (!document || !Number.isInteger(document.plan_version)) return null;
  const extension = path.extname(filePath);
  const archivePath = `${filePath.slice(0, -extension.length)}.plan-v${document.plan_version}${extension}`;
  if (!fs.existsSync(archivePath)) {
    fs.writeFileSync(archivePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  }
  return archivePath;
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {Array<{ repo_id: string, paths: string[] }>}
 */
function deriveRepoScopes(profile) {
  const repos = Array.isArray(profile.repos) ? profile.repos : [];
  /** @type {Array<{ repo_id: string, paths: string[] }>} */
  const scopes = [];

  for (const repo of repos) {
    const repoRecord = asRecord(repo);
    const repoId = typeof repoRecord.repo_id === "string" && repoRecord.repo_id.length > 0 ? repoRecord.repo_id : "main";
    const source = asRecord(repoRecord.source);
    const rootCandidate = typeof source.root === "string" && source.root.length > 0 ? source.root : ".";
    const normalizedPath = rootCandidate === "." ? "**" : `${rootCandidate.replace(/\/+$/u, "")}/**`;
    scopes.push({
      repo_id: repoId,
      paths: [normalizedPath],
    });
  }

  if (scopes.length === 0) {
    scopes.push({
      repo_id: "main",
      paths: ["**"],
    });
  }

  return scopes;
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {string[]}
 */
function deriveAllowedCommands(profile) {
  const repos = Array.isArray(profile.repos) ? profile.repos : [];
  /** @type {string[]} */
  const commands = [];

  for (const repo of repos) {
    const repoRecord = asRecord(repo);
    for (const field of ["lint_commands", "test_commands", "build_commands"]) {
      const value = repoRecord[field];
      if (!Array.isArray(value)) continue;
      for (const command of value) {
        if (typeof command === "string" && command.trim().length > 0) {
          commands.push(command);
        }
      }
    }
  }

  return unique(commands);
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizePathHint(value) {
  return value.replace(/\\/gu, "/").replace(/^\.\//u, "").replace(/\/+$/u, "");
}

/**
 * @param {string} value
 * @returns {string | null}
 */
function pathHintToAllowedPath(value) {
  const raw = value.trim();
  if (!raw) return null;
  const normalized = raw.replace(/\\/gu, "/").replace(/^\.\//u, "");
  if (normalized.includes("*")) return normalized;
  if (normalized.endsWith("/")) return `${normalizePathHint(normalized)}/**`;
  const fileName = normalized.split("/").at(-1) ?? normalized;
  return fileName.includes(".") ? normalized : `${normalizePathHint(normalized)}/**`;
}

/**
 * @param {Record<string, unknown>} artifactPacketBody
 * @returns {string[]}
 */
function deriveMissionAllowedPaths(artifactPacketBody) {
  const featureRequest = asRecord(artifactPacketBody.feature_request);
  const requestDocument = asRecord(featureRequest.request_document);
  const requestChangeEvidence = asRecord(requestDocument.change_evidence);
  const missionScope = asRecord(artifactPacketBody.mission_scope);
  return unique(
    [
      ...asStringArray(requestChangeEvidence.required_path_prefixes).map(pathHintToAllowedPath),
      ...asStringArray(featureRequest.allowed_paths).map(pathHintToAllowedPath),
      ...asStringArray(missionScope.allowed_paths).map(pathHintToAllowedPath),
    ].filter((entry) => typeof entry === "string" && entry.length > 0),
  );
}

/**
 * @param {Array<{ repo_id: string, paths: string[] }>} repoScopes
 * @param {string[]} allowedPaths
 * @returns {Array<{ repo_id: string, paths: string[] }>}
 */
function applyAllowedPathsToRepoScopes(repoScopes, allowedPaths) {
  if (allowedPaths.length === 0) return repoScopes;
  return repoScopes.map((scope) => ({
    repo_id: scope.repo_id,
    paths: scope.paths.includes("**") ? allowedPaths : scope.paths,
  }));
}

/**
 * @param {Record<string, unknown>} requestDocument
 * @returns {{ primary_commands: string[], diagnostic_commands: string[], diagnostic_failure_mode: string | null }}
 */
function deriveVerificationExpectations(requestDocument) {
  const postRunQuality = asRecord(requestDocument.post_run_quality);
  const diagnosticFailureMode =
    typeof postRunQuality.diagnostic_failure_mode === "string" && postRunQuality.diagnostic_failure_mode.trim().length > 0
      ? postRunQuality.diagnostic_failure_mode.trim()
      : null;
  return {
    primary_commands: unique(asStringArray(postRunQuality.primary_commands)),
    diagnostic_commands: unique(asStringArray(postRunQuality.diagnostic_commands)),
    diagnostic_failure_mode: diagnosticFailureMode,
  };
}

/**
 * @param {{ primary_commands: string[], diagnostic_commands: string[], diagnostic_failure_mode: string | null }} expectations
 * @returns {Array<Record<string, unknown>>}
 */
function buildVerificationCommandGroups(expectations) {
  const groups = [];
  if (expectations.primary_commands.length > 0) {
    groups.push({
      id: "post-change-primary",
      role: "test",
      phase: "post-change",
      enforcement: "required",
      timeout_class: "focused-test",
      commands: expectations.primary_commands,
    });
  }
  if (expectations.diagnostic_commands.length > 0) {
    groups.push({
      id: "diagnostic-full-suite",
      role: "full-suite",
      phase: "diagnostic",
      enforcement: expectations.diagnostic_failure_mode === "fail" ? "required" : "warn",
      timeout_class: "full-suite",
      commands: expectations.diagnostic_commands,
    });
  }
  return groups;
}

/**
 * @param {unknown} value
 * @returns {Array<Record<string, string>>}
 */
function normalizeKpis(value) {
  return asRecordArray(value)
    .map((entry) => {
      const kpiId = typeof entry.kpi_id === "string" && entry.kpi_id.trim().length > 0 ? entry.kpi_id.trim() : null;
      const name = typeof entry.name === "string" && entry.name.trim().length > 0 ? entry.name.trim() : null;
      const target = typeof entry.target === "string" && entry.target.trim().length > 0 ? entry.target.trim() : null;
      const measurement =
        typeof entry.measurement === "string" && entry.measurement.trim().length > 0 ? entry.measurement.trim() : null;
      if (!kpiId || !name || !target) return null;
      return {
        kpi_id: kpiId,
        name,
        target,
        ...(measurement ? { measurement } : {}),
      };
    })
    .filter((entry) => entry !== null);
}

function buildCriteriaCatalog({ goals, kpis, definitionOfDone, acceptanceCriteria, sourceRef }) {
  const entries = [];
  goals.forEach((text, index) => entries.push({
    criterion_id: `goal.${index + 1}`,
    kind: "goal",
    text,
    source_ref: sourceRef,
  }));
  kpis.forEach((kpi, index) => entries.push({
    criterion_id: `kpi.${stableTaskSegment(kpi.kpi_id, String(index + 1))}`,
    kind: "kpi",
    text: `${kpi.name}: ${kpi.target}`,
    source_ref: sourceRef,
  }));
  definitionOfDone.forEach((text, index) => entries.push({
    criterion_id: `dod.${index + 1}`,
    kind: "definition-of-done",
    text,
    source_ref: sourceRef,
  }));
  acceptanceCriteria.forEach((text, index) => {
    if (definitionOfDone.includes(text)) return;
    entries.push({
      criterion_id: `acceptance.${index + 1}`,
      kind: "acceptance",
      text,
      source_ref: sourceRef,
    });
  });
  if (entries.length === 0) {
    entries.push({
      criterion_id: "acceptance.bounded-objective",
      kind: "acceptance",
      text: "The approved bounded objective is implemented and verified.",
      source_ref: sourceRef,
    });
  }
  return entries;
}

function buildStructuredTasks({
  objective,
  allowedPaths,
  forbiddenPaths,
  repoIds,
  criteriaCatalog,
  verificationCommandGroups,
  expectedEvidence,
  candidateTasks,
  planSize,
}) {
  if (candidateTasks.length > 0) return candidateTasks;

  const objectiveSegment = stableTaskSegment(objective, "bounded-change");
  const criterionIds = criteriaCatalog.map((entry) => entry.criterion_id);
  const goalCriteria = criteriaCatalog
    .filter((entry) => entry.kind === "goal" || entry.kind === "kpi" || entry.kind === "acceptance")
    .map((entry) => entry.criterion_id);
  const deliveryCriteria = goalCriteria.length > 0 ? goalCriteria : criterionIds;
  const verificationRefs = verificationCommandGroups.map((group) => group.id);
  const normalizedEvidence = expectedEvidence.length > 0 ? expectedEvidence : ["verify-summary", "review-report"];
  const implementationEvidence = normalizedEvidence.filter((entry) => !entry.includes("verify"));
  const safeImplementationEvidence = implementationEvidence.length > 0 ? implementationEvidence : ["review-report"];
  const sharedScope = {
    repo_ids: repoIds,
    component_ids: [],
    allowed_paths: allowedPaths,
    forbidden_paths: forbiddenPaths,
  };
  const tasks = [
    {
      task_id: `task.${objectiveSegment}.design`,
      title: `Define the bounded change for ${objective}`,
      type: "design",
      objective: `Translate the approved objective into an explicit change boundary for ${objective}.`,
      rationale: "Implementation needs one reviewable scope and criterion mapping before repository changes begin.",
      scope: sharedScope,
      depends_on: [],
      work_items: [
        "Confirm the approved repository and path boundary.",
        "Map product criteria to concrete implementation and verification work.",
      ],
      criteria_refs: deliveryCriteria,
      verification: {
        command_group_refs: [],
        validators: ["contract-shape", "repo-scope"],
        manual_checks: [],
        success_conditions: ["The bounded change can be implemented without widening approved scope."],
      },
      expected_evidence: ["review-report"],
      risks: ["Ambiguous source evidence may require a plan revision before implementation."],
      stop_conditions: ["The approved objective conflicts with the declared path or repository scope."],
      execution_hints: { group_key: null, group_reason: null, parallel_candidate: false },
    },
  ];

  const implementationPaths = allowedPaths.slice(0, planSize === "small" ? 1 : 5);
  implementationPaths.forEach((allowedPath, index) => {
    const pathSegment = stableTaskSegment(allowedPath.replace(/\/\*\*$/u, ""), `scope-${index + 1}`);
    tasks.push({
      task_id: `task.${objectiveSegment}.${pathSegment}`,
      title: `Implement ${objective} in ${allowedPath}`,
      type: "implementation",
      objective: `Implement the approved behavior inside ${allowedPath}.`,
      rationale: `This scope is independently reviewable within the mission boundary for ${objective}.`,
      scope: {
        repo_ids: repoIds,
        component_ids: [],
        allowed_paths: [allowedPath],
        forbidden_paths: forbiddenPaths,
      },
      depends_on: [tasks[0].task_id],
      work_items: [
        `Apply the mission-specific change inside ${allowedPath}.`,
        "Preserve unrelated behavior and existing public contracts unless the approved plan changes them.",
      ],
      criteria_refs: deliveryCriteria,
      verification: {
        command_group_refs: verificationRefs,
        validators: ["repo-scope"],
        manual_checks: verificationRefs.length > 0 ? [] : ["Inspect the changed behavior against the approved criteria."],
        success_conditions: ["The scoped behavior satisfies its mapped criteria without forbidden-path changes."],
      },
      expected_evidence: safeImplementationEvidence,
      risks: ["Existing consumers inside the scoped path may rely on current behavior."],
      stop_conditions: ["The change requires files outside the approved scope."],
      execution_hints: { group_key: null, group_reason: null, parallel_candidate: implementationPaths.length > 1 },
    });
  });

  tasks.push({
    task_id: `task.${objectiveSegment}.acceptance`,
    title: `Verify acceptance for ${objective}`,
    type: "verification",
    objective: `Prove the implementation of ${objective} against every approved criterion.`,
    rationale: "Task completion must be derived from verification and evidence rather than an adapter success claim.",
    scope: sharedScope,
    depends_on: tasks.slice(1).map((task) => task.task_id),
    work_items: [
      "Run required verification command groups and deterministic validators.",
      "Link acceptance and review evidence to the stable task IDs.",
    ],
    criteria_refs: criterionIds,
    verification: {
      command_group_refs: verificationRefs,
      validators: ["repo-scope", "evidence-complete"],
      manual_checks: verificationRefs.length > 0 ? [] : ["Review the completed change against every acceptance criterion."],
      success_conditions: ["All required criteria, verification, and evidence are complete with no blocking findings."],
    },
    expected_evidence: normalizedEvidence,
    risks: ["A pre-existing failing baseline may require explicit evidence classification."],
    stop_conditions: ["Required verification is unavailable or produces a new blocking failure."],
    execution_hints: { group_key: null, group_reason: null, parallel_candidate: false },
  });
  return tasks.slice(0, 7);
}

/**
 * @param {{
 *   artifactPacketBody: Record<string, unknown>,
 *   objective: string,
 *   allowedPaths: string[],
 *   verificationExpectations: { primary_commands: string[], diagnostic_commands: string[], diagnostic_failure_mode: string | null },
 *   fallbackVerificationCommands?: string[],
 *   repoIds?: string[],
 *   sourceRef?: string,
 * }} options
 */
function derivePlanningContent(options) {
  const productIntake = asRecord(options.artifactPacketBody.product_intake);
  const featureRequest = asRecord(options.artifactPacketBody.feature_request);
  const requestDocument = asRecord(featureRequest.request_document);
  const goals = unique([...asStringArray(productIntake.goals), ...asStringArray(requestDocument.goals)]);
  const definitionOfDone = unique([
    ...asStringArray(productIntake.definition_of_done),
    ...asStringArray(requestDocument.definition_of_done),
  ]);
  const acceptanceCriteria = unique([
    ...asStringArray(requestDocument.acceptance_checks),
    ...definitionOfDone,
  ]);
  const expectedEvidence = unique(asStringArray(requestDocument.expected_evidence));
  const kpis = normalizeKpis(productIntake.kpis).length > 0 ? normalizeKpis(productIntake.kpis) : normalizeKpis(requestDocument.kpis);
  const verificationCommands =
    options.verificationExpectations.primary_commands.length > 0
      ? options.verificationExpectations.primary_commands
      : unique(asStringArray(options.fallbackVerificationCommands));
  const verificationExpectations = {
    ...options.verificationExpectations,
    primary_commands: verificationCommands,
  };
  const verificationCommandGroups = buildVerificationCommandGroups(verificationExpectations);
  const missionTraceability = asRecord(options.artifactPacketBody.mission_traceability);
  const missionScope = asRecord(options.artifactPacketBody.mission_scope);
  const repoIds = asStringArray(options.repoIds).length > 0 ? asStringArray(options.repoIds) : ["main"];
  const declaredSize = typeof missionTraceability.feature_size === "string" ? missionTraceability.feature_size : null;
  const planSize = repoIds.length > 1 && declaredSize === "small" ? "medium" : declaredSize ?? "medium";
  const sourceRef = typeof options.sourceRef === "string" && options.sourceRef.length > 0
    ? options.sourceRef
    : "packet://approved-intake";
  const criteriaCatalog = buildCriteriaCatalog({ goals, kpis, definitionOfDone, acceptanceCriteria, sourceRef });
  const taskPlanCandidate = Object.keys(asRecord(options.plannerCandidate)).length > 0
    ? asRecord(options.plannerCandidate)
    : asRecord(requestDocument.task_plan);
  const candidateTasks = asRecordArray(taskPlanCandidate.local_tasks);
  const normalizedExpectedEvidence = unique(["verify-summary", "review-report", ...expectedEvidence]);
  const localTasks = buildStructuredTasks({
    objective: options.objective,
    allowedPaths: options.allowedPaths,
    forbiddenPaths: asStringArray(missionScope.forbidden_paths),
    repoIds,
    criteriaCatalog,
    verificationCommandGroups,
    expectedEvidence: normalizedExpectedEvidence,
    candidateTasks,
    planSize,
  });

  return {
    goals,
    definition_of_done: definitionOfDone,
    acceptance_criteria: acceptanceCriteria,
    expected_evidence: normalizedExpectedEvidence,
    kpis,
    verification_expectations: verificationExpectations,
    verification_plan: {
      command_groups: verificationCommandGroups,
    },
    local_tasks: localTasks,
    task_model_version: 1,
    plan_size: ["small", "medium", "large", "xlarge"].includes(planSize) ? planSize : "medium",
    criteria_catalog: criteriaCatalog,
  };
}

/**
 * @param {string} artifactPacketFile
 * @returns {Record<string, unknown>}
 */
function loadApprovedArtifactPacket(artifactPacketFile) {
  if (!fs.existsSync(artifactPacketFile)) {
    throw new Error(`Approved artifact packet '${artifactPacketFile}' was not found.`);
  }

  const loaded = loadContractFile({
    filePath: artifactPacketFile,
    family: "artifact-packet",
  });
  if (!loaded.ok) {
    throw new Error(`Artifact packet '${artifactPacketFile}' failed contract validation.`);
  }

  const packet = asRecord(loaded.document);
  const status = packet.status;
  if (status !== "ready" && status !== "approved") {
    throw new Error(
      `Artifact packet '${artifactPacketFile}' must be in status 'ready' or 'approved' to create handoff artifacts.`,
    );
  }

  return packet;
}

/**
 * @param {Record<string, unknown>} packet
 * @returns {Record<string, unknown>}
 */
function loadArtifactPacketBody(packet) {
  const bodyRef = typeof packet.body_ref === "string" && packet.body_ref.trim().length > 0 ? packet.body_ref : null;
  if (!bodyRef || !fs.existsSync(bodyRef)) {
    return {};
  }
  try {
    return /** @type {Record<string, unknown>} */ (JSON.parse(fs.readFileSync(bodyRef, "utf8")));
  } catch {
    return {};
  }
}

/**
 * @param {{
 *   runtimeLayout: { artifactsRoot: string },
 *   projectId: string,
 *   cwd?: string,
 *   explicitPath?: string,
 * }} options
 * @returns {string}
 */
function resolveArtifactPacketPath(options) {
  if (options.explicitPath) {
    const explicitPath = options.explicitPath.startsWith("evidence://")
      ? options.explicitPath.slice("evidence://".length)
      : options.explicitPath;
    const absolutePath = path.isAbsolute(explicitPath)
      ? explicitPath
      : path.resolve(options.cwd ?? process.cwd(), explicitPath);
    return absolutePath;
  }

  const intakeCandidates = fs
    .readdirSync(options.runtimeLayout.artifactsRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.includes(".artifact.intake.") &&
        entry.name.endsWith(".json") &&
        !entry.name.endsWith(".body.json"),
    )
    .map((entry) => path.join(options.runtimeLayout.artifactsRoot, entry.name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  if (intakeCandidates.length > 0) {
    return intakeCandidates[0];
  }

  return path.join(options.runtimeLayout.artifactsRoot, `${options.projectId}.artifact.bootstrap.v1.json`);
}

/**
 * @param {{
 *   runtimeLayout: { artifactsRoot: string },
 *   projectId: string,
 *   cwd?: string,
 *   explicitPath?: string,
 * }} options
 * @returns {string}
 */
function resolveHandoffPacketPath(options) {
  if (options.explicitPath) {
    return path.isAbsolute(options.explicitPath)
      ? options.explicitPath
      : path.resolve(options.cwd ?? process.cwd(), options.explicitPath);
  }

  return path.join(options.runtimeLayout.artifactsRoot, `${options.projectId}.handoff.bootstrap.v1.json`);
}

/**
 * @param {{
 *  cwd?: string,
 *  projectRef?: string,
 *  projectProfile?: string,
 *  runtimeRoot?: string,
 *  ticketId?: string,
 *  approvedArtifactPath?: string,
 *  plannerCandidate?: Record<string, unknown>,
 *  plannerAttemptRef?: string,
 * }} options
 */
export function prepareHandoffArtifacts(options = {}) {
  const init = initializeProjectRuntime(options);

  const loadedProfile = loadContractFile({
    filePath: init.projectProfilePath,
    family: "project-profile",
  });
  if (!loadedProfile.ok) {
    throw new Error(`Project profile '${init.projectProfilePath}' failed contract validation.`);
  }

  const profile = asRecord(loadedProfile.document);
  const artifactPacketFile = resolveArtifactPacketPath({
    runtimeLayout: init.runtimeLayout,
    projectId: init.projectId,
    cwd: options.cwd,
    explicitPath: options.approvedArtifactPath,
  });
  const artifactPacket = loadApprovedArtifactPacket(artifactPacketFile);
  const artifactPacketBody = loadArtifactPacketBody(artifactPacket);
  const missionTraceability = asRecord(artifactPacketBody.mission_traceability);
  const featureRequest = asRecord(artifactPacketBody.feature_request);

  const profileRepoScopes = deriveRepoScopes(profile);
  const missionAllowedPaths = deriveMissionAllowedPaths(artifactPacketBody);
  const allowedPaths =
    missionAllowedPaths.length > 0 ? missionAllowedPaths : unique(profileRepoScopes.flatMap((scope) => scope.paths));
  const repoScopes = applyAllowedPathsToRepoScopes(profileRepoScopes, allowedPaths);
  const requestDocument = asRecord(featureRequest.request_document);
  const verificationExpectations = deriveVerificationExpectations(requestDocument);
  const allowedCommands = unique([...deriveAllowedCommands(profile), ...verificationExpectations.primary_commands]);

  const ticketId =
    typeof options.ticketId === "string" && options.ticketId.trim().length > 0
      ? options.ticketId.trim()
      : `${init.projectId}.wave.bootstrap.v1`;
  const ticketFileName = `wave-ticket-${sanitizeFileSegment(ticketId)}.json`;
  const waveTicketFile = path.join(init.runtimeLayout.artifactsRoot, ticketFileName);
  const objective =
    typeof featureRequest.title === "string" && featureRequest.title.trim().length > 0
      ? featureRequest.title
      : "Establish a bounded handoff packet from approved bootstrap artifacts.";
  const planningContent = derivePlanningContent({
    artifactPacketBody,
    objective,
    allowedPaths,
    verificationExpectations,
    fallbackVerificationCommands: allowedCommands,
    repoIds: repoScopes.map((scope) => scope.repo_id),
    sourceRef: `evidence://${path.relative(init.projectRoot, artifactPacketFile)}`,
    plannerCandidate: options.plannerCandidate,
  });

  const missionId = typeof missionTraceability.mission_id === "string" && missionTraceability.mission_id.trim().length > 0
    ? missionTraceability.mission_id.trim()
    : ticketId;
  const planId = `${init.projectId}.plan.${stableTaskSegment(missionId, "current")}`;
  const planDigest = stableDigest({
    objective,
    scope: { repo_scopes: repoScopes, allowed_paths: allowedPaths },
    plan_size: planningContent.plan_size,
    criteria_catalog: planningContent.criteria_catalog,
    local_tasks: planningContent.local_tasks,
    verification_plan: planningContent.verification_plan,
    expected_evidence: planningContent.expected_evidence,
  });
  const previousWaveTicket = readJsonFile(waveTicketFile);
  const previousHandoffFile = path.join(init.runtimeLayout.artifactsRoot, `${init.projectId}.handoff.bootstrap.v1.json`);
  const previousHandoff = readJsonFile(previousHandoffFile);
  const samePlan = previousWaveTicket?.task_model_version === 1
    && previousWaveTicket.plan_id === planId
    && previousWaveTicket.plan_digest === planDigest;
  const previousVersion = previousWaveTicket?.plan_id === planId && Number.isInteger(previousWaveTicket.plan_version)
    ? previousWaveTicket.plan_version
    : 0;
  const planVersion = samePlan ? previousVersion : previousVersion + 1;
  const supersededWaveTicket = previousWaveTicket?.task_model_version === 1
    ? { ...previousWaveTicket, plan_status: "superseded" }
    : previousWaveTicket;
  const supersededHandoff = previousHandoff?.task_model_version === 1
    ? {
        ...previousHandoff,
        plan_status: "superseded",
        status: "pending-approval",
        blocked_next_step: "This structured plan version was superseded and cannot start new execution units.",
      }
    : previousHandoff;
  const archivedWaveTicketFile = !samePlan && supersededWaveTicket
    ? archivePlanRevision(waveTicketFile, supersededWaveTicket)
    : null;
  if (!samePlan && supersededHandoff) archivePlanRevision(previousHandoffFile, supersededHandoff);
  const previousPlanRef = archivedWaveTicketFile
    ? `evidence://${path.relative(init.projectRoot, archivedWaveTicketFile)}`
    : previousWaveTicket?.previous_plan_ref ?? null;
  const revisionSummary = samePlan
    ? previousWaveTicket.revision_summary ?? { reason: "Idempotent regeneration.", material_change: false }
    : {
        reason: previousVersion > 0 ? "Structured plan content changed." : "Initial structured plan.",
        material_change: true,
        previous_plan_version: previousVersion || null,
        current_plan_version: planVersion,
      };

  const waveTicket = {
    ticket_id: ticketId,
    project_id: init.projectId,
    objective,
    scope: {
      repo_scopes: repoScopes.map((scope) => scope.repo_id),
      allowed_paths: allowedPaths,
    },
    dependencies: [String(artifactPacket.packet_id ?? "unknown-artifact")],
    risk_tier: "medium",
    status: "ready-for-handoff",
    task_model_version: planningContent.task_model_version,
    plan_id: planId,
    plan_version: planVersion,
    plan_status: samePlan && previousWaveTicket?.plan_status === "approved" ? "approved" : "proposed",
    plan_size: planningContent.plan_size,
    plan_digest: planDigest,
    previous_plan_ref: previousPlanRef,
    revision_summary: revisionSummary,
    criteria_catalog: planningContent.criteria_catalog,
    goals: planningContent.goals,
    definition_of_done: planningContent.definition_of_done,
    local_tasks: planningContent.local_tasks,
    acceptance_criteria: planningContent.acceptance_criteria,
    expected_evidence: planningContent.expected_evidence,
    verification_expectations: planningContent.verification_expectations,
    verification_plan: planningContent.verification_plan,
    kpis: planningContent.kpis,
    approved_input_ref: `evidence://${path.relative(init.projectRoot, artifactPacketFile)}`,
    source_refs: {
      artifact_packet_file: artifactPacketFile,
      project_profile_ref: init.projectProfileRef,
      previous_plan_ref: previousPlanRef,
      planner_attempt_ref: options.plannerAttemptRef ?? null,
      planning_input_refs: unique(asStringArray(options.planningInputRefs)),
    },
    feature_traceability: {
      mission_id: typeof missionTraceability.mission_id === "string" ? missionTraceability.mission_id : null,
      source_kind: typeof missionTraceability.source_kind === "string" ? missionTraceability.source_kind : null,
      request_title: typeof featureRequest.title === "string" ? featureRequest.title : null,
      request_brief: typeof featureRequest.brief === "string" ? featureRequest.brief : null,
    },
  };

  const waveTicketValidation = validateContractDocument({
    family: "wave-ticket",
    document: waveTicket,
    source: "runtime://wave-ticket",
  });
  if (!waveTicketValidation.ok) {
    waveTicket.plan_status = "revision-required";
    waveTicket.revision_summary = {
      ...revisionSummary,
      reason: "Deterministic structured-plan completeness validation failed.",
      material_change: true,
      blocker_codes: waveTicketValidation.issues.map((entry) =>
        entry.message.includes("mission-split-required")
          ? "mission-split-required"
          : `structured-plan.${entry.field.replace(/[^a-zA-Z0-9._-]+/gu, "-")}`,
      ),
    };
  }

  const planRef = toEvidenceRef(init.projectRoot, waveTicketFile);
  const planValidationReportFile = path.join(
    init.runtimeLayout.reportsRoot,
    `validation-report-${sanitizeFileSegment(planId)}.v${planVersion}.json`,
  );
  const planValidationReport = {
    report_id: `${planId}.validation.v${planVersion}`,
    subject_ref: planRef,
    validators: waveTicketValidation.ok
      ? [{
          validator_id: "structured-plan-completeness",
          status: "pass",
          summary: "Structured task plan passed deterministic completeness validation.",
          details: { blocker_codes: [] },
          evidence_refs: [planRef],
        }]
      : waveTicketValidation.issues.map((entry, index) => ({
          validator_id: `structured-plan-completeness.${index + 1}`,
          status: "fail",
          summary: entry.message,
          details: {
            code: entry.code,
            field: entry.field,
            expected: entry.expected,
            actual: entry.actual,
            blocker_code: entry.message.includes("mission-split-required")
              ? "mission-split-required"
              : `structured-plan.${entry.field.replace(/[^a-zA-Z0-9._-]+/gu, "-")}`,
          },
          evidence_refs: [planRef],
        })),
    status: waveTicketValidation.ok ? "pass" : "fail",
    evidence_refs: [planRef, ...(options.plannerAttemptRef ? [options.plannerAttemptRef] : [])],
  };
  const reportValidation = validateContractDocument({
    family: "validation-report",
    document: planValidationReport,
    source: "runtime://structured-plan-validation",
  });
  if (!reportValidation.ok) {
    throw new Error("Generated structured-plan validation report failed contract validation.");
  }
  waveTicket.source_refs.validation_report_ref = toEvidenceRef(init.projectRoot, planValidationReportFile);
  const readableWaveTicketValidation = validateContractDocument({
    family: "wave-ticket",
    document: waveTicket,
    source: "runtime://wave-ticket-readable-revision",
  });
  if (!readableWaveTicketValidation.ok) {
    throw new Error("Generated wave-ticket failed contract validation.");
  }
  fs.writeFileSync(waveTicketFile, `${JSON.stringify(waveTicket, null, 2)}\n`, "utf8");
  fs.writeFileSync(planValidationReportFile, `${JSON.stringify(planValidationReport, null, 2)}\n`, "utf8");

  const writebackPolicy = asRecord(profile.writeback_policy);
  const writebackMode =
    typeof writebackPolicy.default_delivery_mode === "string" && writebackPolicy.default_delivery_mode.length > 0
      ? writebackPolicy.default_delivery_mode
      : "fork-first-pr";
  const handoffPacketId = `${init.projectId}.handoff.bootstrap.v1`;
  const handoffPacketFile = path.join(init.runtimeLayout.artifactsRoot, `${handoffPacketId}.json`);
  const handoffPacket = {
    packet_id: handoffPacketId,
    project_id: init.projectId,
    ticket_id: waveTicket.ticket_id,
    version: 1,
    status: samePlan && previousHandoff?.status === "approved" ? "approved" : "pending-approval",
    risk_tier: "medium",
    approved_objective: waveTicket.objective,
    task_model_version: planningContent.task_model_version,
    plan_id: planId,
    plan_version: planVersion,
    plan_status: waveTicket.plan_status,
    plan_size: planningContent.plan_size,
    plan_digest: planDigest,
    previous_plan_ref: previousPlanRef,
    revision_summary: revisionSummary,
    criteria_catalog: planningContent.criteria_catalog,
    repo_scopes: repoScopes,
    allowed_paths: allowedPaths,
    allowed_commands: allowedCommands,
    goals: planningContent.goals,
    definition_of_done: planningContent.definition_of_done,
    verification_expectations: planningContent.verification_expectations,
    verification_plan: {
      validators: ["contract-shape", "approval-state", "repo-scope"],
      command_groups: planningContent.verification_plan.command_groups,
      commands:
        planningContent.verification_expectations.primary_commands.length > 0
          ? planningContent.verification_expectations.primary_commands
          : allowedCommands.slice(0, 3),
      diagnostic_commands: planningContent.verification_expectations.diagnostic_commands,
      diagnostic_failure_mode: planningContent.verification_expectations.diagnostic_failure_mode,
    },
    scope_constraints: {
      require_bounded_scope: true,
      max_repo_scopes: repoScopes.length,
      max_changed_files: 24,
    },
    command_policy: {
      owner: "project-profile",
      allow_unlisted_commands: false,
    },
    writeback_mode: writebackMode,
    local_tasks: planningContent.local_tasks,
    acceptance_criteria: planningContent.acceptance_criteria,
    expected_evidence: planningContent.expected_evidence,
    kpis: planningContent.kpis,
    approval_state: samePlan && previousHandoff?.approval_state?.state === "approved"
      ? previousHandoff.approval_state
      : {
          required: true,
          state: "pending",
          approval_refs: [],
        },
    feature_traceability: {
      mission_id: typeof missionTraceability.mission_id === "string" ? missionTraceability.mission_id : null,
      source_kind: typeof missionTraceability.source_kind === "string" ? missionTraceability.source_kind : null,
      request_title: typeof featureRequest.title === "string" ? featureRequest.title : null,
      request_brief: typeof featureRequest.brief === "string" ? featureRequest.brief : null,
    },
    source_refs: {
      wave_ticket_file: waveTicketFile,
      artifact_packet_file: artifactPacketFile,
      project_profile_ref: init.projectProfileRef,
      plan_ref: `evidence://${path.relative(init.projectRoot, waveTicketFile)}`,
      previous_plan_ref: previousPlanRef,
      planner_attempt_ref: options.plannerAttemptRef ?? null,
      planning_input_refs: unique(asStringArray(options.planningInputRefs)),
      validation_report_ref: toEvidenceRef(init.projectRoot, planValidationReportFile),
    },
    blocked_next_step: waveTicket.plan_status === "approved"
      ? null
      : "Run 'aor plan approve --project-ref <path> --plan-ref <ref> --approval-ref <ref>' before execution flows.",
  };

  const handoffValidation = validateContractDocument({
    family: "handoff-packet",
    document: handoffPacket,
    source: "runtime://handoff-packet",
  });
  if (!handoffValidation.ok) {
    throw new Error("Generated handoff-packet failed contract validation.");
  }
  fs.writeFileSync(handoffPacketFile, `${JSON.stringify(handoffPacket, null, 2)}\n`, "utf8");

  return {
    ...init,
    artifactPacketFile,
    waveTicket,
    waveTicketFile,
    handoffPacket,
    handoffPacketFile,
    planValidationReport,
    planValidationReportFile,
  };
}

/**
 * @param {{
 *  cwd?: string,
 *  projectRef?: string,
 *  projectProfile?: string,
 *  runtimeRoot?: string,
 *  handoffPacketPath?: string,
 *  approvalRef: string,
 *  approvedBy?: string,
 *  approvedAt?: string,
 * }} options
 */
export function approveHandoffArtifacts(options) {
  const init = initializeProjectRuntime(options);
  const approvalRef = typeof options.approvalRef === "string" ? options.approvalRef.trim() : "";
  if (approvalRef.length === 0) {
    throw new Error("Approval reference is required to approve handoff packet.");
  }

  const handoffPacketFile = resolveHandoffPacketPath({
    runtimeLayout: init.runtimeLayout,
    projectId: init.projectId,
    cwd: options.cwd,
    explicitPath: options.handoffPacketPath,
  });
  if (!fs.existsSync(handoffPacketFile)) {
    throw new Error(`Handoff packet '${handoffPacketFile}' was not found. Run 'aor handoff prepare' first.`);
  }

  const loadedHandoff = loadContractFile({
    filePath: handoffPacketFile,
    family: "handoff-packet",
  });
  if (!loadedHandoff.ok) {
    throw new Error(`Handoff packet '${handoffPacketFile}' failed contract validation.`);
  }

  const handoffPacket = asRecord(loadedHandoff.document);
  if (handoffPacket.task_model_version === 1 && !["proposed", "approved"].includes(String(handoffPacket.plan_status))) {
    throw new Error(`Structured plan status '${String(handoffPacket.plan_status)}' cannot be approved.`);
  }
  const approvalState = asRecord(handoffPacket.approval_state);
  const existingRefs = Array.isArray(approvalState.approval_refs)
    ? approvalState.approval_refs.filter((ref) => typeof ref === "string")
    : [];
  const approvalRefs = unique([...existingRefs, approvalRef]);

  handoffPacket.status = "approved";
  if (handoffPacket.task_model_version === 1) handoffPacket.plan_status = "approved";
  handoffPacket.approval_state = {
    required: true,
    state: "approved",
    approval_refs: approvalRefs,
    approved_by: options.approvedBy ?? "operator",
    approved_at: options.approvedAt ?? new Date().toISOString(),
    ...(handoffPacket.task_model_version === 1 ? { approved_plan_digest: handoffPacket.plan_digest } : {}),
  };
  handoffPacket.blocked_next_step = null;

  const validation = validateContractDocument({
    family: "handoff-packet",
    document: handoffPacket,
    source: "runtime://handoff-packet",
  });
  if (!validation.ok) {
    throw new Error(`Approved handoff packet '${handoffPacketFile}' failed contract validation.`);
  }

  let waveTicketFile = null;
  let waveTicket = null;
  if (handoffPacket.task_model_version === 1) {
    const sourceRefs = asRecord(handoffPacket.source_refs);
    waveTicketFile = typeof sourceRefs.wave_ticket_file === "string" ? sourceRefs.wave_ticket_file : null;
    waveTicket = waveTicketFile ? readJsonFile(waveTicketFile) : null;
    if (!waveTicket || waveTicket.plan_id !== handoffPacket.plan_id || waveTicket.plan_digest !== handoffPacket.plan_digest) {
      throw new Error("Structured handoff approval could not resolve the exact owning plan and digest.");
    }
    waveTicket.plan_status = "approved";
    waveTicket.approval_state = handoffPacket.approval_state;
    const waveValidation = validateContractDocument({
      family: "wave-ticket",
      document: waveTicket,
      source: "runtime://approved-wave-ticket",
    });
    if (!waveValidation.ok) {
      throw new Error("Structured handoff approval could not validate the exact owning plan.");
    }
  }

  fs.writeFileSync(handoffPacketFile, `${JSON.stringify(handoffPacket, null, 2)}\n`, "utf8");
  if (waveTicketFile && waveTicket) {
    fs.writeFileSync(waveTicketFile, `${JSON.stringify(waveTicket, null, 2)}\n`, "utf8");
  }

  return {
    ...init,
    handoffPacket,
    handoffPacketFile,
  };
}

/**
 * @param {{
 *   runtimeLayout: { artifactsRoot: string },
 *   projectId: string,
 *   cwd?: string,
 *   handoffPacketPath?: string,
 * }} options
 * @returns {{
 *   status: "pass" | "fail",
 *   summary: string,
 *   blocking: boolean,
 *   handoffPacketFile: string,
 *   details: Record<string, unknown>,
 * }}
 */
export function validateApprovedHandoffGate(options) {
  const handoffPacketFile = resolveHandoffPacketPath({
    runtimeLayout: options.runtimeLayout,
    projectId: options.projectId,
    cwd: options.cwd,
    explicitPath: options.handoffPacketPath,
  });

  if (!fs.existsSync(handoffPacketFile)) {
    return {
      status: "fail",
      summary: "Execution gate blocked: no handoff packet is present.",
      blocking: true,
      handoffPacketFile,
      details: {
        reason: "handoff-missing",
        blocked_next_step: "Run 'aor handoff prepare' and approve the packet before execution-style flows.",
      },
    };
  }

  const loaded = loadContractFile({
    filePath: handoffPacketFile,
    family: "handoff-packet",
  });
  if (!loaded.ok) {
    return {
      status: "fail",
      summary: "Execution gate blocked: handoff packet is invalid.",
      blocking: true,
      handoffPacketFile,
      details: {
        reason: "handoff-invalid",
      },
    };
  }

  const handoffPacket = asRecord(loaded.document);
  const approvalState = asRecord(handoffPacket.approval_state);
  const approvalRefs = Array.isArray(approvalState.approval_refs)
    ? approvalState.approval_refs.filter((ref) => typeof ref === "string")
    : [];
  const statusApproved = handoffPacket.status === "approved";
  const approvalApproved = approvalState.state === "approved";
  const structuredPlanApproved = handoffPacket.task_model_version !== 1
    || handoffPacket.plan_status === "approved" && approvalState.approved_plan_digest === handoffPacket.plan_digest;

  if (!statusApproved || !approvalApproved || approvalRefs.length === 0 || !structuredPlanApproved) {
    return {
      status: "fail",
      summary: "Execution gate blocked: handoff packet is present but not approved.",
      blocking: true,
      handoffPacketFile,
      details: {
        reason: "handoff-unapproved",
        handoff_status: handoffPacket.status ?? null,
        approval_state: approvalState.state ?? null,
        approval_refs: approvalRefs,
        plan_status: handoffPacket.plan_status ?? null,
        approved_plan_digest: approvalState.approved_plan_digest ?? null,
        blocked_next_step: "Approve the handoff packet and provide approval reference before execution-style flows.",
      },
    };
  }

  return {
    status: "pass",
    summary: "Approved handoff packet is present for execution-style flows.",
    blocking: false,
    handoffPacketFile,
    details: {
      handoff_status: handoffPacket.status,
      approval_state: approvalState.state,
      approval_refs: approvalRefs,
    },
  };
}
