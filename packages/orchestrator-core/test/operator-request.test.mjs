import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateContractDocument } from "../../contracts/src/index.mjs";
import { materializeIntakeArtifactPacket } from "../src/artifact-store.mjs";
import { createControlPlaneHttpServer } from "../src/control-plane/http/http-transport.mjs";
import { initializeProjectRuntime } from "../src/project-init.mjs";
import {
  createOperatorRequest,
  getOperatorRequestStatus,
  listOperatorRequests,
  runOperatorRequest,
} from "../src/operator-request.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(currentFilePath), "../../..");
const cliPath = path.join(workspaceRoot, "apps/cli/bin/aor.mjs");

/**
 * @param {(repoRoot: string) => Promise<void> | void} callback
 */
async function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-operator-request-"));
  const gitInit = spawnSync("git", ["init"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(gitInit.status, 0, gitInit.stderr || gitInit.stdout);
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(repoRoot, "examples"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# Temp project\n", "utf8");
  fs.mkdirSync(path.join(repoRoot, "docs"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "docs/guide.md"), "Original guide\n", "utf8");

  try {
    await callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

/**
 * @param {string} projectRoot
 * @param {string} filePath
 * @returns {string}
 */
function toEvidenceRef(projectRoot, filePath) {
  return `evidence://${path.relative(projectRoot, filePath).replace(/\\/g, "/")}`;
}

/**
 * @param {string} filePath
 * @param {Record<string, unknown>} document
 */
function writeRuntimeJson(filePath, document) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

/**
 * @param {string} repoRoot
 */
function seedCompletedFlow(repoRoot) {
  const init = initializeProjectRuntime({ cwd: repoRoot, projectRef: repoRoot });
  const intake = materializeIntakeArtifactPacket({
    projectId: init.projectId,
    projectRoot: init.projectRoot,
    projectProfileRef: init.projectProfileRef,
    runtimeLayout: init.runtimeLayout,
    command: "aor mission create",
    missionId: "completed-flow",
    requestTitle: "Completed flow",
    requestBrief: "Completed flow for operator request guard.",
    requestConstraints: ["Keep completed evidence read-only."],
    goals: ["Inspect completed evidence."],
    kpis: [{ kpi_id: "completed-flow", name: "Completed flow", target: "Read-only guard passes." }],
    definitionOfDone: ["Completed flow stays immutable."],
    allowedPaths: ["docs/**"],
    deliveryMode: "patch-only",
    sourceKind: "local-note",
    sourceRef: "docs/guide.md",
  });
  const handoffRef = `evidence://.aor/projects/${init.projectId}/reports/learning-loop-handoff-run.completed-flow.json`;
  writeRuntimeJson(path.join(init.runtimeLayout.reportsRoot, "next-action-report-completed-flow.json"), {
    report_id: `${init.projectId}.next-action.completed-flow.v1`,
    project_id: init.projectId,
    version: 1,
    generated_from: {
      command: "aor next",
      project_root: init.projectRoot,
      project_profile_ref: init.projectProfileRef,
    },
    project_state: {
      stage: "learning",
      runtime_root: init.runtimeRoot,
      runtime_state_file: init.stateFile,
      onboarding_report_ref: null,
      active_run_ref: null,
    },
    mission_state: {
      intake_packet_ref: toEvidenceRef(init.projectRoot, intake.packetFile),
      intake_body_ref: toEvidenceRef(init.projectRoot, intake.packetBodyFile),
      completeness_status: "complete",
      missing_fields: [],
      mission_id: "completed-flow",
      delivery_mode: "patch-only",
      allowed_paths: ["docs/**"],
      forbidden_paths: [],
    },
    closure_state: {
      run_id: "run.completed-flow",
      learning: {
        status: "handoff-complete",
        handoff_ref: handoffRef,
        linked_evidence_refs: [handoffRef],
      },
      evidence_chain: [handoffRef],
    },
    primary_action: {
      action_id: "closure-complete",
      command: "aor next",
      reason: "Completed flow fixture.",
      low_level_command: "next",
      evidence_refs: [handoffRef],
    },
    blockers: [],
    bounded_execution: {
      requested_delivery_mode: "patch-only",
      upstream_writes_default: false,
      delivery_capable_mode: true,
      allowed_paths: ["docs/**"],
      forbidden_paths: [],
      requires_review_before_writeback: true,
    },
    evidence_refs: [toEvidenceRef(init.projectRoot, intake.packetFile), toEvidenceRef(init.projectRoot, intake.packetBodyFile), handoffRef],
    status: "ready",
    created_at: "2026-05-28T00:00:00.000Z",
  });
  return {
    init,
    flowId: `flow.${init.projectId}.completed-flow`,
  };
}

test("operator-request contract validates supported enums and rejects invalid intent deterministically", () => {
  const document = {
    request_id: "operator-request.test.1",
    project_id: "aor-core",
    version: 1,
    source_surface: "cli",
    target_stage: "spec",
    intent_type: "analyze",
    request_text: "Analyze README.",
    request_summary: "Analyze README.",
    target_refs: ["README.md"],
    allowed_paths: [],
    delivery_mode: "no-write",
    status: "created",
    created_at: "2026-05-25T00:00:00.000Z",
    result_refs: [],
    evidence_refs: [],
  };
  assert.equal(validateContractDocument({ family: "operator-request", document }).ok, true);
  const invalid = validateContractDocument({
    family: "operator-request",
    document: { ...document, intent_type: "chat" },
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.issues.some((issue) => issue.code === "enum_value_invalid" && issue.field === "intent_type"), true);
});

test("operator request create/run routes request ref through compiled context and hides raw text from reads", async () => {
  await withTempRepo(async (repoRoot) => {
    const created = createOperatorRequest({
      cwd: repoRoot,
      projectRef: repoRoot,
      targetStage: "spec",
      intentType: "analyze",
      requestText: "Explain the README risks before changing anything.",
      targetRefs: ["README.md"],
    });
    assert.equal(created.status, "created");
    assert.equal(created.operatorRequest.delivery_mode, "no-write");
    assert.equal(Object.hasOwn(created.operatorRequest, "request_text"), false);

    const listedBefore = listOperatorRequests({ cwd: repoRoot, projectRef: repoRoot });
    assert.equal(listedBefore.length, 1);
    assert.equal(Object.hasOwn(listedBefore[0].document, "request_text"), false);

    const run = runOperatorRequest({
      cwd: repoRoot,
      projectRef: repoRoot,
      requestRef: created.operatorRequestRef,
      targetStep: "spec",
    });
    assert.equal(run.status, "completed");
    assert.match(run.compiledContextRef, /^compiled-context:\/\//u);
    assert.equal(fs.existsSync(run.routedStepResultFile), true);
    assert.equal(run.patchRefs.length, 0);
    assert.equal(run.proposalRefs.length, 1);

    const stepResult = JSON.parse(fs.readFileSync(run.routedStepResultFile, "utf8"));
    assert.equal(stepResult.routed_execution.operator_request_ref, created.operatorRequestRef);
    const compiled = stepResult.routed_execution.context_compilation.compiled_context_artifact;
    assert.ok(compiled.packet_refs.includes(created.operatorRequestRef));
    assert.ok(compiled.context_bundle_refs.includes("context-bundle://context.bundle.operator-intervention@v1"));

    const status = getOperatorRequestStatus({ cwd: repoRoot, projectRef: repoRoot, requestRef: created.operatorRequestRef });
    assert.equal(status.status, "completed");
    assert.equal(Object.hasOwn(status.operatorRequest, "request_text"), false);
  });
});

test("patch-only operator requests require scope and emit patch evidence without mutating source files", async () => {
  await withTempRepo(async (repoRoot) => {
    assert.throws(
      () =>
        createOperatorRequest({
          cwd: repoRoot,
          projectRef: repoRoot,
          targetStage: "spec",
          intentType: "revise-document",
          requestText: "Revise docs/guide.md.",
          targetRefs: ["docs/guide.md"],
          deliveryMode: "patch-only",
        }),
      (error) => error instanceof Error && error.code === "operator_request.scope_required",
    );

    const guidePath = path.join(repoRoot, "docs/guide.md");
    const before = fs.readFileSync(guidePath, "utf8");
    const created = createOperatorRequest({
      cwd: repoRoot,
      projectRef: repoRoot,
      targetStage: "spec",
      intentType: "revise-document",
      requestText: "Revise docs/guide.md with a short intro.",
      targetRefs: ["docs/guide.md"],
      allowedPaths: ["docs/**"],
      deliveryMode: "patch-only",
    });
    const run = runOperatorRequest({
      cwd: repoRoot,
      projectRef: repoRoot,
      requestRef: created.operatorRequestRef,
      targetStep: "spec",
    });
    assert.equal(run.patchRefs.length, 1);
    const patchFile = path.join(repoRoot, run.patchRefs[0].slice("evidence://".length));
    assert.equal(fs.existsSync(patchFile), true);
    assert.equal(fs.readFileSync(guidePath, "utf8"), before);
  });
});

test("operator request refs stay inside runtime reports and external runtime roots remain addressable", async () => {
  await withTempRepo(async (repoRoot) => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-operator-request-runtime-"));
    const outsideFile = path.join(os.tmpdir(), `operator-request-outside-${Date.now()}.json`);
    try {
      const created = createOperatorRequest({
        cwd: repoRoot,
        projectRef: repoRoot,
        runtimeRoot,
        targetStage: "spec",
        intentType: "analyze",
        requestText: "Analyze README using an external runtime root.",
        targetRefs: ["README.md"],
      });
      assert.ok(created.operatorRequestRef.includes("evidence://"));
      const status = getOperatorRequestStatus({
        cwd: repoRoot,
        projectRef: repoRoot,
        runtimeRoot,
        requestRef: created.operatorRequestRef,
      });
      assert.equal(status.status, "created");

      fs.writeFileSync(
        outsideFile,
        `${JSON.stringify({
          request_id: "operator-request.outside",
          project_id: "aor-core",
          version: 1,
          source_surface: "cli",
          target_stage: "spec",
          intent_type: "analyze",
          request_text: "outside",
          request_summary: "outside",
          target_refs: [],
          allowed_paths: [],
          delivery_mode: "no-write",
          status: "created",
          created_at: "2026-05-25T00:00:00.000Z",
          result_refs: [],
          evidence_refs: [],
        })}\n`,
        "utf8",
      );
      assert.throws(
        () =>
          getOperatorRequestStatus({
            cwd: repoRoot,
            projectRef: repoRoot,
            runtimeRoot,
            requestRef: outsideFile,
          }),
        (error) => error instanceof Error && error.code === "operator_request.invalid_request_ref",
      );
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
      fs.rmSync(outsideFile, { force: true });
    }
  });
});

test("operator request run rejects unsupported target step before mutating request status", async () => {
  await withTempRepo(async (repoRoot) => {
    const created = createOperatorRequest({
      cwd: repoRoot,
      projectRef: repoRoot,
      targetStage: "spec",
      intentType: "analyze",
      requestText: "Analyze README.",
      targetRefs: ["README.md"],
    });
    assert.throws(
      () =>
        runOperatorRequest({
          cwd: repoRoot,
          projectRef: repoRoot,
          requestRef: created.operatorRequestRef,
          targetStep: "unknown-step",
        }),
      (error) => error instanceof Error && error.code === "operator_request.invalid_target_step",
    );
    const status = getOperatorRequestStatus({ cwd: repoRoot, projectRef: repoRoot, requestRef: created.operatorRequestRef });
    assert.equal(status.status, "created");
  });
});

test("operator request CLI and HTTP routes create query-safe requests and run them", async () => {
  await withTempRepo(async (repoRoot) => {
    const createCli = spawnSync(
      process.execPath,
      [
        cliPath,
        "request",
        "create",
        "--project-ref",
        repoRoot,
        "--stage",
        "spec",
        "--intent",
        "analyze",
        "--request",
        "Analyze README from CLI.",
        "--target-ref",
        "README.md",
      ],
      { cwd: workspaceRoot, encoding: "utf8" },
    );
    assert.equal(createCli.status, 0, createCli.stderr || createCli.stdout);
    const createPayload = JSON.parse(createCli.stdout);
    assert.equal(createPayload.operator_request_status, "created");
    assert.equal(Object.hasOwn(createPayload.operator_request, "request_text"), false);

    const runCli = spawnSync(
      process.execPath,
      [
        cliPath,
        "request",
        "run",
        "--project-ref",
        repoRoot,
        "--request-ref",
        createPayload.operator_request_ref,
        "--target-step",
        "spec",
      ],
      { cwd: workspaceRoot, encoding: "utf8" },
    );
    assert.equal(runCli.status, 0, runCli.stderr || runCli.stdout);
    const runPayload = JSON.parse(runCli.stdout);
    assert.equal(runPayload.operator_request_status, "completed");
    assert.ok(runPayload.operator_request_run.compiled_context_ref);

    const transport = await createControlPlaneHttpServer({ cwd: repoRoot, projectRef: repoRoot, host: "127.0.0.1", port: 0 });
    try {
      const base = `${transport.baseUrl}/api/projects/${transport.projectId}`;
      const create = await fetch(`${base}/operator-requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target_stage: "review",
          intent_type: "review",
          request_text: "Review the latest proposal evidence.",
          target_refs: [runPayload.operator_request_ref],
        }),
      });
      assert.equal(create.status, 201);
      const created = await create.json();
      assert.equal(Object.hasOwn(created.operator_request.document, "request_text"), false);

      const list = await fetch(`${base}/operator-requests`);
      const listed = await list.json();
      assert.equal(list.status, 200);
      assert.equal(listed.some((entry) => Object.hasOwn(entry.document, "request_text")), false);

      const action = await fetch(`${base}/operator-requests/${encodeURIComponent(created.operator_request.request_id)}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "run",
          request_ref: created.operator_request.operator_request_ref,
          target_step: "review",
        }),
      });
      assert.equal(action.status, 200);
      const actionPayload = await action.json();
      assert.ok(actionPayload.operator_request_run.compiled_context_ref);
      assert.equal(actionPayload.operator_request_run.proposal_refs.length, 1);
    } finally {
      await transport.close();
    }
  });
});

test("target-flow operator requests preserve completed-flow read-only guardrails", async () => {
  await withTempRepo(async (repoRoot) => {
    const { flowId } = seedCompletedFlow(repoRoot);

    assert.throws(
      () =>
        createOperatorRequest({
          cwd: repoRoot,
          projectRef: repoRoot,
          targetFlowId: flowId,
          targetStage: "spec",
          intentType: "revise-document",
          requestText: "Revise completed flow evidence.",
          targetRefs: ["README.md"],
          allowedPaths: ["docs/**"],
          deliveryMode: "patch-only",
        }),
      (error) => error instanceof Error && error.code === "operator_request.completed_flow_read_only",
    );

    const created = createOperatorRequest({
      cwd: repoRoot,
      projectRef: repoRoot,
      targetFlowId: flowId,
      targetStage: "review",
      intentType: "analyze",
      requestText: "Inspect completed flow evidence without writing.",
      targetRefs: ["README.md"],
      deliveryMode: "no-write",
    });
    assert.equal(created.operatorRequest.target_flow_id, flowId);

    const cli = spawnSync(
      process.execPath,
      [
        cliPath,
        "request",
        "create",
        "--project-ref",
        repoRoot,
        "--stage",
        "review",
        "--intent",
        "explain",
        "--request",
        "Explain completed flow evidence from CLI.",
        "--target-flow-id",
        flowId,
        "--target-ref",
        "README.md",
        "--json",
      ],
      { cwd: workspaceRoot, encoding: "utf8" },
    );
    assert.equal(cli.status, 0, cli.stderr || cli.stdout);
    const cliPayload = JSON.parse(cli.stdout);
    assert.equal(cliPayload.operator_request.target_flow_id, flowId);

    const transport = await createControlPlaneHttpServer({ cwd: repoRoot, projectRef: repoRoot, host: "127.0.0.1", port: 0 });
    try {
      const blocked = await fetch(`${transport.baseUrl}/api/projects/${transport.projectId}/operator-requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target_flow_id: flowId,
          target_stage: "implement",
          intent_type: "implement",
          request_text: "Implement against completed flow.",
          target_refs: ["README.md"],
          allowed_paths: ["docs/**"],
          delivery_mode: "patch-only",
        }),
      });
      assert.equal(blocked.status, 409);
      const blockedPayload = await blocked.json();
      assert.equal(blockedPayload.error.code, "operator_request.completed_flow_read_only");
    } finally {
      await transport.close();
    }
  });
});
