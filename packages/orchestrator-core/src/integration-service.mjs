import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { compareChangedPathsToScope, validateContractDocument } from "../../contracts/src/index.mjs";
import { materializeQualityRepairRequest } from "../../observability/src/quality-repair-request.mjs";
import { withFileLock, writeJsonAtomic } from "../../observability/src/file-transaction.mjs";
import { resolveEvidenceReference } from "./aor-home.mjs";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function integrationAuthorityFile(reportFile) {
  return `${reportFile}.authority.json`;
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

function gitValue(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function absoluteGitPath(repositoryRoot, value) {
  return path.resolve(repositoryRoot, value);
}

function workingTreeDigest(repositoryRoot) {
  const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: repositoryRoot });
  const digest = crypto.createHash("sha256");
  for (const relativePath of files.toString("utf8").split("\0").filter(Boolean)) {
    digest.update(relativePath);
    digest.update("\0");
    digest.update(fs.readFileSync(path.join(repositoryRoot, relativePath)));
    digest.update("\0");
  }
  return digest.digest("hex");
}

function repositoryGitIdentity(repositoryRoot) {
  return {
    head: gitValue(repositoryRoot, ["rev-parse", "HEAD"]),
    gitdir: absoluteGitPath(repositoryRoot, gitValue(repositoryRoot, ["rev-parse", "--git-dir"])),
    index: absoluteGitPath(repositoryRoot, gitValue(repositoryRoot, ["rev-parse", "--git-path", "index"])),
    status: execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: repositoryRoot, encoding: "utf8" }),
    workingTreeDigest: workingTreeDigest(repositoryRoot),
  };
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
  if (typeof output.child_run_id !== "string" || output.child_run_id.length === 0 || !Number.isInteger(output.attempt) || output.attempt < 1) {
    throw Object.assign(new Error("Child output must bind to a child run and positive attempt."), { code: "integration-output-identity-missing" });
  }
  if (!['patch', 'commit'].includes(output.output_kind)) {
    throw Object.assign(new Error("Integration output kind must be patch or commit."), { code: "integration-output-kind-invalid" });
  }
  for (const changedPath of output.changed_paths ?? []) safeRelative(changedPath);
  if (!Array.isArray(output.changed_paths)) {
    throw Object.assign(new Error("Child output must declare its measured changed paths."), { code: "integration-output-paths-missing" });
  }
  if (Array.isArray(options.allowedPaths)) {
    const scope = compareChangedPathsToScope(output.changed_paths, options.allowedPaths);
    if (!scope.ok) {
      throw Object.assign(new Error(`Child output changed paths exceed the declared unit scope (${scope.unauthorized.join(", ")}).`), { code: "integration-output-out-of-scope", unauthorized_paths: scope.unauthorized });
    }
  }
  if (output.output_kind === "patch") {
    if (!output.output_file || !fs.existsSync(output.output_file)) {
      throw Object.assign(new Error("Child patch evidence file is missing."), { code: "integration-output-missing" });
    }
    const bytes = fs.readFileSync(output.output_file);
    if (sha256(bytes) !== output.output_digest) {
      throw Object.assign(new Error("Child patch digest does not match immutable evidence."), { code: "integration-output-digest-mismatch" });
    }
  }
  if (output.output_kind === "commit" && !/^[0-9a-f]{40}$/u.test(String(output.commit_sha ?? output.output_ref ?? ""))) {
    throw Object.assign(new Error("Commit integration output must declare commit_sha as an exact Git SHA."), { code: "integration-output-commit-invalid" });
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
    const sourceIdentity = repositoryGitIdentity(source);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    execFileSync("git", ["clone", "--no-hardlinks", "--no-checkout", "--", source, target], { stdio: "pipe" });
    execFileSync("git", ["checkout", "--detach", repository.resolved_commit ?? sourceIdentity.head], { cwd: target, stdio: "pipe" });
    const targetIdentity = repositoryGitIdentity(target);
    if (sourceIdentity.gitdir === targetIdentity.gitdir || sourceIdentity.index === targetIdentity.index) {
      throw Object.assign(new Error(`Integration workspace for '${repository.repo_id}' does not own an independent Git directory and index.`), { code: "integration-workspace-not-isolated" });
    }
    repositories.set(repository.repo_id, { ...repository, source, target, sourceIdentity, targetIdentity });
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
    const commit = String(output.commit_sha ?? output.output_ref ?? "");
    if (!/^[0-9a-f]{40}$/u.test(commit)) {
      throw Object.assign(new Error("Commit integration output must reference an exact Git SHA."), { code: "integration-output-commit-invalid" });
    }
    try {
      execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: repository.target, stdio: "pipe" });
      execFileSync("git", ["merge-base", "--is-ancestor", repository.targetIdentity.head, commit], { cwd: repository.target, stdio: "pipe" });
    } catch {
      throw Object.assign(new Error("Commit integration output is not an object descended from the authoritative repository base."), { code: "integration-output-commit-ancestry-mismatch" });
    }
    execFileSync("git", ["cherry-pick", "--no-commit", commit], { cwd: repository.target, stdio: "pipe" });
  }
  const changedPaths = gitValue(repository.target, ["diff", "--name-only", repository.targetIdentity.head, "--"]).split("\n").filter(Boolean).sort();
  const diff = execFileSync("git", ["diff", "--binary", repository.targetIdentity.head, "--"], { cwd: repository.target });
  return { changedPaths, diffDigest: sha256(diff), baseCommit: repository.targetIdentity.head };
}

function buildReport(options, workspace, sourceAttempts, blockers) {
  const now = options.now ?? new Date().toISOString();
  const gates = (options.aggregateGates ?? []).map((gate) => {
    const result = options.runGate ? options.runGate({ ...gate, workspace_root: workspace.root }) : { status: "pending", evidence_refs: [] };
    return { ...gate, required: gate.required !== false, status: result.status, evidence_refs: result.evidence_refs ?? [] };
  });
  const gateFailed = gates.some((gate) => gate.required && gate.status !== "passed");
  const status = blockers.length > 0 ? "blocked" : gateFailed ? "verification-pending" : "passed";
  const reportRef = `evidence://projects/${options.projectId}/reports/integration-report-${options.parentRunId}.json`;
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
      workspace_isolation: {
        source_head: repository.sourceIdentity.head,
        integration_base_commit: repository.targetIdentity.head,
        source_gitdir_digest: sha256(repository.sourceIdentity.gitdir),
        integration_gitdir_digest: sha256(repository.targetIdentity.gitdir),
        source_index_digest: sha256(repository.sourceIdentity.index),
        integration_index_digest: sha256(repository.targetIdentity.index),
        distinct_gitdir: repository.sourceIdentity.gitdir !== repository.targetIdentity.gitdir,
        distinct_index: repository.sourceIdentity.index !== repository.targetIdentity.index,
        source_integrity: repository.sourceIntegrity ?? { head_unchanged: false, status_unchanged: false, bytes_unchanged: false },
      },
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
    const unit = options.parent.units.find((candidate) => candidate.execution_unit_id === unitId) ?? {};
    if (!output) {
      blockers.push({ code: "integration-output-missing", execution_unit_id: unitId });
      continue;
    }
    try {
      const repository = workspace.repositories.get(output.repo_id);
      if (!repository) throw Object.assign(new Error("Child output repository is not provisioned in the integration workspace."), { code: "integration-output-scope-mismatch" });
      validateOutput(output, {
        projectId: options.projectId,
        parentRunId: options.parentRunId,
        unitIds,
        repoIds,
        allowedPaths: Array.isArray(unit.scope?.allowed_paths) ? unit.scope.allowed_paths : null,
      });
      const measured = applyOutput(output, repository);
      const expectedPaths = unique(output.changed_paths);
      if (JSON.stringify(measured.changedPaths) !== JSON.stringify(expectedPaths)) {
        throw Object.assign(new Error(`Measured integration paths do not match child evidence (${measured.changedPaths.join(", ")} vs ${expectedPaths.join(", ")}).`), { code: "integration-output-path-mismatch" });
      }
      sourceAttempts.push({ ...output, output_file: undefined, status: "applied", measured_changed_paths: measured.changedPaths, measured_diff_digest: measured.diffDigest, authoritative_base_commit: measured.baseCommit });
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
  for (const repository of workspace.repositories.values()) {
    const finalIdentity = repositoryGitIdentity(repository.source);
    repository.sourceIntegrity = {
      head_unchanged: finalIdentity.head === repository.sourceIdentity.head,
      status_unchanged: finalIdentity.status === repository.sourceIdentity.status,
      bytes_unchanged: finalIdentity.workingTreeDigest === repository.sourceIdentity.workingTreeDigest,
    };
    if (!repository.sourceIntegrity.head_unchanged || !repository.sourceIntegrity.status_unchanged || !repository.sourceIntegrity.bytes_unchanged) {
      blockers.push({ code: "integration-source-checkout-mutated", repo_id: repository.repo_id, detail: "Integration changed the authoritative child checkout." });
    }
  }
  const report = buildReport(options, workspace, sourceAttempts, blockers);
  const validation = validateContractDocument({ family: "integration-report", document: report, source: "runtime://integration-report" });
  if (!validation.ok) throw new Error(validation.issues.map((issue) => issue.message).join("; "));
  const reportFile = path.join(options.runtimeLayout.reportsRoot, `integration-report-${options.parentRunId}.json`);
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  writeJsonAtomic(reportFile, report);
  const reportBytes = fs.readFileSync(reportFile);
  const authority = {
    schema_version: 1,
    authority_kind: "aor-integration-materialization",
    project_id: options.projectId,
    parent_run_id: options.parentRunId,
    report_file: reportFile,
    report_digest: sha256(reportBytes),
    workspace_owner_digest: sha256(fs.readFileSync(path.join(workspace.root, ".aor-integration-owner.json"))),
    source_output_digests: unique(sourceAttempts.map((attempt) => attempt.output_digest)),
    created_at: options.now ?? new Date().toISOString(),
  };
  const authorityFile = integrationAuthorityFile(reportFile);
  writeJsonAtomic(authorityFile, authority);
  return { report, reportFile, authority, authorityFile, workspaceRoot: workspace.root };
}

export function applyIntegrationToParent(options) {
  return withFileLock(`${options.parentFile}.lock`, () => {
    const parent = JSON.parse(fs.readFileSync(options.parentFile, "utf8"));
    if (options.expectedRevision !== undefined && parent.revision !== options.expectedRevision) {
      throw Object.assign(new Error("Parent integration revision conflict."), { code: "parent-run-revision-conflict" });
    }
    if (typeof options.repairRef === "string" && options.repairRef.length > 0) {
      parent.repair_refs = unique([...(parent.repair_refs ?? []), options.repairRef]);
      parent.blocker = { code: "parent-integration-repair-required", detail: options.repairRef };
      parent.status = "blocked";
      parent.revision += 1;
      parent.updated_at = options.now ?? new Date().toISOString();
      writeJsonAtomic(options.parentFile, parent);
      return parent;
    }
    const projectRuntimeRoot = path.dirname(path.dirname(path.dirname(options.parentFile)));
    const expectedReportFile = path.join(projectRuntimeRoot, "reports", `integration-report-${parent.parent_run_id}.json`);
    const reportFile = path.resolve(options.reportFile ?? "");
    if (reportFile !== path.resolve(expectedReportFile) || !fs.existsSync(reportFile)) {
      throw Object.assign(new Error("Parent integration requires its canonical materialized report."), {
        code: "integration-report-not-authoritative",
      });
    }
    const authorityFile = integrationAuthorityFile(reportFile);
    if (!fs.existsSync(authorityFile)) {
      throw Object.assign(new Error("Integration materialization authority is missing."), {
        code: "integration-report-not-authoritative",
      });
    }
    const resolvedReport = resolveEvidenceReference({
      projectRoot: projectRuntimeRoot,
      projectRuntimeRoot,
      workspaceProjectId: parent.project_id,
      reference: reportFile,
    });
    const reportBytes = resolvedReport.bytes;
    const report = JSON.parse(reportBytes);
    const authority = JSON.parse(fs.readFileSync(authorityFile, "utf8"));
    if (
      authority.authority_kind !== "aor-integration-materialization"
      || authority.parent_run_id !== parent.parent_run_id
      || authority.project_id !== parent.project_id
      || authority.report_file !== reportFile
      || authority.report_digest !== sha256(reportBytes)
      || report.parent_run_id !== parent.parent_run_id
      || report.project_id !== parent.project_id
    ) {
      throw Object.assign(new Error("Integration report does not match its authoritative materialization."), {
        code: "integration-report-not-authoritative",
      });
    }
    parent.integration_report_ref = options.integrationReportRef;
    parent.integration_report_digest = authority.report_digest;
    parent.integration_authority_ref = options.integrationAuthorityRef ?? `${options.integrationReportRef}.authority.json`;
    parent.integration_gates = report.aggregate_gates;
    parent.stale_units = report.stale_units;
    parent.repair_refs = report.repair_refs;
    parent.blocker = report.status === "passed" ? null : { code: "parent-integration-not-passed", detail: report.status };
    parent.status = report.status === "passed" ? "succeeded" : "blocked";
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
