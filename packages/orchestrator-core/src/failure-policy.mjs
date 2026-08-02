function asRecord(value) {
  return typeof value === "object" && value !== null ? value : {};
}

function strings(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

export function applyExecutableFailurePolicy(outcome, policyResolution) {
  if (["pass", "block", "fail"].includes(outcome.decision)) return outcome;
  const profile = asRecord(asRecord(policyResolution.policy).profile);
  const selected = asRecord(profile[outcome.decision]);
  if (strings(selected.on).includes(outcome.failureClass)) return outcome;
  if (strings(asRecord(profile.escalation).on).includes(outcome.failureClass)) {
    return { ...outcome, decision: "escalate" };
  }
  return { ...outcome, decision: "block" };
}
