import { asString, asStringArray, readMutationPayload, sendError, sendJson } from "./http-utils.mjs";
import { OperatorRequestError, createOperatorRequest, runOperatorRequest } from "../../operator-request.mjs";

function sendOperatorRequestError(response, error) {
  if (!(error instanceof OperatorRequestError)) return false;
  sendError(response, error.statusCode, error.code, error.message);
  return true;
}

export async function handleOperatorRequestCreate({ request, response, runtimeOptions }) {
  const payload = await readMutationPayload(request, response);
  if (!payload) return;

  try {
    const result = createOperatorRequest({
      ...runtimeOptions,
      sourceSurface: asString(payload.source_surface) ?? "api",
      targetStage: asString(payload.target_stage) ?? "",
      intentType: asString(payload.intent_type) ?? "",
      requestText: asString(payload.request_text) ?? asString(payload.request) ?? "",
      targetFlowId: asString(payload.target_flow_id) ?? undefined,
      idempotencyKey: asString(payload.idempotency_key) ?? undefined,
      targetRefs: asStringArray(payload.target_refs),
      allowedPaths: asStringArray(payload.allowed_paths),
      deliveryMode: asString(payload.delivery_mode) ?? undefined,
    });
    sendJson(response, result.idempotent ? 200 : 201, {
      operator_request: {
        request_id: result.requestId,
        operator_request_ref: result.operatorRequestRef,
        operator_request_file: result.operatorRequestFile,
        status: result.status,
        idempotent: result.idempotent === true,
        document: result.operatorRequest,
      },
    });
  } catch (error) {
    if (sendOperatorRequestError(response, error)) return;
    throw error;
  }
}

export async function handleOperatorRequestAction({ request, response, params, runtimeOptions }) {
  const payload = await readMutationPayload(request, response);
  if (!payload) return;

  const action = asString(payload.action);
  if (action !== "run") {
    sendError(response, 400, "operator_request.invalid_action", `Unsupported operator request action '${action ?? "missing"}'.`);
    return;
  }

  try {
    const requestRef = asString(payload.request_ref) ?? params.requestId;
    const result = runOperatorRequest({
      ...runtimeOptions,
      requestRef,
      targetStep: asString(payload.target_step) ?? undefined,
    });
    sendJson(response, 200, {
      operator_request_run: {
        request_id: result.requestId,
        operator_request_ref: result.operatorRequestRef,
        operator_request_file: result.operatorRequestFile,
        run_id: result.runId,
        routed_step_result_file: result.routedStepResultFile,
        routed_step_result_ref: result.routedStepResultRef,
        compiled_context_ref: result.compiledContextRef,
        proposal_refs: result.proposalRefs,
        patch_refs: result.patchRefs,
        next_action_report_file: result.nextActionReportFile,
        next_action_report_ref: result.nextActionReportRef,
        document: result.operatorRequest,
      },
    });
  } catch (error) {
    if (sendOperatorRequestError(response, error)) return;
    throw error;
  }
}
