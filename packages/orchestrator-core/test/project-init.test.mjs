import assert from "node:assert/strict";
import fs from "node:fs";
import childProcess from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  discoverProjectRoot,
  initializeProjectRuntime,
  resolveProjectProfilePath,
  resolveRuntimeLayout,
} from "../src/project-init.mjs";
import { loadContractFile } from "../../contracts/src/index.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {(tempRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w1-s02-"));

  fs.mkdirSync(path.join(tempRoot, ".git"), { recursive: true });
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(tempRoot, "examples"), { recursive: true });

  try {
    callback(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

/**
 * @param {(tempRoot: string) => void} callback
 */
function withCleanTempRepo(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w54-s03-"));
  fs.mkdirSync(path.join(tempRoot, ".git"), { recursive: true });

  try {
    callback(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

/**
 * @param {string} repoRoot
 * @param {string} relativePath
 * @param {string} content
 */
function writeFile(repoRoot, relativePath, content) {
  const filePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

/**
 * @param {string} profilePath
 * @returns {Record<string, unknown>}
 */
function loadGeneratedProfile(profilePath) {
  const loaded = loadContractFile({
    filePath: profilePath,
    family: "project-profile",
  });
  assert.equal(
    loaded.ok,
    true,
    loaded.ok ? "" : loaded.validation.issues.map((issue) => issue.message).join("; "),
  );
  return /** @type {Record<string, unknown>} */ (loaded.document);
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {Array<Record<string, unknown>>}
 */
function generatedCommandGroups(profile) {
  const verification = /** @type {Record<string, unknown>} */ (profile.verification ?? {});
  return Array.isArray(verification.command_groups)
    ? verification.command_groups.map((entry) => /** @type {Record<string, unknown>} */ (entry))
    : [];
}

/**
 * @param {string} serializedProfile
 */
function assertNoPrivateVerificationVocabulary(serializedProfile) {
  const forbiddenPatterns = [
    /\blive_e2e\w*/u,
    /\blive-e2e\b/u,
    /\btarget_readiness\b/u,
    /\bdiagnostic_health\b/u,
    /\bstep_quality\b/u,
  ];
  for (const pattern of forbiddenPatterns) {
    assert.equal(pattern.test(serializedProfile), false, `generated profile matched ${pattern}`);
  }
}

test("discoverProjectRoot finds git root from nested cwd", () => {
  withTempRepo((tempRoot) => {
    const nestedPath = path.join(tempRoot, "src", "nested");
    fs.mkdirSync(nestedPath, { recursive: true });

    const discovered = discoverProjectRoot({ cwd: nestedPath });
    assert.equal(discovered, fs.realpathSync.native(tempRoot));
  });
});

test("resolveProjectProfilePath defaults to examples/project.aor.yaml in repo root", () => {
  withTempRepo((tempRoot) => {
    const resolved = resolveProjectProfilePath({
      cwd: tempRoot,
      projectRoot: tempRoot,
    });

    assert.equal(resolved, path.join(tempRoot, "examples/project.aor.yaml"));
  });
});

test("relative profiles are project-bound and invalid project IDs fail before runtime writes", () => {
  const launcher = fs.mkdtempSync(path.join(os.tmpdir(), "aor-launcher-"));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-project-"));
  const runtimeRoot = path.join(projectRoot, ".aor");
  fs.writeFileSync(path.join(launcher, "launcher-only.yaml"), "project_id: launcher\n", "utf8");
  try {
    assert.throws(
      () => resolveProjectProfilePath({ cwd: launcher, projectRoot, projectProfile: "launcher-only.yaml" }),
      /never resolve from launcher cwd/u,
    );
    for (const projectId of ["../escape", "C:\\escape", "project\nretry: 1", "PROJECT"] ) {
      assert.throws(() => resolveRuntimeLayout({ runtimeRoot, projectId }), /Invalid project_id/u);
    }
    assert.equal(fs.existsSync(runtimeRoot), false);
  } finally {
    fs.rmSync(launcher, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("initializeProjectRuntime creates idempotent runtime layout and durable state", () => {
  withTempRepo((tempRoot) => {
    const canonicalTempRoot = fs.realpathSync.native(tempRoot);
    const nestedPath = path.join(tempRoot, "apps", "cli");
    fs.mkdirSync(nestedPath, { recursive: true });

    const firstRun = initializeProjectRuntime({ cwd: nestedPath });
    const secondRun = initializeProjectRuntime({ cwd: nestedPath });

    assert.equal(firstRun.projectRoot, canonicalTempRoot);
    assert.equal(secondRun.projectRoot, canonicalTempRoot);
    assert.equal(firstRun.projectProfileRef, "examples/project.aor.yaml");
    assert.equal(secondRun.projectProfileRef, "examples/project.aor.yaml");
    assert.equal(firstRun.artifactPacketId, "aor-core.artifact.bootstrap.v1");
    assert.equal(firstRun.artifactPacketFile, secondRun.artifactPacketFile);
    assert.equal(fs.existsSync(firstRun.artifactPacketFile), true);

    for (const dirPath of [
      firstRun.runtimeLayout.runtimeRoot,
      firstRun.runtimeLayout.projectsRoot,
      firstRun.runtimeLayout.projectRuntimeRoot,
      firstRun.runtimeLayout.artifactsRoot,
      firstRun.runtimeLayout.reportsRoot,
      firstRun.runtimeLayout.stateRoot,
    ]) {
      assert.equal(fs.existsSync(dirPath), true, `expected runtime directory ${dirPath}`);
    }

    assert.equal(firstRun.stateFile, secondRun.stateFile, "state file path should stay stable across repeated runs");

    const stateContent = fs.readFileSync(firstRun.stateFile, "utf8");
    const parsedState = JSON.parse(stateContent);

    assert.equal(parsedState.project_id, "aor-core");
    assert.equal(parsedState.display_name, "AOR Core");
    assert.equal(parsedState.selected_profile_ref, "examples/project.aor.yaml");
    assert.equal(parsedState.project_root, canonicalTempRoot);
    assert.equal(parsedState.runtime_root, path.join(canonicalTempRoot, ".aor"));
    assert.equal(parsedState.asset_mode, "materialized");
    assert.equal(parsedState.onboarding_report_ref, ".aor/projects/aor-core/reports/onboarding-report.json");
    assert.equal(fs.existsSync(firstRun.onboardingReportFile), true);
    assert.equal(firstRun.onboardingReport.status, "ready");
    assert.equal(firstRun.onboardingReport.asset_mode, "materialized");

    const packet = JSON.parse(fs.readFileSync(firstRun.artifactPacketFile, "utf8"));
    assert.equal(packet.packet_id, "aor-core.artifact.bootstrap.v1");
    assert.equal(packet.packet_type, "bootstrap");
    assert.equal(packet.project_id, "aor-core");
  });
});

test("initializeProjectRuntime onboards a clean repo in bundled mode without target asset copies", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w21-s03-clean-"));
  fs.mkdirSync(path.join(tempRoot, ".git"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "package.json"), JSON.stringify({ name: "clean-repo" }, null, 2), "utf8");

  try {
    const result = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });

    assert.match(result.projectId, /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u);
    assert.equal(initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot }).projectId, result.projectId);
    assert.equal(result.assetMode, "bundled");
    assert.equal(result.bootstrapMaterializationStatus, "bundled");
    assert.match(result.projectProfileRef, /^\.aor\/projects\/.+\/state\/project\.aor\.yaml$/);
    assert.equal(fs.existsSync(path.join(tempRoot, "project.aor.yaml")), false);
    assert.equal(fs.existsSync(path.join(tempRoot, "examples")), false);
    assert.equal(fs.existsSync(result.projectProfilePath), true);
    assert.equal(result.registryRoots.routes, path.join(workspaceRoot, "examples/routes"));

    const report = JSON.parse(fs.readFileSync(result.onboardingReportFile, "utf8"));
    assert.equal(report.status, "ready");
    assert.equal(report.asset_mode, "bundled");
    assert.equal(report.project_state.existing_profile_found, false);
    assert.deepEqual(report.write_effects.target_repo_writes, []);
    assert.equal(report.write_effects.copied_example_registries, false);
    assert.equal(report.write_effects.materialized_profile, false);
    assert.ok(report.write_effects.runtime_writes.includes(result.projectProfileRef));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("initializeProjectRuntime materializes Node command groups from discovery without running target commands", () => {
  withCleanTempRepo((tempRoot) => {
    writeFile(
      tempRoot,
      "package.json",
      JSON.stringify(
        {
          name: "node-generated-profile",
          scripts: {
            build: "vite build",
            lint: "eslint .",
            test: "node -e \"require('fs').writeFileSync('target-command-ran', 'yes')\"",
            typecheck: "tsc --noEmit",
            "test:e2e": "playwright test",
          },
        },
        null,
        2,
      ),
    );
    writeFile(tempRoot, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");

    const result = initializeProjectRuntime({
      cwd: tempRoot,
      projectRef: tempRoot,
      assetMode: "materialized",
    });
    const profileText = fs.readFileSync(result.projectProfilePath, "utf8");
    const profile = loadGeneratedProfile(result.projectProfilePath);
    const groups = generatedCommandGroups(profile);
    const repos = /** @type {Array<Record<string, unknown>>} */ (profile.repos);

    assert.equal(fs.existsSync(path.join(tempRoot, "target-command-ran")), false);
    assertNoPrivateVerificationVocabulary(profileText);
    assert.ok(groups.some((group) => group.id === "post-change-build" && group.commands.includes("pnpm run build")));
    assert.ok(groups.some((group) => group.id === "post-change-lint" && group.commands.includes("pnpm run lint")));
    assert.ok(groups.some((group) => group.id === "post-change-test" && group.commands.includes("pnpm run test")));
    assert.ok(
      groups.some((group) => group.id === "post-change-typecheck" && group.commands.includes("pnpm run typecheck")),
    );
    assert.ok(groups.some((group) => group.id === "post-change-e2e" && group.commands.includes("pnpm run test:e2e")));
    assert.ok(groups.every((group) => group.repo_id === "target"));
    assert.ok(groups.every((group) => group.working_dir === "."));
    assert.ok(groups.every((group) => Array.isArray(group.detected_from) && group.detected_from.length > 0));
    assert.deepEqual(repos[0].build_commands, ["pnpm run build"]);
    assert.deepEqual(repos[0].lint_commands, ["pnpm run lint"]);
    assert.deepEqual(repos[0].test_commands, ["pnpm run test"]);
  });
});

test("initializeProjectRuntime materializes generated profiles for public stack archetypes", () => {
  const cases = [
    {
      name: "python",
      setup(repoRoot) {
        writeFile(
          repoRoot,
          "pyproject.toml",
          "[project]\nname = 'python-generated-profile'\n[tool.pytest.ini_options]\ntestpaths = ['tests']\n",
        );
      },
      expected(group) {
        return group.role === "test" && group.commands.includes("python -m pytest");
      },
    },
    {
      name: "go",
      setup(repoRoot) {
        writeFile(repoRoot, "go.mod", "module example.com/generated\n\ngo 1.22\n");
      },
      expected(group) {
        return group.role === "test" && group.commands.includes("go test ./...");
      },
    },
    {
      name: "rust",
      setup(repoRoot) {
        writeFile(repoRoot, "Cargo.toml", "[package]\nname = 'generated'\nversion = '0.1.0'\n");
      },
      expected(group) {
        return group.role === "test" && group.commands.includes("cargo test");
      },
    },
    {
      name: "frontend",
      setup(repoRoot) {
        writeFile(repoRoot, "package.json", JSON.stringify({ name: "frontend-generated-profile" }, null, 2));
        writeFile(repoRoot, "package-lock.json", "{}\n");
        writeFile(repoRoot, "playwright.config.ts", "export default {};\n");
      },
      expected(group) {
        return group.role === "e2e" && group.commands.includes("npx playwright test");
      },
    },
    {
      name: "monorepo",
      setup(repoRoot) {
        writeFile(repoRoot, "pnpm-workspace.yaml", "packages:\n  - apps/*\n");
        writeFile(repoRoot, "package.json", JSON.stringify({ name: "monorepo-generated-profile" }, null, 2));
        writeFile(
          repoRoot,
          "apps/api/package.json",
          JSON.stringify({ name: "api", scripts: { test: "node --test" } }, null, 2),
        );
      },
      expected(group) {
        return (
          group.working_dir === "apps/api" &&
          group.id === "post-change-test-apps-api" &&
          group.commands.includes("pnpm run test")
        );
      },
    },
  ];

  for (const fixture of cases) {
    withCleanTempRepo((tempRoot) => {
      fixture.setup(tempRoot);
      const result = initializeProjectRuntime({
        cwd: tempRoot,
        projectRef: tempRoot,
        assetMode: "materialized",
      });
      const profileText = fs.readFileSync(result.projectProfilePath, "utf8");
      const profile = loadGeneratedProfile(result.projectProfilePath);
      const groups = generatedCommandGroups(profile);

      assertNoPrivateVerificationVocabulary(profileText);
      assert.ok(groups.some((group) => fixture.expected(group)), fixture.name);
    });
  }
});

test("initializeProjectRuntime materializes no-tests evidence without inventing command groups", () => {
  withCleanTempRepo((tempRoot) => {
    writeFile(tempRoot, "README.md", "# No tests fixture\n");

    const result = initializeProjectRuntime({
      cwd: tempRoot,
      projectRef: tempRoot,
      assetMode: "materialized",
    });
    const profile = loadGeneratedProfile(result.projectProfilePath);
    const verification = /** @type {Record<string, unknown>} */ (profile.verification ?? {});
    const repos = /** @type {Array<Record<string, unknown>>} */ (profile.repos);

    assert.deepEqual(generatedCommandGroups(profile), []);
    assert.equal(Array.isArray(verification.discovery_outcomes), true);
    assert.equal(verification.discovery_outcomes[0].outcome, "no-tests");
    assert.equal(verification.discovery_suggestions[0].kind, "custom");
    assert.deepEqual(repos[0].build_commands, []);
    assert.deepEqual(repos[0].lint_commands, []);
    assert.deepEqual(repos[0].test_commands, []);
  });
});

test("initializeProjectRuntime materializes profile and assets only when materialized mode is explicit", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w21-s03-materialized-"));
  fs.mkdirSync(path.join(tempRoot, ".git"), { recursive: true });

  try {
    const canonicalTempRoot = fs.realpathSync.native(tempRoot);
    const result = initializeProjectRuntime({
      cwd: tempRoot,
      projectRef: tempRoot,
      assetMode: "materialized",
    });

    assert.equal(result.assetMode, "materialized");
    assert.equal(result.projectProfileRef, "project.aor.yaml");
    assert.equal(fs.existsSync(path.join(tempRoot, "project.aor.yaml")), true);
    assert.equal(fs.existsSync(path.join(tempRoot, "examples/routes")), true);
    assert.equal(result.registryRoots.routes, path.join(canonicalTempRoot, "examples/routes"));

    const report = JSON.parse(fs.readFileSync(result.onboardingReportFile, "utf8"));
    assert.equal(report.asset_mode, "materialized");
    assert.equal(report.write_effects.materialized_profile, true);
    assert.equal(report.write_effects.copied_example_registries, true);
    assert.ok(report.write_effects.target_repo_writes.includes("project.aor.yaml"));
    assert.ok(report.write_effects.target_repo_writes.includes("examples"));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("initializeProjectRuntime preserves external explicit profile refs as absolute paths", () => {
  withTempRepo((tempRoot) => {
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-live-profile-root-"));
    const externalProfile = path.join(externalRoot, "project-external-runner.aor.yaml");
    fs.copyFileSync(path.join(tempRoot, "examples/project.aor.yaml"), externalProfile);

    try {
      const result = initializeProjectRuntime({
        cwd: tempRoot,
        projectRef: tempRoot,
        projectProfile: externalProfile,
      });

      assert.equal(result.projectProfileRef, externalProfile);
      assert.equal(result.projectProfileRef.startsWith("../"), false);

      const state = JSON.parse(fs.readFileSync(result.stateFile, "utf8"));
      const report = JSON.parse(fs.readFileSync(result.onboardingReportFile, "utf8"));
      assert.equal(state.selected_profile_ref, externalProfile);
      assert.equal(report.generated_from.selected_profile_ref, externalProfile);
      assert.equal(report.project_state.project_profile_ref, externalProfile);
    } finally {
      fs.rmSync(externalRoot, { recursive: true, force: true });
    }
  });
});

test("initializeProjectRuntime merges bundled bootstrap assets when a target examples directory already exists", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w21-s03-existing-examples-"));
  fs.mkdirSync(path.join(tempRoot, ".git"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "examples"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "examples", "README.md"), "target examples stay intact\n", "utf8");

  try {
    const canonicalTempRoot = fs.realpathSync.native(tempRoot);
    const result = initializeProjectRuntime({
      cwd: tempRoot,
      projectRef: tempRoot,
      assetMode: "materialized",
    });

    assert.equal(result.assetMode, "materialized");
    assert.equal(fs.readFileSync(path.join(tempRoot, "examples", "README.md"), "utf8"), "target examples stay intact\n");
    assert.equal(fs.existsSync(path.join(tempRoot, "examples/routes")), true);
    assert.equal(fs.existsSync(path.join(tempRoot, "examples/wrappers")), true);
    assert.equal(result.registryRoots.routes, path.join(canonicalTempRoot, "examples/routes"));

    const report = JSON.parse(fs.readFileSync(result.onboardingReportFile, "utf8"));
    assert.equal(report.write_effects.copied_example_registries, true);
    assert.ok(report.write_effects.target_repo_writes.includes("examples"));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("initializeProjectRuntime blocks invalid explicit profile references before writing runtime state", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w21-s03-missing-profile-"));
  fs.mkdirSync(path.join(tempRoot, ".git"), { recursive: true });

  try {
    assert.throws(
      () =>
        initializeProjectRuntime({
          cwd: tempRoot,
          projectRef: tempRoot,
          projectProfile: "missing-project.aor.yaml",
        }),
      /Project profile 'missing-project\.aor\.yaml' was not found/,
    );
    assert.equal(fs.existsSync(path.join(tempRoot, ".aor")), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("initializeProjectRuntime fails clearly for invalid explicit project reference", () => {
  const missing = path.join(os.tmpdir(), "aor-w1-s02-missing-path");
  assert.throws(
    () => initializeProjectRuntime({ cwd: workspaceRoot, projectRef: missing }),
    /Invalid project reference/,
  );
});

test("transactional initialization rolls back every injected write boundary", () => {
  const failurePoints = [
    "after-profile-materialization",
    "after-asset-materialization",
    "after-runtime-staging",
    "after-state-write",
    "after-artifact-write",
    "before-runtime-publish",
  ];
  for (const failureInjectionPoint of failurePoints) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w57-s06-failure-"));
    fs.mkdirSync(path.join(tempRoot, ".git"), { recursive: true });
    try {
      assert.throws(
        () => initializeProjectRuntime({
          cwd: tempRoot,
          projectRef: tempRoot,
          assetMode: "materialized",
          failureInjectionPoint,
        }),
        /Injected project initialization failure/u,
      );
      assert.equal(fs.existsSync(path.join(tempRoot, "project.aor.yaml")), false, failureInjectionPoint);
      assert.equal(fs.existsSync(path.join(tempRoot, "examples")), false, failureInjectionPoint);
      const projectsRoot = path.join(tempRoot, ".aor", "projects");
      const entries = fs.existsSync(projectsRoot) ? fs.readdirSync(projectsRoot) : [];
      assert.deepEqual(entries, [], failureInjectionPoint);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});

test("transactional reinitialization restores the previous runtime after publish interruption", () => {
  withCleanTempRepo((tempRoot) => {
    const first = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    const previousState = fs.readFileSync(first.stateFile, "utf8");
    assert.throws(
      () => initializeProjectRuntime({
        cwd: tempRoot,
        projectRef: tempRoot,
        failureInjectionPoint: "after-backup-rename",
      }),
      /Injected project initialization failure/u,
    );
    assert.equal(fs.readFileSync(first.stateFile, "utf8"), previousState);
    assert.equal(fs.readdirSync(first.runtimeLayout.projectsRoot).some((entry) => entry.includes(".tmp")), false);
  });
});

test("transactional reinitialization preserves existing artifact lineage and timestamps", () => {
  withCleanTempRepo((tempRoot) => {
    const first = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    const lineageFile = path.join(first.runtimeLayout.reportsRoot, "existing-lineage.json");
    fs.writeFileSync(lineageFile, '{"status":"preserved"}\n', "utf8");
    const lineageTime = new Date("2026-01-02T03:04:05.000Z");
    fs.utimesSync(lineageFile, lineageTime, lineageTime);

    initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });

    assert.equal(fs.readFileSync(lineageFile, "utf8"), '{"status":"preserved"}\n');
    assert.equal(fs.statSync(lineageFile).mtime.toISOString(), lineageTime.toISOString());
  });
});

test("runtime containment rejects a symlink boundary before external writes", () => {
  withCleanTempRepo((tempRoot) => {
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w57-s06-external-"));
    fs.symlinkSync(externalRoot, path.join(tempRoot, ".aor"), "dir");
    try {
      assert.throws(
        () => initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot }),
        /must not be a symbolic link or junction/u,
      );
      assert.deepEqual(fs.readdirSync(externalRoot), []);
    } finally {
      fs.rmSync(externalRoot, { recursive: true, force: true });
    }
  });
});

test("initialization supports external runtime roots and linked detached worktrees with Unicode paths", () => {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor w57 unicode-ß-"));
  const worktreeRoot = `${repositoryRoot} linked Ω`;
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor runtime Ω-"));
  try {
    childProcess.execFileSync("git", ["init", "-q", repositoryRoot]);
    writeFile(repositoryRoot, "package.json", '{"name":"transaction-test"}\n');
    childProcess.execFileSync("git", ["-C", repositoryRoot, "add", "package.json"]);
    childProcess.execFileSync("git", [
      "-C", repositoryRoot,
      "-c", "user.name=AOR Test",
      "-c", "user.email=aor@example.invalid",
      "commit", "-qm", "fixture",
    ]);
    childProcess.execFileSync("git", ["-C", repositoryRoot, "worktree", "add", "--detach", worktreeRoot, "HEAD"]);

    const result = initializeProjectRuntime({
      cwd: worktreeRoot,
      projectRef: worktreeRoot,
      runtimeRoot,
    });
    assert.equal(result.projectRoot, fs.realpathSync.native(worktreeRoot));
    assert.equal(result.runtimeRoot, fs.realpathSync.native(runtimeRoot));
    assert.equal(fs.existsSync(result.stateFile), true);
    assert.equal(fs.existsSync(path.join(worktreeRoot, ".aor")), false);
  } finally {
    try {
      childProcess.execFileSync("git", ["-C", repositoryRoot, "worktree", "remove", "--force", worktreeRoot]);
    } catch {}
    fs.rmSync(worktreeRoot, { recursive: true, force: true });
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});
