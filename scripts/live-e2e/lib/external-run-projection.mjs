import fs from "node:fs";
import path from "node:path";

import {
  asNonEmptyString,
  asRecord,
  asStringArray,
  fileExists,
  normalizeId,
  nowIso,
  readJson,
  uniqueStrings,
  writeJson,
} from "./common.mjs";

export function materializeExternalRunProjectionIngress(options) {
  const targetCheckoutRoot = asNonEmptyString(options.artifacts.target_checkout_root);
  if (!targetCheckoutRoot) return [];
  const projectsRoot = path.join(targetCheckoutRoot, ".aor", "projects");
  if (!fs.existsSync(projectsRoot)) return [];
  const lifecycle = asRecord(options.runHealthReport.lifecycle_completion);
  const controllerHealth = asRecord(options.runHealthReport.controller_health);
  const evidenceHealth = asRecord(options.runHealthReport.evidence_health);
  const failureSummary = asRecord(options.runHealthReport.failure_summary);
  const controllerStateFile = asNonEmptyString(options.artifacts.live_e2e_controller_state_file);
  const controllerState = controllerStateFile && fileExists(controllerStateFile)
    ? asRecord(readJson(controllerStateFile))
    : {};
  const currentStep =
    asNonEmptyString(controllerState.current_step)
    || asNonEmptyString(lifecycle.blocked_step_id)
    || asNonEmptyString(lifecycle.blocked_step_instance_id);
  const pendingDecision = asRecord(controllerState.pending_decision);
  const status = asNonEmptyString(options.runHealthReport.overall_status) || "blocked";
  const blockers = [];
  if (["blocked", "fail", "failed", "not_pass"].includes(status)) {
    blockers.push({
      code: asNonEmptyString(failureSummary.class) || "external_run_blocked",
      severity: "critical",
      summary: asNonEmptyString(failureSummary.summary) || "External run is blocked.",
    });
  }
  if (asNonEmptyString(pendingDecision.action)) {
    blockers.push({
      code: `external_run.${currentStep || "current"}.pending_${pendingDecision.action}`,
      severity: "warning",
      summary: asNonEmptyString(pendingDecision.reason) || "External run requires an operator decision.",
    });
  }
  const generatedAt = asNonEmptyString(options.runHealthReport.generated_at) || nowIso();
  const projection = {
    schema_version: 1,
    projection_id: `external-run.${normalizeId(options.runId)}.v1`,
    run_id: options.runId,
    profile_id: asNonEmptyString(options.profile.profile_id) || undefined,
    status,
    report_status: asNonEmptyString(options.observationReport.report_status) || undefined,
    generated_at: generatedAt,
    current_step: currentStep || undefined,
    blocked_step_id: asNonEmptyString(lifecycle.blocked_step_id) || undefined,
    pending_steps: asStringArray(lifecycle.pending_steps),
    completed_steps: asStringArray(controllerState.completed_steps),
    missing_operator_decision_steps: uniqueStrings([
      ...asStringArray(lifecycle.missing_operator_decision_steps),
      ...asStringArray(controllerHealth.missing_operator_decision_steps),
    ]),
    missing_evidence_refs: asStringArray(evidenceHealth.missing_evidence_refs),
    failure_summary: Object.keys(failureSummary).length > 0 ? failureSummary : undefined,
    pending_decision: Object.keys(pendingDecision).length > 0 ? pendingDecision : undefined,
    resume_interaction_health: asRecord(options.runHealthReport.resume_interaction_health),
    controller_health: {
      status: asNonEmptyString(controllerHealth.status),
      missing_phase_evidence: asStringArray(controllerHealth.missing_phase_evidence),
    },
    blockers,
    artifact_display_summaries: [{
      artifact_ref: `evidence://external-runs/${options.runId}/health`,
      type: "run-health",
      stage: currentStep || "execution",
      label: "Run health",
      description: asNonEmptyString(failureSummary.summary) || `External run health is ${status}.`,
      status,
      timestamp: generatedAt,
    }],
    evidence_refs: [`evidence://external-runs/${options.runId}/health`],
  };
  const written = [];
  for (const entry of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const reportsRoot = path.join(projectsRoot, entry.name, "reports");
    fs.mkdirSync(reportsRoot, { recursive: true });
    const projectionFile = path.join(reportsRoot, `external-run-projection-${normalizeId(options.runId)}.json`);
    writeJson(projectionFile, projection);
    written.push(projectionFile);
  }
  return written;
}
