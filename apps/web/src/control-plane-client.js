export class OperatorError extends Error {
  constructor(payload = {}, status = 0) {
    const detail = payload.detail ?? payload.message ?? "The control-plane request failed.";
    super(detail);
    this.name = "OperatorError";
    this.status = status;
    this.code = payload.code ?? "request_failed";
    this.title = payload.title ?? "Request failed";
    this.detail = detail;
    this.operation = payload.operation ?? null;
    this.phase = payload.phase ?? null;
    this.resource = payload.resource ?? null;
    this.consequence = payload.consequence ?? null;
    this.currentRevision = Number.isInteger(payload.current_revision) ? payload.current_revision : null;
    this.retryable = payload.retryable === true;
    this.fieldErrors = Array.isArray(payload.field_errors) ? payload.field_errors : [];
    this.evidenceRefs = Array.isArray(payload.evidence_refs) ? payload.evidence_refs : [];
    this.recoveryActions = Array.isArray(payload.recovery_actions) ? payload.recovery_actions : [];
  }
}

export async function readControlPlaneJson(url, options = {}, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.headers ?? {}),
    },
  });
  const raw = await response.text();
  const payload = raw.trim().length > 0 ? JSON.parse(raw) : {};
  if (!response.ok) throw new OperatorError(payload?.error ?? {}, response.status);
  return payload;
}
