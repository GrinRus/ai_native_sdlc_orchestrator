import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LiveE2eControllerStop,
  createLiveE2eStepController,
  findLiveE2eCommandByPreferredLabel,
  isLiveE2eControllerStopInProgress,
  isLiveE2eControllerStop,
} from "../live-e2e/lib/step-controller.mjs";
import { prepareOperatorDecisionArtifact } from "../live-e2e/lib/decision-helper.mjs";
import { validateContractDocument } from "../../packages/contracts/src/index.mjs";

function withTempRoot(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-live-e2e-controller-"));
  try {
    callback(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function normalizeLiveE2eId(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function defaultInspectedEvidenceRefs(reportsRoot, runId, sequence, stepInstanceId, extraRefs = []) {
  const normalizedRunId = normalizeLiveE2eId(runId);
  const normalizedStep = normalizeLiveE2eId(stepInstanceId);
  const paddedSequence = String(sequence).padStart(2, "0");
  return [...new Set([
    path.join(reportsRoot, `live-e2e-step-plan-${normalizedRunId}-${paddedSequence}-${normalizedStep}.json`),
    path.join(reportsRoot, `live-e2e-agent-decision-request-${normalizedRunId}-${paddedSequence}-${normalizedStep}.json`),
    path.join(reportsRoot, `live-e2e-step-inspection-${normalizedRunId}-${paddedSequence}-${normalizedStep}.json`),
    path.join(reportsRoot, `live-e2e-step-classification-${normalizedRunId}-${paddedSequence}-${normalizedStep}.json`),
    ...extraRefs,
  ].filter(Boolean))];
}

function writeSkillAgentDecision(reportsRoot, runId, sequence, stepInstanceId, options = {}) {
  const stepId = stepInstanceId.split("#")[0];
  const inspectedEvidenceRefs = defaultInspectedEvidenceRefs(
    reportsRoot,
    runId,
    sequence,
    stepInstanceId,
    options.inspectedEvidenceRefs ?? [],
  );
  const decisionFile = path.join(
    reportsRoot,
    `live-e2e-operator-decision-${runId}-${String(sequence).padStart(2, "0")}-${stepInstanceId.replace("#", "-")}.json`,
  );
  fs.writeFileSync(
    decisionFile,
    `${JSON.stringify(
      {
        step_id: stepId,
        step_instance_id: stepInstanceId,
        status: "accepted",
        operator_ref: "skill://live-e2e-runner",
        action: options.action ?? "continue",
        next_step: options.nextStep,
        reason: options.reason ?? "Skill-agent accepted public evidence.",
        inspected_evidence_refs: inspectedEvidenceRefs,
        evidence_refs: options.evidenceRefs ?? inspectedEvidenceRefs,
        semantic_analysis: {
          status: options.semanticStatus ?? "pass",
          judge_source: "skill-agent",
          findings: options.findings ?? [],
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return decisionFile;
}

test("live E2E step controller persists observation and state before next step", () => {
  withTempRoot((reportsRoot) => {
    const transcriptFile = path.join(reportsRoot, "01-discovery-run.json");
    const analysisFile = path.join(reportsRoot, "analysis.json");
    fs.writeFileSync(transcriptFile, "{}\n", "utf8");
    const controller = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-pass",
      profile: { live_e2e: { flow_range_policy: "delivery_default" } },
      mode: "auto",
    });
    writeSkillAgentDecision(reportsRoot, "controller-pass", 1, "discovery", {
      nextStep: "spec",
      inspectedEvidenceRefs: [transcriptFile],
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

test("live E2E product-change steps materialize accepted step-quality report before continuation", () => {
  withTempRoot((reportsRoot) => {
    const transcriptFile = path.join(reportsRoot, "01-discovery-run.json");
    fs.writeFileSync(transcriptFile, "{}\n", "utf8");
    const controller = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-product-step-quality",
      profile: {
        profile_id: "live-e2e.test.product-step-quality",
        target_catalog_id: "httpx",
        feature_mission_id: "httpx-timeout-transport-regression",
        live_e2e: { flow_range_policy: "delivery_default" },
      },
      mode: "auto",
    });
    writeSkillAgentDecision(reportsRoot, "controller-product-step-quality", 1, "discovery", {
      nextStep: "spec",
      inspectedEvidenceRefs: [transcriptFile],
    });
    const artifacts = {
      target_catalog_id: "httpx",
      feature_mission_id: "httpx-timeout-transport-regression",
      feature_size: "medium",
      mission_class: "product-change",
    };

    const result = controller.observeStage({
      stage: "discovery",
      stageResult: {
        stage: "discovery",
        status: "pass",
        evidence_refs: [transcriptFile],
        summary: "Discovery passed.",
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
      artifacts,
    });

    assert.equal(result.action, "continue");
    assert.equal(artifacts.live_e2e_step_quality_assessment_report_files.length, 1);
    const [reportFile] = artifacts.live_e2e_step_quality_assessment_report_files;
    assert.equal(fs.existsSync(reportFile), true);
    const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
    assert.equal(report.feature_size, "medium");
    assert.equal(report.mission_class, "product-change");
    assert.equal(report.status, "accepted");
    assert.equal(report.decision, "continue");
    assert.equal(report.source_agent_decision_request_file.endsWith("discovery.json"), true);
    assert.equal(report.source_operator_decision_file.endsWith("discovery.json"), true);
    const validation = validateContractDocument({
      family: "live-e2e-step-quality-assessment-report",
      document: report,
      source: reportFile,
    });
    assert.equal(validation.ok, true);
    const [entry] = controller.getStepJournal();
    assert.equal(entry.step_quality_assessment_ref, reportFile);
    const state = JSON.parse(fs.readFileSync(controller.stateFile, "utf8"));
    assert.deepEqual(state.step_quality_assessment_refs, [reportFile]);
    assert.ok(state.evidence_refs.includes(reportFile));
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

test("live E2E decision helper prepares accepted continue decisions with all required refs", () => {
  withTempRoot((reportsRoot) => {
    const transcriptFile = path.join(reportsRoot, "11-discovery-run.json");
    const analysisFile = path.join(reportsRoot, "discovery-analysis.json");
    fs.writeFileSync(transcriptFile, "{}\n", "utf8");
    fs.writeFileSync(analysisFile, "{}\n", "utf8");
    const runId = "controller-decision-helper";
    const profile = {
      live_e2e: {
        flow_range_policy: "delivery_default",
        operator_mode: "skill-agent",
        agent_decision_policy: "required",
        interaction_answer_policy: "agent-required",
        target_write_policy: "aor-runtime-only-before-execution",
      },
    };
    const controller = createLiveE2eStepController({
      reportsRoot,
      runId,
      profile,
      mode: "manual",
    });
    controller.planCommand({ label: "discovery-run", commandSurface: "aor discovery run" });

    assert.throws(
      () =>
        controller.observeStage({
          stage: "discovery",
          stageResult: {
            stage: "discovery",
            status: "pass",
            evidence_refs: [analysisFile],
            summary: "Discovery passed.",
          },
          commandResults: [
            {
              label: "discovery-run",
              command_surface: "aor discovery run",
              status: "pass",
              transcript_file: transcriptFile,
              artifact_refs: [analysisFile],
              exit_code: 0,
            },
          ],
          artifacts: {},
        }),
      (error) => {
        assert.equal(isLiveE2eControllerStop(error), true);
        assert.equal(error.decision.action, "diagnose");
        return true;
      },
    );

    const [pendingEntry] = controller.getStepJournal();
    const decisionRequest = JSON.parse(fs.readFileSync(pendingEntry.agent_decision_request_ref, "utf8"));
    const summary = prepareOperatorDecisionArtifact({
      requestFile: pendingEntry.agent_decision_request_ref,
      action: "continue",
      findings: ["Required public evidence refs were inspected."],
    });
    const preparedDecision = JSON.parse(fs.readFileSync(summary.output_ref, "utf8"));
    assert.deepEqual(preparedDecision.inspected_evidence_refs, decisionRequest.decision_rubric.required_evidence_refs);
    assert.deepEqual(summary.validation_preview.missing_required_inspected_evidence_refs, []);
    assert.equal(summary.validation_preview.rejection_risks.length, 0);

    const resumed = createLiveE2eStepController({
      reportsRoot,
      runId,
      profile,
      mode: "auto",
    });
    const applied = resumed.applyPendingOperatorDecision();
    assert.equal(applied.applied, true);
    assert.equal(applied.action, "continue");
    const [acceptedEntry] = resumed.getStepJournal();
    assert.equal(acceptedEntry.operator_decision_status, "accepted");
    assert.equal(acceptedEntry.operator_decision_rejection_reason, undefined);
    assert.equal(acceptedEntry.decision.action, "continue");
    assert.deepEqual(acceptedEntry.inspected_evidence_refs, decisionRequest.decision_rubric.required_evidence_refs);
  });
});

test("live E2E decision helper preserves AOR operator UI evidence refs in the draft", () => {
  withTempRoot((reportsRoot) => {
    const requestFile = path.join(reportsRoot, "live-e2e-agent-decision-request-ui.json");
    const expectedDecisionFile = path.join(reportsRoot, "live-e2e-operator-decision-ui.json");
    const requiredRefs = [
      path.join(reportsRoot, "live-e2e-step-plan-ui.json"),
      path.join(reportsRoot, "live-e2e-agent-decision-request-ui.json"),
      path.join(reportsRoot, "live-e2e-step-inspection-ui.json"),
    ];
    const aorOperatorUiRefs = [
      path.join(reportsRoot, "guided-web-dom.json"),
      path.join(reportsRoot, "guided-web-accessibility.json"),
      path.join(reportsRoot, "guided-web-screenshot.png"),
    ];
    for (const aorOperatorUiRef of aorOperatorUiRefs) {
      fs.writeFileSync(aorOperatorUiRef, "{}\n", "utf8");
    }
    fs.writeFileSync(
      requestFile,
      `${JSON.stringify(
        {
          request_id: "ui.operator-decision-request",
          run_id: "ui",
          step_id: "learning",
          step_instance_id: "learning",
          iteration: 1,
          operator_context: { operator_ref: "skill://live-e2e-runner" },
          deterministic_analysis: { status: "pass" },
          decision_rubric: {
            required_evidence_refs: requiredRefs,
            aor_operator_ui_evidence_refs: aorOperatorUiRefs,
          },
          operator_decision_expected_ref: expectedDecisionFile,
          expected_response_shape: {
            action: "continue|frontend_interact|diagnose|block",
            inspected_evidence_refs: requiredRefs,
            evidence_refs: requiredRefs,
            ui_ux_analysis: {
              status: "pass|warn|not_pass|blocked",
              task_outcome: "pass|warn|not_pass|blocked",
              findings: [],
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    fs.writeFileSync(expectedDecisionFile, "{}\n", "utf8");

    const summary = prepareOperatorDecisionArtifact({
      requestFile,
      action: "continue",
      findings: ["Frontend proof evidence inspected."],
    });
    const preparedDecision = JSON.parse(fs.readFileSync(summary.output_ref, "utf8"));
    assert.deepEqual(preparedDecision.inspected_evidence_refs, [...requiredRefs, ...aorOperatorUiRefs]);
    for (const aorOperatorUiRef of aorOperatorUiRefs) {
      assert.equal(preparedDecision.evidence_refs.includes(aorOperatorUiRef), true);
      assert.equal(preparedDecision.aor_operator_ui_evidence_refs.includes(aorOperatorUiRef), true);
      assert.equal(preparedDecision.ui_ux_analysis.aor_operator_ui_evidence_refs.includes(aorOperatorUiRef), true);
    }
    const legacyEvidenceField = ["frontend", "evidence", "refs"].join("_");
    assert.equal(preparedDecision[legacyEvidenceField], undefined);
    assert.equal(preparedDecision.ui_ux_analysis[legacyEvidenceField], undefined);
    assert.deepEqual(summary.validation_preview.missing_aor_operator_ui_evidence_refs, []);
  });
});

test("live E2E decision helper hydrates late browser-task proof refs", () => {
  withTempRoot((reportsRoot) => {
    const requestFile = path.join(reportsRoot, "live-e2e-agent-decision-request-ui-late-proof.json");
    const expectedDecisionFile = path.join(reportsRoot, "live-e2e-operator-decision-ui-late-proof.json");
    const requiredRefs = [
      requestFile,
      path.join(reportsRoot, "live-e2e-step-inspection-ui-late-proof.json"),
    ];
    const webSmokeFile = path.join(reportsRoot, "installed-user-guided-web-smoke-run.json");
    const browserProofRequestFile = path.join(reportsRoot, "installed-user-guided-browser-task-proof-request-run.json");
    const browserProofFile = path.join(reportsRoot, "installed-user-guided-browser-task-proof-run.json");
    const screenshotFile = path.join(reportsRoot, "installed-user-guided-browser-task-proof-run.png");
    const htmlFile = path.join(reportsRoot, "installed-user-guided-web-smoke-run.html");
    const domFile = path.join(reportsRoot, "installed-user-guided-web-smoke-dom-run.json");
    const accessibilityFile = path.join(reportsRoot, "installed-user-guided-web-smoke-accessibility-run.json");
    const visualFile = path.join(reportsRoot, "installed-user-guided-web-smoke-visual-guardrail-run.json");
    fs.writeFileSync(screenshotFile, "png", "utf8");
    for (const evidenceFile of [htmlFile, domFile, accessibilityFile, visualFile]) {
      fs.writeFileSync(evidenceFile, "{}", "utf8");
    }
    fs.writeFileSync(
      browserProofRequestFile,
      `${JSON.stringify(
        {
          expected_browser_task_proof_file: browserProofFile,
          expected_rendered_html_file: htmlFile,
          expected_dom_snapshot_file: domFile,
          expected_accessibility_summary_file: accessibilityFile,
          expected_visual_guardrail_file: visualFile,
          evidence_refs: [htmlFile, domFile, accessibilityFile, visualFile],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    fs.writeFileSync(
      browserProofFile,
      `${JSON.stringify(
        {
          status: "pass",
          screenshot_files: [screenshotFile],
          task_outcome: { status: "pass", findings: [] },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    fs.writeFileSync(
      webSmokeFile,
      `${JSON.stringify(
        {
          browser_task_proof_request_file: browserProofRequestFile,
          browser_task_proof_file: null,
          task_outcome: { status: "not_pass", findings: ["browser-task-proof requires skill-agent browser evidence."] },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    fs.writeFileSync(
      requestFile,
      `${JSON.stringify(
        {
          request_id: "ui-late-proof.operator-decision-request",
          run_id: "ui-late-proof",
          step_id: "learning",
          step_instance_id: "learning",
          iteration: 1,
          operator_context: { operator_ref: "skill://live-e2e-runner" },
          deterministic_analysis: { status: "pass" },
          decision_rubric: {
            required_evidence_refs: requiredRefs,
            aor_operator_ui_evidence_refs: [webSmokeFile],
          },
          operator_decision_expected_ref: expectedDecisionFile,
          expected_response_shape: {
            action: "continue|frontend_interact|diagnose|block",
            inspected_evidence_refs: requiredRefs,
            evidence_refs: requiredRefs,
            ui_ux_analysis: {
              status: "pass|warn|not_pass|blocked",
              task_outcome: "pass|warn|not_pass|blocked",
              findings: [],
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const summary = prepareOperatorDecisionArtifact({
      requestFile,
      action: "continue",
    });
    const preparedDecision = JSON.parse(fs.readFileSync(summary.output_ref, "utf8"));
    for (const expectedRef of [
      webSmokeFile,
      browserProofRequestFile,
      browserProofFile,
      screenshotFile,
      htmlFile,
      domFile,
      accessibilityFile,
      visualFile,
    ]) {
      assert.equal(preparedDecision.inspected_evidence_refs.includes(expectedRef), true);
      assert.equal(preparedDecision.evidence_refs.includes(expectedRef), true);
      assert.equal(preparedDecision.aor_operator_ui_evidence_refs.includes(expectedRef), true);
      assert.equal(preparedDecision.ui_ux_analysis.aor_operator_ui_evidence_refs.includes(expectedRef), true);
    }
    const legacyEvidenceField = ["frontend", "evidence", "refs"].join("_");
    assert.equal(preparedDecision[legacyEvidenceField], undefined);
    assert.equal(preparedDecision.ui_ux_analysis[legacyEvidenceField], undefined);
    assert.equal(summary.aor_operator_ui_evidence_ref_count >= 8, true);
    assert.deepEqual(summary.validation_preview.missing_aor_operator_ui_evidence_refs, []);
  });
});

test("live E2E decision helper rejects continue when late browser-task proof is missing", () => {
  withTempRoot((reportsRoot) => {
    const requestFile = path.join(reportsRoot, "live-e2e-agent-decision-request-ui-missing-late-proof.json");
    const expectedDecisionFile = path.join(
      reportsRoot,
      "live-e2e-operator-decision-ui-missing-late-proof.json",
    );
    const requiredRefs = [
      requestFile,
      path.join(reportsRoot, "live-e2e-step-inspection-ui-missing-late-proof.json"),
    ];
    const webSmokeFile = path.join(reportsRoot, "installed-user-guided-web-smoke-run.json");
    const browserProofRequestFile = path.join(reportsRoot, "installed-user-guided-browser-task-proof-request-run.json");
    const browserProofFile = path.join(reportsRoot, "installed-user-guided-browser-task-proof-run.json");
    const htmlFile = path.join(reportsRoot, "installed-user-guided-web-smoke-run.html");
    const domFile = path.join(reportsRoot, "installed-user-guided-web-smoke-dom-run.json");
    const accessibilityFile = path.join(reportsRoot, "installed-user-guided-web-smoke-accessibility-run.json");
    const visualFile = path.join(reportsRoot, "installed-user-guided-web-smoke-visual-guardrail-run.json");
    for (const evidenceFile of [htmlFile, domFile, accessibilityFile, visualFile]) {
      fs.writeFileSync(evidenceFile, "{}\n", "utf8");
    }
    fs.writeFileSync(
      browserProofRequestFile,
      `${JSON.stringify(
        {
          expected_browser_task_proof_file: browserProofFile,
          expected_rendered_html_file: htmlFile,
          expected_dom_snapshot_file: domFile,
          expected_accessibility_summary_file: accessibilityFile,
          expected_visual_guardrail_file: visualFile,
          evidence_refs: [htmlFile, domFile, accessibilityFile, visualFile],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    fs.writeFileSync(
      webSmokeFile,
      `${JSON.stringify(
        {
          browser_task_proof_request_file: browserProofRequestFile,
          browser_task_proof_file: null,
          task_outcome: { status: "not_pass", findings: ["browser-task-proof requires skill-agent browser evidence."] },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    fs.writeFileSync(
      requestFile,
      `${JSON.stringify(
        {
          request_id: "ui-missing-late-proof.operator-decision-request",
          run_id: "ui-missing-late-proof",
          step_id: "learning",
          step_instance_id: "learning",
          iteration: 1,
          operator_context: { operator_ref: "skill://live-e2e-runner" },
          deterministic_analysis: { status: "pass" },
          decision_rubric: {
            required_evidence_refs: requiredRefs,
            aor_operator_ui_evidence_refs: [webSmokeFile],
          },
          operator_decision_expected_ref: expectedDecisionFile,
          expected_response_shape: {
            action: "continue|frontend_interact|diagnose|block",
            inspected_evidence_refs: requiredRefs,
            evidence_refs: requiredRefs,
            ui_ux_analysis: {
              status: "pass|warn|not_pass|blocked",
              task_outcome: "pass|warn|not_pass|blocked",
              findings: [],
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const summary = prepareOperatorDecisionArtifact({
      requestFile,
      action: "continue",
    });
    assert.equal(summary.status, "rejected");
    assert.equal(fs.existsSync(summary.output_ref), false);
    assert.equal(summary.validation_preview.missing_aor_operator_ui_evidence_refs.includes(browserProofFile), true);
    assert.equal(
      summary.validation_preview.rejection_risks.includes("Decision is missing required AOR operator UI evidence refs."),
      true,
    );
    assert.equal(summary.decision_preview.inspected_evidence_refs.includes(browserProofFile), false);
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
          inspected_evidence_refs: defaultInspectedEvidenceRefs(
            reportsRoot,
            "controller-skill-agent-inconsistent",
            1,
            "discovery",
          ),
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
    assert.match(
      entry.operator_decision_rejection_reason,
      /semantic status 'not_pass'/,
    );
    assert.match(entry.decision.reason, /semantic status 'not_pass'/);
    assert.match(entry.semantic_analysis.findings.join("\n"), /semantic status 'not_pass'/);
  });
});

test("live E2E step controller does not require non-materialized source doc refs in operator decisions", () => {
  withTempRoot((reportsRoot) => {
    const transcriptFile = path.join(reportsRoot, "11-discovery-run.json");
    const analysisFile = path.join(reportsRoot, "discovery-research-report.json");
    fs.writeFileSync(transcriptFile, "{}\n", "utf8");
    fs.writeFileSync(analysisFile, "{}\n", "utf8");
    const runId = "controller-doc-ref-filter";
    const controller = createLiveE2eStepController({
      reportsRoot,
      runId,
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
    writeSkillAgentDecision(reportsRoot, runId, 1, "discovery", {
      nextStep: "spec",
      inspectedEvidenceRefs: [transcriptFile, analysisFile],
    });

    const result = controller.observeStage({
      stage: "discovery",
      stageResult: {
        stage: "discovery",
        status: "pass",
        evidence_refs: [analysisFile, "docs/contracts/discovery-research-report.md"],
        summary: "Discovery passed.",
      },
      commandResults: [
        {
          label: "discovery-run",
          command_surface: "aor discovery run",
          status: "pass",
          transcript_file: transcriptFile,
          artifact_refs: [analysisFile, "docs/architecture/12-orchestrator-operating-model.md"],
          exit_code: 0,
        },
      ],
      artifacts: {},
    });

    assert.equal(result.action, "continue");
    const [entry] = controller.getStepJournal();
    assert.equal(entry.operator_decision_status, "accepted");
    assert.equal(entry.inspected_evidence_refs.includes(analysisFile), true);
    assert.equal(entry.inspected_evidence_refs.some((ref) => ref.startsWith("docs/")), false);
    const request = JSON.parse(fs.readFileSync(entry.agent_decision_request_ref, "utf8"));
    assert.equal(entry.artifact_refs.some((ref) => ref.startsWith("docs/")), false);
    assert.equal(request.artifact_refs.some((ref) => ref.startsWith("docs/")), false);
    assert.equal(
      request.decision_rubric.required_evidence_refs.some((ref) => ref.startsWith("docs/")),
      false,
    );
  });
});

test("live E2E step controller rejects skill-agent continue when deterministic checks fail", () => {
  withTempRoot((reportsRoot) => {
    const controller = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-skill-agent-deterministic-fail",
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
    controller.planCommand({ label: "run-start", commandSurface: "aor run start" });
    const decisionFile = path.join(
      reportsRoot,
      "live-e2e-operator-decision-controller-skill-agent-deterministic-fail-01-execution.json",
    );
    fs.writeFileSync(
      decisionFile,
      `${JSON.stringify(
        {
          step_id: "execution",
          status: "accepted",
          operator_ref: "skill://live-e2e-runner",
          action: "continue",
          inspected_evidence_refs: defaultInspectedEvidenceRefs(
            reportsRoot,
            "controller-skill-agent-deterministic-fail",
            1,
            "execution",
          ),
          semantic_analysis: {
            status: "pass",
            judge_source: "skill-agent",
            findings: [],
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
          stage: "execution",
          stageResult: {
            stage: "execution",
            status: "not_pass",
            evidence_refs: [],
            summary: "Run start did not materialize routed execution evidence.",
          },
          commandResults: [{ label: "run-start", command_surface: "aor run start", status: "pass" }],
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

test("live E2E step controller marks execution not_pass when post-run verification fails", () => {
  withTempRoot((reportsRoot) => {
    const controller = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-execution-post-run-fail",
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
    controller.planCommand({ label: "run-start", commandSurface: "aor run start" });

    assert.throws(
      () =>
        controller.observeStage({
          stage: "execution",
          stageResult: {
            stage: "execution",
            status: "pass",
            evidence_refs: [],
            summary: "Run start completed.",
          },
          commandResults: [{ label: "run-start", command_surface: "aor run start", status: "pass", exit_code: 0 }],
          artifacts: {
            post_run_verify_status: "fail",
            post_run_verify_summary_file: path.join(reportsRoot, "verify-summary-post-run-primary.json"),
          },
        }),
      (error) => {
        assert.equal(isLiveE2eControllerStop(error), true);
        assert.equal(error.decision.action, "diagnose");
        return true;
      },
    );

    const [entry] = controller.getStepJournal();
    assert.equal(entry.deterministic_analysis.status, "not_pass");
    assert.equal(entry.deterministic_analysis.recommendation, "diagnose");
    assert.equal(entry.operator_decision_status, "missing");
    assert.equal(entry.final_step_verdict, "blocked");
    assert.match(entry.semantic_analysis.findings.join("\n"), /post-run verification reported 'fail'/);
    const decisionRequest = JSON.parse(fs.readFileSync(entry.agent_decision_request_ref, "utf8"));
    assert.equal(decisionRequest.deterministic_analysis.recommendation, "diagnose");
  });
});

test("live E2E step controller rejects UI-capable decisions without AOR operator UI evidence refs", () => {
  withTempRoot((reportsRoot) => {
    const summaryFile = path.join(reportsRoot, "web-smoke.json");
    const htmlFile = path.join(reportsRoot, "web-smoke.html");
    const domFile = path.join(reportsRoot, "web-dom.json");
    const accessibilityFile = path.join(reportsRoot, "web-accessibility.json");
    const screenshotFile = path.join(reportsRoot, "web-screenshot.svg");
    for (const file of [summaryFile, htmlFile, domFile, accessibilityFile, screenshotFile]) {
      fs.writeFileSync(file, "{}\n", "utf8");
    }
    const controller = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-ui-evidence",
      profile: {
        live_e2e: {
          flow_range_policy: "full_lifecycle",
          frontend_capability: "browser-task-proof",
          operator_mode: "skill-agent",
          agent_decision_policy: "required",
          interaction_answer_policy: "agent-required",
        },
      },
      mode: "auto",
    });
    controller.planCommand({ label: "learning-handoff", commandSurface: "aor learning handoff" });
    const decisionFile = path.join(
      reportsRoot,
      "live-e2e-operator-decision-controller-ui-evidence-01-learning.json",
    );
    fs.writeFileSync(
      decisionFile,
      `${JSON.stringify(
        {
          step_id: "learning",
          status: "accepted",
          operator_ref: "skill://live-e2e-runner",
          action: "continue",
          semantic_analysis: {
            status: "pass",
            judge_source: "skill-agent",
            findings: [],
          },
          inspected_evidence_refs: defaultInspectedEvidenceRefs(reportsRoot, "controller-ui-evidence", 1, "learning", [
            summaryFile,
            htmlFile,
            domFile,
            accessibilityFile,
            screenshotFile,
          ]),
          evidence_refs: [summaryFile],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    assert.throws(
      () =>
        controller.observeStage({
          stage: "learning",
          stageResult: { stage: "learning", status: "pass", evidence_refs: [summaryFile], summary: "learning ok" },
          commandResults: [{ label: "learning-handoff", command_surface: "aor learning handoff", status: "pass" }],
          artifacts: {
            guided_web_smoke_summary_file: summaryFile,
            guided_web_smoke_html_file: htmlFile,
            guided_web_dom_snapshot_file: domFile,
            guided_web_accessibility_summary_file: accessibilityFile,
            guided_web_screenshot_files: [screenshotFile],
          },
        }),
      (error) => {
        assert.equal(isLiveE2eControllerStop(error), true);
        assert.equal(error.decision.action, "block");
        return true;
      },
    );

    const [entry] = controller.getStepJournal();
    assert.equal(entry.operator_decision_status, "rejected");
    assert.match(entry.semantic_analysis.findings.join("\n"), /AOR operator UI evidence refs/);
    assert.match(entry.operator_decision_rejection_reason, /AOR operator UI evidence refs/);
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
    writeSkillAgentDecision(reportsRoot, "controller-repair-loop", 1, "review", {
      action: "retry_public_step",
      semanticStatus: "warn",
      nextStep: "execution",
      inspectedEvidenceRefs: [reviewTranscript],
    });
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
    writeSkillAgentDecision(reportsRoot, "controller-repair-loop", 3, "execution#2", {
      nextStep: "qa",
      inspectedEvidenceRefs: [executionTranscript],
    });
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

    const resumed = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-repair-loop",
      profile: { live_e2e: { flow_range_policy: "delivery_default" } },
      mode: "auto",
    });
    assert.equal(resumed.shouldUseCachedCommand("review-run", 1), true);
    assert.equal(resumed.shouldUseCachedCommand("run-start", 2), true);
  });
});

test("live E2E auto resume reuses cached setup commands after persisted progress", () => {
  withTempRoot((reportsRoot) => {
    const setupTranscript = path.join(reportsRoot, "01-guided-doctor.json");
    const discoveryTranscript = path.join(reportsRoot, "02-discovery-run.json");
    fs.writeFileSync(setupTranscript, "{}\n", "utf8");
    fs.writeFileSync(discoveryTranscript, "{}\n", "utf8");
    const controller = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-setup-cache",
      profile: { live_e2e: { flow_range_policy: "delivery_default" } },
      mode: "auto",
    });

    writeSkillAgentDecision(reportsRoot, "controller-setup-cache", 1, "discovery", {
      nextStep: "spec",
      inspectedEvidenceRefs: [discoveryTranscript],
    });
    controller.observeStage({
      stage: "discovery",
      stageResult: {
        stage: "discovery",
        status: "pass",
        evidence_refs: [discoveryTranscript],
        summary: "Discovery passed.",
      },
      commandResults: [
        {
          label: "guided-doctor",
          command_surface: "aor doctor",
          status: "pass",
          transcript_file: setupTranscript,
          artifact_refs: [setupTranscript],
          exit_code: 0,
        },
        {
          label: "discovery-run",
          command_surface: "aor discovery run",
          status: "pass",
          transcript_file: discoveryTranscript,
          artifact_refs: [discoveryTranscript],
          exit_code: 0,
        },
      ],
      artifacts: {},
    });

    const resumed = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-setup-cache",
      profile: { live_e2e: { flow_range_policy: "delivery_default" } },
      mode: "auto",
    });
    assert.equal(resumed.shouldUseCachedCommand("guided-doctor"), true);
    assert.equal(resumed.getCachedCommandResult("guided-doctor").transcript_file, setupTranscript);
  });
});

test("live E2E delivery certification does not reuse review cached evidence", () => {
  withTempRoot((reportsRoot) => {
    const reviewTranscript = path.join(reportsRoot, "13-review-run.json");
    fs.writeFileSync(reviewTranscript, "{}\n", "utf8");
    const controller = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-delivery-cert-cache",
      profile: { live_e2e: { flow_range_policy: "delivery_default" } },
      mode: "auto",
    });

    controller.planCommand({ label: "review-run", commandSurface: "aor review run", iteration: 1 });
    writeSkillAgentDecision(reportsRoot, "controller-delivery-cert-cache", 1, "review", {
      nextStep: "qa",
      inspectedEvidenceRefs: [reviewTranscript],
    });
    controller.observeStage({
      stage: "review",
      iteration: 1,
      stageResult: { stage: "review", status: "pass", evidence_refs: [reviewTranscript], summary: "reviewed" },
      commandResults: [
        {
          label: "review-run",
          command_surface: "aor review run",
          status: "pass",
          transcript_file: reviewTranscript,
          artifact_refs: [reviewTranscript],
          exit_code: 0,
        },
      ],
      artifacts: {},
    });

    assert.equal(controller.shouldUseCachedCommand("harness-certify", 1), true);
    assert.equal(controller.getCachedCommandResult("harness-certify", 1).transcript_file, reviewTranscript);
    assert.equal(controller.shouldUseCachedCommand("delivery-harness-certify", 1), false);
    assert.equal(controller.getCachedCommandResult("delivery-harness-certify", 1), null);
  });
});

test("live E2E command selection prefers latest repeated label", () => {
  const firstRunStart = { label: "run-start", transcript_file: "11-run-start.json" };
  const secondRunStart = { label: "run-start", transcript_file: "15-run-start.json" };
  const selected = findLiveE2eCommandByPreferredLabel(
    [firstRunStart, { label: "run-status", transcript_file: "12-run-status.json" }, secondRunStart],
    ["run-start"],
  );

  assert.equal(selected.transcript_file, "15-run-start.json");
});

test("live E2E manual resume applies operator decision to observed repair iteration", () => {
  withTempRoot((reportsRoot) => {
    const transcriptFile = path.join(reportsRoot, "15-run-start.json");
    const staleTranscriptFile = path.join(reportsRoot, "11-run-start.json");
    fs.writeFileSync(transcriptFile, "{}\n", "utf8");
    fs.writeFileSync(staleTranscriptFile, "{}\n", "utf8");
    const profile = {
      live_e2e: {
        flow_range_policy: "delivery_default",
        operator_mode: "skill-agent",
        agent_decision_policy: "required",
        interaction_answer_policy: "agent-required",
      },
    };
    const first = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-repair-decision-resume",
      profile,
      mode: "manual",
    });
    first.planCommand({ label: "run-start", commandSurface: "aor run start", iteration: 2 });
    assert.throws(
      () =>
        first.observeStage({
          stage: "execution",
          iteration: 2,
          stageResult: {
            stage: "execution",
            status: "pass",
            evidence_refs: [transcriptFile],
            summary: "repair execution passed",
          },
          commandResults: [
            {
              label: "run-start",
              command_surface: "aor run start",
              status: "pass",
              transcript_file: staleTranscriptFile,
              artifact_refs: ["step-result-initial.json"],
              exit_code: 0,
            },
            {
              label: "run-start",
              command_surface: "aor run start",
              status: "pass",
              transcript_file: transcriptFile,
              artifact_refs: ["step-result-repair-2.json"],
              exit_code: 0,
            },
          ],
          artifacts: { routed_step_result_file: "step-result-repair-2.json" },
        }),
      (error) => {
        assert.equal(isLiveE2eControllerStop(error), true);
        assert.equal(error.decision.action, "diagnose");
        return true;
      },
    );

    const [pendingEntry] = first.getStepJournal();
    const decisionRequest = JSON.parse(fs.readFileSync(pendingEntry.agent_decision_request_ref, "utf8"));
    const requiredEvidenceRefs = decisionRequest.decision_rubric.required_evidence_refs;
    fs.writeFileSync(
      decisionRequest.operator_decision_expected_ref,
      `${JSON.stringify(
        {
          step_id: "execution",
          step_instance_id: "execution#2",
          iteration: 2,
          status: "accepted",
          operator_ref: "skill://live-e2e-runner",
          action: "continue",
          semantic_analysis: {
            status: "pass",
            judge_source: "skill-agent",
            findings: ["Repair execution evidence accepted."],
          },
          inspected_evidence_refs: requiredEvidenceRefs,
          evidence_refs: requiredEvidenceRefs,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const second = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-repair-decision-resume",
      profile,
      mode: "manual",
    });
    assert.equal(second.shouldUseCachedCommand("run-start", 2), true);
    assert.equal(second.getCachedCommandResult("run-start", 2).transcript_file, transcriptFile);
    assert.throws(
      () =>
        second.observeStage({
          stage: "execution",
          iteration: 2,
          stageResult: {
            stage: "execution",
            status: "not_pass",
            evidence_refs: [],
            summary: "This recomputed status must not overwrite persisted repair evidence.",
          },
          commandResults: [{ label: "run-start", command_surface: "aor run start", status: "pass" }],
          artifacts: {},
        }),
      (error) => {
        assert.equal(isLiveE2eControllerStop(error), true);
        assert.equal(error.decision.action, "continue");
        return true;
      },
    );

    const [acceptedEntry] = second.getStepJournal();
    assert.equal(acceptedEntry.operator_decision_status, "accepted");
    assert.equal(acceptedEntry.deterministic_analysis.status, "pass");
    assert.equal(acceptedEntry.decision.action, "continue");
    assert.equal(acceptedEntry.decision.reason, "Skill-agent operator decision accepted.");
  });
});

test("live E2E manual resume can replace a rejected operator decision", () => {
  withTempRoot((reportsRoot) => {
    const transcriptFile = path.join(reportsRoot, "11-discovery-run.json");
    fs.writeFileSync(transcriptFile, "{}\n", "utf8");
    const runId = "controller-rejected-decision-resume";
    const profile = {
      live_e2e: {
        flow_range_policy: "delivery_default",
        operator_mode: "skill-agent",
        agent_decision_policy: "required",
        interaction_answer_policy: "agent-required",
      },
    };
    const first = createLiveE2eStepController({
      reportsRoot,
      runId,
      profile,
      mode: "manual",
    });
    first.planCommand({ label: "discovery-run", commandSurface: "aor discovery run" });
    writeSkillAgentDecision(reportsRoot, runId, 1, "discovery", {
      inspectedEvidenceRefs: [transcriptFile],
      semanticStatus: "not_pass",
      findings: ["Bad operator decision."],
    });

    assert.throws(
      () =>
        first.observeStage({
          stage: "discovery",
          stageResult: {
            stage: "discovery",
            status: "pass",
            evidence_refs: [transcriptFile],
            summary: "Discovery passed.",
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
        }),
      (error) => {
        assert.equal(isLiveE2eControllerStop(error), true);
        assert.equal(error.decision.action, "block");
        return true;
      },
    );

    const [rejectedEntry] = first.getStepJournal();
    assert.equal(rejectedEntry.operator_decision_status, "rejected");
    const decisionRequest = JSON.parse(fs.readFileSync(rejectedEntry.agent_decision_request_ref, "utf8"));
    fs.writeFileSync(
      decisionRequest.operator_decision_expected_ref,
      `${JSON.stringify(
        {
          step_id: "discovery",
          step_instance_id: "discovery",
          iteration: 1,
          status: "accepted",
          operator_ref: "skill://live-e2e-runner",
          action: "continue",
          semantic_analysis: {
            status: "pass",
            judge_source: "skill-agent",
            findings: [],
          },
          inspected_evidence_refs: decisionRequest.expected_response_shape.inspected_evidence_refs,
          evidence_refs: decisionRequest.expected_response_shape.evidence_refs,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const resumed = createLiveE2eStepController({
      reportsRoot,
      runId,
      profile,
      mode: "manual",
    });
    assert.equal(resumed.shouldUseCachedCommand("discovery-run", 1), true);
    assert.throws(
      () =>
        resumed.observeStage({
          stage: "discovery",
          stageResult: {
            stage: "discovery",
            status: "not_pass",
            evidence_refs: [],
            summary: "Recomputed evidence must not replace the persisted decision gate.",
          },
          commandResults: [{ label: "discovery-run", command_surface: "aor discovery run", status: "pass" }],
          artifacts: {},
        }),
      (error) => {
        assert.equal(isLiveE2eControllerStop(error), true);
        assert.equal(error.decision.action, "continue");
        return true;
      },
    );

    const [acceptedEntry] = resumed.getStepJournal();
    assert.equal(acceptedEntry.operator_decision_status, "accepted");
    assert.equal(acceptedEntry.operator_decision_rejection_reason, undefined);
    assert.equal(acceptedEntry.deterministic_analysis.status, "pass");
    assert.equal(acceptedEntry.final_step_verdict, "pass");
    assert.deepEqual(acceptedEntry.semantic_analysis.findings, []);
  });
});

test("live E2E manual resume exposes persisted terminal decisions before provider execution", () => {
  withTempRoot((reportsRoot) => {
    const transcriptFile = path.join(reportsRoot, "11-run-start.json");
    fs.writeFileSync(transcriptFile, "{}\n", "utf8");
    const runId = "controller-terminal-stop-resume";
    const profile = {
      live_e2e: {
        flow_range_policy: "delivery_default",
        operator_mode: "skill-agent",
        agent_decision_policy: "required",
        interaction_answer_policy: "agent-required",
      },
    };
    const first = createLiveE2eStepController({
      reportsRoot,
      runId,
      profile,
      mode: "manual",
    });
    first.planCommand({ label: "run-start", commandSurface: "aor run start" });
    writeSkillAgentDecision(reportsRoot, runId, 1, "execution", {
      action: "block",
      semanticStatus: "blocked",
      inspectedEvidenceRefs: [transcriptFile],
      findings: ["Provider execution timed out."],
    });

    assert.throws(
      () =>
        first.observeStage({
          stage: "execution",
          stageResult: {
            stage: "execution",
            status: "fail",
            evidence_refs: [transcriptFile],
            summary: "Provider timed out.",
          },
          commandResults: [
            {
              label: "run-start",
              command_surface: "aor run start",
              status: "fail",
              transcript_file: transcriptFile,
              artifact_refs: [transcriptFile],
              exit_code: 0,
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
    const [blockedEntry] = first.getStepJournal();
    const persistedBlockedEntry = JSON.parse(fs.readFileSync(blockedEntry.observation_ref, "utf8"));
    persistedBlockedEntry.semantic_analysis.findings.push(
      "Skill-agent operator decisions must cite required inspected evidence refs: stale-ref.json.",
    );
    fs.writeFileSync(blockedEntry.observation_ref, `${JSON.stringify(persistedBlockedEntry, null, 2)}\n`, "utf8");

    const resumed = createLiveE2eStepController({
      reportsRoot,
      runId,
      profile,
      mode: "manual",
    });
    const stop = resumed.getPersistedControllerStop();
    assert.equal(stop.action, "block");
    assert.equal(stop.decision.action, "block");
    const sanitizedFindings = resumed.getStepJournal()[0].semantic_analysis.findings;
    assert.equal(sanitizedFindings.includes("Provider execution timed out."), true);
    assert.equal(sanitizedFindings.some((finding) => finding.includes("required inspected evidence refs")), false);
    assert.equal(resumed.shouldUseCachedCommand("run-start", 1), true);
    assert.equal(resumed.getCachedCommandResult("run-start", 1).transcript_file, transcriptFile);
  });
});

test("live E2E manual resume validates against the persisted decision request", () => {
  withTempRoot((reportsRoot) => {
    const transcriptFile = path.join(reportsRoot, "11-spec-build.json");
    const firstArtifact = path.join(reportsRoot, "step-result-spec-attempt-1.json");
    const laterArtifact = path.join(reportsRoot, "step-result-spec-attempt-2.json");
    for (const file of [transcriptFile, firstArtifact, laterArtifact]) {
      fs.writeFileSync(file, "{}\n", "utf8");
    }
    const runId = "controller-stable-decision-request";
    const profile = {
      live_e2e: {
        flow_range_policy: "delivery_default",
        operator_mode: "skill-agent",
        agent_decision_policy: "required",
        interaction_answer_policy: "agent-required",
      },
    };
    const first = createLiveE2eStepController({
      reportsRoot,
      runId,
      profile,
      mode: "manual",
    });
    first.planCommand({ label: "spec-build", commandSurface: "aor spec build" });
    assert.throws(
      () =>
        first.observeStage({
          stage: "spec",
          stageResult: {
            stage: "spec",
            status: "pass",
            evidence_refs: [firstArtifact],
            summary: "Spec passed.",
          },
          commandResults: [
            {
              label: "spec-build",
              command_surface: "aor spec build",
              status: "pass",
              transcript_file: transcriptFile,
              artifact_refs: [firstArtifact],
              exit_code: 0,
            },
          ],
          artifacts: {},
        }),
      (error) => {
        assert.equal(isLiveE2eControllerStop(error), true);
        return true;
      },
    );

    const [pendingEntry] = first.getStepJournal();
    const decisionRequest = JSON.parse(fs.readFileSync(pendingEntry.agent_decision_request_ref, "utf8"));
    const mutatedEntry = {
      ...pendingEntry,
      artifact_refs: [...pendingEntry.artifact_refs, laterArtifact],
    };
    fs.writeFileSync(pendingEntry.observation_ref, `${JSON.stringify(mutatedEntry, null, 2)}\n`, "utf8");
    fs.writeFileSync(
      decisionRequest.operator_decision_expected_ref,
      `${JSON.stringify(
        {
          step_id: "spec",
          step_instance_id: "spec",
          iteration: 1,
          status: "accepted",
          operator_ref: "skill://live-e2e-runner",
          action: "continue",
          semantic_analysis: {
            status: "pass",
            judge_source: "skill-agent",
            findings: [],
          },
          inspected_evidence_refs: decisionRequest.expected_response_shape.inspected_evidence_refs,
          evidence_refs: decisionRequest.expected_response_shape.evidence_refs,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const resumed = createLiveE2eStepController({
      reportsRoot,
      runId,
      profile,
      mode: "manual",
    });
    assert.throws(
      () =>
        resumed.observeStage({
          stage: "spec",
          stageResult: {
            stage: "spec",
            status: "not_pass",
            evidence_refs: [laterArtifact],
            summary: "Later diagnostic should not move the decision target.",
          },
          commandResults: [{ label: "spec-build", command_surface: "aor spec build", status: "pass" }],
          artifacts: {},
        }),
      (error) => {
        assert.equal(isLiveE2eControllerStop(error), true);
        assert.equal(error.decision.action, "continue");
        return true;
      },
    );

    const [acceptedEntry] = resumed.getStepJournal();
    assert.equal(acceptedEntry.operator_decision_status, "accepted");
    assert.equal(acceptedEntry.inspected_evidence_refs.includes(firstArtifact), true);
    assert.equal(acceptedEntry.inspected_evidence_refs.includes(laterArtifact), false);
  });
});

test("live E2E resume can apply pending decisions before commands run", () => {
  withTempRoot((reportsRoot) => {
    const transcriptFile = path.join(reportsRoot, "11-spec-build.json");
    fs.writeFileSync(transcriptFile, "{}\n", "utf8");
    const runId = "controller-pre-command-decision";
    const profile = {
      live_e2e: {
        flow_range_policy: "delivery_default",
        operator_mode: "skill-agent",
        agent_decision_policy: "required",
        interaction_answer_policy: "agent-required",
      },
    };
    const first = createLiveE2eStepController({
      reportsRoot,
      runId,
      profile,
      mode: "manual",
    });
    first.planCommand({ label: "spec-build", commandSurface: "aor spec build" });
    assert.throws(() =>
      first.observeStage({
        stage: "spec",
        stageResult: { stage: "spec", status: "pass", evidence_refs: [transcriptFile], summary: "Spec passed." },
        commandResults: [
          {
            label: "spec-build",
            command_surface: "aor spec build",
            status: "pass",
            transcript_file: transcriptFile,
            artifact_refs: [transcriptFile],
            exit_code: 0,
          },
        ],
        artifacts: {},
      }),
    );

    const [pendingEntry] = first.getStepJournal();
    const decisionRequest = JSON.parse(fs.readFileSync(pendingEntry.agent_decision_request_ref, "utf8"));
    fs.writeFileSync(
      decisionRequest.operator_decision_expected_ref,
      `${JSON.stringify(
        {
          step_id: "spec",
          step_instance_id: "spec",
          iteration: 1,
          status: "accepted",
          operator_ref: "skill://live-e2e-runner",
          action: "continue",
          semantic_analysis: {
            status: "pass",
            judge_source: "skill-agent",
            findings: [],
          },
          inspected_evidence_refs: decisionRequest.expected_response_shape.inspected_evidence_refs,
          evidence_refs: decisionRequest.expected_response_shape.evidence_refs,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const resumed = createLiveE2eStepController({
      reportsRoot,
      runId,
      profile,
      mode: "auto",
    });
    const applied = resumed.applyPendingOperatorDecision();
    assert.equal(applied.applied, true);
    assert.equal(applied.action, "continue");
    const [acceptedEntry] = resumed.getStepJournal();
    assert.equal(acceptedEntry.operator_decision_status, "accepted");
    assert.equal(acceptedEntry.decision.action, "continue");
  });
});

test("live E2E command cache resolves repeated labels by iteration", () => {
  withTempRoot((reportsRoot) => {
    const firstTranscript = path.join(reportsRoot, "11-run-start.json");
    const repairTranscript = path.join(reportsRoot, "15-run-start.json");
    fs.writeFileSync(firstTranscript, "{}\n", "utf8");
    fs.writeFileSync(repairTranscript, "{}\n", "utf8");
    const profile = {
      live_e2e: {
        flow_range_policy: "delivery_default",
        operator_mode: "skill-agent",
        agent_decision_policy: "required",
        interaction_answer_policy: "agent-required",
      },
    };
    const controller = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-command-cache-iteration",
      profile,
      mode: "manual",
    });

    for (const [iteration, transcriptFile] of [
      [1, firstTranscript],
      [2, repairTranscript],
    ]) {
      controller.planCommand({ label: "run-start", commandSurface: "aor run start", iteration });
      assert.throws(
        () =>
          controller.observeStage({
            stage: "execution",
            iteration,
            stageResult: {
              stage: "execution",
              status: "pass",
              evidence_refs: [transcriptFile],
              summary: `execution ${iteration} passed`,
            },
            commandResults: [
              {
                label: "run-start",
                step_id: "execution",
                step_instance_id: iteration === 1 ? "execution" : "execution#2",
                iteration,
                command_surface: "aor run start",
                status: "pass",
                transcript_file: transcriptFile,
                artifact_refs: [`step-result-${iteration}.json`],
                exit_code: 0,
              },
            ],
            artifacts: { routed_step_result_file: `step-result-${iteration}.json` },
          }),
        (error) => {
          assert.equal(isLiveE2eControllerStop(error), true);
          return true;
        },
      );
    }

    const resumed = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-command-cache-iteration",
      profile,
      mode: "manual",
    });
    assert.equal(resumed.shouldUseCachedCommand("run-start", 1), true);
    assert.equal(resumed.shouldUseCachedCommand("run-start", 2), true);
    assert.equal(resumed.getCachedCommandResult("run-start", 1).transcript_file, firstTranscript);
    assert.equal(resumed.getCachedCommandResult("run-start", 2).transcript_file, repairTranscript);
  });
});

test("live E2E command cache can resume from persisted journal when command snapshot is missing", () => {
  withTempRoot((reportsRoot) => {
    const transcriptFile = path.join(reportsRoot, "11-run-start.json");
    fs.writeFileSync(transcriptFile, "{}\n", "utf8");
    const profile = {
      live_e2e: {
        flow_range_policy: "delivery_default",
        operator_mode: "skill-agent",
        agent_decision_policy: "required",
        interaction_answer_policy: "agent-required",
      },
    };
    const controller = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-command-cache-journal-fallback",
      profile,
      mode: "manual",
    });
    controller.planCommand({ label: "run-start", commandSurface: "aor run start" });
    assert.throws(
      () =>
        controller.observeStage({
          stage: "execution",
          stageResult: { stage: "execution", status: "pass", evidence_refs: [transcriptFile], summary: "execution passed" },
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
      (error) => {
        assert.equal(isLiveE2eControllerStop(error), true);
        return true;
      },
    );

    const state = JSON.parse(fs.readFileSync(controller.stateFile, "utf8"));
    state.command_results = [];
    fs.writeFileSync(controller.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

    const resumed = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-command-cache-journal-fallback",
      profile,
      mode: "manual",
    });
    assert.equal(resumed.shouldUseCachedCommand("run-start", 1), true);
    const cached = resumed.getCachedCommandResult("run-start", 1);
    assert.equal(cached.transcript_file, transcriptFile);
    assert.equal(cached.step_instance_id, "execution");
    assert.equal(cached.iteration, 1);
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
    writeSkillAgentDecision(reportsRoot, "controller-manual", 1, "discovery", { nextStep: "spec" });

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
    writeSkillAgentDecision(reportsRoot, "controller-resume", 1, "discovery", { nextStep: "spec" });

    const second = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-resume",
      profile: { live_e2e: { flow_range_policy: "delivery_default" } },
      mode: "manual",
    });
    assert.throws(
      () =>
        second.observeStage({
          stage: "discovery",
          stageResult: { stage: "discovery", status: "pass", evidence_refs: [], summary: "ok" },
          commandResults: [{ label: "discovery-run", command_surface: "aor discovery run", status: "pass" }],
          artifacts: {},
        }),
      (error) => {
        assert.equal(isLiveE2eControllerStop(error), true);
        assert.equal(error.decision.action, "continue");
        return true;
      },
    );
    writeSkillAgentDecision(reportsRoot, "controller-resume", 3, "spec", { nextStep: "planning" });
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
    const executionEvidence = {
      request_artifact_ref: "evidence://request.json",
      provider_work_packet_ref: "evidence://work-packet.json",
      meaningful_changed_paths: ["source/core/Ky.ts", "test/hooks.ts"],
      top_context_size_sources: [
        {
          source: "provider_work_packet.context",
          bytes: 2048,
          chars: 2048,
          estimated_tokens: 683,
        },
      ],
    };
    let sequence = 1;
    for (const [stage, label] of [
      ["discovery", "discovery-run"],
      ["spec", "spec-build"],
      ["planning", "wave-create"],
      ["handoff", "handoff-approve"],
      ["execution", "run-start"],
      ["review", "review-run"],
      ["qa", "eval-run"],
    ]) {
      writeSkillAgentDecision(reportsRoot, "controller-terminal-manual", sequence, stage);
      prior.observeStage({
        stage,
        stageResult: { stage, status: "pass", evidence_refs: [], summary: "ok" },
        commandResults: [{ label, command_surface: `aor ${stage}`, status: "pass" }],
        artifacts: stage === "execution" ? executionEvidence : {},
      });
      sequence += 2;
    }

    const terminal = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-terminal-manual",
      profile,
      mode: "manual",
    });
    writeSkillAgentDecision(reportsRoot, "controller-terminal-manual", 15, "delivery");
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
    assert.equal(state.artifacts_snapshot.request_artifact_ref, "evidence://request.json");
    assert.deepEqual(state.artifacts_snapshot.meaningful_changed_paths, ["source/core/Ky.ts", "test/hooks.ts"]);
    assert.equal(state.artifacts_snapshot.top_context_size_sources[0].source, "provider_work_packet.context");
  });
});

test("live E2E step controller exposes cached public command results for completed steps", () => {
  withTempRoot((reportsRoot) => {
    const transcriptFile = path.join(reportsRoot, "01-discovery-run.json");
    const analysisFile = path.join(reportsRoot, "analysis.json");
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
    fs.writeFileSync(analysisFile, "{}\n", "utf8");
    const first = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-command-cache",
      profile: { live_e2e: { flow_range_policy: "delivery_default" } },
      mode: "auto",
    });
    writeSkillAgentDecision(reportsRoot, "controller-command-cache", 1, "discovery", {
      nextStep: "spec",
      inspectedEvidenceRefs: [transcriptFile, analysisFile],
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
          artifact_refs: [analysisFile],
          exit_code: 0,
        },
      ],
      artifacts: { analysis_report_file: analysisFile },
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
    const artifactsSnapshot = second.getState().artifacts_snapshot;
    assert.equal(artifactsSnapshot.analysis_report_file, analysisFile);
    assert.equal(artifactsSnapshot.live_e2e_step_observation_files.length, 1);
    assert.equal(artifactsSnapshot.live_e2e_step_quality_assessment_report_files.length, 1);
  });
});

test("live E2E terminal manual continue is not an in-progress observation report", () => {
  const includedSteps = ["discovery", "spec"];
  assert.equal(isLiveE2eControllerStopInProgress({}, includedSteps), false);
  assert.equal(
    isLiveE2eControllerStopInProgress(
      {
        decision: {
          action: "continue",
          next_step: null,
        },
        state: {
          current_step: null,
          completed_steps: includedSteps,
        },
      },
      includedSteps,
    ),
    false,
  );
  assert.equal(
    isLiveE2eControllerStopInProgress(
      {
        decision: {
          action: "continue",
          next_step: "spec",
        },
        state: {
          current_step: "spec",
          completed_steps: ["discovery"],
        },
      },
      includedSteps,
    ),
    true,
  );
  assert.equal(
    isLiveE2eControllerStopInProgress(
      {
        decision: {
          action: "diagnose",
          next_step: null,
        },
        state: {
          current_step: null,
          completed_steps: includedSteps,
        },
      },
      includedSteps,
    ),
    true,
  );
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
    writeSkillAgentDecision(reportsRoot, "controller-unresolved-resume", 1, "spec", {
      action: "answer",
      nextStep: "spec",
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
    writeSkillAgentDecision(reportsRoot, "controller-unresolved-resume", 2, "spec", {
      action: "answer",
      nextStep: "spec",
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
    writeSkillAgentDecision(reportsRoot, "controller-interaction-resumed", 1, "spec", { nextStep: "planning" });
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
    writeSkillAgentDecision(reportsRoot, "controller-interaction-resumed-missing-audit", 1, "spec", {
      action: "block",
      semanticStatus: "blocked",
      findings: ["Answer audit evidence is missing."],
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

test("live E2E step controller accepts repo-relative source evidence refs", () => {
  withTempRoot((tempRoot) => {
    const reportsRoot = path.join(tempRoot, "reports");
    const sourceRoot = path.join(tempRoot, "source");
    fs.mkdirSync(path.join(sourceRoot, "docs"), { recursive: true });
    fs.mkdirSync(reportsRoot, { recursive: true });
    const sourceDocRef = "docs/live-e2e-hardening.md";
    fs.writeFileSync(path.join(sourceRoot, sourceDocRef), "# Live E2E hardening\n", "utf8");
    const transcriptFile = path.join(reportsRoot, "01-discovery-run.json");
    fs.writeFileSync(transcriptFile, "{}\n", "utf8");

    const runId = "controller-source-relative-ref";
    const profile = { live_e2e: { flow_range_policy: "delivery_default" } };
    const controller = createLiveE2eStepController({
      reportsRoot,
      sourceRoot,
      runId,
      profile,
      mode: "auto",
    });
    writeSkillAgentDecision(reportsRoot, runId, 1, "discovery", {
      nextStep: "spec",
      inspectedEvidenceRefs: [transcriptFile, sourceDocRef],
      evidenceRefs: [transcriptFile, sourceDocRef],
    });

    const result = controller.observeStage({
      stage: "discovery",
      stageResult: {
        stage: "discovery",
        status: "pass",
        evidence_refs: [sourceDocRef],
        summary: "Discovery cited repo docs evidence.",
      },
      commandResults: [
        {
          label: "discovery-run",
          command_surface: "aor discovery run",
          status: "pass",
          transcript_file: transcriptFile,
          artifact_refs: [sourceDocRef],
          exit_code: 0,
        },
      ],
      artifacts: {},
    });

    assert.equal(result.action, "continue");
    const [entry] = controller.getStepJournal();
    assert.equal(entry.artifact_refs.includes(sourceDocRef), true);
    const request = JSON.parse(fs.readFileSync(entry.agent_decision_request_ref, "utf8"));
    assert.equal(request.decision_rubric.required_evidence_refs.includes(sourceDocRef), true);
    assert.equal(entry.operator_decision_status, "accepted");
  });
});

test("full lifecycle controller includes only profile-declared terminal stages", () => {
  withTempRoot((reportsRoot) => {
    const governanceController = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-profile-declared-terminals",
      profile: {
        stages: ["bootstrap", "discovery", "spec", "planning", "handoff", "execution", "review", "qa", "delivery", "learning"],
        live_e2e: { flow_range_policy: "full_lifecycle" },
      },
      mode: "auto",
    });
    assert.equal(governanceController.includedSteps.includes("learning"), true);
    assert.equal(governanceController.includedSteps.includes("release"), false);

    const releaseController = createLiveE2eStepController({
      reportsRoot,
      runId: "controller-profile-declared-release",
      profile: {
        stages: ["bootstrap", "discovery", "spec", "planning", "handoff", "execution", "review", "qa", "delivery", "release", "learning"],
        live_e2e: { flow_range_policy: "full_lifecycle" },
      },
      mode: "auto",
    });
    assert.equal(releaseController.includedSteps.includes("release"), true);
    assert.equal(releaseController.includedSteps.includes("learning"), true);
  });
});
