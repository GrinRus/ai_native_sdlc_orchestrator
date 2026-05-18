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
