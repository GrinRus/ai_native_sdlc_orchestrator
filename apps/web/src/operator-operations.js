export async function executeOperatorControl({ control, runLifecycle, refresh }) {
  const result = await runLifecycle(control.operation.command, control.operation.flags);
  const refs = [...(result?.lifecycle_command?.artifact_refs ?? []), ...(result?.lifecycle_command?.evidence_refs ?? [])];
  await runLifecycle("next", { json: true });
  await refresh();
  return refs;
}

export async function createOrResumeOperatorRequest({ apiProjectBase, operation, form, stage, flow, readJson, onCreated }) {
  let request = operation?.phase === "run-pending" ? operation.request : null;
  if (!request) {
    const create = await readJson(`${apiProjectBase}/operator-requests`, {
      method: "POST", headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ source_surface: "web", target_stage: stage.id, intent_type: form.intent, request_text: form.requestText, ...(flow?.flow_id ? { target_flow_id: flow.flow_id } : {}), target_refs: form.targetRefs, allowed_paths: form.allowedPaths, delivery_mode: form.deliveryMode }),
    });
    request = create.operator_request;
    onCreated?.(request);
  }
  const run = await readJson(`${apiProjectBase}/operator-requests/${encodeURIComponent(request.request_id)}/actions`, {
    method: "POST", headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ action: "run", request_ref: request.operator_request_ref, target_step: form.targetStep }),
  });
  return { request, result: run.operator_request_run ?? null };
}
