import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LiveE2eControllerStop,
  createLiveE2eStepController,
  isLiveE2eControllerStop,
} from "../live-e2e/lib/step-controller.mjs";

function withTempRoot(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-live-e2e-controller-"));
  try {
    callback(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

test("live E2E step controller persists observation and state before next step", () => {
  withTempRoot((reportsRoot) => {
    const transcriptFile = path.join(reportsRoot, "01-discovery-run.json");
    fs.writeFileSync(transcriptFile, "{}\n", "utf8");
    const controller = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-pass",
      profile: { live_e2e: { flow_range_policy: "delivery_default" } },
      mode: "auto",
    });

    const result = controller.observeStage({
      stage: "discovery",
      stageResult: {
        stage: "discovery",
        status: "pass",
        evidence_refs: [transcriptFile],
        summary: "Discovery passed.",
        started_at: "2026-05-18T00:00:00.000Z",
        finished_at: "2026-05-18T00:00:01.000Z",
        duration_sec: 1,
        missing_evidence: [],
        recommendation: "continue",
      },
      commandResults: [
        {
          label: "discovery-run",
          command_surface: "aor discovery run",
          status: "pass",
          transcript_file: transcriptFile,
          artifact_refs: [transcriptFile],
          exit_code: 0,
        },
      ],
      artifacts: {},
    });

    assert.equal(result.action, "continue");
    assert.equal(fs.existsSync(controller.stateFile), true);
    const state = JSON.parse(fs.readFileSync(controller.stateFile, "utf8"));
    assert.deepEqual(state.completed_steps, ["discovery"]);
    assert.equal(state.current_step, "spec");
    for (const phase of ["plan", "execute", "inspect", "classify", "decide", "persist"]) {
      assert.equal(state.phase_history.some((entry) => entry.step_id === "discovery" && entry.phase === phase), true);
    }
    const [entry] = controller.getStepJournal();
    assert.equal(fs.existsSync(entry.observation_ref), true);
    assert.equal(entry.plan.public_surface, "aor discovery run");
  });
});

test("live E2E step controller blocks skill-agent profiles until operator decision is accepted", () => {
  withTempRoot((reportsRoot) => {
    const controller = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-skill-agent-required",
      profile: {
        live_e2e: {
          flow_range_policy: "delivery_default",
          operator_mode: "skill-agent",
          agent_decision_policy: "required",
          interaction_answer_policy: "agent-required",
          target_write_policy: "aor-runtime-only-before-execution",
        },
      },
      mode: "auto",
    });

    assert.throws(
      () =>
        controller.observeStage({
          stage: "discovery",
          stageResult: { stage: "discovery", status: "pass", evidence_refs: [], summary: "ok" },
          commandResults: [{ label: "discovery-run", command_surface: "aor discovery run", status: "pass" }],
          artifacts: {},
        }),
      (error) => {
        assert.equal(isLiveE2eControllerStop(error), true);
        assert.equal(error.decision.action, "diagnose");
        return true;
      },
    );

    const [entry] = controller.getStepJournal();
    assert.equal(entry.operator_decision_status, "missing");
    assert.equal(typeof entry.agent_decision_request_ref, "string");
    assert.equal(fs.existsSync(entry.agent_decision_request_ref), true);
  });
});

test("live E2E step controller rejects inconsistent skill-agent continue decisions", () => {
  withTempRoot((reportsRoot) => {
    const controller = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-skill-agent-inconsistent",
      profile: {
        live_e2e: {
          flow_range_policy: "delivery_default",
          operator_mode: "skill-agent",
          agent_decision_policy: "required",
          interaction_answer_policy: "agent-required",
          target_write_policy: "aor-runtime-only-before-execution",
        },
      },
      mode: "auto",
    });
    controller.planCommand({ label: "discovery-run", commandSurface: "aor discovery run" });
    const decisionFile = path.join(
      reportsRoot,
      "live-e2e-operator-decision-controller-skill-agent-inconsistent-01-discovery.json",
    );
    fs.writeFileSync(
      decisionFile,
      `${JSON.stringify(
        {
          step_id: "discovery",
          status: "accepted",
          operator_ref: "skill://live-e2e-runner",
          action: "continue",
          semantic_analysis: {
            status: "not_pass",
            judge_source: "skill-agent",
            findings: ["Discovery evidence is incomplete."],
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    assert.throws(
      () =>
        controller.observeStage({
          stage: "discovery",
          stageResult: { stage: "discovery", status: "pass", evidence_refs: [], summary: "ok" },
          commandResults: [{ label: "discovery-run", command_surface: "aor discovery run", status: "pass" }],
          artifacts: {},
        }),
      (error) => {
        assert.equal(isLiveE2eControllerStop(error), true);
        assert.equal(error.decision.action, "block");
        return true;
      },
    );

    const [entry] = controller.getStepJournal();
    assert.equal(entry.operator_decision_status, "rejected");
    assert.equal(entry.decision.action, "block");
    assert.equal(entry.final_step_verdict, "blocked");
  });
});

test("live E2E step controller preserves repeated execution and review iterations", () => {
  withTempRoot((reportsRoot) => {
    const reviewTranscript = path.join(reportsRoot, "01-review-run.json");
    const executionTranscript = path.join(reportsRoot, "02-run-start.json");
    fs.writeFileSync(reviewTranscript, "{}\n", "utf8");
    fs.writeFileSync(executionTranscript, "{}\n", "utf8");
    const controller = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-repair-loop",
      profile: { live_e2e: { flow_range_policy: "delivery_default" } },
      mode: "auto",
    });

    controller.planCommand({ label: "review-run", commandSurface: "aor review run", iteration: 1 });
    const reviewResult = controller.observeStage({
      stage: "review",
      iteration: 1,
      stageResult: { stage: "review", status: "warn", evidence_refs: [reviewTranscript], summary: "repair" },
      commandResults: [
        {
          label: "review-run",
          command_surface: "aor review run",
          status: "warn",
          transcript_file: reviewTranscript,
          artifact_refs: [reviewTranscript],
          exit_code: 0,
        },
      ],
      artifacts: {},
      decisionOverride: {
        action: "retry_public_step",
        reason: "repair iteration requested",
        next_step: "execution",
      },
    });
    assert.equal(reviewResult.action, "retry_public_step");

    controller.planCommand({ label: "run-start", commandSurface: "aor run start", iteration: 2 });
    controller.observeStage({
      stage: "execution",
      iteration: 2,
      stageResult: { stage: "execution", status: "pass", evidence_refs: [executionTranscript], summary: "repaired" },
      commandResults: [
        {
          label: "run-start",
          command_surface: "aor run start",
          status: "pass",
          transcript_file: executionTranscript,
          artifact_refs: [executionTranscript],
          exit_code: 0,
        },
      ],
      artifacts: {},
    });

    const journal = controller.getStepJournal();
    assert.deepEqual(
      journal.map((entry) => [entry.step_id, entry.step_instance_id, entry.iteration]),
      [
        ["review", "review", 1],
        ["execution", "execution#2", 2],
      ],
    );
    assert.equal(journal.every((entry) => fs.existsSync(entry.plan_ref)), true);
    assert.equal(journal.every((entry) => fs.existsSync(entry.inspection_ref)), true);
    assert.equal(journal.every((entry) => fs.existsSync(entry.classification_ref)), true);
  });
});

test("live E2E step controller gates manual mode after one completed step", () => {
  withTempRoot((reportsRoot) => {
    const controller = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-manual",
      profile: { live_e2e: { flow_range_policy: "delivery_default" } },
      mode: "manual",
    });

    assert.throws(
      () =>
        controller.observeStage({
          stage: "discovery",
          stageResult: { stage: "discovery", status: "pass", evidence_refs: [], summary: "ok" },
          commandResults: [{ label: "discovery-run", command_surface: "aor discovery run", status: "pass" }],
          artifacts: {},
        }),
      (error) => {
        assert.equal(error instanceof LiveE2eControllerStop, true);
        assert.equal(isLiveE2eControllerStop(error), true);
        assert.equal(error.decision.action, "continue");
        return true;
      },
    );
    const state = JSON.parse(fs.readFileSync(controller.stateFile, "utf8"));
    assert.deepEqual(state.completed_steps, ["discovery"]);
  });
});

test("live E2E step controller resumes manual state at the next incomplete step", () => {
  withTempRoot((reportsRoot) => {
    const first = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-resume",
      profile: { live_e2e: { flow_range_policy: "delivery_default" } },
      mode: "manual",
    });
    assert.throws(() =>
      first.observeStage({
        stage: "discovery",
        stageResult: { stage: "discovery", status: "pass", evidence_refs: [], summary: "ok" },
        commandResults: [{ label: "discovery-run", command_surface: "aor discovery run", status: "pass" }],
        artifacts: {},
      }),
    );

    const second = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-resume",
      profile: { live_e2e: { flow_range_policy: "delivery_default" } },
      mode: "manual",
    });
    assert.equal(
      second.observeStage({
        stage: "discovery",
        stageResult: { stage: "discovery", status: "pass", evidence_refs: [], summary: "ok" },
        commandResults: [{ label: "discovery-run", command_surface: "aor discovery run", status: "pass" }],
        artifacts: {},
      }).action,
      "continue",
    );
    assert.throws(
      () =>
        second.observeStage({
          stage: "spec",
          stageResult: { stage: "spec", status: "pass", evidence_refs: [], summary: "ok" },
          commandResults: [{ label: "spec-build", command_surface: "aor spec build", status: "pass" }],
          artifacts: {},
        }),
      (error) => {
        assert.equal(isLiveE2eControllerStop(error), true);
        assert.equal(error.decision.action, "continue");
        return true;
      },
    );
    const state = JSON.parse(fs.readFileSync(second.stateFile, "utf8"));
    assert.deepEqual(state.completed_steps, ["discovery", "spec"]);
  });
});

test("live E2E step controller lets terminal manual continue finalize", () => {
  withTempRoot((reportsRoot) => {
    const profile = { live_e2e: { flow_range_policy: "delivery_default" } };
    const prior = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-terminal-manual",
      profile,
      mode: "auto",
    });
    for (const [stage, label] of [
      ["discovery", "discovery-run"],
      ["spec", "spec-build"],
      ["planning", "wave-create"],
      ["handoff", "handoff-approve"],
      ["execution", "run-start"],
      ["review", "review-run"],
      ["qa", "eval-run"],
    ]) {
      prior.observeStage({
        stage,
        stageResult: { stage, status: "pass", evidence_refs: [], summary: "ok" },
        commandResults: [{ label, command_surface: `aor ${stage}`, status: "pass" }],
        artifacts: {},
      });
    }

    const terminal = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-terminal-manual",
      profile,
      mode: "manual",
    });
    const result = terminal.observeStage({
      stage: "delivery",
      stageResult: { stage: "delivery", status: "pass", evidence_refs: [], summary: "ok" },
      commandResults: [{ label: "deliver-prepare", command_surface: "aor deliver prepare", status: "pass" }],
      artifacts: {},
    });

    assert.equal(result.action, "continue");
    const state = JSON.parse(fs.readFileSync(terminal.stateFile, "utf8"));
    assert.deepEqual(state.completed_steps, [
      "discovery",
      "spec",
      "planning",
      "handoff",
      "execution",
      "review",
      "qa",
      "delivery",
    ]);
    assert.equal(state.current_step, null);
  });
});

test("live E2E step controller exposes cached public command results for completed steps", () => {
  withTempRoot((reportsRoot) => {
    const transcriptFile = path.join(reportsRoot, "01-discovery-run.json");
    fs.writeFileSync(
      transcriptFile,
      `${JSON.stringify({
        stdout: JSON.stringify({ analysis_report_file: "analysis.json" }),
        stderr: "",
        parsed_json: { analysis_report_file: "analysis.json" },
        started_at: "2026-05-18T00:00:00.000Z",
        finished_at: "2026-05-18T00:00:01.000Z",
      })}\n`,
      "utf8",
    );
    const first = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-command-cache",
      profile: { live_e2e: { flow_range_policy: "delivery_default" } },
      mode: "auto",
    });
    first.observeStage({
      stage: "discovery",
      stageResult: { stage: "discovery", status: "pass", evidence_refs: [transcriptFile], summary: "ok" },
      commandResults: [
        {
          label: "discovery-run",
          command_surface: "aor discovery run",
          status: "pass",
          transcript_file: transcriptFile,
          artifact_refs: ["analysis.json"],
          exit_code: 0,
        },
      ],
      artifacts: { analysis_report_file: "analysis.json" },
    });

    const second = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-command-cache",
      profile: { live_e2e: { flow_range_policy: "delivery_default" } },
      mode: "manual",
    });
    assert.equal(second.hasPersistedProgress(), true);
    assert.equal(second.shouldUseCachedCommand("discovery-run"), true);
    assert.equal(second.shouldUseCachedCommand("spec-build"), false);
    assert.equal(second.getCachedCommandResult("discovery-run").transcript_file, transcriptFile);
    assert.deepEqual(second.getState().artifacts_snapshot, { analysis_report_file: "analysis.json" });
  });
});

test("live E2E manual resume reuses cached commands for observed steps awaiting decision", () => {
  withTempRoot((reportsRoot) => {
    const transcriptFile = path.join(reportsRoot, "01-run-start.json");
    fs.writeFileSync(
      transcriptFile,
      `${JSON.stringify({
        stdout: JSON.stringify({ routed_step_result_file: "step-result.json" }),
        stderr: "",
        parsed_json: { routed_step_result_file: "step-result.json" },
        started_at: "2026-05-18T00:00:00.000Z",
        finished_at: "2026-05-18T00:00:01.000Z",
      })}\n`,
      "utf8",
    );
    const first = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-observed-command-cache",
      profile: {
        live_e2e: {
          flow_range_policy: "delivery_default",
          operator_mode: "skill-agent",
          agent_decision_policy: "required",
          interaction_answer_policy: "agent-required",
        },
      },
      mode: "manual",
    });
    assert.throws(() =>
      first.observeStage({
        stage: "execution",
        stageResult: { stage: "execution", status: "pass", evidence_refs: [transcriptFile], summary: "ok" },
        commandResults: [
          {
            label: "run-start",
            command_surface: "aor run start",
            status: "pass",
            transcript_file: transcriptFile,
            artifact_refs: ["step-result.json"],
            exit_code: 0,
          },
        ],
        artifacts: { routed_step_result_file: "step-result.json" },
      }),
    );

    const manualResume = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-observed-command-cache",
      profile: {
        live_e2e: {
          flow_range_policy: "delivery_default",
          operator_mode: "skill-agent",
          agent_decision_policy: "required",
          interaction_answer_policy: "agent-required",
        },
      },
      mode: "manual",
    });
    assert.equal(manualResume.shouldUseCachedCommand("run-start"), true);
    assert.equal(manualResume.getCachedCommandResult("run-start").transcript_file, transcriptFile);

    const autoResume = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-observed-command-cache",
      profile: {
        live_e2e: {
          flow_range_policy: "delivery_default",
          operator_mode: "skill-agent",
          agent_decision_policy: "required",
          interaction_answer_policy: "agent-required",
        },
      },
      mode: "auto",
    });
    assert.equal(autoResume.shouldUseCachedCommand("run-start"), false);
  });
});

test("live E2E step controller does not skip unresolved persisted decisions on resume", () => {
  withTempRoot((reportsRoot) => {
    const first = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-unresolved-resume",
      profile: { live_e2e: { flow_range_policy: "delivery_default" } },
      mode: "auto",
    });
    assert.throws(
      () =>
        first.observeStage({
          stage: "spec",
          stageResult: {
            stage: "spec",
            status: "pass",
            evidence_refs: [],
            summary: "Spec requested an answer.",
          },
          commandResults: [
            {
              label: "spec-build",
              command_surface: "aor spec build",
              status: "pass",
              interactive_continuation: {
                requested: true,
                status: "requested",
                interaction_id: "question-1",
              },
            },
          ],
          artifacts: {},
        }),
      (error) => {
        assert.equal(isLiveE2eControllerStop(error), true);
        assert.equal(error.decision.action, "answer");
        return true;
      },
    );

    const second = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-unresolved-resume",
      profile: { live_e2e: { flow_range_policy: "delivery_default" } },
      mode: "auto",
    });
    assert.throws(
      () =>
        second.observeStage({
          stage: "spec",
          stageResult: {
            stage: "spec",
            status: "pass",
            evidence_refs: [],
            summary: "Spec still waits for an answer.",
          },
          commandResults: [
            {
              label: "spec-build",
              command_surface: "aor spec build",
              status: "pass",
              interactive_continuation: {
                requested: true,
                status: "requested",
                interaction_id: "question-1",
              },
            },
          ],
          artifacts: {},
        }),
      (error) => {
        assert.equal(isLiveE2eControllerStop(error), true);
        assert.equal(error.decision.action, "answer");
        return true;
      },
    );
    const state = JSON.parse(fs.readFileSync(second.stateFile, "utf8"));
    assert.deepEqual(state.completed_steps, ["spec"]);
    assert.equal(state.current_step, "spec");
    assert.equal(state.pending_decision.action, "answer");
  });
});

test("live E2E step controller continues after a persisted interaction resumes", () => {
  withTempRoot((reportsRoot) => {
    const controller = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-interaction-resumed",
      profile: { live_e2e: { flow_range_policy: "delivery_default" } },
      mode: "auto",
    });
    const result = controller.observeStage({
      stage: "spec",
      stageResult: {
        stage: "spec",
        status: "pass",
        evidence_refs: [],
        summary: "Spec answer resumed.",
      },
      commandResults: [
        {
          label: "spec-build",
          command_surface: "aor spec build",
          status: "pass",
          interactive_continuation: {
            requested: true,
            status: "resumed",
            interaction_id: "question-1",
            answer_audit_refs: ["answer-audit://question-1"],
          },
        },
      ],
      artifacts: {},
    });
    assert.equal(result.action, "continue");
    const [entry] = controller.getStepJournal();
    assert.equal(entry.decision.action, "continue");
    assert.equal(entry.resume_result.status, "resumed");
    assert.equal(entry.final_step_verdict, "resumed");
  });
});

test("live E2E step controller blocks resumed interactions without answer audit evidence", () => {
  withTempRoot((reportsRoot) => {
    const controller = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-interaction-resumed-missing-audit",
      profile: { live_e2e: { flow_range_policy: "delivery_default" } },
      mode: "auto",
    });

    assert.throws(
      () =>
        controller.observeStage({
          stage: "spec",
          stageResult: {
            stage: "spec",
            status: "pass",
            evidence_refs: [],
            summary: "Spec answer resumed without audit evidence.",
          },
          commandResults: [
            {
              label: "spec-build",
              command_surface: "aor spec build",
              status: "pass",
              interactive_continuation: {
                requested: true,
                status: "resumed",
                interaction_id: "question-1",
                answer_audit_refs: [],
              },
            },
          ],
          artifacts: {},
        }),
      (error) => {
        assert.equal(isLiveE2eControllerStop(error), true);
        assert.equal(error.decision.action, "block");
        return true;
      },
    );
    const [entry] = controller.getStepJournal();
    assert.equal(entry.decision.action, "block");
    assert.equal(entry.final_step_verdict, "blocked");
    assert.deepEqual(entry.deterministic_analysis.missing_evidence, ["answer_audit_refs"]);
  });
});

test("live E2E step controller stops on diagnose decisions", () => {
  withTempRoot((reportsRoot) => {
    const controller = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-diagnose",
      profile: { live_e2e: { flow_range_policy: "delivery_default" } },
      mode: "auto",
    });

    assert.throws(
      () =>
        controller.observeStage({
          stage: "spec",
          stageResult: {
            stage: "spec",
            status: "fail",
            evidence_refs: [],
            summary: "Spec evidence missing.",
            missing_evidence: ["stage-evidence"],
            recommendation: "inspect stage evidence refs and command transcripts",
          },
          commandResults: [{ label: "spec-build", command_surface: "aor spec build", status: "fail", exit_code: 1 }],
          artifacts: {},
        }),
      (error) => {
        assert.equal(isLiveE2eControllerStop(error), true);
        assert.equal(error.decision.action, "diagnose");
        return true;
      },
    );
    const state = JSON.parse(fs.readFileSync(controller.stateFile, "utf8"));
    assert.deepEqual(state.completed_steps, ["spec"]);
    assert.equal(state.current_step, "spec");
    assert.equal(state.pending_decision.action, "diagnose");
  });
});
