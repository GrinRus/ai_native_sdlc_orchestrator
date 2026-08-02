export function parentRunRows(runs, flowId = null) {
  return (Array.isArray(runs) ? runs : [])
    .filter((run) => run?.parent_run)
    .filter((run) => !flowId || !run.flow_id || run.flow_id === flowId)
    .map((run) => ({ run_id: run.run_id, ...run.parent_run }));
}

export function deliveryTransactionRows(manifests) {
  return (Array.isArray(manifests) ? manifests : []).map((entry) => {
    const manifest = entry?.document ?? entry;
    const transaction = manifest?.coordination_transaction ?? {};
    const status = transaction.status ?? (manifest?.status === "submitted" ? "complete" : "blocked");
    return {
      manifest_id: manifest?.manifest_id,
      status,
      partial: status === "partial" || (transaction.failed_repo_ids?.length ?? 0) > 0,
      repo_deliveries: manifest?.repo_deliveries ?? [],
      integration_report_ref: transaction.integration_report_ref ?? manifest?.approval_context?.integration?.report_ref ?? null,
      rollback_refs: transaction.rollback_refs ?? [],
    };
  });
}

export function integrationCommand(action, parent, unit = null) {
  const flags = {
    "parent-run-id": parent.parent_run_id ?? parent.run_id,
    "command-id": `${parent.parent_run_id ?? parent.run_id}-${action}-${parent.revision + 1}`,
    "expected-revision": parent.revision,
  };
  if (action !== "retry") flags.action = action;
  if (unit?.execution_unit_id) flags["execution-unit-id"] = unit.execution_unit_id;
  return { command: action === "retry" ? "run retry" : "run integration", flags };
}

export async function executeOrchestrationCommand({ request, busy, runLifecycle, refresh, setBusy, setError }) {
  if (busy || !request?.command) return;
  setBusy(true);
  setError("");
  try {
    await runLifecycle(request.command, request.flags ?? {});
    await refresh({ silent: true });
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
  }
}
