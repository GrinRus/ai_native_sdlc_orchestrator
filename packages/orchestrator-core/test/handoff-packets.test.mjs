import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  approveHandoffArtifacts,
  prepareHandoffArtifacts,
  validateApprovedHandoffGate,
} from "../src/handoff-packets.mjs";
import { materializeIntakeArtifactPacket } from "../src/artifact-store.mjs";
import { initializeProjectRuntime } from "../src/project-init.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w1-s07-"));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(repoRoot, "examples"), { recursive: true });

  try {
    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("prepareHandoffArtifacts materializes wave-ticket and pending handoff packet", () => {
  withTempRepo((repoRoot) => {
    const result = prepareHandoffArtifacts({ projectRef: repoRoot, cwd: repoRoot });
    assert.equal(result.waveTicket.project_id, "aor-core");
    assert.equal(result.handoffPacket.project_id, "aor-core");
    assert.equal(result.handoffPacket.status, "pending-approval");
    assert.equal(result.handoffPacket.approval_state.state, "pending");
    assert.equal(typeof result.handoffPacket.writeback_mode, "string");
    assert.equal(typeof result.handoffPacket.scope_constraints, "object");
    assert.ok(result.waveTicket.verification_expectations.primary_commands.length > 0);
    assert.ok(result.waveTicket.verification_plan.command_groups.length > 0);
    assert.ok(result.handoffPacket.verification_plan.command_groups.length > 0);
    assert.deepEqual(
      result.waveTicket.local_tasks.find((task) => task.task_id === "local-task.verification").verification_commands,
      result.handoffPacket.verification_plan.commands,
    );
    assert.equal(fs.existsSync(result.waveTicketFile), true);
    assert.equal(fs.existsSync(result.handoffPacketFile), true);
  });
});

test("prepareHandoffArtifacts preserves mission planning content and narrow path hints", () => {
  withTempRepo((repoRoot) => {
    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const requestFile = path.join(repoRoot, "feature-request.json");
    const primaryCommands = [
      "npx xo",
      "npm run build",
      "npx ava test/retry.ts --match='*shouldRetry*'",
    ];
    fs.writeFileSync(
      requestFile,
      `${JSON.stringify(
        {
          title: "Exercise one broader retry and hooks governance-safe change",
          brief: "Touch one broader request lifecycle surface with bounded regression coverage.",
          goals: ["Exercise one broader retry or hooks lifecycle change with governance-safe evidence."],
          kpis: [
            {
              kpi_id: "ky-governance-lineage",
              name: "Governance lineage",
              target: "Review, delivery, audit, and learning artifacts preserve the same matrix cell",
              measurement: "scenario coverage and artifact consistency checks",
            },
          ],
          definition_of_done: [
            "Bounded primary verification passes and diagnostic full-suite output is recorded.",
          ],
          expected_evidence: [
            "verify-summary",
            "routed-step-result",
            "review-report",
            "delivery-manifest",
            "learning-loop-handoff",
          ],
          acceptance_checks: [
            "preserve repo-local request lifecycle boundaries",
            "keep governance and audit evidence linked to the target checkout",
          ],
          change_evidence: {
            required_path_prefixes: ["source/", "test/", "index.d.ts"],
          },
          post_run_quality: {
            primary_commands: primaryCommands,
            diagnostic_commands: ["npm test"],
            diagnostic_failure_mode: "warn",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    materializeIntakeArtifactPacket({
      projectId: init.projectId,
      projectRoot: init.projectRoot,
      projectProfileRef: init.projectProfileRef,
      runtimeLayout: init.runtimeLayout,
      command: "aor intake create",
      missionId: "ky-retry-hooks-governance",
      requestTitle: "Exercise one broader retry and hooks governance-safe change",
      requestBrief: "Touch one broader request lifecycle surface with bounded regression coverage.",
      goals: ["Exercise one broader retry or hooks lifecycle change with governance-safe evidence."],
      kpis: [
        {
          kpi_id: "ky-governance-lineage",
          name: "Governance lineage",
          target: "Review, delivery, audit, and learning artifacts preserve the same matrix cell",
          measurement: "scenario coverage and artifact consistency checks",
        },
      ],
      definitionOfDone: [
        "Bounded primary verification passes and diagnostic full-suite output is recorded.",
      ],
      requestFile,
    });

    const result = prepareHandoffArtifacts({ projectRef: repoRoot, cwd: repoRoot });
    assert.deepEqual(result.waveTicket.scope.allowed_paths, ["source/**", "test/**", "index.d.ts"]);
    assert.deepEqual(result.waveTicket.goals, [
      "Exercise one broader retry or hooks lifecycle change with governance-safe evidence.",
    ]);
    assert.deepEqual(result.waveTicket.definition_of_done, [
      "Bounded primary verification passes and diagnostic full-suite output is recorded.",
    ]);
    assert.deepEqual(result.handoffPacket.allowed_paths, ["source/**", "test/**", "index.d.ts"]);
    assert.deepEqual(result.handoffPacket.repo_scopes[0].paths, ["source/**", "test/**", "index.d.ts"]);
    assert.deepEqual(result.handoffPacket.goals, result.waveTicket.goals);
    assert.deepEqual(result.handoffPacket.definition_of_done, result.waveTicket.definition_of_done);
    assert.deepEqual(result.handoffPacket.verification_expectations, result.waveTicket.verification_expectations);
    assert.deepEqual(result.handoffPacket.verification_plan.command_groups, result.waveTicket.verification_plan.command_groups);
    assert.deepEqual(result.handoffPacket.verification_plan.commands, primaryCommands);
    assert.deepEqual(result.handoffPacket.verification_plan.command_groups[0], {
      id: "post-change-primary",
      role: "test",
      phase: "post-change",
      enforcement: "required",
      timeout_class: "focused-test",
      commands: primaryCommands,
    });
    assert.deepEqual(result.handoffPacket.verification_plan.command_groups[1], {
      id: "diagnostic-full-suite",
      role: "full-suite",
      phase: "diagnostic",
      enforcement: "warn",
      timeout_class: "full-suite",
      commands: ["npm test"],
    });
    assert.deepEqual(result.handoffPacket.verification_plan.diagnostic_commands, ["npm test"]);
    assert.equal(result.handoffPacket.verification_plan.diagnostic_failure_mode, "warn");
    assert.ok(result.handoffPacket.allowed_commands.includes("npx ava test/retry.ts --match='*shouldRetry*'"));
    assert.ok(result.waveTicket.local_tasks.length >= 3);
    assert.ok(result.handoffPacket.local_tasks.length >= 3);
    assert.ok(
      result.handoffPacket.acceptance_criteria.includes(
        "preserve repo-local request lifecycle boundaries",
      ),
    );
    assert.deepEqual(result.handoffPacket.kpis[0].kpi_id, "ky-governance-lineage");
  });
});

test("approveHandoffArtifacts marks handoff packet as approved and gate passes", () => {
  withTempRepo((repoRoot) => {
    const prepared = prepareHandoffArtifacts({ projectRef: repoRoot, cwd: repoRoot });
    const approved = approveHandoffArtifacts({
      projectRef: repoRoot,
      cwd: repoRoot,
      handoffPacketPath: prepared.handoffPacketFile,
      approvalRef: "approval://APP-2048",
      approvedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.equal(approved.handoffPacket.status, "approved");
    assert.equal(approved.handoffPacket.approval_state.state, "approved");
    assert.ok(approved.handoffPacket.approval_state.approval_refs.includes("approval://APP-2048"));

    const gate = validateApprovedHandoffGate({
      runtimeLayout: approved.runtimeLayout,
      projectId: approved.projectId,
      handoffPacketPath: prepared.handoffPacketFile,
    });
    assert.equal(gate.status, "pass");
    assert.equal(gate.blocking, false);
  });
});

test("validateApprovedHandoffGate fails when handoff packet is missing", () => {
  withTempRepo((repoRoot) => {
    const prepared = prepareHandoffArtifacts({ projectRef: repoRoot, cwd: repoRoot });
    fs.rmSync(prepared.handoffPacketFile, { force: true });

    const gate = validateApprovedHandoffGate({
      runtimeLayout: prepared.runtimeLayout,
      projectId: prepared.projectId,
    });
    assert.equal(gate.status, "fail");
    assert.equal(gate.blocking, true);
    assert.equal(gate.details.reason, "handoff-missing");
  });
});
