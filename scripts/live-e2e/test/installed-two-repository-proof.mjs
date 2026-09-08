#!/usr/bin/env node
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const REQUIRED_SCENARIOS = Object.freeze([
  "provision",
  "conflict_serialization",
  "retry",
  "integration",
  "delivery",
  "cleanup",
]);

export function validateInstalledTwoRepositoryClosure(report) {
  const issues = [];
  if (report?.schema_version !== 1 || report?.evidence_kind !== "installed-public-two-repository-closure") {
    issues.push("closure report kind or schema version is invalid");
  }
  if (report?.status !== "pass") issues.push("closure report did not reach pass status");
  for (const scenario of REQUIRED_SCENARIOS) {
    if (report?.scenarios?.[scenario] !== "pass") issues.push(`scenario '${scenario}' did not pass`);
  }
  if (report?.upstream_writes !== false) issues.push("upstream writes were not explicitly false");
  if (report?.credentialed_provider_calls !== false) issues.push("credentialed provider calls were not explicitly false");
  if (report?.target_repository_unchanged !== true) issues.push("target repository stability was not proven");
  if (!Array.isArray(report?.commands) || report.commands.length < 8) issues.push("public command journal is incomplete");
  if (!Array.isArray(report?.source_snapshots) || report.source_snapshots.length !== 2) issues.push("two source repository snapshots are missing");
  return { ok: issues.length === 0, issues };
}

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status}): ${(result.stderr || result.stdout || "").trim()}`);
  }
  return result.stdout;
}

function runGit(cwd, args) {
  return runChecked("git", args, { cwd });
}

function initializeGitRepo(root, files) {
  for (const [relativePath, contents] of Object.entries(files)) {
    const file = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents, "utf8");
  }
  runGit(root, ["init"]);
  runGit(root, ["config", "user.email", "aor@example.com"]);
  runGit(root, ["config", "user.name", "AOR Installed Proof"]);
  runGit(root, ["add", "."]);
  runGit(root, ["commit", "-m", "initial"]);
  runGit(root, ["branch", "-M", "main"]);
}

function createNestedRepository(root, relativePath, files) {
  const repoRoot = path.join(root, relativePath);
  fs.mkdirSync(repoRoot, { recursive: true });
  initializeGitRepo(repoRoot, files);
  return repoRoot;
}

function buildProfile(root) {
  const source = parseYaml(fs.readFileSync(path.join(sourceRoot, "examples/project.bounded-multirepo.aor.yaml"), "utf8"));
  source.project_id = "aor-bounded-multirepo-sample";
  source.display_name = "AOR W71 S14 Installed Two Repository Proof";
  source.asset_mode = "materialized";
  source.repos = source.repos.filter((repo) => ["backend", "frontend"].includes(repo.repo_id));
  source.components = source.components.filter((component) => ["backend-api", "web-app"].includes(component.component_id));
  source.repo_graph = source.repo_graph.filter((edge) => edge.from_repo_id === "backend" && edge.to_repo_id === "frontend");
  source.component_graph = source.component_graph.filter((edge) => edge.from_component_id === "web-app");
  source.registry_roots = {
    routes: "examples/routes",
    wrappers: "examples/wrappers",
    prompts: "examples/prompts",
    policies: "examples/policies",
    adapters: "examples/adapters",
    evaluation: "examples",
    skills: "examples/skills",
    context_docs: "examples/context/docs",
    context_rules: "examples/context/rules",
    context_skills: "examples/context/skills",
    context_bundles: "examples/context/bundles",
  };
  const profile = path.join(root, "project.two-repository.yaml");
  fs.writeFileSync(profile, stringifyYaml(source), "utf8");
  fs.mkdirSync(path.join(root, ".aor"), { recursive: true });
  fs.copyFileSync(profile, path.join(root, ".aor", "project.yaml"));
  return profile;
}

function buildTasks() {
  return [
    ["backend", ["services/api/index.js", "services/api/index.js"]],
    ["frontend", ["apps/web/index.js"]],
  ].flatMap(([repoId, allowedPaths]) => allowedPaths.map((allowedPath, index) => ({
    task_id: `task.s14.${repoId}.${index + 1}`,
    title: `Verify ${repoId} closure ${index + 1}`,
    type: "implementation",
    objective: `Exercise the bounded ${repoId} repository path ${allowedPath}.`,
    rationale: "The installed closure must preserve independent repository ownership.",
    scope: { repo_ids: [repoId], component_ids: [], allowed_paths: [allowedPath], forbidden_paths: [] },
    depends_on: [],
    work_items: ["Run the bounded repository scenario."],
    criteria_refs: ["goal.1", "dod.1", "acceptance.1"],
    verification: {
      command_group_refs: [],
      validators: ["repo-scope"],
      manual_checks: ["Confirm the source checkout remains unchanged."],
      success_conditions: ["The repository output stays inside its declared scope."],
    },
    expected_evidence: ["verify-summary", "review-report"],
    risks: ["A repository-specific failure must remain recoverable."],
    stop_conditions: ["The scenario requires an upstream write."],
    execution_hints: {
      group_key: repoId === "backend" ? "backend-closure" : null,
      group_reason: repoId === "backend" ? "Backend files share one serialized integration unit." : null,
      parallel_candidate: false,
      conflict_keys: repoId === "backend" ? ["repo:backend"] : [],
    },
  })));
}

function createPatchEvidence(sourceRootPath, changedPaths, patchFile) {
  const originals = changedPaths.map((relativePath) => ({
    relativePath,
    contents: fs.readFileSync(path.join(sourceRootPath, relativePath), "utf8"),
  }));
  try {
    for (const entry of originals) fs.writeFileSync(path.join(sourceRootPath, entry.relativePath), `${entry.contents}// installed S14 closure evidence\n`, "utf8");
    const bytes = Buffer.from(runGit(sourceRootPath, ["diff", "--binary", "--", ...changedPaths]));
    fs.writeFileSync(patchFile, bytes);
    return bytes;
  } finally {
    for (const entry of originals) fs.writeFileSync(path.join(sourceRootPath, entry.relativePath), entry.contents, "utf8");
  }
}

function parseJson(stdout, label) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${label} did not return JSON: ${error instanceof Error ? error.message : String(error)}\n${stdout}`);
  }
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function summarizePayload(payload) {
  const keys = [
    "status",
    "plan_ref",
    "execution_plan_file",
    "workspace_set_ref",
    "integration_report_file",
    "delivery_manifest_file",
    "delivery_plan_status",
    "delivery_mode",
    "multirepo_coordination_ref",
    "multirepo_coordination_status",
    "multirepo_coordination_blocking",
    "multirepo_coordination_blocking_reasons",
    "multirepo_lock_state",
  ];
  return Object.fromEntries(keys.filter((key) => payload && payload[key] !== undefined && payload[key] !== null).map((key) => [key, payload[key]]));
}

function invokeAor(installedBin, args, context, options = {}) {
  const fullArgs = [installedBin, ...args, "--json"];
  const result = spawnSync(process.execPath, fullArgs, {
    cwd: context.launcherRoot,
    env: { ...process.env, AOR_HOME: context.aorHome },
    encoding: "utf8",
    timeout: options.timeoutMs ?? 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const stdoutBytes = Buffer.from(result.stdout ?? "", "utf8");
  const stderrBytes = Buffer.from(result.stderr ?? "", "utf8");
  const journalId = String(context.journal.length + 1).padStart(2, "0");
  const stdoutFile = path.join(context.journalRoot, `${journalId}.stdout`);
  const stderrFile = path.join(context.journalRoot, `${journalId}.stderr`);
  fs.mkdirSync(context.journalRoot, { recursive: true });
  fs.writeFileSync(stdoutFile, stdoutBytes);
  fs.writeFileSync(stderrFile, stderrBytes);
  const output = {
    command: ["aor", ...args].join(" "),
    status: result.status,
    stdout_ref: path.relative(context.evidenceRoot, stdoutFile).split(path.sep).join("/"),
    stderr_ref: path.relative(context.evidenceRoot, stderrFile).split(path.sep).join("/"),
    stdout_sha256: `sha256:${sha256(stdoutBytes)}`,
    stderr_sha256: `sha256:${sha256(stderrBytes)}`,
  };
  let payload = null;
  if (result.status === 0 && stdoutBytes.length > 0) payload = parseJson(result.stdout, output.command);
  output.payload_summary = payload ? summarizePayload(payload) : null;
  context.journal.push(output);
  if (options.expectFailure) {
    if (result.status === 0) throw new Error(`Expected '${output.command}' to fail, but it succeeded.`);
    return { ...output, stdout: result.stdout ?? "", stderr: result.stderr ?? "", payload };
  }
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${output.command} failed (${result.status}): ${result.stderr || result.stdout}`);
  return { ...output, stdout: result.stdout ?? "", stderr: result.stderr ?? "", payload };
}

function runtimePath(payload, camel, snake = camel) {
  const layout = payload.runtime_layout ?? {};
  return layout[camel] ?? layout[snake];
}

function parentRunDocument({ plan, workspaceRef, planRef, parentRunId }) {
  return {
    schema_version: 1,
    parent_run_id: parentRunId,
    project_id: plan.project_id,
    execution_plan_ref: planRef,
    workspace_set_ref: workspaceRef,
    status: "integration-pending",
    revision: 0,
    units: plan.execution_units.map((unit) => ({
      execution_unit_id: unit.unit_id,
      task_refs: unit.task_refs,
      depends_on: unit.depends_on,
      conflict_keys: unit.conflict_keys,
      repository_scope: unit.repository_scope,
      status: "succeeded",
      attempt_count: 1,
      active_child_run_id: null,
      child_runs: [{ child_run_id: `child.${unit.unit_id}`, attempt: 1, status: "succeeded", evidence_refs: [] }],
      blocker_codes: [],
    })),
    integration_gates: [],
    command_ids: [],
    event_cursor: 0,
    events: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    terminal_at: null,
  };
}

function main() {
  const installedBinArg = argValue("--installed-bin");
  if (!installedBinArg) throw new Error("--installed-bin is required.");
  const installedBin = path.resolve(installedBinArg);
  if (!fs.existsSync(installedBin)) throw new Error(`Installed CLI binary '${installedBin}' does not exist.`);
  const installedPackageRoot = path.resolve(path.dirname(installedBin), "../../..");
  const outputPath = argValue("--output", path.join(sourceRoot, "node_modules/.cache/aor/installed-two-repository-proof.json"));
  const resolvedOutputPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  const evidenceRoot = fs.mkdtempSync(path.join(path.dirname(resolvedOutputPath), `${path.basename(resolvedOutputPath, path.extname(resolvedOutputPath))}-`));
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-installed-two-repository-proof-"));
  const launcherRoot = path.join(tempRoot, "neutral launcher");
  const targetRoot = path.join(evidenceRoot, "target");
  const aorHome = path.join(evidenceRoot, "aor-home");
  fs.mkdirSync(launcherRoot, { recursive: true });
  fs.mkdirSync(targetRoot, { recursive: true });
  const journalRoot = path.join(evidenceRoot, "journal");
  const context = { launcherRoot, targetRoot, aorHome, evidenceRoot, journalRoot, journal: [] };
  const report = {
    schema_version: 1,
    evidence_kind: "installed-public-two-repository-closure",
    status: "running",
    started_at: new Date().toISOString(),
    finished_at: null,
    installed_bin: installedBin,
    package_root: installedPackageRoot,
    project_root: targetRoot,
    aor_home: aorHome,
    evidence_root: evidenceRoot,
    upstream_writes: false,
    credentialed_provider_calls: false,
    target_repository_unchanged: false,
    scenarios: {
      provision: "not-run",
      conflict_serialization: "not-run",
      retry: "not-run",
      integration: "not-run",
      delivery: "not-run",
      cleanup: "not-run",
    },
    commands: context.journal,
    source_snapshots: [],
  };
  try {
    initializeGitRepo(targetRoot, { "README.md": "# Installed S14 proof\n" });
    fs.cpSync(path.join(installedPackageRoot, "examples"), path.join(targetRoot, "examples"), { recursive: true });
    const backendRoot = createNestedRepository(targetRoot, "repos/backend", {
      "services/api/index.js": "export const service = 'backend';\n",
      "services/api/schema.js": "export const schema = 1;\n",
    });
    const frontendRoot = createNestedRepository(targetRoot, "repos/frontend", {
      "apps/web/index.js": "export const app = 'frontend';\n",
    });
    const profile = buildProfile(targetRoot);
    const requestFile = path.join(targetRoot, "s14-two-repository-request.json");
    fs.writeFileSync(requestFile, `${JSON.stringify({
      mission_id: "mission.s14.two-repository-closure",
      feature_size: "medium",
      mission_type: "code-changing",
      work_type: "code-change",
      delivery_mode: "no-write",
      goals: ["Prove the installed public two-repository closure."],
      definition_of_done: ["Every source checkout remains unchanged."],
      acceptance_checks: ["Integration and delivery evidence resolve from AOR Home."],
      allowed_paths: ["services/api/**", "apps/web/**"],
      task_plan: { local_tasks: buildTasks() },
    }, null, 2)}\n`, "utf8");
    const snapshots = [backendRoot, frontendRoot].map((root) => ({
      root,
      head: runGit(root, ["rev-parse", "HEAD"]).trim(),
      status: runGit(root, ["status", "--porcelain"]),
    }));
    report.source_snapshots = snapshots;

    const intake = invokeAor(installedBin, ["intake", "create", "--project-ref", targetRoot, "--project-profile", profile, "--request-file", requestFile], context).payload;
    const plan = invokeAor(installedBin, ["plan", "create", "--project-ref", targetRoot, "--project-profile", profile, "--approved-artifact", intake.artifact_packet_file], context).payload;
    if (plan.plan?.plan_status !== "proposed" || plan.plan_validation_report?.status !== "pass") throw new Error("Installed plan did not reach a validated proposed state.");
    const approved = invokeAor(installedBin, ["plan", "approve", "--project-ref", targetRoot, "--plan-ref", plan.plan_ref, "--approval-ref", "approval://w71-s14-installed-two-repository"], context).payload;
    const provision = invokeAor(installedBin, ["workspace", "provision", "--project-ref", targetRoot, "--project-profile", profile, "--run-id", "run-s14-installed-two-repository"], context).payload;
    if (provision.workspace_set?.status !== "ready" || provision.workspace_set.repositories?.length !== 2) throw new Error("Installed workspace provision did not produce two ready repositories.");
    report.scenarios.provision = "pass";

    const workspaceProjectId = /^evidence:\/\/projects\/([^/]+)\//u.exec(provision.workspace_set_ref)?.[1];
    if (!workspaceProjectId) throw new Error(`Could not resolve workspace project id from '${provision.workspace_set_ref}'.`);
    const parentRunId = "run-s14-installed-two-repository";
    const parentFile = path.join(runtimePath(intake, "stateRoot", "state_root"), "parent-runs", `parent-run-${parentRunId}.json`);
    const planRef = `evidence://projects/${workspaceProjectId}/artifacts/${path.basename(approved.execution_plan_file)}`;
    const parent = parentRunDocument({ plan: approved.execution_plan, workspaceRef: provision.workspace_set_ref, planRef, parentRunId });
    fs.mkdirSync(path.dirname(parentFile), { recursive: true });
    fs.writeFileSync(parentFile, `${JSON.stringify(parent, null, 2)}\n`, "utf8");

    const lock = invokeAor(installedBin, ["multirepo", "lock", "--project-ref", targetRoot, "--project-profile", profile, "--action", "acquire", "--run-id", parentRunId, "--owner-ref", "owner.s14.primary", "--repo-ids", "backend,frontend", "--path-globs", "services/api/**,apps/web/**", "--repo-validation-refs", "backend=validation://repos/backend/w71-s14-installed,frontend=validation://repos/frontend/w71-s14-installed", "--integration-validation-refs", "validation://integration/w71-s14/installed-two-repository"], context).payload;
    const conflictingLock = invokeAor(installedBin, ["multirepo", "lock", "--project-ref", targetRoot, "--project-profile", profile, "--action", "acquire", "--run-id", parentRunId, "--owner-ref", "owner.s14.conflict", "--repo-ids", "backend,frontend", "--path-globs", "services/api/**,apps/web/**"], context);
    if (conflictingLock.payload.multirepo_coordination_status !== "blocked" || !conflictingLock.payload.multirepo_coordination_blocking_reasons?.includes("lock-conflict")) throw new Error("Overlapping multirepo lock did not expose a deterministic lock-conflict blocker.");
    report.scenarios.conflict_serialization = "pass";

    const retryParentId = "run-s14-installed-retry";
    const retryParent = parentRunDocument({ plan: approved.execution_plan, workspaceRef: provision.workspace_set_ref, planRef, parentRunId: retryParentId });
    retryParent.status = "attention";
    retryParent.units[0].status = "failed";
    retryParent.units[0].blocker_codes = ["runner-failed"];
    const retryParentFile = path.join(runtimePath(intake, "stateRoot", "state_root"), "parent-runs", `parent-run-${retryParentId}.json`);
    fs.writeFileSync(retryParentFile, `${JSON.stringify(retryParent, null, 2)}\n`, "utf8");
    const retried = invokeAor(installedBin, ["run", "retry", "--project-ref", targetRoot, "--parent-run-id", retryParentId, "--execution-unit-id", retryParent.units[0].execution_unit_id, "--command-id", "retry-s14-installed", "--expected-revision", "0"], context).payload;
    if (retried.parent_run?.units?.[0]?.status !== "pending") throw new Error("Installed retry did not return the failed unit to pending.");
    report.scenarios.retry = "pass";

    const childOutputRefs = [];
    for (const unit of approved.execution_plan.execution_units) {
      const parentUnit = parent.units.find((candidate) => candidate.execution_unit_id === unit.unit_id);
      const sourceRoot = unit.scope.repo_ids[0] === "backend" ? backendRoot : frontendRoot;
      const changedPaths = unit.scope.allowed_paths;
      const patchFile = path.join(runtimePath(intake, "runtimeLayout", "reportsRoot"), `child-output-${unit.unit_id}.patch`);
      const patchBytes = createPatchEvidence(sourceRoot, changedPaths, patchFile);
      const childOutputFile = path.join(runtimePath(intake, "runtimeLayout", "reportsRoot"), `child-output-${unit.unit_id}.json`);
      const childOutput = {
        project_id: approved.plan.project_id,
        parent_run_id: parentRunId,
        execution_unit_id: unit.unit_id,
        child_run_id: parentUnit.child_runs[0].child_run_id,
        attempt: parentUnit.child_runs[0].attempt,
        repo_id: unit.scope.repo_ids[0],
        output_kind: "patch",
        output_ref: `evidence://projects/${workspaceProjectId}/reports/${path.basename(patchFile)}`,
        output_file: patchFile,
        output_digest: crypto.createHash("sha256").update(patchBytes).digest("hex"),
        changed_paths: changedPaths,
      };
      fs.writeFileSync(childOutputFile, `${JSON.stringify(childOutput, null, 2)}\n`, "utf8");
      childOutputRefs.push(childOutputFile);
    }
    const integrated = invokeAor(installedBin, ["run", "integration", "--project-ref", targetRoot, "--parent-run-id", parentRunId, "--action", "materialize", "--execution-plan-ref", approved.execution_plan_file, "--workspace-set-ref", provision.workspace_set_ref, ...childOutputRefs.flatMap((ref) => ["--child-output-file", ref]), "--command-id", "integrate-s14-installed", "--expected-revision", "0"], context).payload;
    if (integrated.integration_report?.status !== "passed" || integrated.parent_run?.status !== "succeeded" || integrated.integration_report.repository_results?.length !== 2) throw new Error("Installed two-repository integration did not close with two repository results.");
    report.scenarios.integration = "pass";
    const delivery = invokeAor(installedBin, ["deliver", "prepare", "--project-ref", targetRoot, "--project-profile", profile, "--run-id", parentRunId, "--mode", "no-write", "--integration-report", integrated.integration_report_file], context).payload;
    if (delivery.delivery_plan_status !== "ready" || delivery.delivery_mode !== "no-write" || !delivery.delivery_manifest_file) throw new Error("Installed two-repository delivery did not produce a ready no-write manifest.");
    report.scenarios.delivery = "pass";

    const released = invokeAor(installedBin, ["multirepo", "lock", "--project-ref", targetRoot, "--project-profile", profile, "--action", "release", "--run-id", parentRunId, "--lock-id", lock.multirepo_lock_state?.lock_id ?? lock.multirepo_coordination_records?.[0]?.lock_state?.lock_id], context).payload;
    if (released.multirepo_coordination_status !== "released") throw new Error("Installed multirepo lock cleanup did not release the active lock.");
    report.scenarios.cleanup = "pass";

    for (const snapshot of snapshots) {
      if (runGit(snapshot.root, ["rev-parse", "HEAD"]).trim() !== snapshot.head || runGit(snapshot.root, ["status", "--porcelain"]) !== snapshot.status) throw new Error(`Source repository '${snapshot.root}' changed during installed closure.`);
    }
    report.target_repository_unchanged = true;
    if (fs.readdirSync(launcherRoot).length > 0) throw new Error("Neutral launcher received unexpected files.");
    report.status = "pass";
    report.finished_at = new Date().toISOString();
    report.commands = context.journal;
    const validation = validateInstalledTwoRepositoryClosure(report);
    if (!validation.ok) throw new Error(`Installed two-repository closure report failed validation: ${validation.issues.join("; ")}`);
    fs.writeFileSync(resolvedOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({ status: report.status, report: resolvedOutputPath, evidence_root: evidenceRoot, scenarios: report.scenarios })}\n`);
  } catch (error) {
    report.status = "fail";
    report.finished_at = new Date().toISOString();
    report.failure = error instanceof Error ? error.message : String(error);
    report.commands = context.journal;
    fs.writeFileSync(resolvedOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    throw error;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
