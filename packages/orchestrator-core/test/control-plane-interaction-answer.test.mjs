import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readRunEventHistory } from "../src/control-plane/read-run-projections.mjs";
import { submitInteractionAnswer } from "../src/control-plane/interaction-answer.mjs";
import { initializeProjectRuntime } from "../src/project-init.mjs";

/**
 * @param {(projectRoot: string) => void} callback
 */
function withTempProject(callback) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w24-s02-interaction-"));
  fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
  try {
    callback(projectRoot);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}

/**
 * @param {string} projectRoot
 * @param {string} runId
 * @param {string} interactionId
 * @returns {string}
 */
function seedRequestedInteraction(projectRoot, runId, interactionId) {
  const init = initializeProjectRuntime({ cwd: projectRoot, projectRef: projectRoot });
  fs.mkdirSync(init.runtimeLayout.reportsRoot, { recursive: true });
  const stepResultFile = path.join(init.runtimeLayout.reportsRoot, "step-result-core-interaction-question.json");
  fs.writeFileSync(
    stepResultFile,
    `${JSON.stringify(
      {
        step_result_id: `${runId}.runner.question`,
        run_id: runId,
        step_id: "runner.implement",
        step_class: "runner",
        status: "failed",
        summary: "Runner requested operator input.",
        evidence_refs: ["evidence://reports/runner-question.json"],
        requested_interaction: {
          requested: true,
          interaction_id: interactionId,
          status: "requested",
          prompt_summary: "Choose the deployment target.",
          question_evidence_refs: ["evidence://reports/runner-question.json"],
          answer_audit_refs: [],
          continuation: {
            next_action: "resume_from_boundary",
            reason_code: "operator-answer-required",
          },
          state_history: [
            {
              status: "requested",
              timestamp: "2026-05-07T00:00:00.000Z",
              summary: "Choose the deployment target.",
              evidence_refs: ["evidence://reports/runner-question.json"],
              continuation: {
                next_action: "resume_from_boundary",
                reason_code: "operator-answer-required",
              },
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return stepResultFile;
}

/**
 * @param {string} projectRoot
 * @param {string} runId
 * @param {string} interactionId
 * @returns {string}
 */
function seedPermissionInteraction(projectRoot, runId, interactionId) {
  const init = initializeProjectRuntime({ cwd: projectRoot, projectRef: projectRoot });
  fs.mkdirSync(init.runtimeLayout.reportsRoot, { recursive: true });
  const stepResultFile = path.join(init.runtimeLayout.reportsRoot, "step-result-core-permission-question.json");
  const runtimePermissionRequest = {
    interaction_type: "permission_request",
    adapter_id: "claude-code",
    runner_family: "claude",
    permission_mode: "restricted",
    operation_type: "file_write",
    tool_name: "Edit",
    target: "src/index.js",
    confidence: "high",
    evidence_refs: ["evidence://reports/runner-permission.json"],
  };
  fs.writeFileSync(
    stepResultFile,
    `${JSON.stringify(
      {
        step_result_id: `${runId}.runner.permission`,
        run_id: runId,
        step_id: "runner.implement",
        step_class: "runner",
        status: "failed",
        summary: "Runner requested file edit permission.",
        failure_class: "permission-mode-blocked",
        runtime_harness_decision: "block",
        evidence_refs: ["evidence://reports/runner-permission.json"],
        requested_interaction: {
          requested: true,
          interaction_id: interactionId,
          interaction_type: "permission_request",
          status: "requested",
          prompt_summary: "Approve file edit?",
          question_evidence_refs: ["evidence://reports/runner-permission.json"],
          answer_audit_refs: [],
          runtime_permission_request: runtimePermissionRequest,
          runtime_permission_decision: {
            decision: "ask_user",
            rule_id: "runtime-permission.ask-user.sensitive-or-unknown",
            approval_scope: "step-coarse",
            approval_resume_mode: "full-bypass",
          },
          continuation: {
            next_action: "resume_from_boundary",
            reason_code: "operator-answer-required",
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return stepResultFile;
}

test("interaction answer audit records answered and resumed states without leaking raw answer to read surfaces", () => {
  withTempProject((projectRoot) => {
    const runId = "run.core.interaction.answer.v1";
    const interactionId = "question-1";
    const stepResultFile = seedRequestedInteraction(projectRoot, runId, interactionId);
    const answerText = "Use the staging target.";

    const result = submitInteractionAnswer({
      cwd: projectRoot,
      projectRef: projectRoot,
      runId,
      interactionId,
      answer: answerText,
      reason: "operator selected a safe target",
    });

    assert.equal(result.interactionStatus, "resumed");
    assert.equal(result.blocked, false);
    assert.equal(result.blockedReason, null);
    assert.equal(fs.existsSync(result.answerAuditFile), true);

    const auditRecord = JSON.parse(fs.readFileSync(result.answerAuditFile, "utf8"));
    assert.equal(auditRecord.answer_text, answerText);

    const updatedStepResult = JSON.parse(fs.readFileSync(stepResultFile, "utf8"));
    assert.equal(JSON.stringify(updatedStepResult).includes(answerText), false);
    assert.equal(updatedStepResult.requested_interaction.status, "resumed");
    assert.deepEqual(
      updatedStepResult.requested_interaction.state_history.map((entry) => entry.status),
      ["requested", "answered", "resumed"],
    );
    assert.equal(updatedStepResult.requested_interaction.continuation.next_action, "continue_run");
    assert.equal(updatedStepResult.status, "passed");
    assert.ok(updatedStepResult.requested_interaction.answer_audit_refs.includes(result.answerAuditRef));

    const eventHistory = readRunEventHistory({
      cwd: projectRoot,
      projectRef: projectRoot,
      runId,
      limit: 10,
    });
    const serializedHistory = JSON.stringify(eventHistory);
    assert.equal(serializedHistory.includes(answerText), false);
    assert.equal(serializedHistory.includes(result.answerAuditRef), true);
    assert.deepEqual(
      eventHistory.events
        .map((event) => event.interaction?.status)
        .filter((status) => typeof status === "string"),
      ["answered", "resumed"],
    );
  });
});

test("permission interaction answer records structured decision without claiming fake continuation", () => {
  withTempProject((projectRoot) => {
    const runId = "run.core.permission.answer.v1";
    const interactionId = "permission-1";
    const stepResultFile = seedPermissionInteraction(projectRoot, runId, interactionId);

    const result = submitInteractionAnswer({
      cwd: projectRoot,
      projectRef: projectRoot,
      runId,
      interactionId,
      answer: "",
      decision: "approve_once",
      reason: "operator approved one file edit",
    });

    assert.equal(result.interactionStatus, "blocked");
    assert.equal(result.blocked, true);
    assert.equal(result.blockedReason.code, "continuation.reinvoke_required");
    assert.equal(result.decision, "approve_once");

    const auditRecord = JSON.parse(fs.readFileSync(result.answerAuditFile, "utf8"));
    assert.equal(auditRecord.answer_text, "");
    assert.equal(auditRecord.decision, "approve_once");
    assert.equal(auditRecord.runtime_permission_request.operation_type, "file_write");
    assert.equal(auditRecord.runtime_permission_decision.decision, "user_approved");

    const updatedStepResult = JSON.parse(fs.readFileSync(stepResultFile, "utf8"));
    assert.equal(updatedStepResult.status, "failed");
    assert.equal(updatedStepResult.runtime_harness_decision, "block");
    assert.equal(updatedStepResult.requested_interaction.status, "blocked");
    assert.equal(updatedStepResult.requested_interaction.runtime_permission_decision.decision, "user_approved");
    assert.equal(updatedStepResult.requested_interaction.runtime_permission_decision.operator_decision, "approve_once");
    assert.equal(updatedStepResult.requested_interaction.runtime_permission_decision.approval_scope, "step-coarse");
    assert.equal(updatedStepResult.requested_interaction.runtime_permission_decision.approval_resume_mode, "full-bypass");
    assert.equal(JSON.stringify(updatedStepResult).includes("operator approved one file edit"), false);
  });
});

test("permission interaction answer requires a structured decision", () => {
  withTempProject((projectRoot) => {
    const runId = "run.core.permission.answer.invalid";
    const interactionId = "permission-invalid";
    seedPermissionInteraction(projectRoot, runId, interactionId);

    assert.throws(
      () =>
        submitInteractionAnswer({
          cwd: projectRoot,
          projectRef: projectRoot,
          runId,
          interactionId,
          answer: "please approve this",
        }),
      (error) =>
        error instanceof Error &&
        /** @type {{ code?: string }} */ (error).code === "interaction_answer.decision_required",
    );
  });
});
