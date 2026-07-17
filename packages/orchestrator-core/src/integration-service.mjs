import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { validateContractDocument } from "../../contracts/src/index.mjs";
import { materializeQualityRepairRequest } from "../../observability/src/quality-repair-request.mjs";
import { withFileLock, writeJsonAtomic } from "../../observability/src/file-transaction.mjs";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function safeRelative(value) {
  const normalized = String(value ?? "").replace(/\\/gu, "/");
  if (!normalized || path.isAbsolute(normalized) || normalized.split("/").includes("..")) {
    const error = new Error(`Integration path '${value}' is not a safe relative path.`);
    error.code = "integration-path-invalid";
    throw error;
  }
  return normalized;
}

function topologicalUnitOrder(units) {
  const byId = new Map(units.map((unit) => [unit.execution_unit_id ?? unit.unit_id, unit]));
  const pending = new Set(byId.keys());
  const ordered = [];
  while (pending.size > 0) {
    const ready = [...pending]
      .filter((id) => (byId.get(id).depends_on ?? []).every((dependency) => !pending.has(dependency)))
      .sort();
    if (ready.length === 0) throw Object.assign(new Error("Integration unit graph contains a cycle."), { code: "integration-dag-cycle" });
    for (const id of ready) {
      ordered.push(id);
      pending.delete(id);
    }
  }
  return ordered;
}

export function computeIntegrationInputFingerprint(input) {
  return sha256(JSON.stringify({
    dependency_evidence: unique(input.dependencyEvidence ?? []),
    contract_digests: unique(input.contractDigests ?? []),
    changed_paths: unique(input.changedPaths ?? []),
  }));
}

export function computeStaleBoundary(units, changes) {
  const changed = new Set(changes.map((change) => change.execution_unit_id));
  const stale = new Set();
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const unit of units) {
      const id = unit.execution_unit_id ?? unit.unit_id;
      if (stale.has(id) || changed.has(id)) continue;
      if ((unit.depends_on ?? []).some((dependency) => changed.has(dependency) || stale.has(dependency))) {
        stale.add(id);
        progressed = true;
      }
    }
  }
  return [...stale].sort().map((id) => ({
    execution_unit_id: id,
    reason: "dependency-input-changed",
    source_units: unique(units.find((unit) => (unit.execution_unit_id ?? unit.unit_id) === id).depends_on
      .filter((dependency) => changed.has(dependency) || stale.has(dependency))),
  }));
}

function validateOutput(output, options) {
  if (output.project_id !== options.projectId || output.parent_run_id !== options.parentRunId) {
    throw Object.assign(new Error("Child output ownership does not match the integration parent."), { code: "integration-output-ownership-mismatch" });
  }
  if (!options.unitIds.has(output.execution_unit_id) || !options.repoIds.has(output.repo_id)) {
    throw Object.assign(new Error("Child output references an unknown unit or repository."), { code: "integration-output-scope-mismatch" });
  }
  if (!['patch', 'commit'].includes(output.output_kind)) {
    throw Object.assign(new Error("Integration output kind must be patch or commit."), { code: "integration-output-kind-invalid" });
  }
  for (const changedPath of output.changed_paths ?? []) safeRelative(changedPath);
  if (output.output_kind === "patch") {
    const bytes = fs.readFileSync(output.output_file);
    if (sha256(bytes) !== output.output_digest) {
      throw Object.assign(new Error("Child patch digest does not match immutable evidence."), { code: "integration-output-digest-mismatch" });
    }
  }
}

function prepareWorkspace(options) {
  const root = path.join(options.runtimeLayout.stateRoot, "integration-workspaces", options.parentRunId);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const repositories = new Map();
  for (const repository of options.workspaceSet.repositories) {
    const mountPath = safeRelative(repository.mount_path ?? `repos/${repository.repo_id}`);
    const source = path.resolve(options.projectRoot, repository.execution_root);
    const target = path.join(root, mountPath);
    fs.cpSync(source, target, { recursive: true, dereference: false });
    repositories.set(repository.repo_id, { ...repository, source, target });
  }
  writeJsonAtomic(path.join(root, ".aor-integration-owner.json"), {
    project_id: options.projectId,
    parent_run_id: options.parentRunId,
  });
  return { root, repositories };
}

function applyOutput(output, repository) {
  if (output.output_kind === "patch") {
    execFileSync("git", ["apply", "--check", output.output_file], { cwd: repository.target, stdio: "pipe" });
    execFileSync("git", ["apply", output.output_file], { cwd: repository.target, stdio: "pipe" });
  } else {
    execFileSync("git", ["cherry-pick", "--no-commit", output.output_ref], { cwd: repository.target, stdio: "pipe" });
  }
}

function buildReport(options, workspace, sourceAttempts, blockers) {
  const now = options.now ?? new Date().toISOString();
  const gates = (options.aggregateGates ?? []).map((gate) => {
    const result = options.runGate ? options.runGate({ ...gate, workspace_root: workspace.root }) : { status: "pending", evidence_refs: [] };
    return { ...gate, required: gate.required !== false, status: result.status, evidence_refs: result.evidence_refs ?? [] };
  });
  const gateFailed = gates.some((gate) => gate.required && gate.status !== "passed");
  const status = blockers.length > 0 ? "blocked" : gateFailed ? "verification-pending" : "passed";
  const reportRef = `evidence://.aor/projects/${options.projectId}/reports/integration-report-${options.parentRunId}.json`;
  return {
    schema_version: 1,
    report_id: `integration-report-${options.parentRunId}`,
    project_id: options.projectId,
    parent_run_id: options.parentRunId,
    execution_plan_ref: options.executionPlanRef,
    workspace_set_ref: options.workspaceSetRef,
    status,
    revision: options.revision ?? 1,
    source_attempts: sourceAttempts,
    repository_results: [...workspace.repositories.values()].map((repository) => ({
      repo_id: repository.repo_id,
      integration_root: `runtime://integration-workspaces/${options.parentRunId}/${repository.mount_path}`,
      changed_paths: unique(sourceAttempts.filter((attempt) => attempt.repo_id === repository.repo_id).flatMap((attempt) => attempt.changed_paths)),
      conflicts: blockers.filter((blocker) => blocker.repo_id === repository.repo_id),
      retained: blockers.length > 0,
    })),
    aggregate_gates: gates,
    stale_units: options.staleUnits ?? [],
    repair_refs: options.repairRefs ?? [],
    blockers,
    evidence_refs: [reportRef, ...gates.flatMap((gate) => gate.evidence_refs)],
    retained_workspace_ref: blockers.length > 0 ? `runtime://integration-workspaces/${options.parentRunId}` : null,
    created_at: options.createdAt ?? now,
    updated_at: now,
  };
}

export function integrateParentRun(options) {
  const unitIds = new Set(options.parent.units.map((unit) => unit.execution_unit_id));
  const repoIds = new Set(options.workspaceSet.repositories.map((repository) => repository.repo_id));
  const workspace = prepareWorkspace(options);
  const outputsByUnit = new Map(options.childOutputs.map((output) => [output.execution_unit_id, output]));
  const sourceAttempts = [];
  const blockers = [];
  for (const unitId of topologicalUnitOrder(options.parent.units)) {
    const output = outputsByUnit.get(unitId);
    if (!output) {
      blockers.push({ code: "integration-output-missing", execution_unit_id: unitId });
      continue;
    }
    try {
      validateOutput(output, { projectId: options.projectId, parentRunId: options.parentRunId, unitIds, repoIds });
      applyOutput(output, workspace.repositories.get(output.repo_id));
      sourceAttempts.push({ ...output, output_file: undefined, status: "applied" });
    } catch (error) {
      blockers.push({
        code: error.code ?? "integration-apply-conflict",
        execution_unit_id: unitId,
        repo_id: output.repo_id,
        detail: error.message,
      });
      sourceAttempts.push({ ...output, output_file: undefined, status: "blocked" });
      break;
    }
  }
  const report = buildReport(options, workspace, sourceAttempts, blockers);
  const validation = validateContractDocument({ family: "integration-report", document: report, source: "runtime://integration-report" });
  if (!validation.ok) throw new Error(validation.issues.map((issue) => issue.message).join("; "));
  const reportFile = path.join(options.runtimeLayout.reportsRoot, `integration-report-${options.parentRunId}.json`);
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  writeJsonAtomic(reportFile, report);
  return { report, reportFile, workspaceRoot: workspace.root };
}

export function applyIntegrationToParent(options) {
  return withFileLock(`${options.parentFile}.lock`, () => {
    const parent = JSON.parse(fs.readFileSync(options.parentFile, "utf8"));
    if (options.expectedRevision !== undefined && parent.revision !== options.expectedRevision) {
      throw Object.assign(new Error("Parent integration revision conflict."), { code: "parent-run-revision-conflict" });
    }
    parent.integration_report_ref = options.integrationReportRef;
    parent.integration_gates = options.report.aggregate_gates;
    parent.stale_units = options.report.stale_units;
    parent.repair_refs = options.report.repair_refs;
    parent.blocker = options.report.status === "passed" ? null : { code: "parent-integration-not-passed", detail: options.report.status };
    parent.status = options.report.status === "passed" ? "succeeded" : "blocked";
    parent.revision += 1;
    parent.updated_at = options.now ?? new Date().toISOString();
    writeJsonAtomic(options.parentFile, parent);
    return parent;
  });
}

export function requestIntegrationRepair(options) {
  const originContext = Object.fromEntries(Object.entries({
    parent_run_id: options.parentRunId,
    execution_unit_id: options.executionUnitId,
    integration_gate_id: options.integrationGateId,
    input_fingerprint: options.inputFingerprint,
  }).filter(([, value]) => value !== undefined && value !== null));
  return materializeQualityRepairRequest({
    ...options,
    originContext,
  });
}
