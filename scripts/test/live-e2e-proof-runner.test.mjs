import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadProofRunnerProfile } from "../live-e2e/lib/profile-catalog.mjs";
import { prepareAorInstallationProof } from "../live-e2e/lib/flows.mjs";
import {
  REQUIRED_GUIDED_COMMAND_LABELS,
  buildGuidedJourneyProof,
  validateGuidedJourneyProof,
} from "../live-e2e/lib/guided-proof.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runProfileScript = path.join(repoRoot, "scripts/live-e2e/run-profile.mjs");

function withTempRoot(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-live-e2e-proof-runner-"));
  try {
    callback(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function writeProfile(tempRoot, liveOverrides, options = {}) {
  const profilePath = path.join(tempRoot, "profile.yaml");
  const live = {
    flow_range_policy: "delivery_default",
    installation_policy: "source-install-required",
    interaction_capability: "public-control-plane",
    frontend_capability: "none",
    safety_policy: "no-upstream-write",
    operator_mode: "skill-agent",
    agent_decision_policy: "required",
    interaction_answer_policy: "agent-required",
    target_write_policy: "aor-runtime-only-before-execution",
    ...liveOverrides,
  };
  fs.writeFileSync(
    profilePath,
    [
      "profile_id: live-e2e.test.skill-agent-only",
      "run_tier: acceptance",
      "journey_mode: full-journey",
      "target_catalog_id: ky",
      "feature_mission_id: regress-basic",
      "implementation_loop:",
      "  enabled: true",
      "  max_iterations: 1",
      "live_e2e:",
      ...Object.entries(live).map(([key, value]) => `  ${key}: ${value}`),
      ...(options.guidedJourney
        ? [
            "guided_journey:",
            "  enabled: true",
            "  proof_requirements:",
            "    - browser-task-proof",
            "    - flow-loop-proof",
            "    - final-skill-agent-verdict",
            "  flow_loop_proof:",
            "    enabled: true",
            "  browser_task_proof:",
            "    required: true",
          ]
        : []),
      "",
    ].join("\n"),
    "utf8",
  );
  return profilePath;
}

function writeJsonFixture(filePath, payload = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filePath;
}

function writeGuidedProofFixture(tempRoot) {
  const targetCheckoutRoot = path.join(tempRoot, "target");
  const reportsRoot = path.join(tempRoot, "reports");
  fs.mkdirSync(path.join(targetCheckoutRoot, ".aor"), { recursive: true });
  fs.mkdirSync(reportsRoot, { recursive: true });
  const files = {
    onboarding: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/reports/onboarding-report.json")),
    missionPacket: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/artifacts/local-target.artifact.intake.first-flow.v1.json")),
    missionBody: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/artifacts/local-target.artifact.intake.first-flow.v1.body.json")),
    completedNext: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/reports/next-action-report-first-flow.json")),
    routedStep: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/reports/step-result.json")),
    reviewReport: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/reports/review-report.json")),
    reviewDecision: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/reports/review-decision.json")),
    deliveryManifest: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/reports/delivery-manifest.json")),
    deliveryTranscript: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/reports/delivery-transcript.json")),
    releasePacket: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/reports/release-packet.json")),
    learningScorecard: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/reports/learning-loop-scorecard.json")),
    learningHandoff: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/reports/learning-loop-handoff.json")),
    webSummary: writeJsonFixture(path.join(reportsRoot, "web-smoke.json")),
    webHtml: writeJsonFixture(path.join(reportsRoot, "web-smoke.html"), { html: "<main>AOR</main>" }),
    webDom: writeJsonFixture(path.join(reportsRoot, "web-dom.json")),
    webAccessibility: writeJsonFixture(path.join(reportsRoot, "web-accessibility.json")),
    webVisual: writeJsonFixture(path.join(reportsRoot, "web-visual.json")),
    browserTaskProof: writeJsonFixture(path.join(reportsRoot, "browser-task-proof.json")),
    newMissionPacket: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/artifacts/local-target.artifact.intake.second-flow.v1.json")),
    newMissionBody: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/artifacts/local-target.artifact.intake.second-flow.v1.body.json")),
    newNext: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/reports/next-action-report-second-flow.json")),
    operatorRequest: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/operator-requests/request-second-flow.json"), {
      target_flow_id: "flow.local-target.second-flow",
      target_stage: "discovery",
      intent_type: "analyze",
      delivery_mode: "no-write",
    }),
  };
  const commandResults = REQUIRED_GUIDED_COMMAND_LABELS.map((label, index) => ({
    label,
    transcript_file: writeJsonFixture(path.join(reportsRoot, `${String(index + 1).padStart(2, "0")}-${label}.json`)),
  }));
  const artifacts = {
    target_checkout_root: targetCheckoutRoot,
    onboarding_report_file: files.onboarding,
    intake_artifact_packet_file: files.missionPacket,
    intake_artifact_packet_body_file: files.missionBody,
    next_action_report_file: files.completedNext,
    completed_flow_next_action_report_file: files.completedNext,
    routed_step_result_file: files.routedStep,
    review_report_file: files.reviewReport,
    review_decision_file: files.reviewDecision,
    delivery_manifest_file: files.deliveryManifest,
    delivery_transcript_file: files.deliveryTranscript,
    release_packet_file: files.releasePacket,
    learning_loop_scorecard_file: files.learningScorecard,
    learning_loop_handoff_file: files.learningHandoff,
    guided_web_smoke_summary_file: files.webSummary,
    guided_web_smoke_html_file: files.webHtml,
    guided_web_dom_snapshot_file: files.webDom,
    guided_web_accessibility_summary_file: files.webAccessibility,
    guided_web_visual_guardrail_file: files.webVisual,
    guided_browser_task_proof_file: files.browserTaskProof,
    first_flow_id: "flow.local-target.first-flow",
    first_flow_status: "completed",
    completed_flow_read_only: true,
    second_flow_id: "flow.local-target.second-flow",
    follow_up_source_handoff_ref: files.learningHandoff,
    new_flow_mission_artifact_packet_file: files.newMissionPacket,
    new_flow_mission_artifact_packet_body_file: files.newMissionBody,
    new_flow_next_action_report_file: files.newNext,
    flow_targeted_operator_request_file: files.operatorRequest,
    flow_targeted_operator_request_ref: "packet://operator-request@flow.local-target.second-flow",
    flow_targeted_operator_request_id: "request.second-flow",
    flow_targeted_operator_request: {
      target_flow_id: "flow.local-target.second-flow",
      target_stage: "discovery",
      intent_type: "analyze",
      delivery_mode: "no-write",
    },
    guided_web_smoke: {
      summary_file: files.webSummary,
      rendered_html_file: files.webHtml,
      dom_snapshot_file: files.webDom,
      accessibility_summary_file: files.webAccessibility,
      visual_guardrail_file: files.webVisual,
      browser_task_proof_file: files.browserTaskProof,
      screenshot_files: [],
      task_outcome: { status: "pass", findings: [] },
      ux_findings: ["Flow selector and closure actions were inspectable."],
      guided_lifecycle_state: "smoke-pass",
      html_loaded: true,
      flow_selector_loaded: true,
      new_flow_action_loaded: true,
      guided_current_stage_id: "learning",
      detached: true,
    },
  };
  const proof = buildGuidedJourneyProof({
    runId: "w34-flow-loop",
    profile: { profile_id: "live-e2e.installed-user.guided-journey", output_policy: { write_back_to_remote: false, preferred_delivery_mode: "patch-only" } },
    commandResults,
    artifacts,
    targetCheckoutRoot,
    reportsRoot,
    targetHeadBefore: "0000000000000000000000000000000000000000",
    targetHeadAfter: "0000000000000000000000000000000000000000",
    targetGitStatusWithoutRuntime: [],
  });
  return { proof, targetCheckoutRoot };
}

test("proof runner profile validation rejects deterministic operator mode", () => {
  withTempRoot((tempRoot) => {
    const profilePath = writeProfile(tempRoot, { operator_mode: "deterministic-fixture" });
    assert.throws(
      () => loadProofRunnerProfile({ hostRoot: repoRoot, profileRef: profilePath }),
      /live_e2e\.operator_mode must be skill-agent/u,
    );
  });
});

test("proof runner profile validation requires skill-agent decision policy", () => {
  withTempRoot((tempRoot) => {
    const profilePath = writeProfile(tempRoot, { agent_decision_policy: "optional" });
    assert.throws(
      () => loadProofRunnerProfile({ hostRoot: repoRoot, profileRef: profilePath }),
      /live_e2e\.agent_decision_policy must be required/u,
    );
  });
});

test("proof runner profile validation requires agent interaction answers", () => {
  withTempRoot((tempRoot) => {
    const profilePath = writeProfile(tempRoot, { interaction_answer_policy: "deterministic-fixture" });
    assert.throws(
      () => loadProofRunnerProfile({ hostRoot: repoRoot, profileRef: profilePath }),
      /live_e2e\.interaction_answer_policy must be agent-required/u,
    );
  });
});

test("proof runner profile validation accepts browser task frontend proof", () => {
  withTempRoot((tempRoot) => {
    const profilePath = writeProfile(tempRoot, { frontend_capability: "browser-task-proof" }, { guidedJourney: true });
    const loaded = loadProofRunnerProfile({ hostRoot: repoRoot, profileRef: profilePath });
    assert.equal(loaded.profile.live_e2e.frontend_capability, "browser-task-proof");
  });
});

test("proof runner profile validation requires guided flow-loop metadata for browser task proof", () => {
  withTempRoot((tempRoot) => {
    const profilePath = writeProfile(tempRoot, { frontend_capability: "browser-task-proof" });
    assert.throws(
      () => loadProofRunnerProfile({ hostRoot: repoRoot, profileRef: profilePath }),
      /guided_journey\.flow_loop_proof\.enabled=true/u,
    );
  });
});

test("guided journey proof requires flow-loop and browser-task evidence", () => {
  withTempRoot((tempRoot) => {
    const { proof, targetCheckoutRoot } = writeGuidedProofFixture(tempRoot);
    assert.deepEqual(validateGuidedJourneyProof(proof, { targetCheckoutRoot }), []);

    const missingSecondFlow = structuredClone(proof);
    missingSecondFlow.flow_loop.second_flow_id = missingSecondFlow.flow_loop.first_flow_id;
    assert.match(
      validateGuidedJourneyProof(missingSecondFlow, { targetCheckoutRoot }).join("\n"),
      /second flow distinct/u,
    );

    const missingBrowserTask = structuredClone(proof);
    missingBrowserTask.web_smoke.browser_task_proof_file = null;
    assert.match(
      validateGuidedJourneyProof(missingBrowserTask, { targetCheckoutRoot }).join("\n"),
      /browser-task proof evidence/u,
    );

    const missingTargetFlow = structuredClone(proof);
    missingTargetFlow.flow_loop.operator_request.target_flow_id = null;
    assert.match(
      validateGuidedJourneyProof(missingTargetFlow, { targetCheckoutRoot }).join("\n"),
      /operator_request\.target_flow_id/u,
    );
  });
});

test("proof runner rejects removed --agent-judge-file flag before live execution", () => {
  const result = spawnSync(
    process.execPath,
    [runProfileScript, "--project-ref", repoRoot, "--profile", "scripts/live-e2e/profiles/full-journey-regress-ky.yaml", "--agent-judge-file", "judge.json"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /--agent-judge-file is no longer supported/u);
});

test("proof runner rejects removed --examples-root flag before live execution", () => {
  const result = spawnSync(
    process.execPath,
    [runProfileScript, "--project-ref", repoRoot, "--profile", "scripts/live-e2e/profiles/full-journey-regress-ky.yaml", "--examples-root", "examples"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /--examples-root is no longer supported/u);
});

test("proof runner reuses valid installation proof for manual resume", () => {
  withTempRoot((tempRoot) => {
    const reportsRoot = path.join(tempRoot, "reports");
    fs.mkdirSync(reportsRoot, { recursive: true });
    const runId = "cached-install-proof";
    const launcher = path.join(reportsRoot, "aor-session-launcher.sh");
    fs.writeFileSync(launcher, "#!/bin/sh\nexit 0\n", "utf8");
    fs.chmodSync(launcher, 0o755);
    const proofFile = path.join(reportsRoot, `live-e2e-aor-installation-proof-${runId}.json`);
    fs.writeFileSync(
      proofFile,
      `${JSON.stringify(
        {
          status: "pass",
          install_mode: "isolated",
          launcher_ref: launcher,
          command_transcripts: [path.join(reportsRoot, "01-help.json")],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = prepareAorInstallationProof({
      hostRoot: repoRoot,
      reportsRoot,
      runId,
      profile: { live_e2e: { installation_policy: "source-install-required" } },
      aorBinOverride: null,
      installMode: "isolated",
      isolatedWorkspaceRoot: path.join(tempRoot, "workspace"),
      isolatedSourceRoot: path.join(tempRoot, "source"),
      runtimeRoot: path.join(tempRoot, ".aor"),
    });

    assert.equal(result.proof.reused_for_manual_resume, true);
    assert.equal(result.launch.command, launcher);
    assert.equal(result.setupEntry.public_surface, "cached pnpm source install");
  });
});
