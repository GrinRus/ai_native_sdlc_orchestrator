import {
  CliUsageError,
  OperatorRequestError,
  createOperatorRequest,
  ensureRequiredFlags,
  getOperatorRequestStatus,
  resolveOptionalCsvFlag,
  resolveOptionalStringFlag,
  runOperatorRequest,
} from "../command-runtime.mjs";

export const REQUEST_COMMANDS = Object.freeze([
  "request create",
  "request run",
  "request status",
]);

export const REQUEST_COMMAND_GROUP = Object.freeze({
  group_id: "operator-requests",
  commands: REQUEST_COMMANDS,
});

/**
 * @param {{ result: ReturnType<typeof createOperatorRequest> | ReturnType<typeof getOperatorRequestStatus>, outputState: Record<string, unknown> }} options
 */
function applyOperatorRequestOutput(options) {
  options.outputState.resolvedProjectRef = options.result.projectRoot;
  options.outputState.resolvedRuntimeRoot = options.result.runtimeRoot;
  options.outputState.operatorRequest = options.result.operatorRequest;
  options.outputState.operatorRequestFile = options.result.operatorRequestFile;
  options.outputState.operatorRequestRef = options.result.operatorRequestRef;
  options.outputState.operatorRequestId = options.result.requestId;
  options.outputState.operatorRequestStatus = options.result.status;
}

/**
 * @param {{ command: string, flags: Record<string, string | string[] | true>, cwd: string, outputState: Record<string, unknown> }} context
 * @returns {boolean}
 */
export function handleRequestCommand(context) {
  const { command, flags, cwd, outputState } = context;

  try {
    if (command === "request create") {
      ensureRequiredFlags(command, flags);
      const result = createOperatorRequest({
        cwd,
        projectRef: /** @type {string} */ (flags["project-ref"]),
        projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
        runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
        sourceSurface: "cli",
        targetStage: resolveOptionalStringFlag("stage", flags.stage) ?? "",
        intentType: resolveOptionalStringFlag("intent", flags.intent) ?? "",
        requestText: resolveOptionalStringFlag("request", flags.request) ?? "",
        targetRefs: resolveOptionalCsvFlag("target-ref", flags["target-ref"]),
        allowedPaths: resolveOptionalCsvFlag("allowed-path", flags["allowed-path"]),
        deliveryMode: resolveOptionalStringFlag("delivery-mode", flags["delivery-mode"]),
      });
      applyOperatorRequestOutput({ result, outputState });
      outputState.readOnly = false;
      outputState.futureControlHooks = ["request run", "request status", "next"];
      return true;
    }

    if (command === "request run") {
      ensureRequiredFlags(command, flags);
      const result = runOperatorRequest({
        cwd,
        projectRef: /** @type {string} */ (flags["project-ref"]),
        projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
        runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
        requestRef: resolveOptionalStringFlag("request-ref", flags["request-ref"]) ?? "",
        targetStep: resolveOptionalStringFlag("target-step", flags["target-step"]),
      });
      applyOperatorRequestOutput({ result, outputState });
      outputState.operatorRequestRun = {
        request_id: result.requestId,
        operator_request_ref: result.operatorRequestRef,
        run_id: result.runId,
        routed_step_result_file: result.routedStepResultFile,
        routed_step_result_ref: result.routedStepResultRef,
        compiled_context_ref: result.compiledContextRef,
        proposal_refs: result.proposalRefs,
        patch_refs: result.patchRefs,
        next_action_report_file: result.nextActionReportFile,
        next_action_report_ref: result.nextActionReportRef,
      };
      outputState.runControlRunId = result.runId;
      outputState.routedStepResultFile = result.routedStepResultFile;
      outputState.compiledContextRef = result.compiledContextRef;
      outputState.proposalRefs = result.proposalRefs;
      outputState.patchRefs = result.patchRefs;
      outputState.nextActionReportFile = result.nextActionReportFile;
      outputState.readOnly = false;
      outputState.futureControlHooks = ["request status", "next"];
      return true;
    }

    if (command === "request status") {
      ensureRequiredFlags(command, flags);
      const result = getOperatorRequestStatus({
        cwd,
        projectRef: /** @type {string} */ (flags["project-ref"]),
        projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
        runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
        requestRef: resolveOptionalStringFlag("request-ref", flags["request-ref"]) ?? "",
      });
      applyOperatorRequestOutput({ result, outputState });
      outputState.readOnly = true;
      outputState.futureControlHooks = ["request run", "next"];
      return true;
    }
  } catch (error) {
    if (error instanceof OperatorRequestError) {
      throw new CliUsageError(`${error.code}: ${error.message}`);
    }
    throw error;
  }

  return false;
}
