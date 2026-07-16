#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { withTempRepo } from "./test/helpers/temp-repo.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0
  ? path.resolve(process.cwd(), process.argv[outputIndex + 1])
  : path.join(root, "node_modules/.cache/aor/w61-topology-onboarding-proof.json");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w61-workspace-"));

function runCli(args, cwd) {
  const result = spawnSync(process.execPath, [path.join(root, "apps/cli/bin/aor.mjs"), ...args, "--json"], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, AOR_HOME: home },
  });
  if (result.status !== 0) throw new Error(`aor ${args.join(" ")} failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function setProjectId(projectRoot, projectId) {
  const profile = path.join(projectRoot, "examples/project.aor.yaml");
  fs.writeFileSync(profile, fs.readFileSync(profile, "utf8").replace(/^project_id: .+$/mu, `project_id: ${projectId}`));
}

function topology(projectId, cwd) {
  return runCli(["project", "topology", "--project-id", projectId, "--action", "show"], cwd).topology;
}

function mutate(command, projectId, action, value, cwd) {
  const current = topology(projectId, cwd);
  return runCli([
    "project", command,
    "--project-id", projectId,
    "--action", action,
    "--value", JSON.stringify(value),
    "--expected-revision", String(current.revision),
  ], cwd);
}

async function scenario(projectRoot, projectId, kind, secondaryRoot = null) {
  setProjectId(projectRoot, projectId);
  const added = runCli([
    "project", "add",
    "--project-ref", projectRoot,
    "--project-profile", "examples/project.aor.yaml",
    "--label", `${kind} proof`,
  ], root);
  if (kind === "monorepo") {
    mutate("component", projectId, "add", {
      component_id: "worker",
      repo_id: "main",
      name: "Worker",
      root: "packages/worker",
      role: "service",
      command_group_refs: [],
    }, root);
  }
  if (kind === "bounded-multirepo") {
    mutate("repository", projectId, "add", {
      repo_id: "service",
      name: "Service",
      source: { kind: "local", root: "." },
      workspace_mount: "repos/service",
      role: "service",
    }, root);
    mutate("repository", projectId, "rebind", {
      repo_id: "service",
      local_path: secondaryRoot,
      base_ref: "HEAD",
      access_mode: "read-only",
    }, root);
  }
  const validated = runCli(["project", "topology", "--project-id", projectId, "--action", "validate"], root);
  const route = runCli(["route", "show", "--project-id", projectId], root).execution_profile;
  const implement = route.routes.find((entry) => entry.step === "implement") ?? route.routes[0];
  const selectedRoute = implement.approved_routes.find((entry) => entry.mode === "simulation") ?? implement.approved_routes[0];
  const selected = runCli([
    "route", "select",
    "--project-id", projectId,
    "--step", implement.step,
    "--route", selectedRoute.route_id,
    "--expected-revision", String(route.revision),
  ], root).execution_profile;
  const readiness = runCli(["route", "check", "--project-id", projectId, "--step", implement.step], root);
  const finalTopology = topology(projectId, root);
  if (fs.existsSync(path.join(projectRoot, ".aor"))) throw new Error(`${kind} read/setup proof materialized project runtime.`);
  return {
    id: kind,
    project_id: projectId,
    repository_count: finalTopology.repositories.length,
    component_count: finalTopology.components.length,
    validation_status: validated.validation.status,
    selected_route_id: selected.routes.find((entry) => entry.step === implement.step)?.route_id,
    route_mode: selectedRoute.mode,
    readiness_status: readiness.execution_readiness_report.status,
    runtime_materialized: false,
    public_surfaces: ["project add", "project topology", "project repository", "project component", "route show", "route select", "route check"],
  };
}

try {
  const report = await withTempRepo({ prefix: "aor-w61-single-", workspaceRoot: root }, async (singleRoot) =>
    withTempRepo({ prefix: "aor-w61-mono-", workspaceRoot: root }, async (monoRoot) =>
      withTempRepo({ prefix: "aor-w61-multi-", workspaceRoot: root }, async (multiRoot) =>
        withTempRepo({ prefix: "aor-w61-service-", workspaceRoot: root }, async (serviceRoot) => {
          const scenarios = [
            await scenario(singleRoot, "w61-single", "single-repo"),
            await scenario(monoRoot, "w61-monorepo", "monorepo"),
            await scenario(multiRoot, "w61-multirepo", "bounded-multirepo", serviceRoot),
          ];
          const listed = runCli(["project", "list"], root).workspace;
          if (listed.projects.length !== 3) throw new Error("W61 proof did not preserve three independent project entries.");
          return {
            schema_version: 1,
            wave_id: "W61",
            status: "pass",
            scenarios,
            project_isolation: { project_count: listed.projects.length, selected_project_id: listed.selected_project_id ?? null },
            browser_evidence_refs: [
              "apps/web/browser/operator-console.spec.mjs",
              "apps/web/src/project-structure.jsx",
              "apps/web/src/execution-setup.jsx",
            ],
            credentialed_provider_calls: false,
            external_network_calls: false,
            upstream_writes: false,
            committed_machine_paths: false,
          };
        }))));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: report.status, report: outputPath, scenarios: report.scenarios.length })}\n`);
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}
