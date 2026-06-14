#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { validateContractDocument } from "../../packages/contracts/src/index.mjs";
import {
  UsageError,
  asNonEmptyString,
  asRecord,
  asStringArray,
  normalizeId,
  nowIso,
  parseFlags,
  readJson,
  readYamlDocument,
  resolveOptionalStringFlag,
  uniqueStrings,
  writeJson,
} from "./lib/common.mjs";

const REQUIRED_DIMENSIONS = Object.freeze([
  "artifact_content_quality",
  "implementation_correctness",
  "implementation_completeness",
  "code_maintainability",
  "test_adequacy",
  "security_review",
  "performance_regression_risk",
  "verification_quality",
  "delivery_safety",
  "ui_ux_quality",
  "accessibility_quality",
  "evidence_strength",
  "acceptance_criteria_traceability",
]);

const FINDING_TAXONOMY = Object.freeze([
  "artifact-content",
  "implementation-correctness",
  "test-adequacy",
  "security",
  "performance",
  "ui-ux",
  "accessibility",
  "evidence-gap",
  "acceptance-traceability",
  "follow-up-needed",
]);

const DIMENSION_RUBRIC = Object.freeze({
  artifact_content_quality: [
    "completeness",
    "contradictions",
    "verifiability",
    "KPI/DoD traceability",
    "execution readiness",
    "architectural coherence",
  ],
  implementation_correctness: [
    "semantic mission behavior",
    "API compatibility",
    "edge cases",
    "error handling",
    "eval mission coverage limits",
  ],
  implementation_completeness: [
    "KPI coverage",
    "Definition of Done coverage",
    "acceptance criterion coverage",
    "mission-scoped required path coverage",
  ],
  code_maintainability: [
    "architecture boundary fit",
    "dependency use",
    "dead or duplicated code",
    "unsafe abstractions",
    "semantic feature-size fit",
    "readability",
  ],
  test_adequacy: [
    "changed-source coverage",
    "target command relevance",
    "regression sensitivity",
    "test weakening or bypass risk",
  ],
  security_review: [
    "secrets",
    "injection risks",
    "authn/authz changes",
    "unsafe file or network access",
    "dependency exposure",
    "data handling",
  ],
  performance_regression_risk: [
    "latency",
    "memory",
    "bundle size",
    "query complexity",
    "render cost",
    "mission-relevant performance regressions",
  ],
  verification_quality: [
    "project verify strength",
    "Runtime Harness evidence",
    "eval evidence mission coverage",
    "review evidence",
    "release evidence",
  ],
  delivery_safety: [
    "no-upstream-write proof",
    "delivery manifest correctness",
    "rollback or recovery guidance",
    "bounded write-back mode",
    "release packet safety",
  ],
  ui_ux_quality: [
    "target product UI/UX",
    "AOR operator UI separated from target UI",
    "task success",
    "copy clarity",
    "responsive visual evidence",
    "loading empty error and recovery states",
    "visual overlap risks",
  ],
  accessibility_quality: [
    "keyboard navigation",
    "focus order",
    "contrast",
    "screen-reader semantics",
    "axe-style evidence",
    "checklist limits",
  ],
  evidence_strength: [
    "strong direct signals",
    "medium supporting signals",
    "weak indirect signals",
    "missing evidence",
    "unevaluated dimensions",
  ],
  acceptance_criteria_traceability: [
    "criterion-to-evidence mapping",
    "KPI-to-evidence mapping",
    "Definition of Done mapping",
    "uncovered criteria findings",
  ],
});

const EVIDENCE_GROUP_FIELDS = Object.freeze({
  run_facts: [
    "live_e2e_run_summary_file",
    "live_e2e_observation_report_file",
    "live_e2e_run_health_report_file",
    "live_e2e_controller_state_file",
    "aor_installation_proof_file",
    "preflight_step_result_files",
  ],
  review_eval_harness: [
    "review_report_file",
    "evaluation_report_file",
    "runtime_harness_report_file",
    "latest_runtime_harness_report_file",
    "run_start_runtime_harness_report_file",
    "delivery_runtime_harness_report_file",
    "post_run_verify_summary_file",
    "post_run_diagnostic_verify_summary_file",
    "post_run_verify_step_result_files",
    "post_run_primary_verify_step_result_files",
  ],
  delivery_release_learning: [
    "delivery_plan_file",
    "delivery_manifest_file",
    "delivery_transcript_file",
    "release_packet_file",
    "release_transcript_file",
    "learning_loop_scorecard_file",
    "learning_loop_handoff_file",
    "learning_loop_transcript_file",
  ],
  frontend_browser: [
    "guided_web_smoke_summary_file",
    "guided_web_smoke_html_file",
    "guided_web_dom_snapshot_file",
    "guided_web_accessibility_summary_file",
    "guided_web_screenshot_files",
    "guided_web_visual_guardrail_file",
    "guided_browser_task_proof_request_file",
    "guided_browser_task_proof_file",
  ],
  acceptance_kpi_dod: [
    "feature_request_file",
    "intake_artifact_packet_file",
    "discovery_step_result_file",
    "spec_step_result_file",
    "approved_handoff_packet_file",
    "handoff_step_result_file",
    "execution_readiness_file",
  ],
});

/**
 * @param {string} filePath
 * @returns {Record<string, unknown>}
 */
function readDocument(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    return asRecord(readYamlDocument(filePath));
  }
  return asRecord(readJson(filePath));
}

/**
 * @param {Record<string, unknown>} record
 * @param {string[]} fields
 * @returns {string[]}
 */
function collectNamedRefs(record, fields) {
  const refs = [];
  for (const field of fields) {
    refs.push(...asStringArray(record[field]));
    const value = asNonEmptyString(record[field]);
    if (value) refs.push(value);
  }
  return uniqueStrings(refs);
}

/**
 * @param {unknown} value
 * @param {string[]} refs
 */
function collectRefsDeep(value, refs) {
  if (typeof value === "string") {
    const trimmed = asNonEmptyString(value);
    if (
      trimmed &&
      /^(?:[a-z]+:\/\/|\/|\.\.?\/)/iu.test(trimmed)
    ) {
      refs.push(trimmed);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectRefsDeep(entry, refs);
    return;
  }
  const record = asRecord(value);
  for (const [key, entry] of Object.entries(record)) {
    if (/(?:_file|_ref|_refs|_files|evidence_refs|artifact_refs|screenshot_refs)$/iu.test(key)) {
      if (typeof entry === "string") refs.push(entry);
      if (Array.isArray(entry)) refs.push(...asStringArray(entry));
    }
    collectRefsDeep(entry, refs);
  }
}

/**
 * @param {Record<string, unknown>} observationReport
 * @returns {string[]}
 */
function collectFrontendRefs(observationReport) {
  const refs = [];
  const frontendInteractions = Array.isArray(observationReport.frontend_interactions)
    ? observationReport.frontend_interactions.map((entry) => asRecord(entry))
    : [];
  for (const interaction of frontendInteractions) {
    refs.push(
      asNonEmptyString(interaction.html_ref),
      asNonEmptyString(interaction.dom_snapshot_ref),
      asNonEmptyString(interaction.accessibility_summary_ref),
      asNonEmptyString(interaction.visual_guardrail_ref),
      asNonEmptyString(interaction.agent_verdict_ref),
      ...asStringArray(interaction.screenshot_refs),
      ...asStringArray(interaction.visual_guardrail_refs),
      ...asStringArray(interaction.evidence_refs),
    );
  }
  return uniqueStrings(refs.filter(Boolean));
}

/**
 * @param {{ runSummaryFile: string, runSummary: Record<string, unknown>, observationReport: Record<string, unknown>, runHealthReport: Record<string, unknown> }} options
 */
function buildEvidenceGroups(options) {
  const seededSummary = {
    ...options.runSummary,
    live_e2e_run_summary_file: options.runSummaryFile,
  };
  const groups = Object.fromEntries(
    Object.entries(EVIDENCE_GROUP_FIELDS).map(([group, fields]) => [group, collectNamedRefs(seededSummary, fields)]),
  );
  groups.run_facts = uniqueStrings([
    ...groups.run_facts,
    asNonEmptyString(options.runSummary.live_e2e_observation_report_file),
    asNonEmptyString(options.runSummary.live_e2e_run_health_report_file),
    ...asStringArray(options.runHealthReport.evidence_refs),
  ]);
  groups.frontend_browser = uniqueStrings([
    ...groups.frontend_browser,
    ...collectFrontendRefs(options.observationReport),
  ]);
  const allRefs = [];
  collectRefsDeep(options.runSummary, allRefs);
  collectRefsDeep(options.observationReport, allRefs);
  collectRefsDeep(options.runHealthReport, allRefs);
  return {
    ...groups,
    all_known_refs: uniqueStrings([options.runSummaryFile, ...Object.values(groups).flat(), ...allRefs]),
  };
}

/**
 * @param {string} ref
 * @param {string} baseDir
 * @returns {string | null}
 */
function resolveLocalEvidenceRef(ref, baseDir) {
  const value = asNonEmptyString(ref);
  if (!value) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(value)) {
    if (value.startsWith("file://")) {
      return new URL(value).pathname;
    }
    if (value.startsWith("runtime://reports/")) {
      return path.resolve(baseDir, value.slice("runtime://reports/".length));
    }
    if (value.startsWith("runtime://artifacts/")) {
      return path.resolve(baseDir, "..", "artifacts", value.slice("runtime://artifacts/".length));
    }
    return null;
  }
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function collectAssessmentRefs(value) {
  const refs = [];
  collectRefsDeep(value, refs);
  return uniqueStrings(refs);
}

/**
 * @param {Record<string, unknown>} assessment
 * @param {string} baseDir
 */
function validateLocalRefs(assessment, baseDir) {
  const refs = uniqueStrings([
    asNonEmptyString(assessment.source_run_summary_file),
    asNonEmptyString(assessment.source_observation_report_file),
    asNonEmptyString(assessment.source_run_health_report_file),
    asNonEmptyString(assessment.assessment_request_file),
    ...collectAssessmentRefs(assessment),
  ].filter(Boolean));
  const checked = [];
  const skipped = [];
  const missing = [];
  for (const ref of refs) {
    const resolved = resolveLocalEvidenceRef(ref, baseDir);
    if (!resolved) {
      skipped.push(ref);
      continue;
    }
    checked.push({ ref, resolved });
    if (!fs.existsSync(resolved)) {
      missing.push({ ref, resolved });
    }
  }
  return {
    checked,
    skipped,
    missing,
  };
}

/**
 * @param {string[]} rawArgs
 */
function prepareCli(rawArgs) {
  const flags = parseFlags(rawArgs);
  const runSummaryFile = path.resolve(
    resolveOptionalStringFlag(flags["run-summary-file"], "run-summary-file") ??
      (() => {
        throw new UsageError("Flag '--run-summary-file' is required.");
      })(),
  );
  if (!fs.existsSync(runSummaryFile)) {
    throw new UsageError(`Run summary file '${runSummaryFile}' was not found.`);
  }
  const runSummary = asRecord(readJson(runSummaryFile));
  const runId = asNonEmptyString(runSummary.run_id) || "live-e2e-run";
  const profileId = asNonEmptyString(runSummary.profile_id) || null;
  const baseDir = path.dirname(runSummaryFile);
  const observationFile = asNonEmptyString(runSummary.live_e2e_observation_report_file);
  const runHealthFile =
    asNonEmptyString(runSummary.live_e2e_run_health_report_file) || asNonEmptyString(runSummary.run_health_report_file);
  const observationReport =
    observationFile && fs.existsSync(resolveLocalEvidenceRef(observationFile, baseDir) ?? "")
      ? readDocument(resolveLocalEvidenceRef(observationFile, baseDir) ?? observationFile)
      : {};
  const runHealthReport =
    runHealthFile && fs.existsSync(resolveLocalEvidenceRef(runHealthFile, baseDir) ?? "")
      ? readDocument(resolveLocalEvidenceRef(runHealthFile, baseDir) ?? runHealthFile)
      : {};
  const requestFile = path.join(baseDir, `live-e2e-quality-assessment-request-${normalizeId(runId)}.json`);
  const expectedAssessmentReportFile = path.join(
    baseDir,
    `live-e2e-quality-assessment-report-${normalizeId(runId)}.yaml`,
  );
  const request = {
    request_id: `${normalizeId(runId)}.quality-assessment-request.v1`,
    run_id: runId,
    profile_id: profileId,
    generated_at: nowIso(),
    evaluator: {
      kind: "swe-agent",
      mode: "post-run-freeform",
      responsibility: "Assess outcome quality after the full flow; do not mutate run status or provider qualification.",
    },
    source_run_summary_file: runSummaryFile,
    source_observation_report_file: observationFile || null,
    source_run_health_report_file: runHealthFile || null,
    expected_assessment_report_file: expectedAssessmentReportFile,
    separation_contract: {
      live_e2e_observation_report: "factual-only setup, step, command, artifact, and evidence journal",
      live_e2e_run_health_report: "run health only: command, controller, provider, target, environment, operator, and AOR-owner issues",
      live_e2e_quality_assessment_report: "post-run advisory outcome assessment for artifacts, code, verification, delivery safety, UI/UX, accessibility, and traceability",
    },
    run_identity: {
      target_catalog_id: asNonEmptyString(runSummary.target_catalog_id) || null,
      feature_mission_id: asNonEmptyString(runSummary.feature_mission_id) || null,
      scenario_family: asNonEmptyString(runSummary.scenario_family) || null,
      provider_variant_id: asNonEmptyString(runSummary.provider_variant_id) || null,
      feature_size: asNonEmptyString(runSummary.feature_size) || null,
      commit_sha: asNonEmptyString(runSummary.commit_sha) || null,
      branch_name: asNonEmptyString(runSummary.branch_name) || null,
      run_health_status:
        asNonEmptyString(runHealthReport.overall_status) ||
        asNonEmptyString(asRecord(runSummary.run_health).overall_status) ||
        asNonEmptyString(runSummary.live_e2e_run_health_overall_status) ||
        null,
    },
    required_dimensions: [...REQUIRED_DIMENSIONS],
    dimension_rubric: DIMENSION_RUBRIC,
    finding_taxonomy: [...FINDING_TAXONOMY],
    quality_report_requirements: [
      "Use status pass|warn|fail|not_evaluated for every required dimension.",
      "Use evidence_strength strong|medium|weak|missing for every required dimension.",
      "Populate inspected_evidence_refs for every evaluated dimension.",
      "Use not_evaluated only with evidence_strength=missing and an explicit finding explaining the gap.",
      "Make gap_report match dimensions: every not_evaluated, weak, and strong dimension must be listed in the corresponding gap_report array.",
      "Treat default evaluation reports as supporting evidence unless their mission coverage is directly inspected.",
      "Separate AOR operator UI evidence from target product UI/UX evidence.",
    ],
    evidence_refs: buildEvidenceGroups({
      runSummaryFile,
      runSummary,
      observationReport,
      runHealthReport,
    }),
    instructions: [
      "Inspect evidence freely as a SWE evaluator; no predetermined fixtures are assumed.",
      "Do not rewrite the factual observation report or run-health report.",
      "Do not change run/qualification exit status from this assessment; it is advisory outcome quality evidence.",
      "Call out dimensions that were not checked, checked with weak signal, or confirmed by strong evidence.",
    ],
  };
  writeJson(requestFile, request);
  process.stdout.write(
    `${JSON.stringify(
      {
        command: "scripts live-e2e quality-assessment prepare",
        status: "ok",
        run_id: runId,
        assessment_request_file: requestFile,
        expected_assessment_report_file: expectedAssessmentReportFile,
      },
      null,
      2,
    )}\n`,
  );
  return 0;
}

/**
 * @param {string[]} rawArgs
 */
function validateCli(rawArgs) {
  const flags = parseFlags(rawArgs);
  const assessmentReportFile = path.resolve(
    resolveOptionalStringFlag(flags["assessment-report-file"], "assessment-report-file") ??
      (() => {
        throw new UsageError("Flag '--assessment-report-file' is required.");
      })(),
  );
  if (!fs.existsSync(assessmentReportFile)) {
    throw new UsageError(`Assessment report file '${assessmentReportFile}' was not found.`);
  }
  const assessment = readDocument(assessmentReportFile);
  const validation = validateContractDocument({
    family: "live-e2e-quality-assessment-report",
    document: assessment,
    source: assessmentReportFile,
  });
  const refValidation = validateLocalRefs(assessment, path.dirname(assessmentReportFile));
  const ok = validation.ok && refValidation.missing.length === 0;
  process.stdout.write(
    `${JSON.stringify(
      {
        command: "scripts live-e2e quality-assessment validate",
        status: ok ? "ok" : "fail",
        assessment_report_file: assessmentReportFile,
        contract_validation_ok: validation.ok,
        contract_issue_count: validation.issues.length,
        contract_issues: validation.issues,
        checked_local_ref_count: refValidation.checked.length,
        skipped_external_ref_count: refValidation.skipped.length,
        missing_local_refs: refValidation.missing,
      },
      null,
      2,
    )}\n`,
  );
  return ok ? 0 : 1;
}

/**
 * @param {string[]} rawArgs
 */
function runCli(rawArgs) {
  if (rawArgs.includes("--help") || rawArgs.includes("-h") || rawArgs.length === 0) {
    process.stdout.write(
      [
        "Usage: node ./scripts/live-e2e/quality-assessment.mjs prepare --run-summary-file <file>",
        "       node ./scripts/live-e2e/quality-assessment.mjs validate --assessment-report-file <file>",
        "",
        "Prepares and validates post-run outcome quality assessment artifacts without changing run-health or qualification status.",
      ].join("\n"),
    );
    return 0;
  }
  const [command, ...rest] = rawArgs;
  if (command === "prepare") return prepareCli(rest);
  if (command === "validate") return validateCli(rest);
  throw new UsageError(`Unknown quality-assessment command '${command}'.`);
}

try {
  process.exitCode = runCli(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } else {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
