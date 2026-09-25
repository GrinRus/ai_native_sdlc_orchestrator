import { asRecord } from "../../contracts/src/value-normalization.mjs";

export function normalizeSemanticEvents(output, status) {
  if (Array.isArray(output.semantic_events)) {
    return output.semantic_events.map((event) => asRecord(event));
  }
  const failureKind = typeof output.failure_kind === "string" && output.failure_kind.trim()
    ? output.failure_kind.trim()
    : null;
  const eventType =
    failureKind === "permission-mode-blocked" || failureKind === "edit-denied"
      ? "permission-denial"
      : failureKind === "interactive-question-requested"
        ? "interaction-request"
        : failureKind === "external-runner-timeout"
          ? "timeout"
          : "terminal-result";
  return [{ event_type: eventType, status, failure_kind: failureKind }];
}
