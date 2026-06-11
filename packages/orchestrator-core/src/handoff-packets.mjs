import fs from "node:fs";
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

/**
 * @param {{
 *   artifactPacketBody: Record<string, unknown>,
 *   objective: string,
 *   allowedPaths: string[],
 *   verificationExpectations: { primary_commands: string[], diagnostic_commands: string[], diagnostic_failure_mode: string | null },
 *   fallbackVerificationCommands?: string[],
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
  const implementationCriteria = acceptanceCriteria.length > 0 ? acceptanceCriteria : definitionOfDone;
  const verificationCommands =
    options.verificationExpectations.primary_commands.length > 0
      ? options.verificationExpectations.primary_commands
      : unique(asStringArray(options.fallbackVerificationCommands));
  const verificationExpectations = {
    ...options.verificationExpectations,
    primary_commands: verificationCommands,
  };
  const localTasks = [
    {
      task_id: "local-task.implementation",
      objective: goals[0] ?? options.objective,
      allowed_paths: options.allowedPaths,
      acceptance_criteria: implementationCriteria,
      expected_evidence: expectedEvidence.filter((entry) => !entry.includes("verify")),
    },
    {
      task_id: "local-task.verification",
      objective: "Run bounded primary verification and preserve diagnostic evidence when configured.",
      verification_commands: verificationCommands,
      acceptance_criteria: definitionOfDone.length > 0 ? definitionOfDone : acceptanceCriteria,
      expected_evidence: unique(["verify-summary", ...expectedEvidence.filter((entry) => entry.includes("review"))]),
    },
    {
      task_id: "local-task.lineage",
      objective: "Keep review, delivery, audit, and learning evidence linked to the same mission and target checkout.",
      acceptance_criteria: acceptanceCriteria,
      expected_evidence: expectedEvidence,
      kpis,
    },
  ].filter((task) => asStringArray(task.acceptance_criteria).length > 0 || asStringArray(task.expected_evidence).length > 0);

  return {
    goals,
    definition_of_done: definitionOfDone,
    acceptance_criteria: acceptanceCriteria,
    expected_evidence: expectedEvidence,
    kpis,
    verification_expectations: verificationExpectations,
    local_tasks: localTasks,
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
    const absolutePath = path.isAbsolute(options.explicitPath)
      ? options.explicitPath
      : path.resolve(options.cwd ?? process.cwd(), options.explicitPath);
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
  });

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
    goals: planningContent.goals,
    definition_of_done: planningContent.definition_of_done,
    local_tasks: planningContent.local_tasks,
    acceptance_criteria: planningContent.acceptance_criteria,
    expected_evidence: planningContent.expected_evidence,
    verification_expectations: planningContent.verification_expectations,
    kpis: planningContent.kpis,
    approved_input_ref: `evidence://${path.relative(init.projectRoot, artifactPacketFile)}`,
    source_refs: {
      artifact_packet_file: artifactPacketFile,
      project_profile_ref: init.projectProfileRef,
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
    throw new Error("Generated wave-ticket failed contract validation.");
  }
  fs.writeFileSync(waveTicketFile, `${JSON.stringify(waveTicket, null, 2)}\n`, "utf8");

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
    status: "pending-approval",
    risk_tier: "medium",
    approved_objective: waveTicket.objective,
    repo_scopes: repoScopes,
    allowed_paths: allowedPaths,
    allowed_commands: allowedCommands,
    goals: planningContent.goals,
    definition_of_done: planningContent.definition_of_done,
    verification_expectations: planningContent.verification_expectations,
    verification_plan: {
      validators: ["contract-shape", "approval-state", "repo-scope"],
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
    approval_state: {
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
    },
    blocked_next_step: "Run 'aor handoff approve --project-ref <path> --approval-ref <ref>' before execution flows.",
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
  const approvalState = asRecord(handoffPacket.approval_state);
  const existingRefs = Array.isArray(approvalState.approval_refs)
    ? approvalState.approval_refs.filter((ref) => typeof ref === "string")
    : [];
  const approvalRefs = unique([...existingRefs, approvalRef]);

  handoffPacket.status = "approved";
  handoffPacket.approval_state = {
    required: true,
    state: "approved",
    approval_refs: approvalRefs,
    approved_by: options.approvedBy ?? "operator",
    approved_at: options.approvedAt ?? new Date().toISOString(),
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
  fs.writeFileSync(handoffPacketFile, `${JSON.stringify(handoffPacket, null, 2)}\n`, "utf8");

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

  if (!statusApproved || !approvalApproved || approvalRefs.length === 0) {
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
