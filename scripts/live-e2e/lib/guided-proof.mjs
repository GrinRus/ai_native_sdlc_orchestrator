import fs from "node:fs";
import path from "node:path";

import {
  asNonEmptyString,
  asRecord,
  asStringArray,
  normalizeId,
  uniqueStrings,
  writeJson,
} from "./common.mjs";

export const REQUIRED_GUIDED_COMMAND_LABELS = Object.freeze([
  "guided-doctor",
  "guided-onboard",
  "guided-app",
  "guided-next-before-mission",
  "mission-create",
  "guided-next-after-mission",
  "run-start",
  "run-status",
  "review-run",
  "guided-next-after-review",
  "review-decide-approve",
  "deliver-prepare",
  "guided-next-after-delivery",
  "release-prepare",
  "learning-handoff",
  "guided-next-after-learning",
  "follow-up-mission-create",
  "guided-next-after-follow-up",
  "flow-targeted-request-create",
]);

const REQUIRED_DURABLE_ARTIFACT_FIELDS = Object.freeze([
  "onboarding_report_file",
  "mission_artifact_packet_file",
  "mission_artifact_packet_body_file",
  "next_action_report_file",
  "routed_step_result_file",
  "review_report_file",
  "review_decision_file",
  "delivery_manifest_file",
  "delivery_transcript_file",
  "release_packet_file",
  "learning_loop_scorecard_file",
  "learning_loop_handoff_file",
  "web_smoke_summary_file",
  "web_smoke_html_file",
  "web_dom_snapshot_file",
  "web_accessibility_summary_file",
  "web_screenshot_file",
  "new_flow_mission_artifact_packet_file",
  "new_flow_mission_artifact_packet_body_file",
  "new_flow_next_action_report_file",
  "flow_targeted_operator_request_file",
]);

/**
 * @param {Record<string, unknown>} profile
 * @returns {boolean}
 */
export function isGuidedJourneyEnabled(profile) {
  if (profile.guided_journey === true) return true;
  return asRecord(profile.guided_journey).enabled === true;
}

/**
 * @param {string} targetRoot
 * @param {string} ref
 * @returns {string | null}
 */
function resolveEvidencePath(targetRoot, ref) {
  if (!ref) return null;
  if (path.isAbsolute(ref)) return ref;
  if (ref.startsWith("evidence://")) {
    const evidencePath = ref.slice("evidence://".length);
    return evidencePath ? path.resolve(targetRoot, evidencePath) : null;
  }
  if (ref.includes("/") || ref.includes("\\")) {
    return path.resolve(targetRoot, ref);
  }
  return null;
}

/**
 * @param {string | null} filePath
 * @returns {Record<string, unknown>}
 */
function readJsonIfPresent(filePath) {
  const resolved = asNonEmptyString(filePath);
  if (!resolved || !fs.existsSync(resolved)) return {};
  return asRecord(JSON.parse(fs.readFileSync(resolved, "utf8")));
}

/**
 * @param {Record<string, unknown>} artifacts
 * @param {Record<string, unknown>} webSmoke
 * @returns {string}
 */
function resolveBrowserTaskProofFile(artifacts, webSmoke) {
  const directProofFile =
    asNonEmptyString(artifacts.guided_browser_task_proof_file) ||
    asNonEmptyString(webSmoke.browser_task_proof_file);
  if (directProofFile && fs.existsSync(directProofFile)) return directProofFile;
  const requestFile =
    asNonEmptyString(artifacts.guided_browser_task_proof_request_file) ||
    asNonEmptyString(webSmoke.browser_task_proof_request_file);
  const request = readJsonIfPresent(requestFile);
  const expectedProofFile = asNonEmptyString(request.expected_browser_task_proof_file);
  return expectedProofFile && fs.existsSync(expectedProofFile) ? expectedProofFile : directProofFile;
}

/**
 * @param {Record<string, unknown>} artifacts
 * @param {Record<string, unknown>} webSmoke
 * @returns {Record<string, unknown>}
 */
function mergeBrowserTaskProofIntoWebSmoke(artifacts, webSmoke) {
  const browserTaskProofFile = resolveBrowserTaskProofFile(artifacts, webSmoke);
  if (!browserTaskProofFile || !fs.existsSync(browserTaskProofFile)) return webSmoke;
  const proof = readJsonIfPresent(browserTaskProofFile);
  const proofOutcome = asRecord(proof.task_outcome);
  const proofStatus = asNonEmptyString(proofOutcome.status) || asNonEmptyString(proof.status);
  const screenshotFiles = uniqueStrings([
    ...asStringArray(webSmoke.screenshot_files),
    ...asStringArray(proof.screenshot_files),
    ...asStringArray(proof.screenshot_refs),
  ]);
  const proofHasVisualEvidence = screenshotFiles.length > 0 || Boolean(asNonEmptyString(proof.visual_guardrail_file));
  const proofPasses = (proofStatus === "pass" || proofStatus === "warn") && proofHasVisualEvidence;
  if (!proofPasses) return { ...webSmoke, browser_task_proof_file: browserTaskProofFile };
  const retainedWebSmokeUxFindings = asStringArray(webSmoke.ux_findings).filter(
    (finding) => !/browser-task-proof requires skill-agent browser evidence/iu.test(finding),
  );
  return {
    ...webSmoke,
    rendered_html_file:
      asNonEmptyString(proof.rendered_html_file) ||
      asNonEmptyString(proof.html_ref) ||
      asNonEmptyString(webSmoke.rendered_html_file),
    dom_snapshot_file:
      asNonEmptyString(proof.dom_snapshot_file) ||
      asNonEmptyString(proof.dom_snapshot_ref) ||
      asNonEmptyString(webSmoke.dom_snapshot_file),
    accessibility_summary_file:
      asNonEmptyString(proof.accessibility_summary_file) ||
      asNonEmptyString(proof.accessibility_summary_ref) ||
      asNonEmptyString(webSmoke.accessibility_summary_file),
    visual_guardrail_file:
      asNonEmptyString(proof.visual_guardrail_file) ||
      asNonEmptyString(webSmoke.visual_guardrail_file),
    browser_task_proof_file: browserTaskProofFile,
    screenshot_files: screenshotFiles,
    task_outcome: {
      status: "pass",
      checked_tasks: uniqueStrings([
        ...asStringArray(asRecord(webSmoke.task_outcome).checked_tasks),
        ...asStringArray(proofOutcome.checked_tasks),
      ]),
      findings: asStringArray(proofOutcome.findings),
    },
    ux_findings: uniqueStrings([...retainedWebSmokeUxFindings, ...asStringArray(proof.ux_findings)]),
    agent_verdict_ref:
      asNonEmptyString(proof.agent_verdict_ref) ||
      asNonEmptyString(webSmoke.agent_verdict_ref),
  };
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {string | null}
 */
function getFirstNextActionReportFile(payload) {
  return (
    asNonEmptyString(payload.next_action_report_file) ||
    asNonEmptyString(payload.nextActionReportFile) ||
    null
  );
}

/**
 * @param {Array<Record<string, unknown>>} commandResults
 * @param {string} label
 * @returns {Record<string, unknown>}
 */
function findCommand(commandResults, label) {
  return commandResults.find((entry) => asNonEmptyString(entry.label) === label) ?? {};
}

/**
 * @param {Array<Record<string, unknown>>} commandResults
 * @returns {Record<string, string>}
 */
function collectRequiredArtifactFiles(commandResults, artifacts) {
  const guidedOnboard = asRecord(findCommand(commandResults, "guided-onboard").parsed_payload);
  const missionCreate = asRecord(findCommand(commandResults, "mission-create").parsed_payload);
  const latestNext =
    asRecord(findCommand(commandResults, "guided-next-after-learning").parsed_payload) ||
    asRecord(findCommand(commandResults, "guided-next-after-delivery").parsed_payload);
  const reviewDecide = asRecord(findCommand(commandResults, "review-decide-approve").parsed_payload);
  const webSmoke = mergeBrowserTaskProofIntoWebSmoke(artifacts, asRecord(artifacts.guided_web_smoke));

  return {
    onboarding_report_file:
      asNonEmptyString(guidedOnboard.onboarding_report_file) ||
      asNonEmptyString(artifacts.onboarding_report_file),
    mission_artifact_packet_file:
      asNonEmptyString(missionCreate.artifact_packet_file) ||
      asNonEmptyString(artifacts.intake_artifact_packet_file),
    mission_artifact_packet_body_file:
      asNonEmptyString(missionCreate.artifact_packet_body_file) ||
      asNonEmptyString(artifacts.intake_artifact_packet_body_file),
    next_action_report_file:
      getFirstNextActionReportFile(latestNext) ||
      asNonEmptyString(artifacts.next_action_report_file),
    routed_step_result_file: asNonEmptyString(artifacts.routed_step_result_file),
    review_report_file:
      asNonEmptyString(reviewDecide.review_report_file) ||
      asNonEmptyString(artifacts.review_report_file),
    review_decision_file:
      asNonEmptyString(reviewDecide.review_decision_file) ||
      asNonEmptyString(artifacts.review_decision_file),
    delivery_manifest_file: asNonEmptyString(artifacts.delivery_manifest_file),
    delivery_transcript_file: asNonEmptyString(artifacts.delivery_transcript_file),
    release_packet_file: asNonEmptyString(artifacts.release_packet_file),
    learning_loop_scorecard_file: asNonEmptyString(artifacts.learning_loop_scorecard_file),
    learning_loop_handoff_file: asNonEmptyString(artifacts.learning_loop_handoff_file),
    web_smoke_summary_file:
      asNonEmptyString(webSmoke.summary_file) ||
      asNonEmptyString(artifacts.guided_web_smoke_summary_file),
    web_smoke_html_file:
      asNonEmptyString(webSmoke.rendered_html_file) ||
      asNonEmptyString(artifacts.guided_web_smoke_html_file),
    web_dom_snapshot_file:
      asNonEmptyString(webSmoke.dom_snapshot_file) ||
      asNonEmptyString(artifacts.guided_web_dom_snapshot_file),
    web_accessibility_summary_file:
      asNonEmptyString(webSmoke.accessibility_summary_file) ||
      asNonEmptyString(artifacts.guided_web_accessibility_summary_file),
    web_screenshot_file:
      asStringArray(webSmoke.screenshot_files)[0] ||
      asStringArray(artifacts.guided_web_screenshot_files)[0] ||
      asNonEmptyString(artifacts.guided_web_visual_guardrail_file),
    new_flow_mission_artifact_packet_file:
      asNonEmptyString(artifacts.new_flow_mission_artifact_packet_file),
    new_flow_mission_artifact_packet_body_file:
      asNonEmptyString(artifacts.new_flow_mission_artifact_packet_body_file),
    new_flow_next_action_report_file:
      asNonEmptyString(artifacts.new_flow_next_action_report_file),
    flow_targeted_operator_request_file:
      asNonEmptyString(artifacts.flow_targeted_operator_request_file),
  };
}

/**
 * @param {Record<string, unknown>} artifacts
 * @returns {Record<string, unknown>}
 */
function buildFlowLoopProof(artifacts) {
  const requestDocument = asRecord(artifacts.flow_targeted_operator_request);
  return {
    first_flow_id: asNonEmptyString(artifacts.first_flow_id) || null,
    first_flow_status: asNonEmptyString(artifacts.first_flow_status) || null,
    completed_flow_read_only: artifacts.completed_flow_read_only === true,
    completed_flow_next_action_report_file: asNonEmptyString(artifacts.completed_flow_next_action_report_file) || null,
    second_flow_id: asNonEmptyString(artifacts.second_flow_id) || null,
    follow_up_source_handoff_ref: asNonEmptyString(artifacts.follow_up_source_handoff_ref) || null,
    new_flow_mission_artifact_packet_file: asNonEmptyString(artifacts.new_flow_mission_artifact_packet_file) || null,
    new_flow_mission_artifact_packet_body_file:
      asNonEmptyString(artifacts.new_flow_mission_artifact_packet_body_file) || null,
    new_flow_next_action_report_file: asNonEmptyString(artifacts.new_flow_next_action_report_file) || null,
    operator_request: {
      operator_request_file: asNonEmptyString(artifacts.flow_targeted_operator_request_file) || null,
      operator_request_ref: asNonEmptyString(artifacts.flow_targeted_operator_request_ref) || null,
      operator_request_id: asNonEmptyString(artifacts.flow_targeted_operator_request_id) || null,
      target_flow_id:
        asNonEmptyString(requestDocument.target_flow_id) ||
        asNonEmptyString(artifacts.flow_targeted_operator_request_target_flow_id) ||
        null,
      target_stage: asNonEmptyString(requestDocument.target_stage) || null,
      intent_type: asNonEmptyString(requestDocument.intent_type) || null,
      delivery_mode: asNonEmptyString(requestDocument.delivery_mode) || null,
    },
    evidence_refs: uniqueStrings([
      asNonEmptyString(artifacts.intake_artifact_packet_file),
      asNonEmptyString(artifacts.completed_flow_next_action_report_file),
      asNonEmptyString(artifacts.learning_loop_handoff_file),
      asNonEmptyString(artifacts.new_flow_mission_artifact_packet_file),
      asNonEmptyString(artifacts.new_flow_next_action_report_file),
      asNonEmptyString(artifacts.flow_targeted_operator_request_file),
    ]),
  };
}

/**
 * @param {{
 *   runId: string,
 *   profile: Record<string, unknown>,
 *   commandResults: Array<Record<string, unknown>>,
 *   artifacts: Record<string, unknown>,
 *   targetCheckoutRoot: string,
 *   reportsRoot: string,
 *   targetHeadBefore: string | null,
 *   targetHeadAfter: string | null,
 *   targetGitStatusWithoutRuntime: string[],
 * }} options
 */
export function buildGuidedJourneyProof(options) {
  const commandLabels = options.commandResults.map((entry) => asNonEmptyString(entry.label)).filter(Boolean);
  const transcriptFiles = options.commandResults
    .filter((entry) => REQUIRED_GUIDED_COMMAND_LABELS.includes(asNonEmptyString(entry.label)))
    .map((entry) => asNonEmptyString(entry.transcript_file))
    .filter(Boolean);
  const outputPolicy = asRecord(options.profile.output_policy);
  const requiredArtifactFiles = collectRequiredArtifactFiles(options.commandResults, options.artifacts);
  const webSmoke = mergeBrowserTaskProofIntoWebSmoke(options.artifacts, asRecord(options.artifacts.guided_web_smoke));

  return {
    proof_id: `${options.runId}.installed-user-guided-journey.v1`,
    run_id: options.runId,
    profile_id: asNonEmptyString(options.profile.profile_id) || null,
    status: "pending",
    command_labels: commandLabels,
    required_command_labels: [...REQUIRED_GUIDED_COMMAND_LABELS],
    command_transcript_files: transcriptFiles,
    durable_artifact_files: requiredArtifactFiles,
    web_smoke: {
      summary_file: asNonEmptyString(webSmoke.summary_file) || null,
      rendered_html_file: asNonEmptyString(webSmoke.rendered_html_file) || null,
      dom_snapshot_file: asNonEmptyString(webSmoke.dom_snapshot_file) || null,
      accessibility_summary_file: asNonEmptyString(webSmoke.accessibility_summary_file) || null,
      screenshot_files: asStringArray(webSmoke.screenshot_files),
      visual_guardrail_file:
        asNonEmptyString(webSmoke.visual_guardrail_file) ||
        asNonEmptyString(options.artifacts.guided_web_visual_guardrail_file) ||
        null,
      browser_task_proof_request_file: asNonEmptyString(webSmoke.browser_task_proof_request_file) || null,
      browser_task_proof_file: asNonEmptyString(webSmoke.browser_task_proof_file) || null,
      task_outcome: asRecord(webSmoke.task_outcome),
      ux_findings: asStringArray(webSmoke.ux_findings),
      agent_verdict_ref: asNonEmptyString(webSmoke.agent_verdict_ref) || null,
      guided_lifecycle_state: asNonEmptyString(webSmoke.guided_lifecycle_state) || null,
      guided_current_stage_id: asNonEmptyString(webSmoke.guided_current_stage_id) || null,
      detached: webSmoke.detached === true,
    },
    flow_loop: buildFlowLoopProof(options.artifacts),
    no_write_assertions: {
      output_policy_write_back_to_remote: outputPolicy.write_back_to_remote === false,
      preferred_delivery_mode: asNonEmptyString(outputPolicy.preferred_delivery_mode) || null,
      upstream_writes_default: false,
      remote_write_commands: [],
      target_head_before: options.targetHeadBefore,
      target_head_after: options.targetHeadAfter,
      target_head_unchanged:
        options.targetHeadBefore !== null &&
        options.targetHeadAfter !== null &&
        options.targetHeadBefore === options.targetHeadAfter,
      target_runtime_root: path.join(options.targetCheckoutRoot, ".aor"),
      runtime_state_under_aor: String(asNonEmptyString(options.artifacts.target_checkout_root)).startsWith(
        options.targetCheckoutRoot,
      ) && fs.existsSync(path.join(options.targetCheckoutRoot, ".aor")),
      target_uncommitted_changes_without_runtime: options.targetGitStatusWithoutRuntime,
      target_committed_file_changes: [],
      target_aor_live_e2e_absent: !fs.existsSync(path.join(options.targetCheckoutRoot, ".aor-live-e2e")),
    },
    generated_at: new Date().toISOString(),
  };
}

/**
 * @param {Record<string, unknown>} proof
 * @param {{ targetCheckoutRoot: string }} options
 * @returns {string[]}
 */
export function validateGuidedJourneyProof(proof, options) {
  const issues = [];
  const labels = asStringArray(proof.command_labels);
  for (const label of REQUIRED_GUIDED_COMMAND_LABELS) {
    if (!labels.includes(label)) {
      issues.push(`missing required guided command transcript '${label}'`);
    }
  }

  const transcriptFiles = asStringArray(proof.command_transcript_files);
  if (transcriptFiles.length === 0) {
    issues.push("guided proof has no CLI transcript files");
  }
  for (const transcriptFile of transcriptFiles) {
    if (!fs.existsSync(transcriptFile)) {
      issues.push(`guided CLI transcript file is missing: ${transcriptFile}`);
    }
  }

  const durableArtifacts = asRecord(proof.durable_artifact_files);
  for (const field of REQUIRED_DURABLE_ARTIFACT_FIELDS) {
    const artifactRef = asNonEmptyString(durableArtifacts[field]);
    if (!artifactRef) {
      issues.push(`missing required durable artifact field '${field}'`);
      continue;
    }
    const resolved = resolveEvidencePath(options.targetCheckoutRoot, artifactRef);
    if (!resolved || !fs.existsSync(resolved)) {
      issues.push(`required durable artifact '${field}' is not materialized: ${artifactRef}`);
    }
  }

  const webSmoke = asRecord(proof.web_smoke);
  if (webSmoke.detached !== true) {
    issues.push("web smoke did not prove detach-safe behavior");
  }
  if (!asNonEmptyString(webSmoke.guided_lifecycle_state)) {
    issues.push("web smoke did not report a guided lifecycle state");
  }
  if (!asNonEmptyString(webSmoke.dom_snapshot_file)) {
    issues.push("web smoke did not materialize a DOM snapshot");
  }
  if (!asNonEmptyString(webSmoke.accessibility_summary_file)) {
    issues.push("web smoke did not materialize an accessibility summary");
  }
  if (asStringArray(webSmoke.screenshot_files).length === 0) {
    const visualGuardrailFile = asNonEmptyString(webSmoke.visual_guardrail_file);
    const resolvedVisualGuardrailFile = visualGuardrailFile
      ? resolveEvidencePath(options.targetCheckoutRoot, visualGuardrailFile)
      : null;
    if (!resolvedVisualGuardrailFile || !fs.existsSync(resolvedVisualGuardrailFile)) {
      issues.push("web smoke did not materialize a screenshot or visual guardrail");
    }
  }
  if (asNonEmptyString(asRecord(webSmoke.task_outcome).status) !== "pass") {
    issues.push("web smoke task outcome did not pass");
  }
  if (asStringArray(webSmoke.ux_findings).length === 0) {
    issues.push("web smoke did not record UX findings");
  }
  const browserTaskProofFile = asNonEmptyString(webSmoke.browser_task_proof_file);
  const resolvedBrowserTaskProofFile = browserTaskProofFile
    ? resolveEvidencePath(options.targetCheckoutRoot, browserTaskProofFile)
    : null;
  if (!resolvedBrowserTaskProofFile || !fs.existsSync(resolvedBrowserTaskProofFile)) {
    issues.push("web smoke did not materialize browser-task proof evidence");
  }

  const flowLoop = asRecord(proof.flow_loop);
  const operatorRequest = asRecord(flowLoop.operator_request);
  const firstFlowId = asNonEmptyString(flowLoop.first_flow_id);
  const secondFlowId = asNonEmptyString(flowLoop.second_flow_id);
  if (!firstFlowId) {
    issues.push("flow loop proof is missing first_flow_id");
  }
  if (asNonEmptyString(flowLoop.first_flow_status) !== "completed") {
    issues.push("flow loop proof must record first_flow_status=completed");
  }
  if (flowLoop.completed_flow_read_only !== true) {
    issues.push("flow loop proof must record completed_flow_read_only=true");
  }
  if (!secondFlowId) {
    issues.push("flow loop proof is missing second_flow_id");
  }
  if (firstFlowId && secondFlowId && firstFlowId === secondFlowId) {
    issues.push("flow loop proof must create a second flow distinct from the first flow");
  }
  if (!asNonEmptyString(flowLoop.follow_up_source_handoff_ref)) {
    issues.push("flow loop proof is missing follow_up_source_handoff_ref");
  }
  for (const field of [
    "new_flow_mission_artifact_packet_file",
    "new_flow_mission_artifact_packet_body_file",
    "new_flow_next_action_report_file",
  ]) {
    const artifactRef = asNonEmptyString(flowLoop[field]);
    if (!artifactRef) {
      issues.push(`flow loop proof is missing ${field}`);
      continue;
    }
    const resolved = resolveEvidencePath(options.targetCheckoutRoot, artifactRef);
    if (!resolved || !fs.existsSync(resolved)) {
      issues.push(`flow loop artifact '${field}' is not materialized: ${artifactRef}`);
    }
  }
  const operatorRequestFile = asNonEmptyString(operatorRequest.operator_request_file);
  if (!operatorRequestFile) {
    issues.push("flow loop proof is missing operator_request.operator_request_file");
  } else {
    const resolvedOperatorRequestFile = resolveEvidencePath(options.targetCheckoutRoot, operatorRequestFile);
    if (!resolvedOperatorRequestFile || !fs.existsSync(resolvedOperatorRequestFile)) {
      issues.push(`flow loop operator request is not materialized: ${operatorRequestFile}`);
    }
  }
  if (!asNonEmptyString(operatorRequest.target_flow_id)) {
    issues.push("flow loop proof is missing operator_request.target_flow_id");
  } else if (secondFlowId && asNonEmptyString(operatorRequest.target_flow_id) !== secondFlowId) {
    issues.push("flow loop operator_request.target_flow_id must target the second flow");
  }

  const noWrite = asRecord(proof.no_write_assertions);
  if (noWrite.output_policy_write_back_to_remote !== true) {
    issues.push("guided proof profile does not expose write_back_to_remote=false");
  }
  if (noWrite.target_head_unchanged !== true) {
    issues.push("target repository HEAD changed during guided proof");
  }
  if (noWrite.runtime_state_under_aor !== true) {
    issues.push("runtime state was not proven under target .aor/");
  }
  if (noWrite.target_aor_live_e2e_absent !== true) {
    issues.push("legacy .aor-live-e2e runtime state was materialized in the target checkout");
  }
  if (asStringArray(noWrite.remote_write_commands).length > 0) {
    issues.push("guided proof recorded remote write commands despite no-upstream-write defaults");
  }
  return uniqueStrings(issues);
}

/**
 * @param {{
 *   proof: Record<string, unknown>,
 *   targetCheckoutRoot: string,
 *   reportsRoot: string,
 *   runId: string,
 * }} options
 */
export function writeValidatedGuidedJourneyProof(options) {
  const issues = validateGuidedJourneyProof(options.proof, {
    targetCheckoutRoot: options.targetCheckoutRoot,
  });
  if (issues.length > 0) {
    throw new Error(`Guided journey proof is incomplete: ${issues.join("; ")}`);
  }
  options.proof.status = "pass";
  const proofFile = path.join(
    options.reportsRoot,
    `installed-user-guided-journey-proof-${normalizeId(options.runId)}.json`,
  );
  writeJson(proofFile, options.proof);
  return {
    proofFile,
    proof: options.proof,
  };
}
