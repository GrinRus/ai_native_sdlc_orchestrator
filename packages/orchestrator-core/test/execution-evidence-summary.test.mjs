import assert from "node:assert/strict";
import test from "node:test";

import { buildExecutionEvidenceSummary } from "../src/execution-evidence-summary.mjs";

function group(summary, groupId) {
  return summary.changed_path_groups.find((entry) => entry.group_id === groupId);
}

test("execution evidence classifies scratch-only output as non-passing", () => {
  const summary = buildExecutionEvidenceSummary({
    runId: "scratch-only",
    stepResults: [
      {
        document: {
          run_id: "scratch-only",
          runtime_harness_decision: "repair",
          mission_semantics: {
            changed_paths_after_step: ["scratch-output.txt"],
            non_bootstrap_changed_paths: ["scratch-output.txt"],
            meaningful_changed_paths: [],
          },
        },
      },
    ],
  });

  assert.equal(summary.real_code_change_status, "fail");
  assert.equal(summary.status, "blocked");
  assert.deepEqual(group(summary, "mission-relevant").paths, []);
  assert.deepEqual(group(summary, "scratch-unrelated").paths, ["scratch-output.txt"]);
  assert.match(summary.blockers.join("\n"), /No mission-relevant changed paths/);
});

test("execution evidence blocks runner-owned state leaks inside target checkout", () => {
  const summary = buildExecutionEvidenceSummary({
    runId: "runner-leak",
    stepResults: [
      {
        document: {
          run_id: "runner-leak",
          runtime_harness_decision: "block",
          mission_semantics: {
            changed_paths_after_step: [".qwen/skills/aor/SKILL.md", "source/utils/merge.ts"],
            non_bootstrap_changed_paths: [".qwen/skills/aor/SKILL.md", "source/utils/merge.ts"],
            meaningful_changed_paths: ["source/utils/merge.ts"],
            runner_owned_state_paths: [".qwen/skills/aor/SKILL.md"],
          },
        },
      },
    ],
  });

  assert.equal(summary.status, "blocked");
  assert.equal(summary.real_code_change_status, "fail");
  assert.deepEqual(group(summary, "runner-owned-leak").paths, [".qwen/skills/aor/SKILL.md"]);
  assert.equal(group(summary, "runner-owned-leak").severity, "critical");
  assert.match(summary.blockers.join("\n"), /Runner-owned state/);
});

test("execution evidence highlights mission-relevant paths from required prefixes", () => {
  const summary = buildExecutionEvidenceSummary({
    runId: "mission-prefix",
    requiredPathPrefixes: ["source/", "test/"],
    stepResults: [
      {
        document: {
          run_id: "mission-prefix",
          runtime_harness_decision: "pass",
          mission_semantics: {
            changed_paths_after_step: ["scratch-output.txt", "source/utils/merge.ts", "test/headers.ts"],
            non_bootstrap_changed_paths: ["scratch-output.txt", "source/utils/merge.ts", "test/headers.ts"],
            meaningful_changed_paths: ["scratch-output.txt", "source/utils/merge.ts", "test/headers.ts"],
          },
        },
      },
    ],
  });

  assert.equal(summary.real_code_change_status, "pass");
  assert.deepEqual(group(summary, "mission-relevant").paths, ["source/utils/merge.ts", "test/headers.ts"]);
  assert.deepEqual(group(summary, "scratch-unrelated").paths, ["scratch-output.txt"]);
});

test("execution evidence carries post-run verification status from public reports", () => {
  const summary = buildExecutionEvidenceSummary({
    runId: "verification-status",
    verificationReports: [
      {
        document: {
          report_id: "verification-status.validation.v1",
          status: "pass",
        },
      },
    ],
    stepResults: [
      {
        document: {
          run_id: "verification-status",
          runtime_harness_decision: "pass",
          mission_semantics: {
            changed_paths_after_step: ["source/utils/merge.ts"],
            non_bootstrap_changed_paths: ["source/utils/merge.ts"],
            meaningful_changed_paths: ["source/utils/merge.ts"],
          },
        },
      },
    ],
  });

  assert.equal(summary.post_run_verification_status, "pass");
  assert.equal(summary.real_code_change_status, "pass");
});

test("execution evidence exposes interrupted provider actions through public surfaces", () => {
  const summary = buildExecutionEvidenceSummary({
    runId: "provider-stop",
    providerStepStatus: {
      provider: "qwen",
      adapter: "qwen-code",
      status: "interrupted",
      current_command_label: "external-provider-runner",
      interruption_owner: "operator",
      interruption_reason: "Operator stopped the short smoke after collecting progress evidence.",
      interruption_status: "operator-stopped",
    },
    stepResults: [
      {
        document: {
          run_id: "provider-stop",
          runtime_harness_decision: "block",
          mission_semantics: {
            changed_paths_after_step: ["source/utils/merge.ts"],
            non_bootstrap_changed_paths: ["source/utils/merge.ts"],
            meaningful_changed_paths: ["source/utils/merge.ts"],
          },
        },
      },
    ],
  });

  assert.equal(summary.provider_execution_status, "interrupted");
  assert.equal(summary.provider_interruption_owner, "operator");
  assert.equal(summary.provider_interruption_reason, "Operator stopped the short smoke after collecting progress evidence.");
  assert.equal(summary.provider_interruption_status, "operator-stopped");
  assert.match(summary.blockers.join("\n"), /stopped or interrupted/);
  assert.equal(summary.actions.find((entry) => entry.action_id === "stop_provider").enabled, false);
  assert.equal(summary.actions.find((entry) => entry.action_id === "save_partial_evidence").enabled, true);
  assert.equal(summary.actions.find((entry) => entry.action_id === "diagnose_current_step").command_surface, "manual-live-e2e --prepare-decision --action diagnose");
  assert.equal(summary.actions.find((entry) => entry.action_id === "retry_public_step").enabled, true);
});
