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

export function createProjectGeneration() {
  let revision = 0;
  let controller = new AbortController();
  return {
    begin() {
      controller.abort();
      controller = new AbortController();
      revision += 1;
      return { revision, signal: controller.signal };
    },
    current() {
      return { revision, signal: controller.signal };
    },
    isCurrent(candidate) {
      return candidate === revision && !controller.signal.aborted;
    },
    cancel() {
      controller.abort();
    },
  };
}

export async function readResourceSnapshot(resourceReaders, previous = {}) {
  const entries = Object.entries(resourceReaders);
  const settled = await Promise.allSettled(entries.map(([, reader]) => reader()));
  const data = { ...previous };
  const errors = {};
  settled.forEach((result, index) => {
    const [key] = entries[index];
    if (result.status === "fulfilled") data[key] = result.value;
    else errors[key] = result.reason instanceof OperatorError
      ? result.reason
      : new OperatorError({ detail: result.reason instanceof Error ? result.reason.message : String(result.reason) });
  });
  const errorCount = Object.keys(errors).length;
  return {
    data,
    errors,
    status: errorCount === 0 ? "connected" : errorCount === entries.length ? "offline" : "partial",
  };
}

export function readProjectResourceSnapshot({ base, statePreview, previous, requestOptions = {} }) {
  const optionalRead = (url) => readControlPlaneJson(url, requestOptions).catch((error) => {
    if (error.status === 404) return null;
    throw error;
  });
  return readResourceSnapshot({
    state: () => statePreview ? Promise.resolve(statePreview) : readControlPlaneJson(`${base}/state`, requestOptions),
    next: () => optionalRead(`${base}/next-action-report`),
    flowPayload: () => readControlPlaneJson(`${base}/flows`, requestOptions),
    selectedFlowPayload: () => optionalRead(`${base}/flows/selected`),
    packetList: () => readControlPlaneJson(`${base}/packets`, requestOptions),
    stepList: () => readControlPlaneJson(`${base}/step-results`, requestOptions),
    runList: () => readControlPlaneJson(`${base}/runs`, requestOptions),
    requestList: () => readControlPlaneJson(`${base}/operator-requests`, requestOptions),
  }, previous);
}
