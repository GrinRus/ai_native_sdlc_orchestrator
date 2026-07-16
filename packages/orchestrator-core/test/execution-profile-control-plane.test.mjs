import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { invokeCli } from "../../../apps/cli/src/index.mjs";
import { withTempRepo } from "../../../scripts/test/helpers/temp-repo.mjs";
import { createControlPlaneHttpServer } from "../src/control-plane/http/http-transport.mjs";
import { createLocalProjectRegistry } from "../src/control-plane/local-project-registry.mjs";
import {
  applyExecutionProfileAction,
  readExecutionProfile,
} from "../src/control-plane/execution-profile.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function fakeRunnerEnvironment(root) {
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const command = path.join(bin, process.platform === "win32" ? "codex.cmd" : "codex");
  fs.writeFileSync(command, process.platform === "win32" ? "@exit /b 0\r\n" : "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  return {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
    AOR_AUTH_READY_CODEX_CLI: "true",
    SECRET_CANARY: "must-not-appear",
  };
}

test("execution profile is derived, revisioned, and readiness evidence contains no secrets", async () => {
  await withTempRepo({ prefix: "aor-execution-profile-", workspaceRoot }, (projectRoot) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "aor-execution-profile-home-"));
    try {
      const registry = createLocalProjectRegistry({
        cwd: projectRoot,
        projects: [{ projectRef: projectRoot, projectProfile: "examples/project.aor.yaml" }],
        persistence: { mode: "persistent", root: home },
      });
      const projectId = registry.defaultProjectId;
      const initial = readExecutionProfile({ registry, projectId });
      assert.equal(initial.initialized, true);
      const initialImplement = initial.routes.find((row) => row.step === "implement");
      assert.equal(initialImplement.route_id, "route.implement.default");
      assert.equal(initialImplement.mode, "live");
      assert.ok(initialImplement.approved_routes.some((route) => route.route_id === "route.implement.default"));
      assert.equal(initialImplement.approved_routes.every((route) => ["simulation", "live"].includes(route.mode)), true);

      const checked = applyExecutionProfileAction({
        registry,
        projectId,
        action: "check",
        step: "implement",
        environment: fakeRunnerEnvironment(home),
      });
      assert.equal(checked.readiness_report.status, "ready");
      assert.equal(checked.execution_profile.routes.find((row) => row.step === "implement").readiness, "ready");
      assert.doesNotMatch(JSON.stringify(checked), /must-not-appear/u);
      const restarted = createLocalProjectRegistry({
        cwd: projectRoot,
        projects: [],
        persistence: { mode: "persistent", root: home },
      });
      assert.equal(readExecutionProfile({ registry: restarted, projectId }).routes.find((row) => row.step === "implement").readiness, "ready");

      const missingRunner = applyExecutionProfileAction({
        registry,
        projectId,
        action: "check",
        step: "implement",
        environment: { ...process.env, PATH: "", AOR_AUTH_READY_CODEX_CLI: "true" },
      });
      assert.equal(missingRunner.readiness_report.status, "runner-missing");
      const missingAuthEnvironment = fakeRunnerEnvironment(home);
      missingAuthEnvironment.AOR_AUTH_READY_CODEX_CLI = "false";
      const missingAuth = applyExecutionProfileAction({
        registry,
        projectId,
        action: "check",
        step: "implement",
        environment: missingAuthEnvironment,
      });
      assert.equal(missingAuth.readiness_report.status, "auth-missing");

      const revision = missingAuth.execution_profile.revision;
      const selected = applyExecutionProfileAction({
        registry,
        projectId,
        action: "select",
        step: "implement",
        routeId: "route.implement.default",
        expectedRevision: revision,
      });
      assert.equal(selected.execution_profile.routes.find((row) => row.step === "implement").readiness, "unconfigured");
      assert.throws(
        () => applyExecutionProfileAction({
          registry,
          projectId,
          action: "reset",
          step: "implement",
          expectedRevision: revision,
        }),
        (error) => error.code === "execution-profile.stale-revision",
      );
      assert.throws(
        () => applyExecutionProfileAction({
          registry,
          projectId,
          action: "select",
          step: "implement",
          routeId: "raw-provider/model",
          expectedRevision: registry.revision,
        }),
        (error) => error.code === "execution-profile.route-invalid",
      );
      const mission = invokeCli([
        "mission", "create",
        "--project-ref", projectRoot,
        "--title", "Active flow guard",
        "--brief", "Prove route mutations stop while a flow is active.",
        "--goal", "Keep route selection stable.",
        "--kpi", "route-stable:Route stable:ready:status",
        "--dod", "Active flow is visible.",
        "--json",
      ], { cwd: projectRoot });
      assert.equal(mission.exitCode, 0, mission.stderr);
      assert.throws(
        () => applyExecutionProfileAction({
          registry,
          projectId,
          action: "select",
          step: "implement",
          routeId: "route.implement.default",
          expectedRevision: registry.revision,
        }),
        (error) => error.code === "execution-profile.active-run-conflict",
      );
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

test("model and policy failures are classified before any runner process", async () => {
  await withTempRepo({ prefix: "aor-execution-fail-closed-", workspaceRoot }, (projectRoot) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "aor-execution-fail-home-"));
    try {
      const registry = createLocalProjectRegistry({
        cwd: projectRoot,
        projects: [{ projectRef: projectRoot, projectProfile: "examples/project.aor.yaml" }],
        persistence: { mode: "persistent", root: home },
      });
      const projectId = registry.defaultProjectId;
      const profilePath = path.join(projectRoot, "examples/project.aor.yaml");
      const profile = fs.readFileSync(profilePath, "utf8");
      fs.writeFileSync(profilePath, profile.replace(/allowed_adapters:\n(?:  - .+\n)+/u, "allowed_adapters:\n  - mock-runner\n"));
      const policyDenied = applyExecutionProfileAction({ registry, projectId, action: "check", step: "implement" });
      assert.equal(policyDenied.readiness_report.status, "policy-denied");

      fs.writeFileSync(profilePath, profile);
      const adapterPath = path.join(projectRoot, "examples/adapters/codex-cli.yaml");
      const adapter = fs.readFileSync(adapterPath, "utf8");
      fs.writeFileSync(adapterPath, adapter.replace(/  coding-primary: gpt-5\.5\n/u, ""));
      const modelUnsupported = applyExecutionProfileAction({ registry, projectId, action: "check", step: "implement" });
      assert.equal(modelUnsupported.readiness_report.status, "model-unsupported");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

test("execution profile GET is non-materializing and HTTP check is durable", async () => {
  await withTempRepo({ prefix: "aor-execution-http-", workspaceRoot }, async (projectRoot) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "aor-execution-http-home-"));
    const transport = await createControlPlaneHttpServer({
      cwd: projectRoot,
      projects: [{ projectRef: projectRoot, projectProfile: "examples/project.aor.yaml" }],
      workspaceRegistry: { mode: "persistent", root: home },
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const runtimeRoot = path.join(projectRoot, ".aor");
      const response = await fetch(`${transport.baseUrl}/api/projects/${transport.projectId}/execution-profile`);
      assert.equal(response.status, 200);
      const profile = await response.json();
      assert.equal(profile.read_only, true);
      assert.equal(fs.existsSync(runtimeRoot), false);

      const checkedResponse = await fetch(`${transport.baseUrl}/api/projects/${transport.projectId}/execution-profile/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "check", step: "implement" }),
      });
      assert.equal(checkedResponse.status, 202);
      const checked = await checkedResponse.json();
      assert.ok(["runner-missing", "auth-missing", "ready"].includes(checked.readiness_report.status));
      assert.equal(fs.existsSync(runtimeRoot), false);
    } finally {
      await transport.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

test("route CLI reads the same persistent execution profile", async () => {
  await withTempRepo({ prefix: "aor-execution-cli-", workspaceRoot }, (projectRoot) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "aor-execution-cli-home-"));
    const previous = process.env.AOR_HOME;
    process.env.AOR_HOME = home;
    try {
      const added = invokeCli([
        "project", "add",
        "--project-ref", projectRoot,
        "--project-profile", "examples/project.aor.yaml",
        "--json",
      ], { cwd: projectRoot });
      assert.equal(added.exitCode, 0, added.stderr);
      const projectId = JSON.parse(added.stdout).project.project_id;
      const shown = invokeCli(["route", "show", "--project-id", projectId, "--json"], { cwd: projectRoot });
      assert.equal(shown.exitCode, 0, shown.stderr);
      const output = JSON.parse(shown.stdout);
      assert.equal(output.execution_profile.project_id, projectId);
      assert.equal(output.execution_profile.read_only, true);
      assert.equal(fs.existsSync(path.join(projectRoot, ".aor")), false);
    } finally {
      if (previous === undefined) delete process.env.AOR_HOME;
      else process.env.AOR_HOME = previous;
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
