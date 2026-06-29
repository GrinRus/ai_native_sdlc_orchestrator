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
  resolveOptionalBooleanFlag,
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
  "aor_operator_ui_ux_quality",
  "aor_operator_accessibility_quality",
  "evidence_strength",
  "acceptance_criteria_traceability",
]);

const AOR_OPERATOR_UI_UX_SUBDIMENSIONS = Object.freeze([
  "task_success",
  "flow_navigation_clarity",
  "next_action_clarity",
  "blocker_and_error_understandability",
  "recovery_affordance",
  "state_feedback_loading_empty_error",
  "visual_stability_responsiveness",
  "raw_json_independence",
]);

const AOR_OPERATOR_ACCESSIBILITY_SUBDIMENSIONS = Object.freeze([
  "keyboard_navigation",
  "focus_order",
  "contrast_and_readability",
  "semantic_structure",
  "screen_reader_labels",
  "accessible_error_feedback",
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

const ASSESSABLE_RUN_HEALTH_STATUSES = Object.freeze(["pass", "warn"]);
const ASSESSABLE_OBSERVATION_STATUSES = Object.freeze(["pass", "warn"]);
const ALL_PASS_ALLOWED_EVIDENCE_STRENGTHS = Object.freeze(["medium", "strong"]);
const BLOCKING_FINDING_SEVERITIES = Object.freeze(["blocker", "critical", "high", "major"]);

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
  aor_operator_ui_ux_quality: [
    "AOR installed-user task success",
    "flow navigation clarity",
    "next action clarity",
    "blocker and error understandability",
    "recovery affordance",
    "loading empty error and recovery state feedback",
    "visual stability and responsiveness",
    "operator can proceed without raw JSON inspection",
  ],
  aor_operator_accessibility_quality: [
    "keyboard navigation",
    "focus order",
    "contrast and readability",
    "semantic structure",
    "screen-reader labels",
    "accessible error feedback",
  ],
  aor_operator_ui_ux_subdimensions: AOR_OPERATOR_UI_UX_SUBDIMENSIONS,
  aor_operator_accessibility_subdimensions: AOR_OPERATOR_ACCESSIBILITY_SUBDIMENSIONS,
  legacy_scope_exclusion: [
    "Repository-owned frontend behavior is not part of the live E2E AOR operator UI/UX assessment.",
    "Frontend changes in the checked repository, when a mission includes them, are assessed through implementation and verification dimensions.",
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
    "post_run_diagnostic_verify_step_result_files",
    "post_run_diagnostic_verify_preserved_files",
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
  aor_operator_ui: [
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

const ACCEPTANCE_REF_PATTERNS = Object.freeze([
  /feature-request-/iu,
  /intake.*artifact.*packet/iu,
  /artifact-packet/iu,
  /project-analysis-report/iu,
  /discovery/iu,
  /spec/iu,
  /handoff/iu,
  /execution-readiness/iu,
]);

const AOR_OPERATOR_UI_REF_PATTERNS = Object.freeze([
  /guided-web/iu,
  /web-smoke/iu,
  /browser-task-proof/iu,
  /accessibility/iu,
  /visual-guardrail/iu,
  /dom-snapshot/iu,
  /screenshot/iu,
]);

const DRAFT_DIMENSION_REF_GROUPS = Object.freeze({
  artifact_content_quality: ["acceptance_kpi_dod", "review_eval_harness", "delivery_release_learning"],
  implementation_correctness: ["review_eval_harness", "all_known_refs"],
  implementation_completeness: ["acceptance_kpi_dod", "review_eval_harness", "delivery_release_learning"],
  code_maintainability: ["review_eval_harness", "all_known_refs"],
  test_adequacy: ["review_eval_harness"],
  security_review: [],
  performance_regression_risk: [],
  verification_quality: ["review_eval_harness"],
  delivery_safety: ["delivery_release_learning", "run_facts"],
  aor_operator_ui_ux_quality: ["aor_operator_ui", "paired_aor_operator_ui"],
  aor_operator_accessibility_quality: ["aor_operator_ui", "paired_aor_operator_ui"],
  evidence_strength: ["run_facts", "review_eval_harness", "aor_operator_ui", "acceptance_kpi_dod"],
  acceptance_criteria_traceability: ["acceptance_kpi_dod", "review_eval_harness"],
});

const DRAFT_DIMENSION_FINDING_CATEGORY = Object.freeze({
  artifact_content_quality: "artifact-content",
  implementation_correctness: "implementation-correctness",
  implementation_completeness: "acceptance-traceability",
  code_maintainability: "follow-up-needed",
  test_adequacy: "test-adequacy",
  security_review: "security",
  performance_regression_risk: "performance",
  verification_quality: "evidence-gap",
  delivery_safety: "follow-up-needed",
  aor_operator_ui_ux_quality: "ui-ux",
  aor_operator_accessibility_quality: "accessibility",
  evidence_strength: "evidence-gap",
  acceptance_criteria_traceability: "acceptance-traceability",
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
      asNonEmptyString(interaction.operator_decision_ref),
      ...asStringArray(interaction.screenshot_refs),
      ...asStringArray(interaction.visual_guardrail_refs),
      ...asStringArray(interaction.operator_decision_refs),
      ...asStringArray(interaction.evidence_refs),
    );
  }
  return uniqueStrings(refs.filter(Boolean));
}

/**
 * @param {string[]} refs
 * @param {RegExp[]} patterns
 * @returns {string[]}
 */
function filterRefsByPatterns(refs, patterns) {
  return uniqueStrings(refs.filter((ref) => patterns.some((pattern) => pattern.test(ref))));
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
  const allRefs = [];
  collectRefsDeep(options.runSummary, allRefs);
  collectRefsDeep(options.observationReport, allRefs);
  collectRefsDeep(options.runHealthReport, allRefs);
  groups.run_facts = uniqueStrings([
    ...groups.run_facts,
    asNonEmptyString(options.runSummary.live_e2e_observation_report_file),
    asNonEmptyString(options.runSummary.live_e2e_run_health_report_file),
    ...asStringArray(options.runHealthReport.evidence_refs),
  ]);
  groups.aor_operator_ui = uniqueStrings([
    ...groups.aor_operator_ui,
    ...collectFrontendRefs(options.observationReport),
    ...filterRefsByPatterns(allRefs, AOR_OPERATOR_UI_REF_PATTERNS),
  ]);
  groups.acceptance_kpi_dod = uniqueStrings([
    ...groups.acceptance_kpi_dod,
    ...filterRefsByPatterns(allRefs, ACCEPTANCE_REF_PATTERNS),
  ]);
  return {
    ...groups,
    all_known_refs: uniqueStrings([options.runSummaryFile, ...Object.values(groups).flat(), ...allRefs]),
  };
}

/**
 * @param {Record<string, unknown>} request
 * @param {string | null} pairedRunSummaryFile
 * @param {string} baseDir
 */
function attachPairedAorOperatorUiEvidence(request, pairedRunSummaryFile, baseDir) {
  if (!pairedRunSummaryFile) return;
  const resolvedPairedSummary = path.resolve(baseDir, pairedRunSummaryFile);
  if (!fs.existsSync(resolvedPairedSummary)) {
    throw new UsageError(`Paired AOR operator UI run summary file '${resolvedPairedSummary}' was not found.`);
  }
  const pairedRunSummary = asRecord(readJson(resolvedPairedSummary));
  const pairedObservationFile = asNonEmptyString(pairedRunSummary.live_e2e_observation_report_file);
  const pairedRunHealthFile =
    asNonEmptyString(pairedRunSummary.live_e2e_run_health_report_file) ||
    asNonEmptyString(pairedRunSummary.run_health_report_file);
  const pairedObservationReport =
    pairedObservationFile && fs.existsSync(resolveLocalEvidenceRef(pairedObservationFile, path.dirname(resolvedPairedSummary)) ?? "")
      ? readDocument(resolveLocalEvidenceRef(pairedObservationFile, path.dirname(resolvedPairedSummary)) ?? pairedObservationFile)
      : {};
  const pairedRunHealthReport =
    pairedRunHealthFile && fs.existsSync(resolveLocalEvidenceRef(pairedRunHealthFile, path.dirname(resolvedPairedSummary)) ?? "")
      ? readDocument(resolveLocalEvidenceRef(pairedRunHealthFile, path.dirname(resolvedPairedSummary)) ?? pairedRunHealthFile)
      : {};
  const pairedGroups = buildEvidenceGroups({
    runSummaryFile: resolvedPairedSummary,
    runSummary: pairedRunSummary,
    observationReport: pairedObservationReport,
    runHealthReport: pairedRunHealthReport,
  });
  const evidenceRefs = asRecord(request.evidence_refs);
  evidenceRefs.paired_aor_operator_ui = uniqueStrings([
    resolvedPairedSummary,
    pairedObservationFile,
    pairedRunHealthFile,
    ...asStringArray(pairedGroups.aor_operator_ui),
  ]);
  evidenceRefs.aor_operator_ui = uniqueStrings([
    ...asStringArray(evidenceRefs.aor_operator_ui),
    ...asStringArray(evidenceRefs.paired_aor_operator_ui),
  ]);
  evidenceRefs.all_known_refs = uniqueStrings([
    ...asStringArray(evidenceRefs.all_known_refs),
    ...asStringArray(pairedGroups.all_known_refs),
  ]);
  request.evidence_refs = evidenceRefs;
  request.paired_aor_operator_ui_proof = {
    source_run_summary_file: resolvedPairedSummary,
    source_observation_report_file: pairedObservationFile || null,
    source_run_health_report_file: pairedRunHealthFile || null,
    usage: "AOR operator UI/UX and accessibility evidence may be reused when it was produced for the same AOR commit because these dimensions assess the AOR operator experience, not the target repository UI.",
  };
}

/**
 * @param {Record<string, unknown>} request
 * @param {string[]} groups
 * @returns {string[]}
 */
function collectDraftRefsForGroups(request, groups) {
  const evidenceRefs = asRecord(request.evidence_refs);
  return uniqueStrings(
    groups.flatMap((group) => {
      const refs = asStringArray(evidenceRefs[group]);
      if (group === "all_known_refs") {
        return refs.filter((ref) => !/README\.md$/u.test(ref)).slice(0, 18);
      }
      return refs;
    }),
  ).slice(0, 24);
}

/**
 * @param {string} dimensionKey
 * @param {string[]} refs
 * @returns {Record<string, unknown>}
 */
function buildDraftDimension(dimensionKey, refs) {
  const category = DRAFT_DIMENSION_FINDING_CATEGORY[dimensionKey] || "evidence-gap";
  if (refs.length === 0) {
    return {
      status: "not_evaluated",
      evidence_strength: "missing",
      inspected_evidence_refs: [],
      findings: [
        {
          category,
          severity: "medium",
          summary: `Draft hydration found no direct public evidence refs for ${dimensionKey}; SWE evaluator judgement is required before acceptance.`,
          evidence_refs: [],
        },
      ],
      recommended_followups: [`Inspect and attach public evidence for ${dimensionKey} before attempting all-pass closure.`],
    };
  }
  return {
    status: "warn",
    evidence_strength: "weak",
    inspected_evidence_refs: refs,
    findings: [
      {
        category,
        severity: "medium",
        summary: `Draft hydration attached public evidence refs for ${dimensionKey}, but no SWE judgement has confirmed pass quality yet.`,
        evidence_refs: refs,
      },
    ],
    recommended_followups: [`Replace this draft judgement with explicit SWE assessment for ${dimensionKey}.`],
  };
}

/**
 * @param {string[]} keys
 * @param {string[]} refs
 * @param {"ui-ux" | "accessibility"} category
 * @returns {Record<string, unknown>}
 */
function buildDraftSubdimensions(keys, refs, category) {
  return Object.fromEntries(
    keys.map((key) => {
      if (refs.length === 0) {
        return [
          key,
          {
            status: "not_evaluated",
            evidence_strength: "missing",
            evidence_refs: [],
            findings: [
              {
                category,
                severity: "medium",
                summary: `Draft hydration found no AOR operator evidence for ${key}; SWE evaluator judgement is required.`,
                evidence_refs: [],
              },
            ],
          },
        ];
      }
      return [
        key,
        {
          status: "warn",
          evidence_strength: "weak",
          evidence_refs: refs,
          findings: [
            {
              category,
              severity: "medium",
              summary: `Draft hydration attached AOR operator evidence for ${key}, but pass quality is not yet evaluator-confirmed.`,
              evidence_refs: refs,
            },
          ],
        },
      ];
    }),
  );
}

/**
 * @param {Record<string, unknown>} request
 * @param {string} reportFile
 * @returns {Record<string, unknown>}
 */
function buildDraftAssessmentReport(request, reportFile) {
  const runIdentity = asRecord(request.run_identity);
  const dimensions = Object.fromEntries(
    REQUIRED_DIMENSIONS.map((dimensionKey) => {
      const refs = collectDraftRefsForGroups(request, DRAFT_DIMENSION_REF_GROUPS[dimensionKey] || []);
      const dimension = buildDraftDimension(dimensionKey, refs);
      if (dimensionKey === "aor_operator_ui_ux_quality") {
        dimension.subdimensions = buildDraftSubdimensions(AOR_OPERATOR_UI_UX_SUBDIMENSIONS, refs, "ui-ux");
      }
      if (dimensionKey === "aor_operator_accessibility_quality") {
        dimension.subdimensions = buildDraftSubdimensions(AOR_OPERATOR_ACCESSIBILITY_SUBDIMENSIONS, refs, "accessibility");
      }
      return [dimensionKey, dimension];
    }),
  );
  const notEvaluatedDimensions = REQUIRED_DIMENSIONS.filter(
    (dimensionKey) => asRecord(dimensions[dimensionKey]).status === "not_evaluated",
  );
  const weakSignalDimensions = REQUIRED_DIMENSIONS.filter(
    (dimensionKey) => asRecord(dimensions[dimensionKey]).evidence_strength === "weak",
  );
  const assessmentRequestFile = asNonEmptyString(request.assessment_request_file);
  const requestEvidenceRefs = uniqueStrings([
    asNonEmptyString(request.source_run_summary_file),
    asNonEmptyString(request.source_observation_report_file),
    asNonEmptyString(request.source_run_health_report_file),
    assessmentRequestFile,
    ...asStringArray(asRecord(request.evidence_refs).run_facts),
  ]);
  return {
    assessment_id: `${asNonEmptyString(request.run_id) || "live-e2e-run"}.quality-assessment.draft.v1`,
    run_id: asNonEmptyString(request.run_id) || "live-e2e-run",
    profile_id: asNonEmptyString(request.profile_id) || "unknown-profile",
    generated_at: nowIso(),
    evaluator: {
      kind: "swe-agent",
      ref: "skill://live-e2e-runner",
      mode: "hydrated-draft",
    },
    source_run_summary_file: asNonEmptyString(request.source_run_summary_file),
    source_observation_report_file: asNonEmptyString(request.source_observation_report_file),
    source_run_health_report_file: asNonEmptyString(request.source_run_health_report_file),
    assessment_request_file: assessmentRequestFile,
    overall_status: "warn",
    dimensions,
    gap_report: {
      not_evaluated_dimensions: notEvaluatedDimensions,
      weak_signal_dimensions: weakSignalDimensions,
      strong_evidence_dimensions: [],
    },
    findings: [
      {
        category: "evidence-gap",
        severity: "medium",
        summary:
          "This is an automatically hydrated draft. It preserves public evidence refs and explicit gaps, but it is not product acceptance until a SWE evaluator replaces draft judgements and all-pass gate succeeds.",
        evidence_refs: requestEvidenceRefs,
      },
    ],
    recommended_followups: [
      "Inspect linked evidence and replace draft warn/not_evaluated dimensions with evaluator-authored judgements.",
      "Run quality-assessment validate and gate --policy all-pass only after completing SWE evaluator review.",
    ],
    evidence_refs: uniqueStrings([
      ...requestEvidenceRefs,
      ...asStringArray(asRecord(request.evidence_refs).review_eval_harness),
      ...asStringArray(asRecord(request.evidence_refs).delivery_release_learning),
      ...asStringArray(asRecord(request.evidence_refs).aor_operator_ui),
      ...asStringArray(asRecord(request.evidence_refs).acceptance_kpi_dod),
    ]),
    draft_metadata: {
      generated_from_request: true,
      product_acceptance_required: runIdentity.product_acceptance_required === true,
      all_pass_expected_to_fail_until_evaluator_review: true,
    },
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
 * @param {Record<string, unknown>} report
 * @returns {string[]}
 */
function collectRuntimeHarnessMeaningfulChangedPaths(report) {
  const stepDecisions = Array.isArray(report.step_decisions) ? report.step_decisions.map((entry) => asRecord(entry)) : [];
  return uniqueStrings(
    stepDecisions.flatMap((entry) => {
      const semantics = asRecord(entry.mission_semantics);
      return [
        ...asStringArray(semantics.meaningful_changed_paths),
        ...asStringArray(semantics.non_bootstrap_changed_paths),
      ];
    }),
  );
}

/**
 * @param {Record<string, unknown>} report
 * @returns {string[]}
 */
function collectReviewMeaningfulChangedPaths(report) {
  const codeQuality = asRecord(report.code_quality);
  const diagnostics = asRecord(codeQuality.changed_path_diagnostics);
  return uniqueStrings([
    ...asStringArray(codeQuality.changed_paths),
    ...asStringArray(diagnostics.meaningful_changed_paths),
  ]);
}

/**
 * @param {Record<string, unknown>} runSummary
 * @param {string} summaryBaseDir
 * @returns {{ runtimeHarnessChangedPaths: string[], reviewChangedPaths: string[], sourceRefs: string[] }}
 */
function collectSourceReportChangedPaths(runSummary, summaryBaseDir) {
  const runtimeHarnessRefs = uniqueStrings([
    asNonEmptyString(runSummary.runtime_harness_report_file),
    asNonEmptyString(runSummary.latest_runtime_harness_report_file),
    asNonEmptyString(runSummary.run_start_runtime_harness_report_file),
    asNonEmptyString(runSummary.delivery_runtime_harness_report_file),
  ]);
  const reviewRefs = uniqueStrings([asNonEmptyString(runSummary.review_report_file)]);
  const runtimeHarnessChangedPaths = [];
  const reviewChangedPaths = [];
  const sourceRefs = [];
  for (const reportRef of runtimeHarnessRefs) {
    const reportFile = resolveLocalEvidenceRef(reportRef, summaryBaseDir);
    if (!reportFile || !fs.existsSync(reportFile)) continue;
    sourceRefs.push(reportRef);
    runtimeHarnessChangedPaths.push(...collectRuntimeHarnessMeaningfulChangedPaths(asRecord(readJson(reportFile))));
  }
  for (const reportRef of reviewRefs) {
    const reportFile = resolveLocalEvidenceRef(reportRef, summaryBaseDir);
    if (!reportFile || !fs.existsSync(reportFile)) continue;
    sourceRefs.push(reportRef);
    reviewChangedPaths.push(...collectReviewMeaningfulChangedPaths(asRecord(readJson(reportFile))));
  }
  return {
    runtimeHarnessChangedPaths: uniqueStrings(runtimeHarnessChangedPaths),
    reviewChangedPaths: uniqueStrings(reviewChangedPaths),
    sourceRefs: uniqueStrings(sourceRefs),
  };
}

/**
 * @param {Record<string, unknown>} runSummary
 * @param {Record<string, unknown>} observationReport
 * @param {Record<string, unknown>} runHealthReport
 */
function resolveAssessmentReadiness(runSummary, observationReport, runHealthReport) {
  const runHealthStatus =
    asNonEmptyString(runHealthReport.overall_status) ||
    asNonEmptyString(asRecord(runSummary.run_health).overall_status) ||
    asNonEmptyString(runSummary.live_e2e_run_health_overall_status) ||
    null;
  const observationStatus =
    asNonEmptyString(observationReport.overall_status) ||
    asNonEmptyString(runSummary.live_e2e_observation_overall_status) ||
    null;
  const failureSummary = asRecord(runHealthReport.failure_summary);
  const failureClass =
    asNonEmptyString(failureSummary.class) ||
    asNonEmptyString(asRecord(runHealthReport.provider_health).context_budget_failure_class) ||
    asNonEmptyString(runSummary.context_budget_failure_class) ||
    null;
  const issues = [];
  if (!runHealthStatus) {
    issues.push("source run-health status is missing");
  } else if (!ASSESSABLE_RUN_HEALTH_STATUSES.includes(runHealthStatus)) {
    issues.push(`source run-health status is '${runHealthStatus}'`);
  }
  if (!observationStatus) {
    issues.push("source observation status is missing");
  } else if (!ASSESSABLE_OBSERVATION_STATUSES.includes(observationStatus)) {
    issues.push(`source observation status is '${observationStatus}'`);
  }
  if (failureClass === "compiled_context_budget_exceeded") {
    issues.push("flow stopped at context-budget guardrail before outcome artifacts were produced");
  }
  return {
    ok: issues.length === 0,
    runHealthStatus,
    observationStatus,
    failureClass,
    issues,
  };
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
  const pairedAorOperatorUiRunSummaryFile = resolveOptionalStringFlag(
    flags["paired-aor-operator-ui-run-summary-file"],
    "paired-aor-operator-ui-run-summary-file",
  );
  const writeDraftReport = resolveOptionalBooleanFlag(flags["write-draft-report"], "write-draft-report");
  const runId = asNonEmptyString(runSummary.run_id) || "live-e2e-run";
  const profileId = asNonEmptyString(runSummary.profile_id) || null;
  const featureSize = asNonEmptyString(runSummary.feature_size) || null;
  const missionClass =
    asNonEmptyString(runSummary.mission_class) ||
    (featureSize === "small" ? "flow-regression" : featureSize ? "product-change" : null);
  const productAcceptanceRequired =
    missionClass === "product-change" && ["medium", "large", "xlarge"].includes(featureSize ?? "");
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
  const readiness = resolveAssessmentReadiness(runSummary, observationReport, runHealthReport);
  if (!readiness.ok) {
    throw new UsageError(
      [
        "Quality assessment can be prepared only after a completed full flow with pass/warn run-health and observation status.",
        `run_health_status=${readiness.runHealthStatus ?? "missing"}`,
        `observation_status=${readiness.observationStatus ?? "missing"}`,
        readiness.failureClass ? `failure_class=${readiness.failureClass}` : null,
        `issues=${readiness.issues.join("; ")}`,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
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
      live_e2e_quality_assessment_report: "post-run outcome assessment for artifacts, code, verification, delivery safety, AOR operator UI/UX, AOR operator accessibility, and traceability; mandatory for medium+ product acceptance",
    },
    run_identity: {
      target_catalog_id: asNonEmptyString(runSummary.target_catalog_id) || null,
      feature_mission_id: asNonEmptyString(runSummary.feature_mission_id) || null,
      scenario_family: asNonEmptyString(runSummary.scenario_family) || null,
      provider_variant_id: asNonEmptyString(runSummary.provider_variant_id) || null,
      feature_size: featureSize,
      mission_class: missionClass,
      product_acceptance_required: productAcceptanceRequired,
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
      productAcceptanceRequired
        ? "This medium+ product-change mission requires final all-pass quality for product acceptance."
        : "This small flow-regression mission uses lightweight canary quality follow-up unless a stricter local gate is requested.",
      "Use status pass|warn|fail|not_evaluated for every required dimension.",
      "Use evidence_strength strong|medium|weak|missing for every required dimension.",
      "Populate inspected_evidence_refs for every evaluated dimension.",
      "Use not_evaluated only with evidence_strength=missing and an explicit finding explaining the gap.",
      "Make gap_report match dimensions: every not_evaluated, weak, and strong dimension must be listed in the corresponding gap_report array.",
      "Treat default evaluation reports as supporting evidence unless their mission coverage is directly inspected.",
      "Assess only the AOR operator and installed-user UI/UX in the AOR UI dimensions.",
      "Do not use checked-repository frontend behavior as live E2E AOR operator UI/UX evidence; repository frontend work belongs under implementation and verification dimensions when the mission requires it.",
      "Treat aor app --smoke as a render guardrail, not UX proof.",
      "Treat AOR operator UI/UX as strong only when browser/task inspection or explicit SWE inspection cites concrete evidence refs.",
      "For all-pass policy, security_review and performance_regression_risk must be evaluated with pass status and medium or strong evidence.",
      "For all-pass policy, AOR operator UI/UX and accessibility may cite a paired guided AOR operator proof from the same AOR commit because those dimensions assess AOR itself, not the target repository UI.",
      "For all-pass policy, aor_operator_accessibility_quality requires browser-task proof or SWE-inspected evidence refs for every AOR operator accessibility subdimension.",
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
      "Do not change run-health or provider qualification status from this assessment; medium+ product acceptance consumes the separate all-pass gate.",
      "Call out dimensions that were not checked, checked with weak signal, or confirmed by strong evidence.",
    ],
  };
  attachPairedAorOperatorUiEvidence(request, pairedAorOperatorUiRunSummaryFile, path.dirname(runSummaryFile));
  request.assessment_request_file = requestFile;
  writeJson(requestFile, request);
  let draftAssessmentReportFile = null;
  if (writeDraftReport) {
    const draftReport = buildDraftAssessmentReport(request, expectedAssessmentReportFile);
    const draftValidation = validateContractDocument({
      family: "live-e2e-quality-assessment-report",
      document: draftReport,
      source: expectedAssessmentReportFile,
    });
    if (!draftValidation.ok) {
      const issues = draftValidation.issues.map((issue) => issue.message).join("; ");
      throw new Error(`Draft quality assessment report failed contract validation: ${issues}`);
    }
    writeJson(expectedAssessmentReportFile, draftReport);
    draftAssessmentReportFile = expectedAssessmentReportFile;
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        command: "scripts live-e2e quality-assessment prepare",
        status: "ok",
        run_id: runId,
        assessment_request_file: requestFile,
        expected_assessment_report_file: expectedAssessmentReportFile,
        draft_assessment_report_file: draftAssessmentReportFile,
      },
      null,
      2,
    )}\n`,
  );
  return 0;
}

/**
 * @param {Record<string, unknown>} assessment
 * @param {string} baseDir
 * @returns {{ ok: boolean, issues: Array<{ code: string, field: string, message: string }> }}
 */
function evaluateAllPassGate(assessment, baseDir) {
  const issues = [];
  const dimensions = asRecord(assessment.dimensions);
  if (assessment.overall_status !== "pass") {
    issues.push({
      code: "overall_status_not_pass",
      field: "overall_status",
      message: `All-pass policy requires overall_status=pass, got '${String(assessment.overall_status)}'.`,
    });
  }
  for (const dimensionKey of REQUIRED_DIMENSIONS) {
    const dimension = asRecord(dimensions[dimensionKey]);
    if (dimension.status !== "pass") {
      issues.push({
        code: "dimension_status_not_pass",
        field: `dimensions.${dimensionKey}.status`,
        message: `All-pass policy requires dimension '${dimensionKey}' to have status=pass.`,
      });
    }
    if (!ALL_PASS_ALLOWED_EVIDENCE_STRENGTHS.includes(asNonEmptyString(dimension.evidence_strength))) {
      issues.push({
        code: "dimension_evidence_strength_too_weak",
        field: `dimensions.${dimensionKey}.evidence_strength`,
        message: `All-pass policy requires dimension '${dimensionKey}' evidence_strength to be medium or strong.`,
      });
    }
    for (const [subdimensionKey, subdimension] of Object.entries(asRecord(dimension.subdimensions))) {
      const record = asRecord(subdimension);
      if (record.status !== "pass") {
        issues.push({
          code: "subdimension_status_not_pass",
          field: `dimensions.${dimensionKey}.subdimensions.${subdimensionKey}.status`,
          message: `All-pass policy requires AOR operator subdimension '${subdimensionKey}' to have status=pass.`,
        });
      }
      if (!ALL_PASS_ALLOWED_EVIDENCE_STRENGTHS.includes(asNonEmptyString(record.evidence_strength))) {
        issues.push({
          code: "subdimension_evidence_strength_too_weak",
          field: `dimensions.${dimensionKey}.subdimensions.${subdimensionKey}.evidence_strength`,
          message: `All-pass policy requires AOR operator subdimension '${subdimensionKey}' evidence_strength to be medium or strong.`,
        });
      }
    }
  }
  const gapReport = asRecord(assessment.gap_report);
  for (const field of ["not_evaluated_dimensions", "weak_signal_dimensions"]) {
    const values = asStringArray(gapReport[field]);
    if (values.length > 0) {
      issues.push({
        code: "gap_report_not_empty",
        field: `gap_report.${field}`,
        message: `All-pass policy requires '${field}' to be empty, got ${values.join(", ")}.`,
      });
    }
  }
  const dimensionFindings = Object.values(dimensions).flatMap((dimension) => {
    const findings = asRecord(dimension).findings;
    return Array.isArray(findings) ? findings : [];
  });
  const subdimensionFindings = Object.values(dimensions).flatMap((dimension) =>
    Object.values(asRecord(asRecord(dimension).subdimensions)).flatMap((subdimension) => {
      const findings = asRecord(subdimension).findings;
      return Array.isArray(findings) ? findings : [];
    }),
  );
  for (const [field, value] of [
    ["findings", assessment.findings],
    ["dimension_findings", dimensionFindings],
    ["subdimension_findings", subdimensionFindings],
  ]) {
    for (const [index, finding] of (Array.isArray(value) ? value : []).entries()) {
      const severity = asNonEmptyString(asRecord(finding).severity).toLowerCase();
      if (BLOCKING_FINDING_SEVERITIES.includes(severity)) {
        issues.push({
          code: "blocking_finding_present",
          field: `${field}[${index}].severity`,
          message: `All-pass policy rejects finding severity '${severity}'.`,
        });
      }
    }
  }
  const sourceRunSummaryFile = asNonEmptyString(assessment.source_run_summary_file);
  const resolvedSummaryFile = sourceRunSummaryFile ? resolveLocalEvidenceRef(sourceRunSummaryFile, baseDir) : null;
  if (resolvedSummaryFile && fs.existsSync(resolvedSummaryFile)) {
    const runSummary = asRecord(readJson(resolvedSummaryFile));
    const featureSize = asNonEmptyString(runSummary.feature_size);
    const missionClass =
      asNonEmptyString(runSummary.mission_class) ||
      (featureSize === "small" ? "flow-regression" : featureSize ? "product-change" : "");
    const productAcceptanceRequired =
      missionClass === "product-change" && ["medium", "large", "xlarge"].includes(featureSize);
    const runHealthStatus =
      asNonEmptyString(runSummary.live_e2e_run_health_overall_status) ||
      asNonEmptyString(runSummary.run_health_status) ||
      asNonEmptyString(asRecord(runSummary.run_health).overall_status);
    if (productAcceptanceRequired && runHealthStatus !== "pass") {
      issues.push({
        code: "run_health_not_pass",
        field: "source_run_summary_file.live_e2e_run_health_overall_status",
        message: `Product acceptance requires run-health pass, got '${runHealthStatus || "missing"}'.`,
      });
    }
    if (productAcceptanceRequired) {
      const stepObservationFiles = asStringArray(runSummary.live_e2e_step_observation_files);
      const stepQualityAssessmentReportFiles = asStringArray(runSummary.live_e2e_step_quality_assessment_report_files);
      if (!asNonEmptyString(runSummary.target_checkout_root)) {
        issues.push({
          code: "target_checkout_root_missing",
          field: "source_run_summary_file.target_checkout_root",
          message: "Product acceptance requires a canonical target_checkout_root in the run summary.",
        });
      }
      if (stepQualityAssessmentReportFiles.length < stepObservationFiles.length) {
        issues.push({
          code: "step_quality_assessment_missing",
          field: "source_run_summary_file.live_e2e_step_quality_assessment_report_files",
          message: `Product acceptance requires an accepted step-quality report for every observed step (${stepQualityAssessmentReportFiles.length}/${stepObservationFiles.length}).`,
        });
      }
      for (const [index, reportRef] of stepQualityAssessmentReportFiles.entries()) {
        const resolvedReport = resolveLocalEvidenceRef(reportRef, path.dirname(resolvedSummaryFile));
        if (!resolvedReport || !fs.existsSync(resolvedReport)) {
          issues.push({
            code: "step_quality_assessment_missing",
            field: `source_run_summary_file.live_e2e_step_quality_assessment_report_files[${index}]`,
            message: `Step-quality assessment report '${reportRef}' was not found.`,
          });
          continue;
        }
        const stepQualityReport = asRecord(readJson(resolvedReport));
        if (asNonEmptyString(stepQualityReport.status) !== "accepted" || asNonEmptyString(stepQualityReport.decision) !== "continue") {
          issues.push({
            code: "step_quality_assessment_not_accepted",
            field: `source_run_summary_file.live_e2e_step_quality_assessment_report_files[${index}]`,
            message: `Step-quality assessment report '${reportRef}' must be accepted/continue for product acceptance.`,
          });
        }
      }
    }
    const meaningfulChangedPaths = asStringArray(runSummary.meaningful_changed_paths);
    const targetChangedPaths = meaningfulChangedPaths.filter((entry) => !entry.startsWith(".aor/"));
    const sourceChangedPaths = collectSourceReportChangedPaths(runSummary, path.dirname(resolvedSummaryFile));
    const sourceReportChangedPaths = uniqueStrings([
      ...sourceChangedPaths.runtimeHarnessChangedPaths,
      ...sourceChangedPaths.reviewChangedPaths,
    ]).filter((entry) => !entry.startsWith(".aor/"));
    if (sourceReportChangedPaths.length > 0 && targetChangedPaths.length === 0) {
      issues.push({
        code: "changed_path_lineage_mismatch",
        field: "source_run_summary_file.meaningful_changed_paths",
        message: `Source runtime/review reports recorded meaningful changed paths (${sourceReportChangedPaths.join(", ")}) but the run summary did not preserve them.`,
      });
    }
    if (targetChangedPaths.length === 0) {
      issues.push({
        code: "meaningful_target_change_missing",
        field: "source_run_summary_file.meaningful_changed_paths",
        message: "All-pass policy requires at least one meaningful target changed path outside .aor/.",
      });
    }
    const postRunVerifyStatus = asNonEmptyString(runSummary.post_run_verify_status);
    if (productAcceptanceRequired && postRunVerifyStatus && postRunVerifyStatus !== "pass") {
      issues.push({
        code: "post_run_verify_not_pass",
        field: "source_run_summary_file.post_run_verify_status",
        message: `Product acceptance requires post_run_verify_status=pass when primary verification evidence is present, got '${postRunVerifyStatus}'.`,
      });
    }
    const postRunDiagnosticStatus = asNonEmptyString(runSummary.post_run_diagnostic_status);
    if (postRunDiagnosticStatus && postRunDiagnosticStatus !== "pass") {
      issues.push({
        code: "post_run_diagnostic_not_pass",
        field: "source_run_summary_file.post_run_diagnostic_status",
        message: `All-pass policy requires post_run_diagnostic_status=pass when diagnostic evidence is present, got '${postRunDiagnosticStatus}'.`,
      });
    }
  }
  return { ok: issues.length === 0, issues };
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
function gateCli(rawArgs) {
  const flags = parseFlags(rawArgs);
  const policy = resolveOptionalStringFlag(flags.policy, "policy") ?? "all-pass";
  if (policy !== "all-pass") {
    throw new UsageError("Flag '--policy' must be 'all-pass'.");
  }
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
  const gate = evaluateAllPassGate(assessment, path.dirname(assessmentReportFile));
  const ok = validation.ok && refValidation.missing.length === 0 && gate.ok;
  process.stdout.write(
    `${JSON.stringify(
      {
        command: "scripts live-e2e quality-assessment gate",
        status: ok ? "ok" : "fail",
        policy,
        assessment_report_file: assessmentReportFile,
        contract_validation_ok: validation.ok,
        contract_issue_count: validation.issues.length,
        contract_issues: validation.issues,
        checked_local_ref_count: refValidation.checked.length,
        skipped_external_ref_count: refValidation.skipped.length,
        missing_local_refs: refValidation.missing,
        gate_issue_count: gate.issues.length,
        gate_issues: gate.issues,
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
        "Usage: node ./scripts/live-e2e/quality-assessment.mjs prepare --run-summary-file <file> [--write-draft-report]",
        "       node ./scripts/live-e2e/quality-assessment.mjs validate --assessment-report-file <file>",
        "       node ./scripts/live-e2e/quality-assessment.mjs gate --policy all-pass --assessment-report-file <file>",
        "",
        "Prepares, validates, and gates post-run outcome quality assessment artifacts without changing run-health or qualification status.",
      ].join("\n"),
    );
    return 0;
  }
  const [command, ...rest] = rawArgs;
  if (command === "prepare") return prepareCli(rest);
  if (command === "validate") return validateCli(rest);
  if (command === "gate") return gateCli(rest);
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
