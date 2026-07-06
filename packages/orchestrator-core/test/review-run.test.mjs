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

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} runId
 * @param {{
 *   command: string,
 *   role: string,
 *   groupId: string,
 *   exitCode: number,
 *   stdoutTail?: string,
 *   stderrTail?: string,
 *   summary?: string,
 * }} options
 */
function writeFailedVerifyRuntimeFixture(init, runId, options) {
  const transcriptFile = path.join(init.runtimeLayout.reportsRoot, `verify-transcript-${options.groupId}.txt`);
  fs.writeFileSync(
    transcriptFile,
    [
      `command: ${options.command}`,
      `exit_code: ${options.exitCode}`,
      "stdout:",
      options.stdoutTail ?? "",
      "stderr:",
      options.stderrTail ?? "",
      "",
    ].join("\n"),
    "utf8",
  );
  const stepResultFile = path.join(init.runtimeLayout.reportsRoot, `step-result-post-run-primary-${options.groupId}.json`);
  const stepSummary =
    options.summary ?? `Post-change verification command '${options.command}' failed with exit code ${options.exitCode}.`;
  writeJson(stepResultFile, {
    step_result_id: `${runId}.verify.post-run-primary.${options.groupId}`,
    run_id: `${runId}.verify.post-run-primary.v1`,
    step_id: `verify.post-run-primary.${options.groupId}`,
    step_class: "runner",
    status: "failed",
    summary: stepSummary,
    evidence_refs: [transcriptFile],
    repo_scope: "target",
    command: options.command,
    command_owner: "target",
    command_source: "project-profile",
    command_kind: options.role,
    verification_label: "post-run-primary",
    command_group_id: options.groupId,
    command_group_role: options.role,
    command_group_phase: "post-change",
    command_group_enforcement: "required",
    command_group_timeout_class: "focused-test",
    enforcement_result: "fail",
    command_timeout_ms: 300000,
    timed_out: false,
    exit_code: options.exitCode,
    signal: null,
    error_code: null,
    output_excerpt: {
      stdout_tail: options.stdoutTail ?? "",
      stderr_tail: options.stderrTail ?? "",
    },
  });
  writeJson(path.join(init.runtimeLayout.reportsRoot, "verify-summary-post-run-primary.json"), {
    run_id: `${runId}.verify.post-run-primary.v1`,
    verification_label: "post-run-primary",
    status: "failed",
    validation_gate_status: "failed",
    command_source: "project-profile",
    command_overrides: {
      build_commands: [],
      lint_commands: [],
      test_commands: [],
    },
    command_groups: [
      {
        id: options.groupId,
        role: options.role,
        phase: "post-change",
        enforcement: "required",
        timeout_class: "focused-test",
        status: "failed",
        command_count: 1,
        failed_command_count: 1,
        skipped_command_count: 0,
        outcome: null,
        step_result_refs: [stepResultFile],
      },
    ],
    step_result_refs: [stepResultFile],
    command_timeout_ms: 300000,
    timed_out_commands: [],
    phase_summary: {
      baseline_failed_count: 0,
      post_change_failed_count: 1,
      broken_baseline_count: 0,
      baseline_failed_step_result_refs: [],
      post_change_failed_step_result_refs: [stepResultFile],
    },
    enforcement_summary: {
      required_failed_count: 1,
      warn_failed_count: 0,
      observe_failed_count: 0,
      required_failed_step_result_refs: [stepResultFile],
      warn_step_result_refs: [],
      observe_step_result_refs: [],
    },
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
    assert.equal(reviewReport.overall_status, "warn");
    assert.equal(reviewReport.review_recommendation, "required-human-review");
    assert.ok(
      artifactFindings.some((finding) =>
        String(finding.summary).includes("Primary verification did not explicitly exercise changed test file(s): test/retry.ts"),
      ),
    );
    assert.ok(artifactFindings.every((finding) => !Array.isArray(finding.verification_failure_details)));
  });
});

test("review report attaches actionable XO verification failure details", () => {
  withGitRepo((repoRoot) => {
    const runId = "run.review-xo-failure";
    fs.writeFileSync(path.join(repoRoot, "source/index.ts"), "export const existing: string | null = null;\n", "utf8");
    const init = initializeProjectRuntime({ cwd: repoRoot, projectRef: repoRoot });
    writeReviewRuntimeFixture(init, runId);
    writeFailedVerifyRuntimeFixture(init, runId, {
      command: "npx xo",
      role: "lint",
      groupId: "post-change-lint",
      exitCode: 1,
      stderrTail: "test/retry.ts: Type 'string | null' is not assignable to type 'string'.",
    });

    const { reviewReport } = materializeReviewReport({
      cwd: repoRoot,
      projectRef: repoRoot,
      runId,
    });

    const verifyFinding = reviewReport.artifact_quality.findings.find((finding) =>
      String(finding.summary).includes("Verify-summary failed with command-level details"),
    );
    assert.ok(verifyFinding);
    assert.equal(verifyFinding.verification_failure_details.length, 1);
    const [detail] = verifyFinding.verification_failure_details;
    assert.equal(detail.command, "npx xo");
    assert.equal(detail.role, "lint");
    assert.equal(detail.enforcement, "required");
    assert.equal(detail.exit_code, 1);
    assert.equal(detail.timeout_class, "focused-test");
    assert.match(detail.stderr_excerpt, /string \| null/u);
    assert.ok(detail.evidence_refs.some((ref) => String(ref).includes("step-result-post-run-primary-post-change-lint")));
  });
});

test("review report attaches actionable AVA verification failure details", () => {
  withGitRepo((repoRoot) => {
    const runId = "run.review-ava-failure";
    fs.writeFileSync(
      path.join(repoRoot, "test/retry.ts"),
      [
        "test('existing retry coverage', t => t.pass());",
        "test('shouldRetry receives request context', t => t.fail('missing request context'));",
        "",
      ].join("\n"),
      "utf8",
    );
    const init = initializeProjectRuntime({ cwd: repoRoot, projectRef: repoRoot });
    writeReviewRuntimeFixture(init, runId);
    writeFailedVerifyRuntimeFixture(init, runId, {
      command: "npx ava test/retry.ts --match='*shouldRetry*'",
      role: "test",
      groupId: "post-change-test",
      exitCode: 1,
      stdoutTail: "shouldRetry receives request context",
      stderrTail: "AssertionError: missing request context",
    });

    const { reviewReport } = materializeReviewReport({
      cwd: repoRoot,
      projectRef: repoRoot,
      runId,
    });

    const verifyFinding = reviewReport.artifact_quality.findings.find((finding) =>
      String(finding.summary).includes("Verify-summary failed with command-level details"),
    );
    assert.ok(verifyFinding);
    const [detail] = verifyFinding.verification_failure_details;
    assert.equal(detail.command, "npx ava test/retry.ts --match='*shouldRetry*'");
    assert.equal(detail.role, "test");
    assert.equal(detail.exit_code, 1);
    assert.match(detail.stdout_excerpt, /shouldRetry/u);
    assert.match(detail.stderr_excerpt, /missing request context/u);
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
    assert.deepEqual(reviewReport.artifact_quality.verification_coverage.uncovered_test_paths, []);
    assert.deepEqual(reviewReport.artifact_quality.verification_coverage.covered_test_paths, [
      "packages/ts-utils/src/typeguards/__tests__/typeguards.test.ts",
    ]);
    assert.deepEqual(reviewReport.artifact_quality.verification_coverage.covering_commands, [
      "yarn workspace @your-org/ts-utils test-unit",
    ]);
    assert.equal(
      reviewReport.artifact_quality.verification_coverage.coverage_reason,
      "workspace-or-package-scoped-test-command",
    );
    assert.ok(
      reviewReport.artifact_quality.findings.every(
        (finding) => !String(finding.summary).includes("Primary verification did not explicitly exercise changed test file"),
      ),
    );
  });
});

test("review report treats broad npm test:ci command as covering changed test files", () => {
  withGitRepo((repoRoot) => {
    const runId = "run.review-broad-test-ci-coverage";
    fs.writeFileSync(
      path.join(repoRoot, "test/schema-feature.test.js"),
      [
        "test('existing schema coverage', t => t.pass());",
        "test('new schema feature coverage', t => t.pass());",
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
        lint_commands: [],
        test_commands: ["npm run test:ci"],
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
    assert.deepEqual(reviewReport.artifact_quality.verification_coverage.changed_test_paths, [
      "test/schema-feature.test.js",
    ]);
    assert.deepEqual(reviewReport.artifact_quality.verification_coverage.covered_test_paths, [
      "test/schema-feature.test.js",
    ]);
    assert.deepEqual(reviewReport.artifact_quality.verification_coverage.uncovered_test_paths, []);
    assert.deepEqual(reviewReport.artifact_quality.verification_coverage.covering_commands, ["npm run test:ci"]);
    assert.equal(reviewReport.artifact_quality.verification_coverage.coverage_reason, "broad-repo-test-command");
    assert.ok(
      reviewReport.artifact_quality.findings.every(
        (finding) => !String(finding.summary).includes("Primary verification did not explicitly exercise changed test file"),
      ),
    );
  });
});

test("review report resolves broad test commands from verify command-group step results", () => {
  withGitRepo((repoRoot) => {
    const runId = "run.review-command-group-step-result-coverage";
    fs.writeFileSync(
      path.join(repoRoot, "test/schema-feature.test.js"),
      [
        "test('existing schema coverage', t => t.pass());",
        "test('new schema feature coverage', t => t.pass());",
        "",
      ].join("\n"),
      "utf8",
    );
    const init = initializeProjectRuntime({ cwd: repoRoot, projectRef: repoRoot });
    writeReviewRuntimeFixture(init, runId);
    const stepResultPath = path.join(init.runtimeLayout.reportsRoot, "step-result-post-run-primary-1.json");
    writeJson(stepResultPath, {
      step_result_id: `${runId}.verify.post-run-primary.v1.step.1`,
      run_id: `${runId}.verify.post-run-primary.v1`,
      step_id: "verify.post-run-primary.command.1",
      step_class: "runner",
      status: "passed",
      summary: "Verification command 'npm run test:ci' passed.",
      evidence_refs: [],
      command: "npm run test:ci",
      command_kind: "test",
      command_group_id: "post-change-primary",
      command_group_role: "test",
      command_group_phase: "post-change",
      enforcement_result: "pass",
    });
    writeJson(path.join(init.runtimeLayout.reportsRoot, "verify-summary-post-run-primary.json"), {
      run_id: `${runId}.verify.post-run-primary.v1`,
      verification_label: "post-run-primary",
      status: "passed",
      command_source: "project-profile",
      command_overrides: {
        build_commands: [],
        lint_commands: [],
        test_commands: [],
      },
      command_groups: [
        {
          id: "post-change-primary",
          role: "test",
          phase: "post-change",
          status: "passed",
          step_result_refs: [`evidence://${path.relative(repoRoot, stepResultPath).replace(/\\/g, "/")}`],
        },
      ],
      step_result_refs: [],
    });

    const { reviewReport } = materializeReviewReport({
      cwd: repoRoot,
      projectRef: repoRoot,
      runId,
    });

    assert.equal(reviewReport.overall_status, "pass");
    assert.equal(reviewReport.review_recommendation, "proceed");
    assert.deepEqual(reviewReport.artifact_quality.verification_coverage.changed_test_paths, [
      "test/schema-feature.test.js",
    ]);
    assert.deepEqual(reviewReport.artifact_quality.verification_coverage.covered_test_paths, [
      "test/schema-feature.test.js",
    ]);
    assert.deepEqual(reviewReport.artifact_quality.verification_coverage.uncovered_test_paths, []);
    assert.deepEqual(reviewReport.artifact_quality.verification_coverage.covering_commands, ["npm run test:ci"]);
    assert.deepEqual(reviewReport.artifact_quality.verification_coverage.recorded_test_commands, ["npm run test:ci"]);
    assert.equal(reviewReport.artifact_quality.verification_coverage.coverage_reason, "broad-repo-test-command");
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
