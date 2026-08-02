function findRequestedInteraction(value, depth = 0) {
  if (depth > 5 || !value || typeof value !== "object") return null;
  if (value.requested === true) return value;
  for (const child of Object.values(value)) {
    const match = findRequestedInteraction(child, depth + 1);
    if (match) return match;
  }
  return null;
}

export function classifyRunJobTerminalStatus(options) {
  if (options.currentStatus === "canceling" || ["SIGTERM", "SIGKILL"].includes(options.signal)) return "canceled";
  if (findRequestedInteraction(options.commandOutput?.requested_interaction ?? options.commandOutput)) return "waiting-input";
  return options.exitCode === 0 ? "succeeded" : "failed";
}
