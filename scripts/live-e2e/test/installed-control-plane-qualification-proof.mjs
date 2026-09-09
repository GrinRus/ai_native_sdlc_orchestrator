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
const REQUIRED_SCENARIOS = Object.freeze(["prepare_to_start_to_work", "recovery_and_review_completion"]);

export function validateInstalledControlPlaneQualification(report) {
  const issues = [];
  if (report?.schema_version !== 1 || report?.evidence_kind !== "installed-control-plane-qualification") {
    issues.push("qualification report kind or schema version is invalid");
  }
  if (report?.status !== "pass") issues.push("qualification report did not reach pass status");
  for (const scenario of REQUIRED_SCENARIOS) {
    if (report?.scenarios?.[scenario] !== "pass") issues.push(`scenario '${scenario}' did not pass`);
  }
  if (report?.upstream_writes !== false) issues.push("upstream writes were not explicitly false");
  if (report?.credentialed_provider_calls !== false) issues.push("credentialed provider calls were not explicitly false");
  if (report?.target_repository_unchanged !== true) issues.push("target repository stability was not proven");
  if (typeof report?.workspace_project_id !== "string" || !report.workspace_project_id) issues.push("workspace project identity is missing");
  if (!Array.isArray(report?.commands) || report.commands.length < 12) issues.push("public command journal is incomplete");
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
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status}): ${(result.stderr || result.stdout || "").trim()}`);
  return result.stdout;
}

function runGit(cwd, args) { return runChecked("git", args, { cwd }); }

function initializeGitRepo(root, files) {
  for (const [relativePath, contents] of Object.entries(files)) {
    const file = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents, "utf8");
  }
  runGit(root, ["init"]);
  runGit(root, ["config", "user.email", "aor@example.com"]);
  runGit(root, ["config", "user.name", "AOR Installed Qualification Proof"]);
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

function buildTasks() {
  return [
    ["backend", ["services/api/index.js", "services/api/index.js"]],
    ["frontend", ["apps/web/index.js", "apps/web/index.js"]],
  ].flatMap(([repoId, allowedPaths]) => allowedPaths.map((allowedPath, index) => ({
    task_id: `task.s14.qualification.${repoId}.${index + 1}`,
    title: `Qualify ${repoId} lifecycle`,
    type: "implementation",
    objective: `Exercise the installed ${repoId} repository lifecycle path.`,
    rationale: "Installed qualification must preserve independent repository ownership.",
    scope: { repo_ids: [repoId], component_ids: [], allowed_paths: [allowedPath], forbidden_paths: [] },
    depends_on: [],
    work_items: ["Run the bounded repository scenario."],
    criteria_refs: ["goal.1", "dod.1", "acceptance.1"],
    verification: { command_group_refs: [], validators: ["repo-scope"], manual_checks: ["Confirm source checkout stability."], success_conditions: ["The repository output stays inside its declared scope."] },
    expected_evidence: ["verify-summary", "review-report"],
    risks: ["A repository-specific failure must remain recoverable."],
    stop_conditions: ["The scenario requires an upstream write."],
    execution_hints: { group_key: repoId, group_reason: `The ${repoId} repository qualification is one serialized evidence group.`, parallel_candidate: false, conflict_keys: [`repo:${repoId}`] },
  })));
}

function buildProfile(root) {
  const profile = parseYaml(fs.readFileSync(path.join(sourceRoot, "examples/project.bounded-multirepo.aor.yaml"), "utf8"));
  profile.project_id = "aor-installed-control-plane-qualification";
  profile.display_name = "AOR Installed Control Plane Qualification";
  profile.repos = profile.repos
    .filter((repo) => ["backend", "frontend"].includes(repo.repo_id))
    .map((repo) => ({ ...repo, build_commands: ["true"], test_commands: ["true"], lint_commands: ["true"] }));
  profile.components = profile.components.filter((component) => ["backend-api", "web-app"].includes(component.component_id));
  profile.repo_graph = profile.repo_graph.filter((edge) => edge.from_repo_id === "backend" && edge.to_repo_id === "frontend");
  profile.component_graph = profile.component_graph.filter((edge) => edge.from_component_id === "web-app");
  profile.registry_roots = {
    routes: "examples/routes", wrappers: "examples/wrappers", prompts: "examples/prompts", policies: "examples/policies",
    adapters: "examples/adapters", evaluation: "examples", skills: "examples/skills", context_docs: "examples/context/docs",
    context_rules: "examples/context/rules", context_skills: "examples/context/skills", context_bundles: "examples/context/bundles",
  };
  const profilePath = path.join(root, "project.aor.yaml");
  fs.writeFileSync(profilePath, stringifyYaml(profile), "utf8");
  fs.mkdirSync(path.join(root, ".aor"), { recursive: true });
  fs.copyFileSync(profilePath, path.join(root, ".aor", "project.yaml"));
  return profilePath;
}

function configureDeterministicProvider(root) {
  const adapterPath = path.join(root, "examples/adapters/codex-cli.yaml");
  const adapter = parseYaml(fs.readFileSync(adapterPath, "utf8"));
  const providerCode = [
    "const fs=require('node:fs');",
    "const index=process.argv.indexOf('--work-packet');",
    "const packet=index>=0?JSON.parse(fs.readFileSync(process.argv[index+1],'utf8')):JSON.parse(fs.readFileSync(0,'utf8'));",
    "const request=packet.request||packet||{};",
    "if(request.step_class==='implement'&&request.dry_run===false){fs.mkdirSync('qualification',{recursive:true});fs.writeFileSync('qualification/installed-work.txt','deterministic installed work\\n');}",
    "process.stdout.write(JSON.stringify({status:'completed',summary:'deterministic installed qualification runner',changed_files:request.step_class==='implement'?['qualification/installed-work.txt']:[],command_result_claims:[{command:'deterministic-installed-runner',status:'passed',summary:'The bounded local runner completed.'}],verification:{summary:'The installed proof runner completed its declared step.'},risks:[],repair_closure:null,intent_normalization:{title:'Installed qualification task',outcome:'Complete the bounded two-repository proof.',constraints:['No upstream writes.'],acceptance:['Review and completion evidence resolve after reload.'],scope:{allowed_paths:['**'],forbidden_paths:['.git/**']},work_type:'code-change',confidence:0.99},evidence_refs:['evidence://installed-qualification/mock-runner'],tool_traces:[{phase:'invoke_adapter',kind:'deterministic-installed-runner'}]}));",
  ].join("");
  adapter.execution = {
    live_baseline: true,
    runtime_mode: "external-process",
    handler: "codex-cli-external-runner",
    evidence_namespace: "evidence://adapter-live/installed-qualification",
    external_runtime: {
      command: process.execPath,
      request_via_stdin: false,
      request_transport: "request-artifact",
      request_file: { mode: "pointer-prompt", message: "Read the AOR provider work packet at {provider_work_packet_path}.", argument: "--work-packet" },
      timeout_ms: 30_000,
      model_argument: { prefix_args: ["--"], flag: "--model" },
      permission_policy: { default_mode: "full-bypass", modes: { "full-bypass": { args: ["-e", providerCode] } } },
    },
  };
  fs.writeFileSync(adapterPath, stringifyYaml(adapter), "utf8");
}

function parseJson(stdout, label) {
  try { return JSON.parse(stdout); } catch (error) { throw new Error(`${label} did not return JSON: ${error instanceof Error ? error.message : String(error)}\n${stdout}`); }
}

function sha256(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }

function summarizePayload(payload) {
  const keys = ["status", "project_id", "submission_id", "flow_id", "run_control_state", "routed_step_result_file", "review_report_file", "review_overall_status", "review_decision", "delivery_manifest_file", "learning_loop_handoff_file", "workspace_set_ref", "integration_report_file"];
  return Object.fromEntries(keys.filter((key) => payload && payload[key] !== undefined && payload[key] !== null).map((key) => [key, payload[key]]));
}

function invokeAor(installedBin, args, context, options = {}) {
  const result = spawnSync(process.execPath, [installedBin, ...args, "--json"], {
    cwd: context.launcherRoot,
    env: { ...process.env, AOR_HOME: context.aorHome, AOR_AUTH_READY_CODEX_CLI: "true" },
    encoding: "utf8",
    timeout: options.timeoutMs ?? 180_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const stdoutBytes = Buffer.from(result.stdout ?? "", "utf8");
  const stderrBytes = Buffer.from(result.stderr ?? "", "utf8");
  const journalId = String(context.journal.length + 1).padStart(2, "0");
  fs.mkdirSync(context.journalRoot, { recursive: true });
  const stdoutFile = path.join(context.journalRoot, `${journalId}.stdout`);
  const stderrFile = path.join(context.journalRoot, `${journalId}.stderr`);
  fs.writeFileSync(stdoutFile, stdoutBytes);
  fs.writeFileSync(stderrFile, stderrBytes);
  const output = { command: ["aor", ...args].join(" "), status: result.status, stdout_ref: path.relative(context.evidenceRoot, stdoutFile).split(path.sep).join("/"), stderr_ref: path.relative(context.evidenceRoot, stderrFile).split(path.sep).join("/"), stdout_sha256: `sha256:${sha256(stdoutBytes)}`, stderr_sha256: `sha256:${sha256(stderrBytes)}` };
  const payload = result.status === 0 && stdoutBytes.length > 0 ? parseJson(result.stdout, output.command) : null;
  output.payload_summary = summarizePayload(payload);
  context.journal.push(output);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${output.command} failed (${result.status}): ${result.stderr || result.stdout}`);
  return { ...output, stdout: result.stdout ?? "", stderr: result.stderr ?? "", payload };
}

function runtimePath(payload, camel, snake = camel) {
  const layout = payload.runtime_layout ?? {};
  return layout[camel] ?? layout[snake];
}

function parentRunDocument({ plan, projectId, workspaceRef, planRef, parentRunId }) {
  return {
    schema_version: 1,
    parent_run_id: parentRunId,
    project_id: projectId ?? plan.project_id,
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

function createPatchEvidence(repoRoot, relativePath, patchFile) {
  const file = path.join(repoRoot, relativePath);
  const original = fs.readFileSync(file, "utf8");
  try {
    fs.writeFileSync(file, `${original}// qualification review evidence\n`, "utf8");
    const bytes = Buffer.from(runGit(repoRoot, ["diff", "--binary", "--", relativePath]));
    fs.writeFileSync(patchFile, bytes);
    return bytes;
  } finally {
    fs.writeFileSync(file, original, "utf8");
  }
}

function main() {
  const installedBinArg = argValue("--installed-bin");
  if (!installedBinArg) throw new Error("--installed-bin is required.");
  const installedBin = path.resolve(installedBinArg);
  if (!fs.existsSync(installedBin)) throw new Error(`Installed CLI binary '${installedBin}' does not exist.`);
  const outputPath = path.resolve(argValue("--output", path.join(sourceRoot, "node_modules/.cache/aor/installed-control-plane-qualification.json")));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const evidenceRoot = fs.mkdtempSync(path.join(path.dirname(outputPath), `${path.basename(outputPath, path.extname(outputPath))}-`));
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-installed-control-plane-qualification-"));
  const launcherRoot = path.join(tempRoot, "neutral launcher");
  const targetRoot = path.join(evidenceRoot, "target");
  const aorHome = path.join(evidenceRoot, "aor-home");
  fs.mkdirSync(launcherRoot, { recursive: true });
  fs.mkdirSync(targetRoot, { recursive: true });
  const context = { launcherRoot, targetRoot, aorHome, evidenceRoot, journalRoot: path.join(evidenceRoot, "journal"), journal: [] };
  const report = {
    schema_version: 1,
    evidence_kind: "installed-control-plane-qualification",
    status: "running",
    started_at: new Date().toISOString(),
    finished_at: null,
    installed_bin: installedBin,
    package_root: path.resolve(path.dirname(installedBin), "../../.."),
    project_root: targetRoot,
    aor_home: aorHome,
    evidence_root: evidenceRoot,
    workspace_project_id: null,
    scenarios: { prepare_to_start_to_work: "not-run", recovery_and_review_completion: "not-run" },
    commands: context.journal,
    source_snapshots: [],
    upstream_writes: false,
    credentialed_provider_calls: false,
    target_repository_unchanged: false,
  };
  try {
    initializeGitRepo(targetRoot, { "README.md": "# Installed control-plane qualification\n", "package.json": "{\"name\":\"installed-qualification\"}\n" });
    const packageRoot = report.package_root;
    fs.cpSync(path.join(packageRoot, "examples"), path.join(targetRoot, "examples"), { recursive: true });
    const backendRoot = createNestedRepository(targetRoot, "repos/backend", { "services/api/index.js": "export const service = 'backend';\n", "services/api/schema.js": "export const schema = 1;\n" });
    const frontendRoot = createNestedRepository(targetRoot, "repos/frontend", { "apps/web/index.js": "export const app = 'frontend';\n", "apps/web/styles.js": "export const styles = 'bounded';\n" });
    const profile = buildProfile(targetRoot);
    configureDeterministicProvider(targetRoot);
    const requestFile = path.join(targetRoot, "qualification-request.json");
    fs.writeFileSync(requestFile, `${JSON.stringify({ mission_id: "mission.s14.installed.qualification", feature_size: "small", mission_type: "code-changing", work_type: "code-change", delivery_mode: "patch-only", goals: ["Qualify the installed control plane."], definition_of_done: ["Review and completion evidence resolve after reload."], acceptance_checks: ["Two repositories remain unchanged upstream."], allowed_paths: ["services/api/**", "apps/web/**", "qualification/**"], forbidden_paths: [".git/**"], scenario_family: "regress", provider_variant_id: "openai-primary", matrix_cell: { cell_id: "installed.qualification.small.mock", target_catalog_id: "installed-qualification", feature_mission_id: "mission.s14.installed.qualification", scenario_family: "regress", provider_variant_id: "openai-primary", feature_size: "small", coverage_tier: "diagnostic" }, change_budget: { max_changed_files: 4, max_added_lines: 100 }, task_plan: { local_tasks: buildTasks() } }, null, 2)}\n`, "utf8");
    runGit(targetRoot, ["add", "."]);
    runGit(targetRoot, ["commit", "-m", "qualification baseline"]);
    const snapshots = [backendRoot, frontendRoot].map((root) => ({ root, head: runGit(root, ["rev-parse", "HEAD"]).trim(), status: runGit(root, ["status", "--porcelain"]) }));
    report.source_snapshots = snapshots;

    const init = invokeAor(installedBin, ["project", "init", "--project-ref", targetRoot, "--project-profile", profile], context).payload;
    const initState = JSON.parse(fs.readFileSync(init.runtime_state_file, "utf8"));
    const runtimeProjectId = initState.project_id;
    const connected = invokeAor(installedBin, ["project", "connect", "--path", targetRoot, "--label", "installed qualification"], context).payload;
    const connectedProjectId = connected.project?.project_id ?? connected.project?.id ?? runtimeProjectId;
    const taskPrepared = invokeAor(installedBin, ["task", "prepare", "--project-id", connectedProjectId, "--request", "Qualify the installed two-repository control plane."], context).payload;
    if (taskPrepared.intent_submission?.status !== "prepared" || !taskPrepared.intent_normalization) throw new Error("Installed task prepare did not produce a prepared normalization report.");
    const taskStarted = invokeAor(installedBin, ["task", "start", "--submission-id", taskPrepared.intent_submission.submission_id, "--expected-revision", String(taskPrepared.intent_submission.revision)], context).payload;
    const missionResult = taskStarted.task_start?.mission?.result;
    const missionOutput = missionResult?.stdout ? parseJson(missionResult.stdout, "task start mission") : null;
    if (!taskStarted.task_start?.mission?.ok || !missionOutput?.artifact_packet_file) throw new Error("Installed task start did not create a durable mission packet.");
    const intake = invokeAor(installedBin, ["intake", "create", "--project-ref", targetRoot, "--project-profile", profile, "--mission-id", "mission.s14.installed.qualification", "--request-file", requestFile], context).payload;
    const discovery = invokeAor(installedBin, ["discovery", "run", "--project-ref", targetRoot, "--project-profile", profile, "--input-packet", intake.artifact_packet_file], context).payload;
    const spec = invokeAor(installedBin, ["spec", "build", "--project-ref", targetRoot, "--project-profile", profile], context).payload;
    const plan = invokeAor(installedBin, ["plan", "create", "--project-ref", targetRoot, "--project-profile", profile], context).payload;
    const wave = invokeAor(installedBin, ["wave", "create", "--project-ref", targetRoot, "--project-profile", profile], context).payload;
    const approved = invokeAor(installedBin, ["handoff", "approve", "--project-ref", targetRoot, "--project-profile", profile, "--handoff-packet", wave.handoff_packet_file, "--approval-ref", "approval://w71-s14-installed-qualification"], context).payload;
    const verified = invokeAor(installedBin, ["project", "verify", "--project-ref", targetRoot, "--project-profile", profile], context).payload;
    const childRunId = "run-s14-installed-qualification-backend";
    const child = invokeAor(installedBin, ["run", "start", "--project-ref", targetRoot, "--project-profile", profile, "--run-id", childRunId, "--target-step", "implement", "--approved-handoff-ref", approved.handoff_packet_file, "--promotion-evidence-refs", verified.step_result_files?.join(",") ?? "", "--require-validation-pass", "false", "--unsafe-development-override", "true"], context, { timeoutMs: 240_000 }).payload;
    if (child.run_control_state?.status !== "completed" || !child.routed_step_result_file) throw new Error("Installed child work run did not complete.");
    report.scenarios.prepare_to_start_to_work = "pass";

    const executionRoot = JSON.parse(fs.readFileSync(child.routed_step_result_file, "utf8")).routed_execution?.workspace_isolation?.execution_root;
    if (!executionRoot) throw new Error("Installed child run did not publish its disposable execution root.");
    if (!fs.existsSync(path.join(executionRoot, "qualification", "installed-work.txt"))) throw new Error("Installed work runner did not materialize its bounded output.");
    const patchFile = path.join(init.runtime_layout.reportsRoot, "qualification-review.patch");
    const patchBytes = createPatchEvidence(executionRoot, "qualification/installed-work.txt", patchFile);
    const review = invokeAor(installedBin, ["review", "run", "--project-ref", targetRoot, "--project-profile", profile, "--run-id", childRunId, "--execution-root", executionRoot], context).payload;
    if (review.review_overall_status !== "pass") throw new Error(`Installed review did not pass: ${review.review_overall_status ?? "unknown"}`);
    const decision = invokeAor(installedBin, ["review", "decide", "--project-ref", targetRoot, "--project-profile", profile, "--run-id", childRunId, "--decision", "approve", "--reason", "Installed review evidence passed for the bounded child.", "--execution-root", executionRoot], context).payload;
    if (decision.review_decision !== "approve" || decision.review_decision_gate !== "pass") throw new Error("Installed review decision did not approve the completed child.");
    const provision = invokeAor(installedBin, ["workspace", "provision", "--project-ref", targetRoot, "--project-profile", profile, "--run-id", childRunId], context).payload;
    if (provision.workspace_set?.status !== "ready" || provision.workspace_set.repositories?.length !== 2) throw new Error("Installed qualification workspace did not contain two ready repositories.");
    const workspaceProjectId = /^evidence:\/\/projects\/([^/]+)\//u.exec(provision.workspace_set_ref)?.[1];
    if (!workspaceProjectId) throw new Error("Installed qualification workspace project id is missing.");
    report.workspace_project_id = workspaceProjectId;

    // The installed child run and synthetic parent integration record share the
    // public run id so review, delivery, and integration evidence bind to one
    // lifecycle without importing internal runtime helpers.
    const parentRunId = childRunId;
    const planRef = `evidence://projects/${workspaceProjectId}/artifacts/${path.basename(approved.execution_plan_file)}`;
    const parent = parentRunDocument({ plan: approved.execution_plan, projectId: approved.execution_plan.project_id, workspaceRef: provision.workspace_set_ref, planRef, parentRunId });
    const stateRoot = runtimePath(intake, "stateRoot", "state_root");
    const parentFile = path.join(stateRoot, "parent-runs", `parent-run-${parentRunId}.json`);
    fs.mkdirSync(path.dirname(parentFile), { recursive: true });
    fs.writeFileSync(parentFile, `${JSON.stringify(parent, null, 2)}\n`, "utf8");

    const lock = invokeAor(installedBin, ["multirepo", "lock", "--project-ref", targetRoot, "--project-profile", profile, "--action", "acquire", "--run-id", parentRunId, "--owner-ref", "owner.s14.qualification", "--repo-ids", "backend,frontend", "--path-globs", "services/api/**,apps/web/**", "--repo-validation-refs", "backend=validation://repos/backend/w71-s14-installed,frontend=validation://repos/frontend/w71-s14-installed", "--integration-validation-refs", "validation://integration/w71-s14/installed-control-plane"], context).payload;
    if (lock.multirepo_coordination_status !== "ready" || !lock.multirepo_coordination_ref) throw new Error("Installed qualification multirepo coordination did not reach ready state.");

    const childOutputRefs = [];
    for (const unit of approved.execution_plan.execution_units) {
      const parentUnit = parent.units.find((candidate) => candidate.execution_unit_id === unit.unit_id);
      const sourceRoot = unit.scope.repo_ids[0] === "backend" ? backendRoot : frontendRoot;
      const changedPaths = unit.scope.allowed_paths;
      const patchOutputFile = path.join(runtimePath(intake, "reportsRoot", "reports_root"), `qualification-${unit.unit_id}.patch`);
      const patchOutputBytes = createPatchEvidence(sourceRoot, changedPaths[0], patchOutputFile);
      const childOutputFile = path.join(runtimePath(intake, "reportsRoot", "reports_root"), `qualification-${unit.unit_id}.json`);
      const childOutput = {
        project_id: approved.execution_plan.project_id,
        parent_run_id: parentRunId,
        execution_unit_id: unit.unit_id,
        child_run_id: parentUnit.child_runs[0].child_run_id,
        attempt: parentUnit.child_runs[0].attempt,
        repo_id: unit.scope.repo_ids[0],
        output_kind: "patch",
        output_ref: `evidence://projects/${workspaceProjectId}/reports/${path.basename(patchOutputFile)}`,
        output_file: patchOutputFile,
        output_digest: sha256(patchOutputBytes),
        changed_paths: changedPaths,
      };
      fs.writeFileSync(childOutputFile, `${JSON.stringify(childOutput, null, 2)}\n`, "utf8");
      childOutputRefs.push(childOutputFile);
    }
    const integrated = invokeAor(installedBin, ["run", "integration", "--project-ref", targetRoot, "--parent-run-id", parentRunId, "--action", "materialize", "--execution-plan-ref", approved.execution_plan_file, "--workspace-set-ref", provision.workspace_set_ref, ...childOutputRefs.flatMap((ref) => ["--child-output-file", ref]), "--command-id", "integrate-s14-installed-qualification", "--expected-revision", "0"], context).payload;
    if (integrated.integration_report?.status !== "passed" || integrated.parent_run?.status !== "succeeded" || integrated.integration_report.repository_results?.length !== 2) throw new Error("Installed qualification integration did not close with two repository results.");

    const delivery = invokeAor(installedBin, ["deliver", "prepare", "--project-ref", targetRoot, "--project-profile", profile, "--run-id", childRunId, "--mode", "patch-only", "--execution-root", executionRoot, "--approved-handoff-ref", approved.handoff_packet_file, "--promotion-evidence-refs", verified.step_result_files?.join(",") ?? "", "--require-review-decision", "--coordination-evidence-refs", lock.multirepo_coordination_ref, "--coordination-lock-evidence-refs", lock.multirepo_coordination_ref, "--cross-repo-validation-refs", "validation://integration/w71-s14/installed-control-plane", "--integration-report", integrated.integration_report_file], context).payload;
    if (delivery.delivery_plan_status !== "ready" || delivery.delivery_mode !== "patch-only") throw new Error("Installed review-gated delivery did not reach ready patch-only state.");
    const learning = invokeAor(installedBin, ["learning", "handoff", "--project-ref", targetRoot, "--project-profile", profile, "--run-id", childRunId], context).payload;
    if (!learning.learning_loop_handoff_file || !fs.existsSync(learning.learning_loop_handoff_file)) throw new Error("Installed learning handoff was not materialized.");
    if (!fs.existsSync(patchFile) || sha256(patchBytes).length !== 64) throw new Error("Installed review patch evidence was not materialized.");
    report.scenarios.recovery_and_review_completion = "pass";

    for (const snapshot of snapshots) {
      if (runGit(snapshot.root, ["rev-parse", "HEAD"]).trim() !== snapshot.head || runGit(snapshot.root, ["status", "--porcelain"]) !== snapshot.status) throw new Error(`Source repository '${snapshot.root}' changed during qualification.`);
    }
    report.target_repository_unchanged = true;
    if (fs.readdirSync(launcherRoot).length > 0) throw new Error("Neutral launcher received unexpected files.");
    report.status = "pass";
    report.finished_at = new Date().toISOString();
    const validation = validateInstalledControlPlaneQualification(report);
    if (!validation.ok) throw new Error(`Installed qualification report failed validation: ${validation.issues.join("; ")}`);
    const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
    fs.writeFileSync(outputPath, bytes);
    fs.writeFileSync(path.join(aorHome, "projects", workspaceProjectId, "reports", "installed-control-plane-qualification.json"), bytes);
    process.stdout.write(`${JSON.stringify({ status: report.status, report: outputPath, evidence_root: evidenceRoot, scenarios: report.scenarios })}\n`);
  } catch (error) {
    report.status = "fail";
    report.finished_at = new Date().toISOString();
    report.failure = error instanceof Error ? error.message : String(error);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    throw error;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
