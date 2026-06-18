import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { initializeProjectRuntime } from "../src/project-init.mjs";
import { materializeReviewReport } from "../src/review-run.mjs";

/**
 * @param {(repoRoot: string) => void} callback
 */
function withGitRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-review-run-"));
  try {
    runGit(repoRoot, ["init"]);
    fs.mkdirSync(path.join(repoRoot, "source"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, "test"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "package.json"), `${JSON.stringify({ name: "review-target" }, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(repoRoot, "readme.md"), "# Review target\n", "utf8");
    fs.writeFileSync(path.join(repoRoot, "source/index.ts"), "export const existing = true;\n", "utf8");
    fs.writeFileSync(path.join(repoRoot, "test/retry.ts"), "test('existing retry coverage', t => t.pass());\n", "utf8");
    runGit(repoRoot, ["add", "."]);
    runGit(repoRoot, ["-c", "user.name=AOR Test", "-c", "user.email=aor@example.test", "commit", "-m", "initial"]);

    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function runGit(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

/**
 * @param {string} filePath
 * @param {Record<string, unknown>} document
 */
function writeJson(filePath, document) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} runId
 * @param {{ handoffAllowedPaths?: string[] }} [options]
 */
function writeReviewRuntimeFixture(init, runId, options = {}) {
  const traceability = {
    mission_id: "ky-retry-hooks-governance",
    scenario_family: "governance",
    provider_variant_id: "anthropic-primary",
    feature_size: "large",
    matrix_cell: {
      cell_id: "ky.governance.large.anthropic",
      target_catalog_id: "ky",
      scenario_family: "governance",
      feature_size: "large",
      provider_variant_id: "anthropic-primary",
    },
  };
  const intakeBodyFile = path.join(init.runtimeLayout.artifactsRoot, "intake-request-body.json");
  writeJson(intakeBodyFile, {
    generated_from: {},
    project_identity: { project_id: init.projectId },
    mission_traceability: traceability,
    product_intake: {},
    product_intake_completeness: {},
    mission_scope: {},
    feature_request: {
      title: "Expose retry hook context",
      brief: "Make shouldRetry receive request and normalized options.",
      request_document: {
        scenario_family: "governance",
        provider_variant_id: "anthropic-primary",
        feature_size: "large",
        provider_variant: {
          provider: "anthropic",
          primary_adapter: "claude-code",
        },
        size_budget: {
          max_changed_files: 5,
          max_added_lines: 100,
        },
        matrix_cell: traceability.matrix_cell,
      },
    },
    evidence_roots: {},
  });
  writeJson(path.join(init.runtimeLayout.artifactsRoot, `${init.projectId}.artifact.intake-request.v1.json`), {
    packet_id: `${init.projectId}.intake-request.v1`,
    project_id: init.projectId,
    packet_type: "intake-request",
    version: 1,
    status: "complete",
    summary: "Intake request fixture.",
    body_ref: intakeBodyFile,
  });
  writeJson(path.join(init.runtimeLayout.reportsRoot, "project-analysis-report.json"), {
    report_id: `${init.projectId}.analysis.v1`,
    project_id: init.projectId,
    version: 1,
    generated_from: {},
    repo_facts: {},
    toolchain_facts: {},
    command_catalog: {},
    route_resolution: {},
    asset_resolution: {},
    policy_resolution: {},
    evaluation_registry: {},
    discovery_research: {},
    verification_plan: {},
    feature_traceability: traceability,
    status: "complete",
  });
  writeJson(path.join(init.runtimeLayout.reportsRoot, `step-result-${runId}-spec.json`), {
    step_result_id: `${runId}.spec.v1`,
    run_id: runId,
    step_id: "spec",
    step_class: "artifact",
    status: "pass",
    summary: "Spec fixture.",
    evidence_refs: [],
    routed_execution: {
      feature_traceability: traceability,
    },
  });
  writeJson(path.join(init.runtimeLayout.reportsRoot, `step-result-${runId}-execution.json`), {
    step_result_id: `${runId}.execution.v1`,
    run_id: runId,
    step_id: "execution",
    step_class: "runner",
    status: "pass",
    summary: "Execution fixture.",
    evidence_refs: [],
    routed_execution: {
      mode: "provider",
      feature_traceability: traceability,
      context_compilation: {
        compiled_context_ref: "evidence://compiled-context",
      },
      route_resolution: {
        resolved_route_id: "execution.claude-code",
        route_profile_source: "catalog",
        route_profile: {
          primary: {
            provider: "anthropic",
          },
        },
      },
      adapter_resolution: {
        adapter: {
          adapter_id: "claude-code",
        },
      },
    },
  });
  writeJson(path.join(init.runtimeLayout.artifactsRoot, `${init.projectId}.handoff.${runId}.v1.json`), {
    packet_id: `${init.projectId}.handoff.${runId}.v1`,
    project_id: init.projectId,
    ticket_id: `${runId}.ticket`,
    version: 1,
    status: "approved",
    risk_tier: "medium",
    approved_objective: "Expose retry hook context.",
    repo_scopes: [],
    allowed_paths: options.handoffAllowedPaths ?? [],
    allowed_commands: [],
    verification_plan: {},
    scope_constraints: {},
    command_policy: {},
    writeback_mode: "patch-only",
    approval_state: { status: "approved" },
    feature_traceability: traceability,
  });
}

test("review report warns when changed test files are outside explicit primary verification commands", () => {
  withGitRepo((repoRoot) => {
    const runId = "run.review-coverage";
    fs.writeFileSync(
      path.join(repoRoot, "test/retry.ts"),
      [
        "test('existing retry coverage', t => t.pass());",
        "test('new retry lifecycle coverage', t => t.pass());",
        "",
      ].join("\n"),
      "utf8",
    );
    const init = initializeProjectRuntime({ cwd: repoRoot, projectRef: repoRoot });
    writeReviewRuntimeFixture(init, runId);
    writeJson(path.join(init.runtimeLayout.reportsRoot, "verify-summary-post-run-primary.json"), {
      run_id: `${runId}.verify.post-run-primary.v1`,
      verification_label: "post-run-primary",
      status: "passed",
      command_source: "cli-override",
      command_overrides: {
        build_commands: ["npm run build"],
        lint_commands: ["npx xo"],
        test_commands: ["npx ava test/main.ts test/hooks.ts"],
      },
      step_result_refs: [],
    });

    const { reviewReport } = materializeReviewReport({
      cwd: repoRoot,
      projectRef: repoRoot,
      runId,
    });

    const artifactFindings = reviewReport.artifact_quality.findings;
    assert.ok(
      artifactFindings.some((finding) =>
        String(finding.summary).includes("Primary verification did not explicitly exercise changed test file(s): test/retry.ts"),
      ),
    );
  });
});

test("review report treats package workspace test commands as covering changed package tests", () => {
  withGitRepo((repoRoot) => {
    const runId = "run.review-workspace-coverage";
    const packageRoot = path.join(repoRoot, "packages/ts-utils");
    const testPath = path.join(packageRoot, "src/typeguards/__tests__/typeguards.test.ts");
    fs.mkdirSync(path.dirname(testPath), { recursive: true });
    fs.writeFileSync(
      path.join(packageRoot, "package.json"),
      `${JSON.stringify({ name: "@your-org/ts-utils" }, null, 2)}\n`,
      "utf8",
    );
    fs.writeFileSync(testPath, "test('existing typeguard coverage', t => t.pass());\n", "utf8");
    runGit(repoRoot, ["add", "."]);
    runGit(repoRoot, ["-c", "user.name=AOR Test", "-c", "user.email=aor@example.test", "commit", "-m", "add workspace package"]);
    fs.writeFileSync(
      testPath,
      [
        "test('existing typeguard coverage', t => t.pass());",
        "test('strict numeric string coverage', t => t.pass());",
        "",
      ].join("\n"),
      "utf8",
    );
    const init = initializeProjectRuntime({ cwd: repoRoot, projectRef: repoRoot });
    writeReviewRuntimeFixture(init, runId);
    writeJson(path.join(init.runtimeLayout.reportsRoot, "verify-summary-post-run-primary.json"), {
      run_id: `${runId}.verify.post-run-primary.v1`,
      verification_label: "post-run-primary",
      status: "passed",
      command_source: "cli-override",
      command_overrides: {
        build_commands: ["yarn g:typecheck"],
        lint_commands: [],
        test_commands: ["yarn workspace @your-org/ts-utils test-unit"],
      },
      step_result_refs: [],
    });

    const { reviewReport } = materializeReviewReport({
      cwd: repoRoot,
      projectRef: repoRoot,
      runId,
    });

    assert.equal(reviewReport.overall_status, "pass");
    assert.equal(reviewReport.review_recommendation, "proceed");
    assert.ok(
      reviewReport.artifact_quality.findings.every(
        (finding) => !String(finding.summary).includes("Primary verification did not explicitly exercise changed test file"),
      ),
    );
  });
});

test("review report does not treat test support config files as changed test specs", () => {
  withGitRepo((repoRoot) => {
    const runId = "run.review-test-support-config";
    const supportPath = path.join(repoRoot, "apps/nextjs-app/config/tests/AppTestProviders.tsx");
    fs.mkdirSync(path.dirname(supportPath), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, "apps/nextjs-app/package.json"),
      `${JSON.stringify({ name: "@your-org/nextjs-app" }, null, 2)}\n`,
      "utf8",
    );
    fs.writeFileSync(supportPath, "export function AppTestProviders({ children }) { return children; }\n", "utf8");
    runGit(repoRoot, ["add", "."]);
    runGit(repoRoot, ["-c", "user.name=AOR Test", "-c", "user.email=aor@example.test", "commit", "-m", "add test support config"]);
    fs.writeFileSync(
      supportPath,
      "export function AppTestProviders({ children }) { return <>{children}</>; }\n",
      "utf8",
    );
    const init = initializeProjectRuntime({ cwd: repoRoot, projectRef: repoRoot });
    writeReviewRuntimeFixture(init, runId);
    writeJson(path.join(init.runtimeLayout.reportsRoot, "verify-summary-post-run-primary.json"), {
      run_id: `${runId}.verify.post-run-primary.v1`,
      verification_label: "post-run-primary",
      status: "passed",
      command_source: "cli-override",
      command_overrides: {
        build_commands: ["yarn g:typecheck"],
        lint_commands: [],
        test_commands: ["yarn workspace @your-org/ts-utils test-unit"],
      },
      step_result_refs: [],
    });

    const { reviewReport } = materializeReviewReport({
      cwd: repoRoot,
      projectRef: repoRoot,
      runId,
    });

    assert.ok(
      reviewReport.artifact_quality.findings.every(
        (finding) => !String(finding.summary).includes("Primary verification did not explicitly exercise changed test file"),
      ),
    );
  });
});

test("review report fails changed paths outside approved handoff scope", () => {
  withGitRepo((repoRoot) => {
    const runId = "run.review-handoff-scope";
    fs.writeFileSync(path.join(repoRoot, "source/index.ts"), "export const existing = true;\nexport const added = true;\n", "utf8");
    fs.writeFileSync(
      path.join(repoRoot, "readme.md"),
      "# Review target\n\nDocumenting a code change outside the approved handoff path scope.\n",
      "utf8",
    );
    const init = initializeProjectRuntime({ cwd: repoRoot, projectRef: repoRoot });
    writeReviewRuntimeFixture(init, runId, {
      handoffAllowedPaths: ["source/**", "test/**", "index.d.ts"],
    });
    writeJson(path.join(init.runtimeLayout.reportsRoot, "verify-summary-post-run-primary.json"), {
      run_id: `${runId}.verify.post-run-primary.v1`,
      verification_label: "post-run-primary",
      status: "passed",
      command_source: "cli-override",
      command_overrides: {
        build_commands: ["npm run build"],
        lint_commands: ["npx xo"],
        test_commands: ["npm test"],
      },
      step_result_refs: [],
    });

    const { reviewReport } = materializeReviewReport({
      cwd: repoRoot,
      projectRef: repoRoot,
      runId,
    });

    assert.equal(reviewReport.overall_status, "fail");
    assert.equal(reviewReport.review_recommendation, "repair");
    assert.equal(reviewReport.code_quality.status, "fail");
    assert.deepEqual(reviewReport.code_quality.changed_paths.sort(), ["readme.md", "source/index.ts"]);
    assert.ok(
      reviewReport.code_quality.findings.some((finding) =>
        String(finding.summary).includes("Changed path(s) outside approved handoff scope: readme.md"),
      ),
    );
  });
});
