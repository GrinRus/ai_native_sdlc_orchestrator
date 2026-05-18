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
