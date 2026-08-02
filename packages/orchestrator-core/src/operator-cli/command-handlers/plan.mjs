import {
  approveTaskPlan,
  createTaskPlan,
  diffTaskPlanRefs,
  ensureRequiredFlags,
  getTaskPlanStatus,
  requestTaskPlanRevision,
  resolveOptionalStringFlag,
  showTaskPlan,
} from "../command-runtime.mjs";

export const PLAN_COMMANDS = Object.freeze([
  "plan create",
  "plan show",
  "plan diff",
  "plan revise",
  "plan approve",
  "plan status",
]);

export const PLAN_COMMAND_GROUP = Object.freeze({ group_id: "structured-plans", commands: PLAN_COMMANDS });

export function handlePlanCommand({ command, flags, cwd, outputState }) {
  ensureRequiredFlags(command, flags);
  const common = {
    cwd,
    projectRef: /** @type {string} */ (flags["project-ref"]),
    projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
    runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
  };

  let result;
  if (command === "plan create") {
    result = createTaskPlan({
      ...common,
      ticketId: resolveOptionalStringFlag("ticket-id", flags["ticket-id"]),
      approvedArtifactPath: resolveOptionalStringFlag("approved-artifact", flags["approved-artifact"]),
    });
  } else if (command === "plan show") {
    result = showTaskPlan({ ...common, planRef: resolveOptionalStringFlag("plan-ref", flags["plan-ref"]) });
  } else if (command === "plan diff") {
    result = diffTaskPlanRefs({
      ...common,
      fromPlanRef: /** @type {string} */ (flags["from-plan-ref"]),
      toPlanRef: /** @type {string} */ (flags["to-plan-ref"]),
    });
  } else if (command === "plan revise") {
    result = requestTaskPlanRevision({
      ...common,
      planRef: /** @type {string} */ (flags["plan-ref"]),
      reason: /** @type {string} */ (flags.reason),
    });
  } else if (command === "plan approve") {
    result = approveTaskPlan({
      ...common,
      planRef: /** @type {string} */ (flags["plan-ref"]),
      approvalRef: /** @type {string} */ (flags["approval-ref"]),
    });
  } else if (command === "plan status") {
    result = getTaskPlanStatus({ ...common, planRef: resolveOptionalStringFlag("plan-ref", flags["plan-ref"]) });
  } else {
    return false;
  }

  outputState.resolvedProjectRef = result.projectRoot;
  outputState.resolvedRuntimeRoot = result.runtimeRoot;
  outputState.plan = result.plan ?? null;
  outputState.planRef = result.planRef ?? (result.planFile ? `evidence://${result.planFile}` : null);
  outputState.planFile = result.planFile ?? null;
  outputState.planDiff = result.diff ?? null;
  outputState.planRevisionRequest = result.revisionRequest ?? null;
  outputState.planRevisionRequestFile = result.revisionRequestFile ?? null;
  outputState.planValidationReport = result.planValidationReport ?? null;
  outputState.planValidationReportFile = result.planValidationReportFile ?? null;
  outputState.planningRun = result.planningRun ?? null;
  outputState.planningRunRef = result.planningRunRef ?? null;
  outputState.planningRunFile = result.planningRunFile ?? null;
  outputState.planEvaluationReport = result.planEvaluationReport ?? null;
  outputState.planEvaluationReportFile = result.planEvaluationReportFile ?? null;
  outputState.semanticEvaluationRun = result.semanticEvaluationRun ?? null;
  outputState.semanticEvaluationRunRef = result.semanticEvaluationRunRef ?? null;
  outputState.semanticEvaluationRunFile = result.semanticEvaluationRunFile ?? null;
  outputState.executionPlan = result.executionPlan ?? null;
  outputState.executionPlanFile = result.executionPlanFile ?? null;
  outputState.taskProgress = result.taskProgress ?? null;
  outputState.taskProgressFile = result.taskProgressFile ?? null;
  outputState.handoffPacketFile = result.handoffPacketFile ?? result.handoffFile ?? null;
  outputState.handoffPacketId = result.handoffPacket?.packet_id ?? result.handoff?.packet_id ?? null;
  outputState.handoffStatus = result.handoffPacket?.status ?? result.handoff?.status ?? null;
  outputState.handoffApprovalState = result.handoffPacket?.approval_state ?? result.handoff?.approval_state ?? null;
  outputState.waveTicketId = result.waveTicket?.ticket_id ?? result.plan?.ticket_id ?? null;
  outputState.waveTicketFile = result.waveTicketFile ?? result.planFile ?? null;
  outputState.readOnly = command === "plan show" || command === "plan diff" || command === "plan status";
  return true;
}
