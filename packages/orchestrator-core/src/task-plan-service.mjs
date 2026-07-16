import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { derivePublicId, loadContractFile, validateContractDocument } from "../../contracts/src/index.mjs";

import { prepareHandoffArtifacts } from "./handoff-packets.mjs";
import { buildPlanningInputManifest, selectPlannerCandidate } from "./planner-decomposition.mjs";
import { initializeProjectRuntime, previewProjectRuntime } from "./project-init.mjs";
import { executeRoutedStep } from "./step-execution-engine.mjs";
import { enrichExecutionDag, executionDagDigest, validateExecutionDagCoverage } from "./execution-dag-planner.mjs";
import { resolveOverallTaskProgressStatus, resolveTaskProgressStatus } from "./task-progress-projection.mjs";

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function asRecordArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry)) : [];
}

function asStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function stableDigest(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function safeSegment(value) {
  return String(value ?? "plan").replace(/[^a-zA-Z0-9._-]+/gu, "-");
}

function evidenceRef(projectRoot, filePath) {
  return `evidence://${path.relative(projectRoot, filePath).replaceAll("\\", "/")}`;
}

function resolveEvidencePath(projectRoot, value) {
  if (!value) return null;
  if (value.startsWith("evidence://")) {
    const candidate = value.slice("evidence://".length);
    return path.isAbsolute(candidate) ? candidate : path.resolve(projectRoot, candidate);
  }
  return path.isAbsolute(value) ? value : path.resolve(projectRoot, value);
}

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const document = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return typeof document === "object" && document !== null && !Array.isArray(document) ? document : null;
  } catch {
    return null;
  }
}

function writeJson(filePath, document) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

function materializePlanSemanticEvaluation(options, result) {
  if (result.planValidationReport?.status !== "pass") {
    return {
      planEvaluationReport: null,
      planEvaluationReportFile: null,
      semanticEvaluationRun: null,
      semanticEvaluationRunFile: null,
      semanticEvaluationRunRef: null,
    };
  }
  const planRef = evidenceRef(result.projectRoot, result.waveTicketFile);
  const validationRef = evidenceRef(result.projectRoot, result.planValidationReportFile);
  const semanticRun = executeRoutedStep({
    ...options,
    stepClass: "eval",
    dryRun: options.dryRun !== false,
    runId:
      options.semanticRunId ??
      derivePublicId([String(result.waveTicket.plan_id), "semantic", String(Date.now())], "semantic-run"),
    stepId: "plan.evaluate",
    runtimeEvidenceRefs: unique([...asStringArray(options.runtimeEvidenceRefs), planRef, validationRef]),
  });
  const semanticRunRef = evidenceRef(result.projectRoot, semanticRun.stepResultPath);
  const adapterOutput = asRecord(asRecord(asRecord(semanticRun.stepResult.routed_execution).adapter_response).output);
  const semantic = Object.keys(asRecord(options.semanticEvaluation)).length > 0
    ? asRecord(options.semanticEvaluation)
    : asRecord(adapterOutput.semantic_evaluation);
  const warnings = asStringArray(semantic.warnings);
  const findings = Array.isArray(semantic.findings) ? semantic.findings : [];
  const requestedStatus = String(semantic.status ?? "").toLowerCase();
  const evaluationStatus = semanticRun.stepResult.status !== "passed" || ["fail", "failed", "block", "blocked"].includes(requestedStatus)
    ? "fail"
    : warnings.length > 0 || findings.length > 0 || requestedStatus === "warn"
      ? "warn"
      : "pass";

  const loadedProfile = loadContractFile({ filePath: result.projectProfilePath, family: "project-profile" });
  const profile = loadedProfile.ok ? asRecord(loadedProfile.document) : {};
  const planPolicy = asRecord(profile.structured_plan_policy);
  const blocking = planPolicy.semantic_evaluator_blocking === true;
  const evaluationReport = {
    report_id: derivePublicId(
      [String(result.waveTicket.plan_id), "semantic-evaluation", `v${result.waveTicket.plan_version}`],
      "semantic-evaluation",
    ),
    subject_ref: planRef,
    subject_type: "wave-ticket",
    subject_fingerprint: result.waveTicket.plan_digest,
    subject_snapshot: {
      reference: planRef,
      family: "wave-ticket",
      version: result.waveTicket.plan_version,
      digest: result.waveTicket.plan_digest,
      source_refs: [planRef],
    },
    case_resolution: [{
      case_id: "semantic-plan-quality",
      status: "resolved",
      input_ref: planRef,
      expected_ref: "policy://plan-semantic-quality",
      input_digest: result.waveTicket.plan_digest,
      expected_digest: "policy://plan-semantic-quality@v1",
    }],
    suite_ref: "suite.plan.semantic-quality@v1",
    dataset_ref: "dataset://plan-semantic-quality/runtime",
    scorer_metadata: [{
      scorer_id: "runner-agnostic-plan-semantic-evaluator",
      scorer_mode: "judge",
      scorer_impl: "orchestrator.plan.semantic-evaluator.v1",
    }],
    grader_results: {
      semantic_quality: {
        status: evaluationStatus,
        warnings,
        findings,
        evaluator_step_ref: semanticRunRef,
      },
    },
    summary_metrics: {
      total_cases: 1,
      passed_cases: evaluationStatus === "pass" ? 1 : 0,
      failed_cases: evaluationStatus === "fail" ? 1 : 0,
      warning_cases: evaluationStatus === "warn" ? 1 : 0,
      aggregate_pass_rate: evaluationStatus === "pass" ? 1 : 0,
      blocking,
    },
    status: evaluationStatus,
    evidence_refs: [planRef, validationRef, semanticRunRef],
  };
  const evaluationValidation = validateContractDocument({
    family: "evaluation-report",
    document: evaluationReport,
    source: "runtime://structured-plan-semantic-evaluation",
  });
  if (!evaluationValidation.ok) {
    const error = new Error("Generated structured-plan evaluation report failed contract validation.");
    error.code = "plan-evaluation-invalid";
    error.validation = evaluationValidation;
    throw error;
  }
  const evaluationReportFile = path.join(
    result.runtimeLayout.reportsRoot,
    `evaluation-report-${safeSegment(result.waveTicket.plan_id)}.v${result.waveTicket.plan_version}.json`,
  );
  writeJson(evaluationReportFile, evaluationReport);
  const evaluationRef = evidenceRef(result.projectRoot, evaluationReportFile);
  const evaluationSummary = {
    status: evaluationStatus,
    blocking,
    warnings,
    finding_count: findings.length,
    report_ref: evaluationRef,
  };
  result.waveTicket.source_refs = { ...asRecord(result.waveTicket.source_refs), evaluation_report_ref: evaluationRef };
  result.handoffPacket.source_refs = { ...asRecord(result.handoffPacket.source_refs), evaluation_report_ref: evaluationRef };
  result.waveTicket.semantic_evaluation = evaluationSummary;
  result.handoffPacket.semantic_evaluation = evaluationSummary;
  if (blocking && evaluationStatus !== "pass") {
    result.waveTicket.plan_status = "revision-required";
    result.waveTicket.revision_summary = {
      ...asRecord(result.waveTicket.revision_summary),
      reason: "Project policy requires semantic plan evaluation to pass before approval.",
      blocker_codes: unique([
        ...asStringArray(asRecord(result.waveTicket.revision_summary).blocker_codes),
        "semantic-plan-evaluation-blocking",
      ]),
    };
    result.handoffPacket.plan_status = "revision-required";
    result.handoffPacket.status = "pending-approval";
    result.handoffPacket.blocked_next_step = "Resolve blocking semantic plan findings and create a revised plan.";
  }
  writeJson(result.waveTicketFile, result.waveTicket);
  writeJson(result.handoffPacketFile, result.handoffPacket);
  return {
    planEvaluationReport: evaluationReport,
    planEvaluationReportFile: evaluationReportFile,
    semanticEvaluationRun: semanticRun.stepResult,
    semanticEvaluationRunFile: semanticRun.stepResultPath,
    semanticEvaluationRunRef: semanticRunRef,
  };
}

function flowIdForPlan(projectId, plan) {
  const missionId = asRecord(plan.feature_traceability).mission_id;
  if (typeof missionId !== "string" || missionId.trim().length === 0) return null;
  const segment = missionId.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return `flow.${projectId}.${segment || "flow"}`;
}

function latestPlanFile(runtimeLayout, projectId, flowId) {
  if (!fs.existsSync(runtimeLayout.artifactsRoot)) return null;
  return fs.readdirSync(runtimeLayout.artifactsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith("wave-ticket-") && entry.name.endsWith(".json") && !entry.name.includes(".plan-v"))
    .map((entry) => path.join(runtimeLayout.artifactsRoot, entry.name))
    .filter((filePath) => {
      const plan = readJson(filePath);
      return plan?.task_model_version === 1 && (!flowId || flowIdForPlan(projectId, plan) === flowId);
    })
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0] ?? null;
}

function collectPlanningInputRefs(options) {
  const context = previewProjectRuntime(options);
  const files = [];
  if (typeof options.approvedArtifactPath === "string" && options.approvedArtifactPath.trim().length > 0) {
    files.push(resolveEvidencePath(context.projectRoot, options.approvedArtifactPath));
  } else if (fs.existsSync(context.runtimeLayout.artifactsRoot)) {
    const artifactPacket = fs.readdirSync(context.runtimeLayout.artifactsRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name.includes(".artifact.") && !entry.name.includes(".body."))
      .map((entry) => path.join(context.runtimeLayout.artifactsRoot, entry.name))
      .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0];
    if (artifactPacket) files.push(artifactPacket);
  }
  if (fs.existsSync(context.runtimeLayout.reportsRoot)) {
    const reportFiles = fs.readdirSync(context.runtimeLayout.reportsRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(context.runtimeLayout.reportsRoot, entry.name));
    const latestByKind = new Map();
    for (const filePath of reportFiles) {
      const document = readJson(filePath);
      const kind = filePath.includes("project-analysis")
        ? "project-analysis"
        : filePath.includes("discovery-research")
          ? "discovery-research"
          : document?.step_id && String(document.step_id).includes("spec")
            ? "specification"
            : null;
      if (!kind) continue;
      const previous = latestByKind.get(kind);
      if (!previous || fs.statSync(filePath).mtimeMs > fs.statSync(previous).mtimeMs) latestByKind.set(kind, filePath);
    }
    files.push(...latestByKind.values());
  }
  return unique(files.filter((filePath) => filePath && fs.existsSync(filePath)).map((filePath) => evidenceRef(context.projectRoot, filePath)));
}

function resolvePlanContext(options, { mutate = false } = {}) {
  const context = mutate ? initializeProjectRuntime(options) : previewProjectRuntime(options);
  const planFile = options.planRef
    ? resolveEvidencePath(context.projectRoot, options.planRef)
    : latestPlanFile(context.runtimeLayout, context.projectId, options.flowId);
  if (!planFile || !fs.existsSync(planFile)) {
    const error = new Error("No structured task plan was found. Run 'aor plan create' first.");
    error.code = "structured-plan-required";
    throw error;
  }
  const loaded = loadContractFile({ filePath: planFile, family: "wave-ticket" });
  if (!loaded.ok) {
    const error = new Error(`Structured task plan '${planFile}' failed contract validation.`);
    error.code = "plan-invalid";
    error.validation = loaded.validation;
    throw error;
  }
  const plan = asRecord(loaded.document);
  if (plan.task_model_version !== 1) {
    const error = new Error(`Plan '${planFile}' uses the legacy compact task model.`);
    error.code = "structured-plan-required";
    throw error;
  }
  if (options.flowId && flowIdForPlan(context.projectId, plan) !== options.flowId) {
    const error = new Error(`Plan '${planFile}' does not belong to flow '${options.flowId}'.`);
    error.code = "plan-flow-mismatch";
    throw error;
  }
  return { ...context, planFile, plan };
}

function taskDigest(task) {
  return stableDigest({
    task_id: task.task_id,
    title: task.title,
    type: task.type,
    objective: task.objective,
    rationale: task.rationale,
    scope: task.scope,
    depends_on: task.depends_on,
    work_items: task.work_items,
    criteria_refs: task.criteria_refs,
    verification: task.verification,
    expected_evidence: task.expected_evidence,
    risks: task.risks,
    stop_conditions: task.stop_conditions,
    execution_hints: task.execution_hints,
  });
}

function unionScope(tasks) {
  const scopes = tasks.map((task) => asRecord(task.scope));
  return {
    repo_ids: unique(scopes.flatMap((scope) => asStringArray(scope.repo_ids))),
    component_ids: unique(scopes.flatMap((scope) => asStringArray(scope.component_ids))),
    allowed_paths: unique(scopes.flatMap((scope) => asStringArray(scope.allowed_paths))),
    forbidden_paths: unique(scopes.flatMap((scope) => asStringArray(scope.forbidden_paths))),
  };
}

export function buildExecutionPlan({ projectId, projectRoot, plan, planFile, projectProfile = {}, createdAt = new Date().toISOString() }) {
  const tasks = asRecordArray(plan.local_tasks);
  const grouped = new Map();
  for (const task of tasks) {
    const hints = asRecord(task.execution_hints);
    const groupKey = typeof hints.group_key === "string" && hints.group_key.trim().length > 0
      ? `group.${hints.group_key.trim()}`
      : `task.${String(task.task_id)}`;
    const members = grouped.get(groupKey) ?? [];
    members.push(task);
    grouped.set(groupKey, members);
  }

  const taskToUnit = new Map();
  const units = [];
  for (const [groupKey, members] of grouped.entries()) {
    const unitId = derivePublicId(["unit", safeSegment(groupKey).toLowerCase()], "execution-unit");
    members.forEach((task) => taskToUnit.set(String(task.task_id), unitId));
    const firstHints = asRecord(members[0]?.execution_hints);
    units.push({
      unit_id: unitId,
      task_refs: members.map((task) => String(task.task_id)),
      depends_on: [],
      scope: unionScope(members),
      required_evidence: unique(members.flatMap((task) => asStringArray(task.expected_evidence))),
      integration_requirements: [],
      grouping_rationale: members.length > 1 ? firstHints.group_reason ?? null : null,
      parallel_candidate: members.every((task) => asRecord(task.execution_hints).parallel_candidate === true),
    });
  }
  for (const unit of units) {
    const memberTasks = tasks.filter((task) => unit.task_refs.includes(String(task.task_id)));
    unit.depends_on = unique(memberTasks.flatMap((task) => asStringArray(task.depends_on).map((taskId) => taskToUnit.get(taskId))))
      .filter((unitId) => unitId && unitId !== unit.unit_id);
  }

  const dag = enrichExecutionDag({
    units,
    tasks,
    topology: projectProfile,
    integrationVerification: asRecordArray(plan.integration_verification),
  });
  const coverage = validateExecutionDagCoverage({
    tasks,
    units: dag.units,
    nonRunTasks: [],
    approvedScope: asRecord(plan.approved_scope),
  });
  const dagMaterial = {
    execution_units: dag.units,
    non_run_tasks: [],
    integration_gates: dag.integrationGates,
  };
  return {
    schema_version: 2,
    execution_plan_id: derivePublicId(
      [projectId, "execution-plan", String(plan.plan_id), `v${plan.plan_version}`],
      "execution-plan",
    ),
    project_id: projectId,
    plan_id: plan.plan_id,
    plan_version: plan.plan_version,
    plan_ref: evidenceRef(projectRoot, planFile),
    plan_digest: plan.plan_digest,
    dag_version: 1,
    dag_digest: executionDagDigest(dagMaterial),
    source_plan_refs: [evidenceRef(projectRoot, planFile)],
    status: coverage.ok ? "ready" : "blocked",
    impacted_scope: unionScope(tasks),
    execution_units: dag.units,
    non_run_tasks: [],
    integration_gates: dag.integrationGates,
    validation_findings: coverage.findings,
    concurrency_summary: {
      parallel_candidates: dag.units.filter((unit) => unit.concurrency.classification === "parallel-candidate").map((unit) => unit.unit_id),
      serialized_units: dag.units.filter((unit) => unit.concurrency.classification === "serialized").map((unit) => unit.unit_id),
    },
    risks: unique(tasks.flatMap((task) => asStringArray(task.risks))),
    approval: {
      state: "approved",
      plan_digest: plan.plan_digest,
      dag_digest: executionDagDigest(dagMaterial),
      invalidated: false,
    },
    created_at: createdAt,
  };
}

export function materializeExecutionPlan(options) {
  const context = resolvePlanContext(options, { mutate: true });
  if (context.plan.plan_status !== "approved") {
    const error = new Error("Execution plan materialization requires an approved structured task plan.");
    error.code = "plan-unapproved";
    throw error;
  }
  const executionPlanFile = path.join(
    context.runtimeLayout.artifactsRoot,
    `execution-plan-${safeSegment(context.plan.plan_id)}.v${context.plan.plan_version}.json`,
  );
  const candidateExecutionPlan = buildExecutionPlan(context);
  const existingExecutionPlan = readJson(executionPlanFile);
  if (existingExecutionPlan) {
    const existingValidation = validateContractDocument({ family: "execution-plan", document: existingExecutionPlan, source: "runtime://execution-plan-existing" });
    if (
      existingValidation.ok
      && existingExecutionPlan.plan_id === context.plan.plan_id
      && existingExecutionPlan.plan_version === context.plan.plan_version
      && existingExecutionPlan.plan_digest === context.plan.plan_digest
      && existingExecutionPlan.dag_digest === candidateExecutionPlan.dag_digest
    ) {
      return { ...context, executionPlan: existingExecutionPlan, executionPlanFile };
    }
    if (
      existingValidation.ok
      && existingExecutionPlan.plan_digest === context.plan.plan_digest
      && existingExecutionPlan.dag_digest !== candidateExecutionPlan.dag_digest
    ) {
      const error = new Error("Execution DAG changed materially and requires a new approved plan revision.");
      error.code = "execution-plan-approval-invalidated";
      error.previousDagDigest = existingExecutionPlan.dag_digest;
      error.candidateDagDigest = candidateExecutionPlan.dag_digest;
      throw error;
    }
    const error = new Error("Existing execution plan is invalid or stale and cannot be overwritten.");
    error.code = "execution-plan-immutable";
    error.validation = existingValidation;
    throw error;
  }
  const executionPlan = candidateExecutionPlan;
  const validation = validateContractDocument({ family: "execution-plan", document: executionPlan, source: "runtime://execution-plan" });
  if (!validation.ok) {
    const error = new Error("Generated execution plan failed contract validation.");
    error.code = "execution-plan-invalid";
    error.validation = validation;
    throw error;
  }
  writeJson(executionPlanFile, executionPlan);
  return { ...context, executionPlan, executionPlanFile };
}

function progressFromEvidence({ task, unit, dependencyStatuses, evidenceDocuments, approvedPlanDigest }) {
  const taskId = String(task.task_id);
  const currentTaskDigest = taskDigest(task);
  const matching = evidenceDocuments.filter((entry) => {
    const document = asRecord(entry.document);
    return asStringArray(document.task_refs).includes(taskId)
      || document.task_id === taskId
      || asStringArray(document.task_ids).includes(taskId);
  });
  const currentMatching = matching.filter((entry) => {
    const document = asRecord(entry.document);
    return document.plan_digest === approvedPlanDigest
      || document.task_digest === currentTaskDigest
      || asRecord(document.task_digests)[taskId] === currentTaskDigest;
  });
  const effectiveMatching = currentMatching.length > 0 ? currentMatching : matching;
  const attemptRefs = unique(effectiveMatching.flatMap((entry) => {
    const document = asRecord(entry.document);
    return [document.attempt_ref, document.run_ref, document.run_id, ...asStringArray(document.attempt_refs)];
  }));
  const evidenceRefs = unique(effectiveMatching.map((entry) => entry.ref));
  const attemptSignals = effectiveMatching.filter((entry) => {
    const status = String(asRecord(entry.document).status);
    return ["failed", "fail", "blocked", "running", "in-progress", "pass", "passed", "success", "succeeded", "complete"].includes(status);
  });
  const latestAttempt = attemptSignals.at(-1);
  const latestAttemptStatus = String(asRecord(latestAttempt?.document).status ?? "");
  const blockingFindings = unique(effectiveMatching.flatMap((entry) => {
    if (attemptSignals.includes(entry) && entry !== latestAttempt) return [];
    return asStringArray(asRecord(entry.document).blocking_findings);
  }));
  const stale = matching.length > 0 && currentMatching.length === 0;
  const failed = ["failed", "fail", "blocked"].includes(latestAttemptStatus);
  const running = ["running", "in-progress"].includes(latestAttemptStatus);
  const adapterSucceeded = ["pass", "passed", "success", "succeeded", "complete"].includes(latestAttemptStatus);
  const requiredEvidence = asStringArray(task.expected_evidence);
  const evidenceComplete = requiredEvidence.every((kind) => effectiveMatching.some((entry) => entry.ref.includes(kind) || asRecord(entry.document).family === kind));
  const verificationPass = effectiveMatching.some((entry) => {
    const document = asRecord(entry.document);
    return document.verification_status === "pass" || document.status === "pass" && entry.ref.includes("verify");
  });
  const criteriaSatisfied = effectiveMatching.some((entry) => asRecord(entry.document).criteria_status === "satisfied");
  const dependenciesComplete = dependencyStatuses.every((status) => status === "complete");

  const status = resolveTaskProgressStatus({
    stale,
    failed,
    blockingFindings: blockingFindings.length,
    running,
    adapterSucceeded,
    evidenceComplete,
    verificationPass,
    criteriaSatisfied,
    dependenciesComplete,
  });

  return {
    task_id: taskId,
    task_digest: currentTaskDigest,
    status,
    criteria_status: criteriaSatisfied ? "satisfied" : "pending",
    verification_status: verificationPass ? "pass" : "pending",
    evidence_status: evidenceComplete ? "complete" : evidenceRefs.length > 0 ? "partial" : "missing",
    execution_unit_refs: unit ? [unit.unit_id] : [],
    attempt_refs: attemptRefs,
    evidence_refs: evidenceRefs,
    blocking_findings: blockingFindings,
    next_action: status === "complete"
      ? null
      : status === "blocked"
        ? "Complete prerequisite tasks."
        : status === "verification-pending"
          ? "Run required verification and collect acceptance evidence."
          : status === "failed"
            ? "Retry or repair the failed execution unit."
            : status === "stale"
              ? "Replan or rerun from the invalidated task boundary."
              : "Start the ready execution unit.",
  };
}

function readEvidenceDocuments(runtimeLayout, projectRoot) {
  const roots = [runtimeLayout.artifactsRoot, runtimeLayout.reportsRoot];
  const documents = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.startsWith("task-progress-")) continue;
      const filePath = path.join(root, entry.name);
      const document = readJson(filePath);
      if (document) documents.push({ ref: evidenceRef(projectRoot, filePath), document });
    }
  }
  return documents;
}

export function materializeTaskProgress(options) {
  const context = resolvePlanContext(options, { mutate: true });
  const executionPlanResult = materializeExecutionPlan({ ...options, planRef: context.planFile });
  const executionPlan = executionPlanResult.executionPlan;
  const evidenceDocuments = options.evidenceDocuments ?? readEvidenceDocuments(context.runtimeLayout, context.projectRoot);
  const tasks = asRecordArray(context.plan.local_tasks);
  const taskById = new Map(tasks.map((task) => [String(task.task_id), task]));
  const projectionByTask = new Map();
  function projectTask(taskId, visiting = new Set()) {
    if (projectionByTask.has(taskId)) return projectionByTask.get(taskId);
    if (visiting.has(taskId)) return null;
    const task = taskById.get(taskId);
    if (!task) return null;
    const nextVisiting = new Set(visiting).add(taskId);
    const unit = executionPlan.execution_units.find((candidate) => candidate.task_refs.includes(String(task.task_id)));
    const dependencyStatuses = asStringArray(task.depends_on).map((dependencyId) => projectTask(dependencyId, nextVisiting)?.status ?? "blocked");
    const projection = progressFromEvidence({
      task,
      unit,
      dependencyStatuses,
      evidenceDocuments,
      approvedPlanDigest: context.plan.plan_digest,
    });
    projectionByTask.set(taskId, projection);
    return projection;
  }
  const projections = tasks.map((task) => projectTask(String(task.task_id))).filter(Boolean);
  const statuses = projections.map((task) => task.status);
  const overallStatus = resolveOverallTaskProgressStatus(statuses);
  const report = {
    report_id: derivePublicId(
      [context.projectId, "task-progress", String(context.plan.plan_id), `v${context.plan.plan_version}`],
      "task-progress",
    ),
    project_id: context.projectId,
    plan_id: context.plan.plan_id,
    plan_version: context.plan.plan_version,
    plan_ref: evidenceRef(context.projectRoot, context.planFile),
    execution_plan_ref: evidenceRef(context.projectRoot, executionPlanResult.executionPlanFile),
    overall_status: overallStatus,
    tasks: projections,
    generated_at: options.generatedAt ?? new Date().toISOString(),
  };
  const validation = validateContractDocument({ family: "task-progress-report", document: report, source: "runtime://task-progress-report" });
  if (!validation.ok) {
    const error = new Error("Generated task progress report failed contract validation.");
    error.code = "task-progress-invalid";
    error.validation = validation;
    throw error;
  }
  const reportFile = path.join(context.runtimeLayout.reportsRoot, `task-progress-${safeSegment(context.plan.plan_id)}.v${context.plan.plan_version}.json`);
  writeJson(reportFile, report);
  return { ...context, executionPlan, executionPlanFile: executionPlanResult.executionPlanFile, taskProgress: report, taskProgressFile: reportFile };
}

export function createTaskPlan(options = {}) {
  const projectContext = previewProjectRuntime(options);
  const planningInputRefs = collectPlanningInputRefs(options);
  const planningRun = executeRoutedStep({
    ...options,
    stepClass: "planning",
    dryRun: options.dryRun !== false,
    runId:
      options.planningRunId ??
      derivePublicId([projectContext.projectId, "planning", String(Date.now())], "planning-run"),
    stepId: "plan.create",
    runtimeEvidenceRefs: unique([...asStringArray(options.runtimeEvidenceRefs), ...planningInputRefs]),
  });
  if (planningRun.stepResult.status !== "passed") {
    const error = new Error(`Planning route failed: ${planningRun.stepResult.summary}`);
    error.code = "planning-route-failed";
    error.planningRunRef = evidenceRef(planningRun.projectRoot, planningRun.stepResultPath);
    throw error;
  }
  const adapterOutput = asRecord(asRecord(asRecord(planningRun.stepResult.routed_execution).adapter_response).output);
  const candidateSelection = selectPlannerCandidate({
    explicitCandidate: options.plannerCandidate,
    adapterOutput,
  });
  const planningRunRef = evidenceRef(planningRun.projectRoot, planningRun.stepResultPath);
  const result = prepareHandoffArtifacts({
    ...options,
    plannerCandidate: candidateSelection.candidate,
    plannerCandidateSource: candidateSelection.source,
    plannerAttemptRef: planningRunRef,
    planningInputRefs,
    planningInputManifest: buildPlanningInputManifest(planningInputRefs),
  });
  const semanticEvaluation = materializePlanSemanticEvaluation(options, result);
  if (options.flowId && flowIdForPlan(result.projectId, result.waveTicket) !== options.flowId) {
    const error = new Error(`Planner output does not belong to flow '${options.flowId}'.`);
    error.code = "plan-flow-mismatch";
    throw error;
  }
  return {
    ...result,
    plan: result.waveTicket,
    planFile: result.waveTicketFile,
    planRef: evidenceRef(result.projectRoot, result.waveTicketFile),
    planningRun: planningRun.stepResult,
    planningRunFile: planningRun.stepResultPath,
    planningRunRef,
    ...semanticEvaluation,
  };
}

export function showTaskPlan(options = {}) {
  const context = resolvePlanContext(options);
  const handoffFile = typeof context.plan.source_refs?.handoff_packet_file === "string"
    ? context.plan.source_refs.handoff_packet_file
    : path.join(context.runtimeLayout.artifactsRoot, `${context.projectId}.handoff.bootstrap.v1.json`);
  return {
    ...context,
    planRef: evidenceRef(context.projectRoot, context.planFile),
    handoffPacket: readJson(handoffFile),
    handoffFile,
  };
}

function compareScopes(before, after) {
  const beforePaths = new Set(asStringArray(asRecord(before).allowed_paths));
  const afterPaths = new Set(asStringArray(asRecord(after).allowed_paths));
  const widened = [...afterPaths].filter((entry) => !beforePaths.has(entry));
  const narrowed = [...beforePaths].filter((entry) => !afterPaths.has(entry));
  return { widened, narrowed };
}

export function diffTaskPlans(beforePlan, afterPlan) {
  const beforeTasks = new Map(asRecordArray(beforePlan.local_tasks).map((task) => [String(task.task_id), task]));
  const afterTasks = new Map(asRecordArray(afterPlan.local_tasks).map((task) => [String(task.task_id), task]));
  const addedTaskIds = [...afterTasks.keys()].filter((taskId) => !beforeTasks.has(taskId));
  const removedTaskIds = [...beforeTasks.keys()].filter((taskId) => !afterTasks.has(taskId));
  const modifiedTaskIds = [...afterTasks.keys()].filter((taskId) => beforeTasks.has(taskId) && taskDigest(beforeTasks.get(taskId)) !== taskDigest(afterTasks.get(taskId)));
  const beforeOrder = [...beforeTasks.keys()].filter((taskId) => afterTasks.has(taskId));
  const afterOrder = [...afterTasks.keys()].filter((taskId) => beforeTasks.has(taskId));
  const reordered = JSON.stringify(beforeOrder) !== JSON.stringify(afterOrder);
  const scopeChange = compareScopes(beforePlan.scope, afterPlan.scope);
  return {
    from_plan_ref: `${beforePlan.plan_id}@v${beforePlan.plan_version}`,
    to_plan_ref: `${afterPlan.plan_id}@v${afterPlan.plan_version}`,
    added_task_ids: addedTaskIds,
    removed_task_ids: removedTaskIds,
    modified_task_ids: modifiedTaskIds,
    reordered,
    scope_widened_paths: scopeChange.widened,
    scope_narrowed_paths: scopeChange.narrowed,
    dependency_changed_task_ids: modifiedTaskIds.filter((taskId) => JSON.stringify(asStringArray(beforeTasks.get(taskId).depends_on)) !== JSON.stringify(asStringArray(afterTasks.get(taskId).depends_on))),
    criteria_changed_task_ids: modifiedTaskIds.filter((taskId) => JSON.stringify(asStringArray(beforeTasks.get(taskId).criteria_refs)) !== JSON.stringify(asStringArray(afterTasks.get(taskId).criteria_refs))),
    verification_changed_task_ids: modifiedTaskIds.filter((taskId) => JSON.stringify(beforeTasks.get(taskId).verification) !== JSON.stringify(afterTasks.get(taskId).verification)),
    material_change: reordered || addedTaskIds.length + removedTaskIds.length + modifiedTaskIds.length + scopeChange.widened.length + scopeChange.narrowed.length > 0,
  };
}

export function diffTaskPlanRefs(options = {}) {
  const context = previewProjectRuntime(options);
  const beforeFile = resolveEvidencePath(context.projectRoot, options.fromPlanRef);
  const afterFile = resolveEvidencePath(context.projectRoot, options.toPlanRef);
  const beforePlan = readJson(beforeFile);
  const afterPlan = readJson(afterFile);
  if (!beforePlan || !afterPlan) {
    const error = new Error("Both plan refs must resolve to readable plan artifacts.");
    error.code = "plan-not-found";
    throw error;
  }
  return { ...context, beforeFile, afterFile, diff: diffTaskPlans(beforePlan, afterPlan) };
}

export function requestTaskPlanRevision(options = {}) {
  const context = resolvePlanContext(options, { mutate: true });
  if (!["proposed", "approved", "revision-required"].includes(String(context.plan.plan_status))) {
    const error = new Error(`Plan status '${context.plan.plan_status}' cannot request another revision.`);
    error.code = "plan-immutable";
    throw error;
  }
  const reason = typeof options.reason === "string" ? options.reason.trim() : "";
  if (!reason) {
    const error = new Error("A non-empty revision reason is required.");
    error.code = "plan-revision-reason-required";
    throw error;
  }
  const requestedAt = options.requestedAt ?? new Date().toISOString();
  const planRef = evidenceRef(context.projectRoot, context.planFile);
  context.plan.plan_status = "revision-requested";
  context.plan.revision_summary = {
    ...(asRecord(context.plan.revision_summary)),
    reason,
    material_change: null,
    requested_at: requestedAt,
  };
  writeJson(context.planFile, context.plan);
  const handoffFile = path.join(context.runtimeLayout.artifactsRoot, `${context.projectId}.handoff.bootstrap.v1.json`);
  const handoff = readJson(handoffFile);
  if (handoff?.plan_id === context.plan.plan_id && handoff?.plan_version === context.plan.plan_version) {
    handoff.plan_status = "revision-requested";
    handoff.status = "pending-approval";
    handoff.approval_state = { required: true, state: "pending", approval_refs: [] };
    handoff.blocked_next_step = "Create and approve a revised structured task plan before execution.";
    writeJson(handoffFile, handoff);
  }
  const planningRun = executeRoutedStep({
    ...options,
    stepClass: "planning",
    dryRun: options.dryRun !== false,
    runId:
      options.planningRunId ??
      derivePublicId([String(context.plan.plan_id), "revision", String(Date.now())], "planning-revision"),
    stepId: "plan.revise",
    runtimeEvidenceRefs: unique([...asStringArray(options.runtimeEvidenceRefs), planRef]),
  });
  const planningRunRef = evidenceRef(context.projectRoot, planningRun.stepResultPath);
  const requestId = derivePublicId(
    [String(context.plan.plan_id), "revision-request", `v${context.plan.plan_version}`],
    "revision-request",
  );
  const requestFile = path.join(context.runtimeLayout.artifactsRoot, `plan-revision-request-${safeSegment(requestId)}.json`);
  const request = {
    request_id: requestId,
    project_id: context.projectId,
    plan_id: context.plan.plan_id,
    plan_version: context.plan.plan_version,
    plan_ref: planRef,
    status: "requested",
    reason,
    planning_run_ref: planningRunRef,
    planning_status: planningRun.stepResult.status,
    requested_at: requestedAt,
  };
  writeJson(requestFile, request);
  return {
    ...context,
    planRef,
    revisionRequest: request,
    revisionRequestFile: requestFile,
    planningRun: planningRun.stepResult,
    planningRunFile: planningRun.stepResultPath,
    planningRunRef,
    handoffFile,
  };
}

export function approveTaskPlan(options = {}) {
  const context = resolvePlanContext(options, { mutate: true });
  const approvalRef = typeof options.approvalRef === "string" ? options.approvalRef.trim() : "";
  if (!approvalRef) {
    const error = new Error("Approval reference is required.");
    error.code = "approval-required";
    throw error;
  }
  if (context.plan.plan_status !== "proposed") {
    const error = new Error(`Plan status '${context.plan.plan_status}' cannot be approved.`);
    error.code = ["revision-required", "revision-requested"].includes(String(context.plan.plan_status)) ? "plan-incomplete" : "plan-immutable";
    throw error;
  }
  const validation = validateContractDocument({ family: "wave-ticket", document: context.plan, source: "runtime://plan-approval" });
  if (!validation.ok) {
    const error = new Error("Structured task plan is incomplete and cannot be approved.");
    error.code = "plan-incomplete";
    error.validation = validation;
    throw error;
  }
  const approvalState = {
    required: true,
    state: "approved",
    approval_refs: [approvalRef],
    approved_by: options.approvedBy ?? "operator",
    approved_at: options.approvedAt ?? new Date().toISOString(),
    approved_plan_digest: context.plan.plan_digest,
  };

  const handoffFile = path.join(context.runtimeLayout.artifactsRoot, `${context.projectId}.handoff.bootstrap.v1.json`);
  const handoff = readJson(handoffFile);
  if (!handoff || handoff.plan_id !== context.plan.plan_id || handoff.plan_version !== context.plan.plan_version || handoff.plan_digest !== context.plan.plan_digest) {
    const error = new Error("Current handoff packet does not match the exact plan version and digest.");
    error.code = "plan-stale";
    throw error;
  }
  context.plan.plan_status = "approved";
  context.plan.approval_state = approvalState;
  handoff.plan_status = "approved";
  handoff.status = "approved";
  handoff.approval_state = approvalState;
  handoff.blocked_next_step = null;
  const handoffValidation = validateContractDocument({ family: "handoff-packet", document: handoff, source: "runtime://plan-handoff-approval" });
  if (!handoffValidation.ok) {
    const error = new Error("Approved structured handoff failed validation.");
    error.code = "handoff-invalid";
    error.validation = handoffValidation;
    throw error;
  }
  writeJson(context.planFile, context.plan);
  writeJson(handoffFile, handoff);
  const progress = materializeTaskProgress({ ...options, planRef: context.planFile });
  return {
    ...context,
    planRef: evidenceRef(context.projectRoot, context.planFile),
    handoff,
    handoffFile,
    executionPlan: progress.executionPlan,
    executionPlanFile: progress.executionPlanFile,
    taskProgress: progress.taskProgress,
    taskProgressFile: progress.taskProgressFile,
  };
}

export function approveTaskPlanFromHandoff(options = {}) {
  const context = previewProjectRuntime(options);
  const handoffFile = options.handoffPacketPath
    ? resolveEvidencePath(context.projectRoot, options.handoffPacketPath)
    : path.join(context.runtimeLayout.artifactsRoot, `${context.projectId}.handoff.bootstrap.v1.json`);
  const handoff = readJson(handoffFile);
  if (handoff?.task_model_version !== 1) return null;
  const planRef = asRecord(handoff.source_refs).wave_ticket_file;
  if (typeof planRef !== "string" || planRef.trim().length === 0) {
    const error = new Error("Structured handoff does not reference its owning task plan.");
    error.code = "plan-stale";
    throw error;
  }
  return approveTaskPlan({ ...options, planRef });
}

export function getTaskPlanStatus(options = {}) {
  const context = resolvePlanContext(options);
  const progressFile = path.join(
    context.runtimeLayout.reportsRoot,
    `task-progress-${safeSegment(context.plan.plan_id)}.v${context.plan.plan_version}.json`,
  );
  const executionPlanFile = path.join(
    context.runtimeLayout.artifactsRoot,
    `execution-plan-${safeSegment(context.plan.plan_id)}.v${context.plan.plan_version}.json`,
  );
  return {
    ...context,
    planRef: evidenceRef(context.projectRoot, context.planFile),
    executionPlan: readJson(executionPlanFile),
    executionPlanFile: fs.existsSync(executionPlanFile) ? executionPlanFile : null,
    taskProgress: readJson(progressFile),
    taskProgressFile: fs.existsSync(progressFile) ? progressFile : null,
  };
}

export function resolveExecutionUnitContext(options = {}) {
  const context = resolvePlanContext(options);
  if (context.plan.plan_status !== "approved") {
    const error = new Error("Run start requires the current structured task plan to be approved.");
    error.code = "plan-unapproved";
    throw error;
  }
  const executionPlanFile = options.executionPlanRef
    ? resolveEvidencePath(context.projectRoot, options.executionPlanRef)
    : path.join(
        context.runtimeLayout.artifactsRoot,
        `execution-plan-${safeSegment(context.plan.plan_id)}.v${context.plan.plan_version}.json`,
      );
  const executionPlan = readJson(executionPlanFile);
  if (!executionPlan) {
    const error = new Error("Approved plan has no readable execution-plan artifact.");
    error.code = "execution-plan-required";
    throw error;
  }
  const validation = validateContractDocument({
    family: "execution-plan",
    document: executionPlan,
    source: "runtime://run-execution-plan",
  });
  if (!validation.ok) {
    const error = new Error("Execution plan failed contract validation.");
    error.code = "execution-plan-invalid";
    error.validation = validation;
    throw error;
  }
  if (
    executionPlan.plan_id !== context.plan.plan_id
    || executionPlan.plan_version !== context.plan.plan_version
    || executionPlan.plan_digest !== context.plan.plan_digest
  ) {
    const error = new Error("Execution plan is stale for the current approved plan version.");
    error.code = "plan-stale";
    throw error;
  }
  const unitId = typeof options.executionUnitId === "string" ? options.executionUnitId.trim() : "";
  const unit = asRecordArray(executionPlan.execution_units).find((entry) => entry.unit_id === unitId);
  if (!unit) {
    const error = new Error(`Execution unit '${unitId || "missing"}' was not found in the approved execution plan.`);
    error.code = "execution-unit-not-found";
    throw error;
  }
  return {
    ...context,
    executionPlan,
    executionPlanFile,
    executionPlanRef: evidenceRef(context.projectRoot, executionPlanFile),
    executionUnit: unit,
    executionUnitId: unitId,
    taskRefs: asStringArray(unit.task_refs),
    planDigest: context.plan.plan_digest,
    taskDigests: Object.fromEntries(
      asStringArray(unit.task_refs).map((taskId) => [taskId, taskDigest(asRecordArray(context.plan.local_tasks).find((task) => task.task_id === taskId) ?? {})]),
    ),
  };
}
